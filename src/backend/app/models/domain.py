"""
Core domain models for the AI Emergency Operations & Resource Orchestration System.
Uses Pydantic v2 for typed schemas.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
import uuid


# ─────────────────────────────────────────────────────────────────────────────
# Enumerations
# ─────────────────────────────────────────────────────────────────────────────

class EntityType(str, Enum):
    HOSPITAL = "hospital"
    HEALTH_POST = "health_post"
    SCHOOL = "school"
    SHELTER = "shelter"
    HYDROPOWER = "hydropower"
    COMMAND_CENTER = "command_center"
    VILLAGE = "village"
    BRIDGE = "bridge"
    ROAD = "road"
    RIVER = "river"
    RESOURCE_BASE = "resource_base"
    INTERSECTION = "intersection"


class AssetStatus(str, Enum):
    OPERATIONAL = "operational"
    DAMAGED = "damaged"
    DESTROYED = "destroyed"
    UNKNOWN = "unknown"
    FLOODED = "flooded"
    EVACUATED = "evacuated"
    OVERLOADED = "overloaded"


class RoadStatus(str, Enum):
    OPEN = "open"
    PARTIALLY_BLOCKED = "partially_blocked"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"
    HIGH_RISK = "high_risk"


class ResourceType(str, Enum):
    RESCUE_TEAM = "rescue_team"
    AMBULANCE = "ambulance"
    ENGINEERING_TEAM = "engineering_team"
    SUPPLY_VEHICLE = "supply_vehicle"
    MEDICAL_UNIT = "medical_unit"


class ResourceStatus(str, Enum):
    AVAILABLE = "available"
    DEPLOYED = "deployed"
    UNAVAILABLE = "unavailable"
    EN_ROUTE = "en_route"


class TaskType(str, Enum):
    RESCUE = "rescue"
    MEDICAL_RESPONSE = "medical_response"
    EVACUATION = "evacuation"
    ENGINEERING = "engineering"
    SUPPLY_DELIVERY = "supply_delivery"
    VERIFICATION = "verification"


class SourceType(str, Enum):
    SATELLITE = "satellite"
    DRONE = "drone"
    FIELD_REPORT = "field_report"
    EMERGENCY_CALL = "emergency_call"
    HOSPITAL = "hospital"
    SCHOOL = "school"
    SENSOR = "sensor"
    AUTHORITY_REPORT = "authority_report"
    SIMULATION = "simulation"


class ObservationType(str, Enum):
    ACCESSIBILITY = "accessibility"
    DAMAGE = "damage"
    POPULATION = "population"
    CAPACITY = "capacity"
    STRUCTURAL = "structural"
    FLOOD_LEVEL = "flood_level"
    ROAD_STATUS = "road_status"
    BRIDGE_STATUS = "bridge_status"
    RESOURCE_STATUS = "resource_status"
    DEMAND = "demand"
    WEATHER = "weather"


class ConflictStatus(str, Enum):
    NONE = "none"
    CONFLICTING = "conflicting"
    RESOLVED = "resolved"


class ConfidenceLevel(str, Enum):
    HIGH = "high"       # >= 0.75
    MEDIUM = "medium"   # >= 0.50
    LOW = "low"         # >= 0.25
    VERY_LOW = "very_low"  # < 0.25


class OperatorDecisionStatus(str, Enum):
    """A human operator's response to a system recommendation.

    MODIFIED means the operator accepted the recommendation with changes that
    they describe in operator_notes. It records the human's intent only — the
    system does not re-dispatch or reassign resources on the strength of it,
    because autonomous dispatch is out of scope.
    """
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    MODIFIED = "modified"


# ─────────────────────────────────────────────────────────────────────────────
# Geography & Location
# ─────────────────────────────────────────────────────────────────────────────

class Location(BaseModel):
    lat: float
    lon: float
    elevation_m: Optional[float] = None
    description: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Assets (facilities, villages, infrastructure)
# ─────────────────────────────────────────────────────────────────────────────

class Asset(BaseModel):
    id: str
    name: str
    type: EntityType
    location: Location
    population: int = 0                    # affected/resident population
    criticality: float = 0.5              # 0-1
    status: AssetStatus = AssetStatus.OPERATIONAL
    importance: float = 0.5               # configurable base importance
    metadata: dict[str, Any] = Field(default_factory=dict)


class Road(BaseModel):
    id: str
    name: str
    from_node: str                         # asset id
    to_node: str                           # asset id
    distance_km: float
    travel_time_min: float
    status: RoadStatus = RoadStatus.OPEN
    risk: float = 0.1                      # 0-1
    vehicle_restrictions: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    last_updated: datetime = Field(default_factory=lambda: datetime.utcnow())
    metadata: dict[str, Any] = Field(default_factory=dict)


class Bridge(BaseModel):
    id: str
    name: str
    on_road: str                           # road id this bridge is part of
    location: Location
    status: RoadStatus = RoadStatus.OPEN
    capacity: str = "heavy"               # light / medium / heavy
    confidence: float = 1.0
    conflict_status: ConflictStatus = ConflictStatus.NONE
    last_updated: datetime = Field(default_factory=lambda: datetime.utcnow())


# ─────────────────────────────────────────────────────────────────────────────
# Resources
# ─────────────────────────────────────────────────────────────────────────────

class Resource(BaseModel):
    id: str
    name: str
    type: ResourceType
    status: ResourceStatus = ResourceStatus.AVAILABLE
    location_id: str                       # current node id
    capabilities: list[TaskType] = Field(default_factory=list)
    capacity: int = 1
    current_task_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Observations / Evidence
# ─────────────────────────────────────────────────────────────────────────────

class Observation(BaseModel):
    id: str = Field(default_factory=lambda: f"OBS-{uuid.uuid4().hex[:8].upper()}")
    event_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.utcnow())
    source_type: SourceType
    source_id: str
    entity_id: str
    observation_type: ObservationType
    value: str                             # normalized string value
    severity: float = 0.5                 # 0-1
    confidence: float = 0.8              # 0-1 observation-specific confidence
    freshness: float = 1.0               # computed, decays over time
    location: Optional[Location] = None
    raw_text: Optional[str] = None
    structured_data: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"


class EvidenceSummary(BaseModel):
    """Result of fusing multiple observations for an entity attribute."""
    entity_id: str
    observation_type: ObservationType
    best_value: str
    confidence: float
    conflict_status: ConflictStatus = ConflictStatus.NONE
    confidence_level: ConfidenceLevel = ConfidenceLevel.MEDIUM
    supporting_observations: list[str] = Field(default_factory=list)  # observation ids
    conflicting_observations: list[str] = Field(default_factory=list)
    last_verified: datetime = Field(default_factory=lambda: datetime.utcnow())
    source_count: int = 0
    recommendation: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────────────────────

class Task(BaseModel):
    id: str = Field(default_factory=lambda: f"TASK-{uuid.uuid4().hex[:8].upper()}")
    name: str
    task_type: TaskType
    target_entity_id: str
    priority: float = 0.5
    urgency: float = 0.5
    required_capabilities: list[TaskType] = Field(default_factory=list)
    estimated_duration_min: int = 30
    deadline_offset_min: Optional[int] = None
    status: str = "pending"               # pending / assigned / in_progress / completed
    assigned_resource_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

class Route(BaseModel):
    origin: str
    destination: str
    path_nodes: list[str] = Field(default_factory=list)
    path_edges: list[str] = Field(default_factory=list)
    total_distance_km: float = 0.0
    total_time_min: float = 0.0
    total_risk: float = 0.0
    feasible: bool = True
    blocked_alternatives: list[str] = Field(default_factory=list)
    reason: str = ""
    vehicle_type: str = "heavy"
    calculated_at: datetime = Field(default_factory=lambda: datetime.utcnow())


# ─────────────────────────────────────────────────────────────────────────────
# Decisions & Explanations
# ─────────────────────────────────────────────────────────────────────────────

class DecisionExplanation(BaseModel):
    decision_id: str = Field(default_factory=lambda: f"DEC-{uuid.uuid4().hex[:8].upper()}")
    timestamp: datetime = Field(default_factory=lambda: datetime.utcnow())
    recommended_action: str
    target_entity_id: Optional[str] = None
    resource_id: Optional[str] = None
    # Exact join key to AllocationResult.task_id (B7). Optional so that
    # decisions not tied to a specific task remain representable.
    task_id: Optional[str] = None
    priority: float = 0.5
    confidence: float = 0.5
    reasons: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    alternatives_considered: list[str] = Field(default_factory=list)
    human_verification_required: bool = True
    simulation_time_min: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Simulation Events
# ─────────────────────────────────────────────────────────────────────────────

class SimulationEvent(BaseModel):
    id: str = Field(default_factory=lambda: f"EVT-{uuid.uuid4().hex[:8].upper()}")
    time_offset_min: int                   # minutes from simulation start
    event_type: str
    description: str
    entity_id: Optional[str] = None
    source_type: SourceType = SourceType.SIMULATION
    observation_type: Optional[ObservationType] = None
    value: Optional[str] = None
    confidence: float = 1.0
    severity: float = 0.5
    metadata: dict[str, Any] = Field(default_factory=dict)
    processed: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Audit Log
# ─────────────────────────────────────────────────────────────────────────────

class AuditRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"AUD-{uuid.uuid4().hex[:8].upper()}")
    timestamp: datetime = Field(default_factory=lambda: datetime.utcnow())
    event_type: str
    entity_id: Optional[str] = None
    previous_state: Optional[dict[str, Any]] = None
    new_state: Optional[dict[str, Any]] = None
    decision_id: Optional[str] = None
    reason: str = ""
    confidence: float = 1.0
    simulation_time_min: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Priority Score
# ─────────────────────────────────────────────────────────────────────────────

class PriorityScore(BaseModel):
    entity_id: str
    entity_name: str
    entity_type: EntityType
    priority_score: float                  # 0-1 final
    criticality_score: float
    urgency_score: float
    accessibility_factor: float           # 0=unreachable, 1=fully accessible
    confidence_factor: float
    impact_score: float
    rank: int = 0
    explanation: str = ""
    supporting_factors: list[str] = Field(default_factory=list)
    calculated_at: datetime = Field(default_factory=lambda: datetime.utcnow())


# ─────────────────────────────────────────────────────────────────────────────
# Resource Allocation
# ─────────────────────────────────────────────────────────────────────────────

class AllocationResult(BaseModel):
    task_id: str
    resource_id: str
    route: Optional[Route] = None
    estimated_arrival_min: float = 0.0
    priority_score: float = 0.0
    explanation: str = ""
    calculated_at: datetime = Field(default_factory=lambda: datetime.utcnow())


class PlanChange(BaseModel):
    """A meaningful difference between the previous and new response plan.

    Produced by diffing the existing optimizer's output before and after an
    event, keyed on task_id (task ids are deterministic and stable across
    replans). This is a comparison only — it never re-runs routing or
    allocation, which remain the optimizer's job.
    """
    task_id: str
    entity_id: Optional[str] = None
    previous_resource_id: Optional[str] = None
    new_resource_id: Optional[str] = None
    previous_eta_min: Optional[float] = None
    new_eta_min: Optional[float] = None
    previous_route_feasible: Optional[bool] = None
    new_route_feasible: Optional[bool] = None
    change_reason: str = ""
    triggering_event_id: Optional[str] = None
    triggering_event_type: Optional[str] = None
    affected_infrastructure_id: Optional[str] = None
    review_required: bool = False


class ResponsePlan(BaseModel):
    plan_id: str = Field(default_factory=lambda: f"PLAN-{uuid.uuid4().hex[:8].upper()}")
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())
    simulation_time_min: int = 0
    allocations: list[AllocationResult] = Field(default_factory=list)
    unassigned_tasks: list[str] = Field(default_factory=list)
    unassigned_resources: list[str] = Field(default_factory=list)
    total_travel_time: float = 0.0
    coverage_score: float = 0.0
    explanation: str = ""
    decisions: list[DecisionExplanation] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Benchmark
# ─────────────────────────────────────────────────────────────────────────────

class BenchmarkMetrics(BaseModel):
    scenario_name: str
    strategy_name: str
    critical_sites_covered: int
    total_critical_sites: int
    coverage_rate: float
    total_travel_time_min: float
    weighted_response_time: float
    unmet_critical_demand: float
    resource_utilization: float
    blocked_route_violations: int
    replanning_events: int
    conflict_detection_rate: float
    decision_confidence_avg: float
    calculated_at: datetime = Field(default_factory=lambda: datetime.utcnow())
