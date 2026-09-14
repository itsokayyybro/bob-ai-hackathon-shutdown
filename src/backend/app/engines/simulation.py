"""
Simulation Engine.

Manages the discrete-event disaster response simulation:
- Maintains in-memory world state (assets, roads, bridges, resources, observations)
- Processes simulation events in order
- Coordinates evidence fusion, routing, and priority updates
- Provides the authoritative current world state for all APIs
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import (
    AssetDB, RoadDB, BridgeDB, ResourceDB, ObservationDB,
    AuditDB, DecisionDB, SimEventDB
)
from app.engines.evidence_fusion import fuse_observations
from app.engines.graph_engine import network as road_network
from app.engines.priority_engine import (
    compute_criticality, compute_priority, derive_urgency,
    derive_isolation_risk, derive_damage_severity, derive_confidence_factor
)
from app.engines.resource_optimizer import optimize_allocation, baseline_nearest_assignment
from app.models.domain import (
    Asset, Road, Bridge, Resource, Observation, EvidenceSummary,
    PriorityScore, ResponsePlan, AuditRecord, SimulationEvent,
    AssetStatus, RoadStatus, ResourceStatus, ObservationType,
    SourceType, EntityType, Location, Task, TaskType
)

logger = logging.getLogger(__name__)


class WorldState:
    """
    In-memory snapshot of the current simulation world.
    All state is authoritative here; database is the durable backing store.
    """

    def __init__(self) -> None:
        self.assets: dict[str, Asset] = {}
        self.roads: dict[str, Road] = {}
        self.bridges: dict[str, Bridge] = {}
        self.resources: dict[str, Resource] = {}
        self.observations: dict[str, Observation] = {}   # id → Observation
        self.evidence_cache: dict[str, EvidenceSummary] = {}  # "entity:type" → EvidenceSummary
        self.priorities: dict[str, PriorityScore] = {}
        self.tasks: dict[str, Task] = {}
        self.current_plan: Optional[ResponsePlan] = None
        self.baseline_plan: Optional[ResponsePlan] = None
        self.current_time_min: int = 0
        self.simulation_started: bool = False
        self.simulation_base_time: datetime = datetime.utcnow()
        self.processed_event_ids: set[str] = set()
        self.audit_log: list[AuditRecord] = []
        self.unprocessed_events: list[SimulationEvent] = []
        self.all_events: list[SimulationEvent] = []

    def get_now(self) -> datetime:
        """Simulated wall-clock time."""
        return self.simulation_base_time + timedelta(minutes=self.current_time_min)

    def _cache_key(self, entity_id: str, obs_type: ObservationType) -> str:
        return f"{entity_id}:{obs_type.value}"

    def get_entity_observations(
        self, entity_id: str, obs_type: Optional[ObservationType] = None
    ) -> list[Observation]:
        obs = [o for o in self.observations.values() if o.entity_id == entity_id and o.status == "active"]
        if obs_type:
            obs = [o for o in obs if o.observation_type == obs_type]
        return obs

    def get_evidence(self, entity_id: str, obs_type: ObservationType) -> Optional[EvidenceSummary]:
        return self.evidence_cache.get(self._cache_key(entity_id, obs_type))

    def get_all_evidence_for_entity(self, entity_id: str) -> list[EvidenceSummary]:
        prefix = f"{entity_id}:"
        return [v for k, v in self.evidence_cache.items() if k.startswith(prefix)]

    def fuse_entity(self, entity_id: str, obs_type: ObservationType) -> EvidenceSummary:
        """Re-fuse all active observations for this entity+type."""
        obs = self.get_entity_observations(entity_id, obs_type)
        summary = fuse_observations(obs, entity_id, obs_type, now=self.get_now())
        self.evidence_cache[self._cache_key(entity_id, obs_type)] = summary
        return summary

    def add_observation(self, obs: Observation) -> None:
        self.observations[obs.id] = obs
        # Re-fuse
        self.fuse_entity(obs.entity_id, obs.observation_type)

    def _apply_asset_status_from_evidence(self, entity_id: str) -> None:
        """Update asset status based on fused evidence."""
        asset = self.assets.get(entity_id)
        if not asset:
            return

        evidence = self.get_all_evidence_for_entity(entity_id)
        if not evidence:
            return

        # Map evidence values to AssetStatus
        value_status = {
            "overloaded": AssetStatus.OVERLOADED,
            "flooded": AssetStatus.FLOODED,
            "destroyed": AssetStatus.DESTROYED,
            "damaged": AssetStatus.DAMAGED,
            "evacuation_required": AssetStatus.EVACUATED,
            "unavailable": AssetStatus.DESTROYED,
        }
        for summary in evidence:
            new_status = value_status.get(summary.best_value)
            if new_status and summary.confidence >= 0.5:
                prev = asset.status
                asset.status = new_status
                if prev != new_status:
                    self._audit(
                        "asset_status_update",
                        entity_id=entity_id,
                        previous={"status": prev.value},
                        new={"status": new_status.value},
                        reason=f"Evidence fusion: {summary.best_value} (conf={summary.confidence:.2f})",
                    )
                break

    def _audit(
        self,
        event_type: str,
        entity_id: Optional[str] = None,
        previous: Optional[dict] = None,
        new: Optional[dict] = None,
        reason: str = "",
        decision_id: Optional[str] = None,
        confidence: float = 1.0,
    ) -> AuditRecord:
        record = AuditRecord(
            event_type=event_type,
            entity_id=entity_id,
            previous_state=previous,
            new_state=new,
            decision_id=decision_id,
            reason=reason,
            confidence=confidence,
            simulation_time_min=self.current_time_min,
        )
        self.audit_log.append(record)
        logger.info(f"AUDIT [{self.current_time_min}min] {event_type}: {reason}")
        return record


# ─────────────────────────────────────────────────────────────────────────────
# Simulation Engine
# ─────────────────────────────────────────────────────────────────────────────

class SimulationEngine:
    """
    Orchestrates the full disaster response simulation.
    """

    def __init__(self, state: WorldState) -> None:
        self.state = state

    async def load_from_db(self, session: AsyncSession) -> None:
        """Load world state from database."""
        state = self.state
        state.assets = {}
        state.roads = {}
        state.bridges = {}
        state.resources = {}
        state.observations = {}
        state.evidence_cache = {}
        state.priorities = {}
        state.tasks = {}
        state.current_plan = None
        state.unprocessed_events = []

        # Assets
        result = await session.execute(select(AssetDB))
        for row in result.scalars():
            asset = Asset(
                id=row.id,
                name=row.name,
                type=EntityType(row.type),
                location=Location(lat=row.lat, lon=row.lon, elevation_m=row.elevation_m),
                population=row.population,
                criticality=row.criticality,
                importance=row.importance,
                status=AssetStatus(row.status),
                metadata=json.loads(row.metadata_json or "{}"),
            )
            state.assets[row.id] = asset

        # Roads
        result = await session.execute(select(RoadDB))
        for row in result.scalars():
            road = Road(
                id=row.id,
                name=row.name,
                from_node=row.from_node,
                to_node=row.to_node,
                distance_km=row.distance_km,
                travel_time_min=row.travel_time_min,
                status=RoadStatus(row.status),
                risk=row.risk,
                vehicle_restrictions=json.loads(row.vehicle_restrictions_json or "[]"),
                confidence=row.confidence,
                last_updated=row.last_updated or datetime.utcnow(),
            )
            state.roads[row.id] = road

        # Bridges
        result = await session.execute(select(BridgeDB))
        for row in result.scalars():
            from app.models.domain import ConflictStatus
            bridge = Bridge(
                id=row.id,
                name=row.name,
                on_road=row.on_road,
                location=Location(lat=row.lat, lon=row.lon, elevation_m=row.elevation_m),
                status=RoadStatus(row.status),
                capacity=row.capacity,
                confidence=row.confidence,
                conflict_status=ConflictStatus(row.conflict_status or "none"),
                last_updated=row.last_updated or datetime.utcnow(),
            )
            state.bridges[row.id] = bridge

        # Resources
        result = await session.execute(select(ResourceDB))
        for row in result.scalars():
            resource = Resource(
                id=row.id,
                name=row.name,
                type=row.type,
                status=ResourceStatus(row.status),
                location_id=row.location_id,
                capabilities=[TaskType(c) for c in json.loads(row.capabilities_json or "[]")],
                capacity=row.capacity,
                current_task_id=row.current_task_id,
                metadata=json.loads(row.metadata_json or "{}"),
            )
            state.resources[row.id] = resource

        # Simulation events
        result = await session.execute(select(SimEventDB).order_by(SimEventDB.time_offset_min))
        state.all_events = []
        state.unprocessed_events = []
        for row in result.scalars():
            evt = SimulationEvent(
                id=row.id,
                time_offset_min=row.time_offset_min,
                event_type=row.event_type,
                description=row.description,
                entity_id=row.entity_id,
                source_type=SourceType(row.source_type) if row.source_type else SourceType.SIMULATION,
                observation_type=ObservationType(row.observation_type) if row.observation_type else None,
                value=row.value,
                confidence=row.confidence,
                severity=row.severity,
                metadata=json.loads(row.metadata_json or "{}"),
                processed=row.processed,
            )
            state.all_events.append(evt)
            if not row.processed:
                state.unprocessed_events.append(evt)

        # Rebuild road network graph
        road_network.rebuild(
            list(state.roads.values()),
            list(state.bridges.values()),
        )

        # Rebuild observations from DB
        result = await session.execute(select(ObservationDB).order_by(ObservationDB.timestamp))
        for row in result.scalars():
            obs_type = ObservationType(row.observation_type)
            obs = Observation(
                id=row.id,
                event_id=row.event_id,
                timestamp=row.timestamp,
                source_type=SourceType(row.source_type),
                source_id=row.source_id,
                entity_id=row.entity_id,
                observation_type=obs_type,
                value=row.value,
                severity=row.severity,
                confidence=row.confidence,
                freshness=row.freshness,
                raw_text=row.raw_text,
                structured_data=json.loads(row.structured_data_json or "{}"),
                provenance=json.loads(row.provenance_json or "{}"),
                status=row.status,
            )
            state.observations[obs.id] = obs

        # Re-fuse all observations
        self._fuse_all()

        # Compute initial priorities
        self._recalculate_priorities()

        # Initial tasks
        self._generate_tasks()

        logger.info(
            f"World loaded: {len(state.assets)} assets, {len(state.roads)} roads, "
            f"{len(state.bridges)} bridges, {len(state.resources)} resources, "
            f"{len(state.unprocessed_events)} pending events"
        )

    def _fuse_all(self) -> None:
        """Re-fuse all observations for all entities."""
        from collections import defaultdict
        entity_types: dict[str, set] = defaultdict(set)
        for obs in self.state.observations.values():
            if obs.status == "active":
                entity_types[obs.entity_id].add(obs.observation_type)
        for entity_id, obs_types in entity_types.items():
            for obs_type in obs_types:
                self.state.fuse_entity(entity_id, obs_type)

    def _recalculate_priorities(self) -> None:
        """Recalculate priority scores for all assets."""
        state = self.state
        now = state.get_now()

        for asset in state.assets.values():
            if asset.type in (EntityType.BRIDGE, EntityType.ROAD, EntityType.RIVER,
                               EntityType.RESOURCE_BASE, EntityType.INTERSECTION):
                continue

            evidence = state.get_all_evidence_for_entity(asset.id)

            # Derive factors from evidence
            urgency = derive_urgency(asset, evidence)
            isolation_risk = derive_isolation_risk(asset, evidence)
            damage_severity = derive_damage_severity(asset, evidence)
            confidence_factor = derive_confidence_factor(evidence)

            # Accessibility: check if any route exists from command center
            accessibility = self._compute_accessibility(asset.id)

            # Impact: normalized affected population
            impact = min(1.0, asset.population / 10000)

            criticality = compute_criticality(asset, damage_severity, isolation_risk)

            priority = compute_priority(
                asset, criticality, urgency, accessibility, confidence_factor, impact, evidence
            )
            state.priorities[asset.id] = priority

        logger.debug(f"Priorities recalculated for {len(state.priorities)} entities")

    def _compute_accessibility(self, entity_id: str) -> float:
        """
        0 = completely unreachable, 1 = fully accessible.
        Based on whether a route exists from command center.
        """
        origin = "CC1"  # Command center
        if entity_id == origin:
            return 1.0

        route = road_network.find_route(origin, entity_id)
        if not route.feasible:
            return 0.0

        # Penalize by risk
        return max(0.1, 1.0 - route.total_risk)

    def _generate_tasks(self) -> None:
        """Generate tasks based on current world state and evidence."""
        state = self.state
        state.tasks = {}  # Reset

        for asset in state.assets.values():
            if asset.type in (EntityType.BRIDGE, EntityType.ROAD, EntityType.RIVER,
                               EntityType.RESOURCE_BASE, EntityType.INTERSECTION):
                continue

            evidence = state.get_all_evidence_for_entity(asset.id)
            priority = state.priorities.get(asset.id)
            if not priority:
                continue

            # Generate task based on asset status and evidence
            task_type, urgency = self._determine_task_type(asset, evidence)
            if task_type is None:
                continue

            task = Task(
                id=f"TASK-{asset.id}-{task_type.value}",
                name=f"{task_type.value.replace('_', ' ').title()} at {asset.name}",
                task_type=task_type,
                target_entity_id=asset.id,
                priority=priority.priority_score,
                urgency=urgency,
                required_capabilities=[task_type],
                estimated_duration_min=self._estimate_duration(task_type),
                status="pending",
            )
            state.tasks[task.id] = task

    def _determine_task_type(
        self, asset: Asset, evidence: list[EvidenceSummary]
    ) -> tuple[Optional[TaskType], float]:
        """Determine what task is needed for this asset."""
        # Check evidence values
        for summary in evidence:
            if summary.best_value == "overloaded" and summary.confidence >= 0.5:
                if asset.type in (EntityType.HOSPITAL, EntityType.HEALTH_POST):
                    return TaskType.MEDICAL_RESPONSE, summary.confidence
            if summary.best_value == "evacuation_required" and summary.confidence >= 0.5:
                return TaskType.EVACUATION, summary.confidence
            if summary.best_value == "isolated" and summary.confidence >= 0.5:
                if asset.type == EntityType.VILLAGE:
                    return TaskType.RESCUE, summary.confidence
                return TaskType.SUPPLY_DELIVERY, summary.confidence
            if summary.best_value == "flooded" and summary.confidence >= 0.5:
                return TaskType.RESCUE, summary.confidence

        # Status-based
        if asset.status == AssetStatus.OVERLOADED:
            return TaskType.MEDICAL_RESPONSE, 0.85
        if asset.status == AssetStatus.EVACUATED:
            return TaskType.EVACUATION, 0.80
        if asset.status == AssetStatus.FLOODED:
            return TaskType.RESCUE, 0.80
        if asset.status == AssetStatus.DAMAGED:
            if asset.type in (EntityType.HOSPITAL, EntityType.HEALTH_POST):
                return TaskType.ENGINEERING, 0.70

        return None, 0.0

    def _estimate_duration(self, task_type: TaskType) -> int:
        durations = {
            TaskType.RESCUE: 45,
            TaskType.MEDICAL_RESPONSE: 30,
            TaskType.EVACUATION: 60,
            TaskType.ENGINEERING: 120,
            TaskType.SUPPLY_DELIVERY: 30,
            TaskType.VERIFICATION: 15,
        }
        return durations.get(task_type, 30)

    async def process_next_event(self, session: AsyncSession) -> Optional[SimulationEvent]:
        """Process the next unprocessed simulation event."""
        state = self.state
        if not state.unprocessed_events:
            return None

        evt = state.unprocessed_events.pop(0)
        state.current_time_min = evt.time_offset_min

        logger.info(f"PROCESSING EVENT [{evt.time_offset_min}min]: {evt.event_type} — {evt.description}")

        await self._process_event(evt, session)

        # Mark processed in DB
        result = await session.execute(select(SimEventDB).where(SimEventDB.id == evt.id))
        db_evt = result.scalar_one_or_none()
        if db_evt:
            db_evt.processed = True
            await session.commit()

        evt.processed = True
        state.processed_event_ids.add(evt.id)

        # Post-event pipeline
        self._fuse_all()
        self._recalculate_priorities()
        self._generate_tasks()
        await self._run_optimizer(session)

        return evt

    async def _process_event(self, evt: SimulationEvent, session: AsyncSession) -> None:
        """Handle a simulation event by updating world state."""
        state = self.state
        now = state.get_now()

        if evt.event_type == "normal_state":
            # Nothing to do — initial state
            return

        if not evt.entity_id or not evt.observation_type or not evt.value:
            # Non-observation events (system events)
            state._audit(evt.event_type, reason=evt.description)
            return

        # Create observation from event
        obs = Observation(
            event_id=evt.id,
            timestamp=now,
            source_type=evt.source_type,
            source_id=evt.event_type,
            entity_id=evt.entity_id,
            observation_type=evt.observation_type,
            value=evt.value,
            severity=evt.severity,
            confidence=evt.confidence,
            freshness=1.0,
            raw_text=evt.description,
            structured_data=evt.metadata,
            provenance={"event_id": evt.id, "event_type": evt.event_type},
        )
        state.add_observation(obs)

        # Persist observation
        obs_db = ObservationDB(
            id=obs.id,
            event_id=obs.event_id,
            timestamp=obs.timestamp,
            source_type=obs.source_type.value,
            source_id=obs.source_id,
            entity_id=obs.entity_id,
            observation_type=obs.observation_type.value,
            value=obs.value,
            severity=obs.severity,
            confidence=obs.confidence,
            freshness=obs.freshness,
            raw_text=obs.raw_text,
            structured_data_json=json.dumps(obs.structured_data),
            provenance_json=json.dumps(obs.provenance),
            status="active",
        )
        session.add(obs_db)
        await session.commit()

        # Apply direct state changes
        await self._apply_state_change(evt, obs, session)

    async def _apply_state_change(
        self, evt: SimulationEvent, obs: Observation, session: AsyncSession
    ) -> None:
        """Apply direct state mutations based on event type."""
        state = self.state
        entity_id = evt.entity_id

        if evt.event_type in ("bridge_damage_report", "conflicting_bridge_report", "bridge_confirmed_blocked"):
            bridge = state.bridges.get(entity_id)
            if bridge:
                summary = state.fuse_entity(entity_id, ObservationType.BRIDGE_STATUS)
                new_status = RoadStatus(summary.best_value) if summary.best_value in [e.value for e in RoadStatus] else RoadStatus.UNKNOWN
                prev_status = bridge.status
                bridge.status = new_status
                bridge.confidence = summary.confidence
                bridge.conflict_status = summary.conflict_status
                bridge.last_updated = state.get_now()

                # Update road network
                road_network.update_bridge(entity_id, new_status, summary.confidence)

                # Update DB
                result = await session.execute(select(BridgeDB).where(BridgeDB.id == entity_id))
                db_bridge = result.scalar_one_or_none()
                if db_bridge:
                    db_bridge.status = new_status.value
                    db_bridge.confidence = summary.confidence
                    db_bridge.conflict_status = summary.conflict_status.value
                    db_bridge.last_updated = state.get_now()
                    await session.commit()

                state._audit(
                    "bridge_status_updated",
                    entity_id=entity_id,
                    previous={"status": prev_status.value},
                    new={"status": new_status.value, "confidence": summary.confidence, "conflict": summary.conflict_status.value},
                    reason=f"Bridge {entity_id} status updated to {new_status.value} (conf={summary.confidence:.2f})",
                    confidence=summary.confidence,
                )
                logger.info(f"Bridge {entity_id}: {prev_status.value} → {new_status.value} (conf={summary.confidence:.2f})")

        elif evt.event_type == "road_blockage":
            road = state.roads.get(entity_id)
            if road:
                prev_status = road.status
                road.status = RoadStatus.BLOCKED
                road.confidence = obs.confidence
                road.last_updated = state.get_now()
                road_network.update_road(entity_id, RoadStatus.BLOCKED, obs.confidence)

                # Update DB
                result = await session.execute(select(RoadDB).where(RoadDB.id == entity_id))
                db_road = result.scalar_one_or_none()
                if db_road:
                    db_road.status = "blocked"
                    db_road.confidence = obs.confidence
                    db_road.last_updated = state.get_now()
                    await session.commit()

                state._audit(
                    "road_status_updated",
                    entity_id=entity_id,
                    previous={"status": prev_status.value},
                    new={"status": "blocked"},
                    reason=f"Road {entity_id} blocked: {evt.description}",
                )

        elif evt.event_type == "alternate_route_opened":
            road = state.roads.get(entity_id)
            if road:
                prev_status = road.status
                road.status = RoadStatus.OPEN
                road.confidence = obs.confidence
                road_network.update_road(entity_id, RoadStatus.OPEN, obs.confidence)

                result = await session.execute(select(RoadDB).where(RoadDB.id == entity_id))
                db_road = result.scalar_one_or_none()
                if db_road:
                    db_road.status = "open"
                    db_road.confidence = obs.confidence
                    await session.commit()

                state._audit(
                    "road_status_updated",
                    entity_id=entity_id,
                    previous={"status": prev_status.value},
                    new={"status": "open"},
                    reason=f"Route {entity_id} cleared: {evt.description}",
                )

        elif evt.event_type == "resource_unavailable":
            resource = state.resources.get(entity_id)
            if resource:
                prev_status = resource.status
                resource.status = ResourceStatus.UNAVAILABLE

                result = await session.execute(select(ResourceDB).where(ResourceDB.id == entity_id))
                db_res = result.scalar_one_or_none()
                if db_res:
                    db_res.status = "unavailable"
                    await session.commit()

                state._audit(
                    "resource_status_updated",
                    entity_id=entity_id,
                    previous={"status": prev_status.value},
                    new={"status": "unavailable"},
                    reason=f"Resource {entity_id} unavailable: {evt.metadata.get('reason', 'unknown')}",
                )

        elif evt.event_type in ("hospital_demand_surge",):
            asset = state.assets.get(entity_id)
            if asset:
                prev_status = asset.status.value
                asset.status = AssetStatus.OVERLOADED
                cap_pct = evt.metadata.get("capacity_pct", 0.74)
                asset.metadata["capacity_pct"] = cap_pct

                result = await session.execute(select(AssetDB).where(AssetDB.id == entity_id))
                db_asset = result.scalar_one_or_none()
                if db_asset:
                    db_asset.status = "overloaded"
                    meta = json.loads(db_asset.metadata_json or "{}")
                    meta["capacity_pct"] = cap_pct
                    db_asset.metadata_json = json.dumps(meta)
                    await session.commit()

                state._audit(
                    "asset_status_updated",
                    entity_id=entity_id,
                    previous={"status": prev_status},
                    new={"status": "overloaded", "capacity_pct": cap_pct},
                    reason=evt.description,
                )

        elif evt.event_type == "school_evacuation":
            asset = state.assets.get(entity_id)
            if asset:
                asset.status = AssetStatus.EVACUATED
                result = await session.execute(select(AssetDB).where(AssetDB.id == entity_id))
                db_asset = result.scalar_one_or_none()
                if db_asset:
                    db_asset.status = "evacuated"
                    await session.commit()

        elif evt.event_type == "satellite_observation":
            state._apply_asset_status_from_evidence(entity_id)

        elif evt.event_type == "village_isolation_confirmed":
            asset = state.assets.get(entity_id)
            if asset:
                asset.status = AssetStatus.FLOODED
                state._audit(
                    "village_isolated",
                    entity_id=entity_id,
                    previous={},
                    new={"isolated": True, "population": asset.population},
                    reason=evt.description,
                )

    async def _run_optimizer(self, session: AsyncSession) -> None:
        """Run resource optimizer and update the current response plan."""
        state = self.state
        resources = list(state.resources.values())
        tasks = list(state.tasks.values())

        if not tasks:
            return

        # AI system plan
        state.current_plan = optimize_allocation(
            resources, tasks, road_network, state.current_time_min
        )

        # Baseline plan
        state.baseline_plan = baseline_nearest_assignment(
            resources, tasks, road_network, state.current_time_min
        )

        # Persist decisions
        for decision in state.current_plan.decisions:
            dec_db = DecisionDB(
                id=decision.decision_id,
                timestamp=decision.timestamp,
                recommended_action=decision.recommended_action,
                target_entity_id=decision.target_entity_id,
                resource_id=decision.resource_id,
                priority=decision.priority,
                confidence=decision.confidence,
                reasons_json=json.dumps(decision.reasons),
                evidence_ids_json=json.dumps(decision.evidence_ids),
                constraints_json=json.dumps(decision.constraints),
                alternatives_json=json.dumps(decision.alternatives_considered),
                human_verification_required=decision.human_verification_required,
                simulation_time_min=state.current_time_min,
            )
            session.add(dec_db)

        await session.commit()

    async def inject_event(
        self,
        event_type: str,
        entity_id: Optional[str],
        obs_type: Optional[ObservationType],
        value: Optional[str],
        confidence: float,
        severity: float,
        description: str,
        source_type: SourceType,
        metadata: dict,
        session: AsyncSession,
    ) -> SimulationEvent:
        """Inject a custom event into the simulation."""
        evt = SimulationEvent(
            id=f"EVT-INJ-{uuid.uuid4().hex[:8].upper()}",
            time_offset_min=self.state.current_time_min,
            event_type=event_type,
            description=description,
            entity_id=entity_id,
            source_type=source_type,
            observation_type=obs_type,
            value=value,
            confidence=confidence,
            severity=severity,
            metadata=metadata,
            processed=False,
        )

        # Persist event
        evt_db = SimEventDB(
            id=evt.id,
            time_offset_min=evt.time_offset_min,
            event_type=evt.event_type,
            description=evt.description,
            entity_id=evt.entity_id,
            source_type=evt.source_type.value,
            observation_type=evt.observation_type.value if evt.observation_type else None,
            value=evt.value,
            confidence=evt.confidence,
            severity=evt.severity,
            metadata_json=json.dumps(evt.metadata),
            processed=False,
        )
        session.add(evt_db)
        await session.commit()

        # Process immediately
        self.state.all_events.append(evt)
        self.state.current_time_min = evt.time_offset_min
        await self._process_event(evt, session)
        self._fuse_all()
        self._recalculate_priorities()
        self._generate_tasks()
        await self._run_optimizer(session)

        evt.processed = True
        return evt

    async def reset(self, session: AsyncSession) -> None:
        """Reset simulation to initial state."""
        from sqlalchemy import delete
        # Clear observation, audit, decision, and sim event data
        await session.execute(delete(ObservationDB))
        await session.execute(delete(AuditDB))
        await session.execute(delete(DecisionDB))

        # Reset all sim events to unprocessed
        result = await session.execute(select(SimEventDB))
        for row in result.scalars():
            row.processed = False

        # Reset assets, roads, bridges, resources to initial
        from app.db.seed import _load_scenario
        scenario = _load_scenario()

        for a_data in scenario["assets"]:
            result = await session.execute(select(AssetDB).where(AssetDB.id == a_data["id"]))
            db_asset = result.scalar_one_or_none()
            if db_asset:
                db_asset.status = a_data.get("status", "operational")
                meta = a_data.get("metadata", {})
                db_asset.metadata_json = json.dumps(meta)

        for r_data in scenario["roads"]:
            result = await session.execute(select(RoadDB).where(RoadDB.id == r_data["id"]))
            db_road = result.scalar_one_or_none()
            if db_road:
                db_road.status = r_data.get("status", "open")
                db_road.confidence = 1.0

        for b_data in scenario["bridges"]:
            result = await session.execute(select(BridgeDB).where(BridgeDB.id == b_data["id"]))
            db_bridge = result.scalar_one_or_none()
            if db_bridge:
                db_bridge.status = b_data.get("status", "open")
                db_bridge.confidence = 1.0
                db_bridge.conflict_status = "none"

        for res_data in scenario["resources"]:
            result = await session.execute(select(ResourceDB).where(ResourceDB.id == res_data["id"]))
            db_res = result.scalar_one_or_none()
            if db_res:
                db_res.status = res_data.get("status", "available")
                db_res.current_task_id = None

        await session.commit()
        await self.load_from_db(session)
        logger.info("Simulation reset complete.")


# Global singleton
world_state = WorldState()
sim_engine = SimulationEngine(world_state)
