"""
FastAPI application — AI Emergency Operations & Resource Orchestration System.

Endpoints:
  GET  /health
  GET  /situation
  GET  /entities
  GET  /entities/{id}
  GET  /evidence/{entity_id}
  GET  /priorities
  GET  /resources
  GET  /routes
  POST /simulate/event
  POST /simulate/next
  POST /simulate/reset
  POST /simulate/auto
  POST /optimize
  GET  /decisions
  GET  /decisions/{id}
  GET  /benchmark
  GET  /timeline
  GET  /map-data
  POST /ai/question
  GET  /audit
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.db.database import get_db, init_db, DecisionDB, AuditDB, ObservationDB
from app.db.seed import seed_database, _load_scenario
from app.engines.simulation import sim_engine, world_state
from app.engines.graph_engine import network as road_network
from app.engines.benchmark import run_benchmark
from app.models.domain import (
    ObservationType, SourceType, RoadStatus, ResourceStatus
)
from app.utils.ai_provider import get_ai_provider

# Load scenario metadata once at import time so it is available to all routes.
_scenario_meta = _load_scenario()
SCENARIO_NAME: str = _scenario_meta.get("scenario_name", "Bhote Valley Emergency Simulation")
SCENARIO_DESCRIPTION: str = _scenario_meta.get("description", "")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and load world state on startup."""
    await init_db()
    async for session in get_db():
        await seed_database(session)
        await sim_engine.load_from_db(session)
        break
    logger.info("Application startup complete.")
    yield


app = FastAPI(
    title="AI Emergency Operations & Resource Orchestration System",
    description=(
        "Evidence-aware disaster response decision support platform. "
        "Bhote Valley Emergency Simulation — synthetic Nepal-inspired scenario."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────────────────────────────────────

class InjectEventRequest(BaseModel):
    event_type: str
    entity_id: Optional[str] = None
    observation_type: Optional[str] = None
    value: Optional[str] = None
    confidence: float = 0.85
    severity: float = 0.7
    description: str = "Injected event"
    source_type: str = "field_report"
    metadata: dict = {}


class AIQuestionRequest(BaseModel):
    question: str
    context_entity_id: Optional[str] = None


class ConfirmDecisionRequest(BaseModel):
    status: str                          # accepted | rejected | modified
    operator_notes: Optional[str] = None


class RouteRequest(BaseModel):
    origin: str
    destination: str
    vehicle_type: str = "heavy"


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": "1.0.0",
        "simulation_time_min": world_state.current_time_min,
        "assets": len(world_state.assets),
        "observations": len(world_state.observations),
        "pending_events": len(world_state.unprocessed_events),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Situation
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/situation")
async def get_situation():
    """Current situation overview — all critical data in one response."""
    state = world_state

    priorities = sorted(
        state.priorities.values(),
        key=lambda p: p.priority_score,
        reverse=True,
    )

    # Blocked infrastructure
    blocked_infra = []
    for road in state.roads.values():
        if road.status == RoadStatus.BLOCKED:
            blocked_infra.append(f"Road {road.id}: {road.name}")
    for bridge in state.bridges.values():
        if bridge.status == RoadStatus.BLOCKED:
            blocked_infra.append(f"Bridge {bridge.id}: {bridge.name}")

    # Evidence conflicts
    conflicts = []
    for summary in state.evidence_cache.values():
        if summary.conflict_status.value == "conflicting":
            entity = state.assets.get(summary.entity_id) or state.bridges.get(summary.entity_id)
            name = entity.name if entity else summary.entity_id
            conflicts.append(
                f"{name}: {summary.observation_type.value} — "
                f"best='{summary.best_value}' (conf={summary.confidence:.0%})"
            )

    # Unavailable resources
    unavail_resources = [r.name for r in state.resources.values() if r.status == ResourceStatus.UNAVAILABLE]

    plan_summary = ""
    if state.current_plan:
        plan_summary = state.current_plan.explanation

    return {
        "sim_time_min": state.current_time_min,
        "scenario": SCENARIO_NAME,
        "top_priorities": [
            {
                "entity_id": p.entity_id,
                "entity_name": p.entity_name,
                "entity_type": p.entity_type.value,
                "priority_score": p.priority_score,
                "criticality_score": p.criticality_score,
                "urgency_score": p.urgency_score,
                "accessibility_factor": p.accessibility_factor,
                "confidence_factor": p.confidence_factor,
                "impact_score": p.impact_score,
                "explanation": p.explanation,
                "supporting_factors": p.supporting_factors,
                "rank": i + 1,
            }
            for i, p in enumerate(priorities[:10])
        ],
        "blocked_infrastructure": blocked_infra,
        "evidence_conflicts": conflicts,
        "unavailable_resources": unavail_resources,
        "current_plan_summary": plan_summary,
        "pending_events": len(state.unprocessed_events),
        "total_events": len(state.all_events),
        "processed_events": len(state.processed_event_ids),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Entities
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/entities")
async def get_entities():
    """All assets, roads, and bridges."""
    state = world_state
    return {
        "assets": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.type.value,
                "lat": a.location.lat,
                "lon": a.location.lon,
                "elevation_m": a.location.elevation_m,
                "population": a.population,
                "status": a.status.value,
                "criticality": a.criticality,
                "importance": a.importance,
                "metadata": a.metadata,
            }
            for a in state.assets.values()
        ],
        "roads": [
            {
                "id": r.id,
                "name": r.name,
                "from_node": r.from_node,
                "to_node": r.to_node,
                "distance_km": r.distance_km,
                "travel_time_min": r.travel_time_min,
                "status": r.status.value,
                "risk": r.risk,
                "confidence": r.confidence,
            }
            for r in state.roads.values()
        ],
        "bridges": [
            {
                "id": b.id,
                "name": b.name,
                "on_road": b.on_road,
                "lat": b.location.lat,
                "lon": b.location.lon,
                "status": b.status.value,
                "capacity": b.capacity,
                "confidence": b.confidence,
                "conflict_status": b.conflict_status.value,
            }
            for b in state.bridges.values()
        ],
    }


@app.get("/entities/{entity_id}")
async def get_entity(entity_id: str):
    """Single entity with full evidence and priority data."""
    state = world_state
    entity = (
        state.assets.get(entity_id)
        or state.roads.get(entity_id)
        or state.bridges.get(entity_id)
    )
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    priority = state.priorities.get(entity_id)
    evidence = state.get_all_evidence_for_entity(entity_id)

    return {
        "entity": entity.model_dump(mode="json"),
        "priority": priority.model_dump(mode="json") if priority else None,
        "evidence": [e.model_dump(mode="json") for e in evidence],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Evidence
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/evidence/{entity_id}")
async def get_evidence(entity_id: str):
    """All evidence (fused + raw observations) for an entity."""
    state = world_state
    raw_obs = state.get_entity_observations(entity_id)
    evidence = state.get_all_evidence_for_entity(entity_id)

    return {
        "entity_id": entity_id,
        "evidence_summaries": [e.model_dump(mode="json") for e in evidence],
        "raw_observations": [
            {
                "id": o.id,
                "timestamp": o.timestamp.isoformat(),
                "source_type": o.source_type.value,
                "source_id": o.source_id,
                "observation_type": o.observation_type.value,
                "value": o.value,
                "confidence": o.confidence,
                "freshness": o.freshness,
                "severity": o.severity,
                "raw_text": o.raw_text,
                "provenance": o.provenance,
            }
            for o in raw_obs
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Priorities
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/priorities")
async def get_priorities():
    """Priority-ranked list of all entities."""
    state = world_state
    ranked = sorted(
        state.priorities.values(),
        key=lambda p: p.priority_score,
        reverse=True,
    )
    result = []
    for i, p in enumerate(ranked):
        p.rank = i + 1
        result.append(p.model_dump(mode="json"))
    return {"priorities": result, "calculated_at": datetime.utcnow().isoformat()}


# ─────────────────────────────────────────────────────────────────────────────
# Resources
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/resources")
async def get_resources():
    """All resources with current status."""
    state = world_state
    return {
        "resources": [
            {
                "id": r.id,
                "name": r.name,
                "type": r.type,
                "status": r.status.value,
                "location_id": r.location_id,
                "capabilities": [c.value for c in r.capabilities],
                "current_task_id": r.current_task_id,
                "metadata": r.metadata,
            }
            for r in state.resources.values()
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/routes")
async def get_routes(
    origin: str = Query(default="CC1"),
    destination: str = Query(default="H1"),
    vehicle_type: str = Query(default="heavy"),
):
    """Calculate route between two nodes."""
    route = road_network.find_route(origin, destination, vehicle_type)
    return route.model_dump(mode="json")


@app.post("/routes")
async def post_route(request: RouteRequest):
    """Calculate route via POST."""
    route = road_network.find_route(request.origin, request.destination, request.vehicle_type)
    return route.model_dump(mode="json")


# ─────────────────────────────────────────────────────────────────────────────
# Simulation
# ─────────────────────────────────────────────────────────────────────────────

async def _collect_affected_decision_ids(
    plan_changes,
    session: AsyncSession,
) -> list[str]:
    """
    Return DecisionDB.id values whose target_entity_id appears in the plan changes
    and that are either:
      - is_current = True  (current recommendation, needs re-review), OR
      - operator_status IS NOT NULL (operator already acted — still visible as history).
    Scoped per Correction 4 design decision.
    """
    from sqlalchemy import or_
    affected_entity_ids = {pc.entity_id for pc in plan_changes}
    if not affected_entity_ids:
        return []
    result = await session.execute(
        select(DecisionDB).where(
            DecisionDB.target_entity_id.in_(affected_entity_ids)
        ).where(
            or_(
                DecisionDB.is_current == True,   # noqa: E712
                DecisionDB.operator_status.isnot(None),
            )
        )
    )
    return [row.id for row in result.scalars()]


@app.post("/simulate/next")
async def simulate_next(session: AsyncSession = Depends(get_db)):
    """Process the next simulation event."""
    evt = await sim_engine.process_next_event(session)
    if evt is None:
        return {
            "status": "no_more_events",
            "message": "All simulation events have been processed.",
            "sim_time_min": world_state.current_time_min,
        }

    # Return updated situation
    situation = await get_situation()
    plan_changes = world_state.last_plan_changes
    affected_ids = await _collect_affected_decision_ids(plan_changes, session)
    return {
        "status": "event_processed",
        "event": {
            "id": evt.id,
            "time_offset_min": evt.time_offset_min,
            "event_type": evt.event_type,
            "description": evt.description,
            "entity_id": evt.entity_id,
        },
        "situation_update": situation,
        "plan_changes": [pc.model_dump(mode="json") for pc in plan_changes],
        "affected_decision_ids": affected_ids,
    }


@app.post("/simulate/auto")
async def simulate_auto(
    max_events: int = Query(default=99),
    session: AsyncSession = Depends(get_db),
):
    """Process all remaining simulation events."""
    processed = []
    count = 0
    while world_state.unprocessed_events and count < max_events:
        evt = await sim_engine.process_next_event(session)
        if evt:
            processed.append({
                "id": evt.id,
                "time_offset_min": evt.time_offset_min,
                "event_type": evt.event_type,
                "description": evt.description,
            })
        count += 1

    return {
        "status": "completed",
        "events_processed": len(processed),
        "sim_time_min": world_state.current_time_min,
        "events": processed,
    }


@app.post("/simulate/event")
async def inject_event(
    request: InjectEventRequest,
    session: AsyncSession = Depends(get_db),
):
    """Inject a custom simulation event."""
    obs_type = None
    if request.observation_type:
        try:
            obs_type = ObservationType(request.observation_type)
        except ValueError:
            raise HTTPException(400, f"Invalid observation_type: {request.observation_type}")

    src_type = SourceType.FIELD_REPORT
    try:
        src_type = SourceType(request.source_type)
    except ValueError:
        pass

    evt = await sim_engine.inject_event(
        event_type=request.event_type,
        entity_id=request.entity_id,
        obs_type=obs_type,
        value=request.value,
        confidence=request.confidence,
        severity=request.severity,
        description=request.description,
        source_type=src_type,
        metadata=request.metadata,
        session=session,
    )

    situation = await get_situation()
    plan_changes = world_state.last_plan_changes
    affected_ids = await _collect_affected_decision_ids(plan_changes, session)
    return {
        "status": "event_injected",
        "event_id": evt.id,
        "situation_update": situation,
        "plan_changes": [pc.model_dump(mode="json") for pc in plan_changes],
        "affected_decision_ids": affected_ids,
    }


@app.post("/simulate/reset")
async def simulate_reset(session: AsyncSession = Depends(get_db)):
    """Reset simulation to initial state."""
    await sim_engine.reset(session)
    return {
        "status": "reset_complete",
        "sim_time_min": world_state.current_time_min,
        "message": "Simulation reset to initial state.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Optimize
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/optimize")
async def optimize(session: AsyncSession = Depends(get_db)):
    """Manually trigger resource optimization."""
    from app.engines.resource_optimizer import optimize_allocation, baseline_nearest_assignment
    resources = list(world_state.resources.values())
    tasks = list(world_state.tasks.values())

    plan = optimize_allocation(resources, tasks, road_network, world_state.current_time_min)
    world_state.current_plan = plan
    baseline = baseline_nearest_assignment(resources, tasks, road_network, world_state.current_time_min)
    world_state.baseline_plan = baseline

    return {
        "plan": plan.model_dump(mode="json"),
        "baseline": baseline.model_dump(mode="json"),
        "comparison": {
            "our_total_travel": plan.total_travel_time,
            "baseline_total_travel": baseline.total_travel_time,
            "our_coverage": plan.coverage_score,
            "baseline_coverage": baseline.coverage_score,
            "improvement_pct": round(
                (baseline.total_travel_time - plan.total_travel_time) / max(1, baseline.total_travel_time) * 100, 1
            ),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Decisions
# ─────────────────────────────────────────────────────────────────────────────

def _b7_fields_for_entity(entity_id: Optional[str], resource_id: Optional[str]) -> dict:
    """
    Return B7 fields read directly from world_state — no DB queries, no recompute.

    Provides:
      task_id                    — from current plan allocation matching resource+entity
      route_feasible             — from matching AllocationResult.route.feasible
      estimated_arrival_min      — from matching AllocationResult
      resource_type              — from world_state.resources
      capability                 — first resource capability (task type)
      supporting_factors         — from PriorityScore.supporting_factors
      last_evidence_verified     — most recent EvidenceSummary.last_verified for the entity
      target_entity_accessibility — PriorityScore.accessibility_factor
      human_verification_required — always True
    """
    state = world_state

    # Accessibility + supporting factors from priority score
    priority = state.priorities.get(entity_id) if entity_id else None
    accessibility = priority.accessibility_factor if priority else None
    supporting_factors = priority.supporting_factors if priority else []

    # last_evidence_verified: max last_verified across all evidence for this entity
    evidence = state.get_all_evidence_for_entity(entity_id) if entity_id else []
    last_verified = None
    if evidence:
        last_verified = max(e.last_verified for e in evidence).isoformat()

    # task_id, route_feasible, estimated_arrival_min from current plan
    task_id = None
    route_feasible = None
    estimated_arrival_min = None
    if state.current_plan and entity_id:
        for alloc in state.current_plan.allocations:
            task = state.tasks.get(alloc.task_id)
            if task and task.target_entity_id == entity_id:
                # If we also have the resource_id, prefer the exact match
                if resource_id is None or alloc.resource_id == resource_id:
                    task_id = alloc.task_id
                    route_feasible = bool(alloc.route and alloc.route.feasible)
                    estimated_arrival_min = alloc.estimated_arrival_min
                    break

    # resource_type and capability from resource
    resource = state.resources.get(resource_id) if resource_id else None
    resource_type = resource.type if resource else None
    capability = resource.capabilities[0].value if (resource and resource.capabilities) else None

    return {
        "task_id": task_id,
        "route_feasible": route_feasible,
        "estimated_arrival_min": estimated_arrival_min,
        "resource_type": resource_type,
        "capability": capability,
        "supporting_factors": supporting_factors,
        "human_verification_required": True,
        "last_evidence_verified": last_verified,
        "target_entity_accessibility": accessibility,
    }


def _decision_row_to_dict(row: DecisionDB) -> dict:
    """Serialize a DecisionDB row to a dict (shared by list and detail views)."""
    return {
        "id": row.id,
        "timestamp": row.timestamp.isoformat(),
        "recommended_action": row.recommended_action,
        "target_entity_id": row.target_entity_id,
        "resource_id": row.resource_id,
        "priority": row.priority,
        "confidence": row.confidence,
        "reasons": json.loads(row.reasons_json or "[]"),
        "constraints": json.loads(row.constraints_json or "[]"),
        "alternatives_considered": json.loads(row.alternatives_json or "[]"),
        "human_verification_required": row.human_verification_required,
        "simulation_time_min": row.simulation_time_min,
        "operator_status": row.operator_status,
        "operator_notes": row.operator_notes,
        "is_current": bool(row.is_current),
    }


@app.get("/decisions")
async def get_decisions(
    limit: int = Query(default=20),
    session: AsyncSession = Depends(get_db),
):
    """Recent decisions with explanations."""
    result = await session.execute(
        select(DecisionDB).order_by(DecisionDB.timestamp.desc()).limit(limit)
    )
    decisions = [_decision_row_to_dict(row) for row in result.scalars()]
    return {"decisions": decisions}


@app.get("/decisions/{decision_id}")
async def get_decision(
    decision_id: str,
    session: AsyncSession = Depends(get_db),
):
    """Single decision with full explanation."""
    result = await session.execute(select(DecisionDB).where(DecisionDB.id == decision_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Decision '{decision_id}' not found")

    provider = get_ai_provider()
    decision_data = {
        "recommended_action": row.recommended_action,
        "reasons": json.loads(row.reasons_json or "[]"),
        "confidence": row.confidence,
        "constraints": json.loads(row.constraints_json or "[]"),
        "alternatives_considered": json.loads(row.alternatives_json or "[]"),
    }
    explanation = provider.explain_decision(decision_data)

    d = _decision_row_to_dict(row)
    d["ai_explanation"] = explanation
    # B7 additions — read from world_state, never re-query
    d.update(_b7_fields_for_entity(row.target_entity_id, row.resource_id))
    return d


@app.post("/decisions/{decision_id}/confirm")
async def confirm_decision(
    decision_id: str,
    request: ConfirmDecisionRequest,
    session: AsyncSession = Depends(get_db),
):
    """
    Record operator acceptance/rejection/modification of a recommendation (B3).

    Persists operator_status and operator_notes on the DecisionDB row without
    overwriting recommended_action, reasons, confidence, or any evidence fields.
    Writes an AuditDB record with event_type='operator_decision'.
    """
    valid_statuses = {"accepted", "rejected", "modified"}
    if request.status not in valid_statuses:
        raise HTTPException(422, f"Invalid status '{request.status}'. Must be one of: {sorted(valid_statuses)}")

    result = await session.execute(select(DecisionDB).where(DecisionDB.id == decision_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Decision '{decision_id}' not found")

    prev_status = row.operator_status

    # Update only the operator fields — never touch recommendation/evidence fields
    row.operator_status = request.status
    row.operator_notes = request.operator_notes

    # Write to AuditDB (B3 requirement — audit persistence, not just in-memory log)
    audit_row = AuditDB(
        id=f"AUD-{__import__('uuid').uuid4().hex[:8].upper()}",
        event_type="operator_decision",
        entity_id=row.target_entity_id,
        previous_state_json=json.dumps({"operator_status": prev_status}),
        new_state_json=json.dumps({
            "operator_status": request.status,
            "notes": request.operator_notes,
        }),
        decision_id=decision_id,
        reason=f"Operator {request.status} decision {decision_id}",
        confidence=row.confidence,
        simulation_time_min=world_state.current_time_min,
    )
    session.add(audit_row)

    # Also append to in-memory audit log so GET /audit reflects it immediately
    world_state._audit(
        event_type="operator_decision",
        entity_id=row.target_entity_id,
        previous={"operator_status": prev_status},
        new={"operator_status": request.status, "notes": request.operator_notes},
        decision_id=decision_id,
    )

    await session.commit()

    d = _decision_row_to_dict(row)
    return d


# ─────────────────────────────────────────────────────────────────────────────
# Benchmark
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/benchmark")
async def get_benchmark(session: AsyncSession = Depends(get_db)):
    """Run benchmark and return results."""
    results = await run_benchmark(session)
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Timeline
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/timeline")
async def get_timeline():
    """Full simulation timeline — all events with status."""
    state = world_state
    events = []
    for evt in state.all_events:
        events.append({
            "id": evt.id,
            "time_offset_min": evt.time_offset_min,
            "event_type": evt.event_type,
            "description": evt.description,
            "entity_id": evt.entity_id,
            "observation_type": evt.observation_type.value if evt.observation_type else None,
            "value": evt.value,
            "confidence": evt.confidence,
            "severity": evt.severity,
            "processed": evt.processed,
        })
    return {
        "events": events,
        "sim_time_min": state.current_time_min,
        "processed_count": len(state.processed_event_ids),
        "pending_count": len(state.unprocessed_events),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Map Data
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/map-data")
async def get_map_data():
    """GeoJSON-structured map data for the frontend."""
    state = world_state

    features = []

    # Asset features
    for a in state.assets.values():
        priority = state.priorities.get(a.id)
        evidence = state.get_all_evidence_for_entity(a.id)
        has_conflict = any(e.conflict_status.value == "conflicting" for e in evidence)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [a.location.lon, a.location.lat]},
            "properties": {
                "id": a.id,
                "name": a.name,
                "type": a.type.value,
                "status": a.status.value,
                "population": a.population,
                "criticality": a.criticality,
                "priority_score": priority.priority_score if priority else 0,
                "conflict_status": "conflicting" if has_conflict else "none",
                "elevation_m": a.location.elevation_m,
            },
        })

    # Bridge features
    for b in state.bridges.values():
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [b.location.lon, b.location.lat]},
            "properties": {
                "id": b.id,
                "name": b.name,
                "type": "bridge",
                "status": b.status.value,
                "confidence": b.confidence,
                "conflict_status": b.conflict_status.value,
                "capacity": b.capacity,
                "on_road": b.on_road,
                "priority_score": 0,
            },
        })

    # Road features (as lines)
    road_features = []
    for r in state.roads.values():
        from_asset = state.assets.get(r.from_node)
        to_asset = state.assets.get(r.to_node)
        if from_asset and to_asset:
            road_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [from_asset.location.lon, from_asset.location.lat],
                        [to_asset.location.lon, to_asset.location.lat],
                    ],
                },
                "properties": {
                    "id": r.id,
                    "name": r.name,
                    "type": "road",
                    "status": r.status.value,
                    "risk": r.risk,
                    "distance_km": r.distance_km,
                    "travel_time_min": r.travel_time_min,
                    "confidence": r.confidence,
                },
            })

    # Resource positions
    resource_features = []
    for res in state.resources.values():
        loc_asset = state.assets.get(res.location_id)
        if loc_asset:
            # Slightly offset resources at same location
            resource_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        loc_asset.location.lon + 0.003,
                        loc_asset.location.lat + 0.003,
                    ],
                },
                "properties": {
                    "id": res.id,
                    "name": res.name,
                    "type": "resource",
                    "resource_type": res.type,
                    "status": res.status.value,
                    "location_id": res.location_id,
                },
            })

    return {
        "type": "FeatureCollection",
        "features": features + road_features + resource_features,
        "metadata": {
            "scenario": "Bhote Valley Emergency Simulation",
            "sim_time_min": state.current_time_min,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# AI / Bob Interface
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/ai/question")
async def ask_ai(request: AIQuestionRequest):
    """Natural-language operator Q&A backed by actual system state."""
    state = world_state
    priorities = sorted(state.priorities.values(), key=lambda p: p.priority_score, reverse=True)
    blocked = [f"{r.id}: {r.name}" for r in state.roads.values() if r.status == RoadStatus.BLOCKED]
    blocked += [f"{b.id}: {b.name}" for b in state.bridges.values() if b.status == RoadStatus.BLOCKED]
    conflicts = [
        f"{e.entity_id}/{e.observation_type.value}: {e.best_value}"
        for e in state.evidence_cache.values()
        if e.conflict_status.value == "conflicting"
    ]

    context = {
        "sim_time_min": state.current_time_min,
        "top_priorities": [
            {
                "name": p.entity_name,
                "priority": round(p.priority_score, 3),
                "urgency": round(p.urgency_score, 3),
                "explanation": p.explanation,
                "confidence": round(p.confidence_factor, 3),
            }
            for p in priorities[:5]
        ],
        "blocked_infrastructure": blocked,
        "evidence_conflicts": conflicts,
        "unavailable_resources": [r.name for r in state.resources.values() if r.status == ResourceStatus.UNAVAILABLE],
        "bridges": {
            b.id: {
                "name": b.name,
                "status": b.status.value,
                "confidence": b.confidence,
                "conflict_status": b.conflict_status.value,
            }
            for b in state.bridges.values()
        },
        "resources": [
            {"name": r.name, "status": r.status.value, "type": r.type}
            for r in state.resources.values()
        ],
        "current_plan_summary": state.current_plan.explanation if state.current_plan else None,
    }

    provider = get_ai_provider()
    answer = provider.answer_operator_question(request.question, context)

    return {
        "question": request.question,
        "answer": answer,
        "context_snapshot": {
            "sim_time_min": context["sim_time_min"],
            "top_priority": priorities[0].entity_name if priorities else None,
            "blocked_count": len(blocked),
            "conflict_count": len(conflicts),
        },
    }


@app.get("/ai/situation")
async def get_ai_situation():
    """AI-generated situation summary from actual system state."""
    state = world_state
    priorities = sorted(state.priorities.values(), key=lambda p: p.priority_score, reverse=True)
    blocked = [f"{r.name}" for r in state.roads.values() if r.status == RoadStatus.BLOCKED]
    blocked += [f"{b.name}" for b in state.bridges.values() if b.status == RoadStatus.BLOCKED]
    conflicts = [
        f"{e.entity_id}: {e.observation_type.value}"
        for e in state.evidence_cache.values()
        if e.conflict_status.value == "conflicting"
    ]

    state_summary = {
        "sim_time_min": state.current_time_min,
        "top_priorities": [
            {
                "name": p.entity_name,
                "priority": round(p.priority_score, 3),
                "urgency": round(p.urgency_score, 3),
                "explanation": p.explanation,
            }
            for p in priorities[:5]
        ],
        "blocked_infrastructure": blocked,
        "evidence_conflicts": conflicts,
        "unavailable_resources": [r.name for r in state.resources.values() if r.status == ResourceStatus.UNAVAILABLE],
        "current_plan_summary": state.current_plan.explanation if state.current_plan else "",
    }

    provider = get_ai_provider()
    summary = provider.generate_situation_summary(state_summary)
    return {"summary": summary, "state_snapshot": state_summary}


# ─────────────────────────────────────────────────────────────────────────────
# Audit Log
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/audit")
async def get_audit(limit: int = Query(default=50)):
    """Recent audit log entries."""
    state = world_state
    recent = list(reversed(state.audit_log[-limit:]))
    return {
        "audit_log": [
            {
                "id": r.id,
                "timestamp": r.timestamp.isoformat(),
                "event_type": r.event_type,
                "entity_id": r.entity_id,
                "previous_state": r.previous_state,
                "new_state": r.new_state,
                "reason": r.reason,
                "confidence": r.confidence,
                "sim_time_min": r.simulation_time_min,
            }
            for r in recent
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tasks & Plan
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/tasks")
async def get_tasks():
    """All current tasks."""
    state = world_state
    return {
        "tasks": [
            {
                "id": t.id,
                "name": t.name,
                "task_type": t.task_type.value,
                "target_entity_id": t.target_entity_id,
                "priority": t.priority,
                "urgency": t.urgency,
                "status": t.status,
                "required_capabilities": [c.value for c in t.required_capabilities],
            }
            for t in state.tasks.values()
        ]
    }


@app.get("/plan")
async def get_plan():
    """Current response plan with B7 enrichment per allocation."""
    state = world_state
    if not state.current_plan:
        return {"plan": None, "baseline": None}

    # Enrich each allocation with B7 fields (last_evidence_verified, accessibility, etc.)
    plan_dict = state.current_plan.model_dump(mode="json")
    for alloc in plan_dict.get("allocations", []):
        task = state.tasks.get(alloc["task_id"])
        entity_id = task.target_entity_id if task else None
        b7 = _b7_fields_for_entity(entity_id, alloc.get("resource_id"))
        alloc.update(b7)

    return {
        "plan": plan_dict,
        "baseline": state.baseline_plan.model_dump(mode="json") if state.baseline_plan else None,
        "comparison": {
            "our_total_travel": state.current_plan.total_travel_time,
            "baseline_total_travel": state.baseline_plan.total_travel_time if state.baseline_plan else 0,
            "our_coverage": state.current_plan.coverage_score,
            "baseline_coverage": state.baseline_plan.coverage_score if state.baseline_plan else 0,
        },
    }


# Serve the production frontend from the API host when it has been built.
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
