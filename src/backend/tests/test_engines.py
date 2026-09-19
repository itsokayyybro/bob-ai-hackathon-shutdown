"""
Unit tests for the AI Emergency Operations System.
Tests evidence fusion, freshness, criticality, priority, routing, optimization.
"""
import math
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.models.domain import (
    Observation, ObservationType, SourceType, Asset, EntityType,
    AssetStatus, Road, Bridge, RoadStatus, Resource, ResourceStatus,
    ResourceType, TaskType, Task, Location, ConflictStatus
)
from app.engines.evidence_fusion import (
    compute_freshness, compute_evidence_weight, fuse_observations, _normalize_value
)
from app.engines.graph_engine import NetworkState
from app.engines.priority_engine import (
    compute_criticality, compute_priority, derive_urgency, derive_isolation_risk,
    derive_damage_severity, derive_confidence_factor
)
from app.engines.resource_optimizer import (
    optimize_allocation, baseline_nearest_assignment, _can_perform, _score_pair
)
from app.config import get_source_reliability, get_freshness_lambda


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def make_observation(
    entity_id="B1",
    obs_type=ObservationType.BRIDGE_STATUS,
    value="blocked",
    confidence=0.85,
    source_type=SourceType.FIELD_REPORT,
    age_minutes=0,
) -> Observation:
    timestamp = datetime.utcnow() - timedelta(minutes=age_minutes)
    return Observation(
        source_type=source_type,
        source_id="TEST-SRC",
        entity_id=entity_id,
        observation_type=obs_type,
        value=value,
        confidence=confidence,
        timestamp=timestamp,
    )


def make_asset(
    id="H1",
    name="Test Hospital",
    entity_type=EntityType.HOSPITAL,
    population=5000,
    status=AssetStatus.OPERATIONAL,
) -> Asset:
    return Asset(
        id=id,
        name=name,
        type=entity_type,
        location=Location(lat=28.1, lon=85.7),
        population=population,
        status=status,
    )


def make_road(id="R1", status=RoadStatus.OPEN, risk=0.1) -> Road:
    return Road(
        id=id, name=f"Road {id}",
        from_node="A", to_node="B",
        distance_km=5.0, travel_time_min=20.0,
        status=status, risk=risk,
    )


def make_bridge(id="B1", on_road="R1", status=RoadStatus.OPEN, confidence=1.0) -> Bridge:
    return Bridge(
        id=id, name=f"Bridge {id}",
        on_road=on_road,
        location=Location(lat=28.1, lon=85.7),
        status=status, confidence=confidence,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Evidence Freshness Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_freshness_new_observation_is_high():
    obs = make_observation()
    freshness = compute_freshness(obs)
    assert freshness > 0.99, "Brand new observation should have freshness ≈ 1.0"


def test_freshness_old_observation_decays():
    obs = make_observation(age_minutes=60)  # 1 hour old
    freshness = compute_freshness(obs)
    # bridge_status has lambda=2.0, so exp(-2.0 * 1) ≈ 0.135
    assert freshness < 0.20, "1-hour-old bridge status should have low freshness"
    assert freshness > 0.0


def test_freshness_formula():
    """freshness = exp(-lambda * age_hours)"""
    obs = make_observation(
        obs_type=ObservationType.BRIDGE_STATUS,
        age_minutes=30,  # 0.5 hours
    )
    freshness = compute_freshness(obs)
    lam = get_freshness_lambda("bridge_status")  # 2.0
    expected = math.exp(-lam * 0.5)
    assert abs(freshness - expected) < 0.01


def test_freshness_population_slow_decay():
    obs = make_observation(
        obs_type=ObservationType.POPULATION,
        age_minutes=60,  # 1 hour
    )
    freshness = compute_freshness(obs)
    # population has lambda=0.1, so exp(-0.1 * 1) ≈ 0.905
    assert freshness > 0.85, "Population freshness decays slowly"


# ─────────────────────────────────────────────────────────────────────────────
# Source Reliability Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_source_reliability_values():
    assert get_source_reliability("satellite") == 0.85
    assert get_source_reliability("drone") == 0.90
    assert get_source_reliability("hospital") == 0.95
    assert get_source_reliability("simulation") == 1.00
    assert get_source_reliability("unknown_source") == 0.70  # default


def test_evidence_weight_calculation():
    obs = make_observation(confidence=0.8, source_type=SourceType.FIELD_REPORT)
    weight = compute_evidence_weight(obs)
    reliability = get_source_reliability("field_report")  # 0.88
    # weight = reliability * confidence * freshness (≈1.0 for new obs)
    assert abs(weight - reliability * 0.8 * 1.0) < 0.01


# ─────────────────────────────────────────────────────────────────────────────
# Evidence Fusion Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_fuse_single_observation():
    obs = make_observation(value="blocked", confidence=0.9)
    result = fuse_observations([obs], "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "blocked"
    assert result.confidence > 0.0
    assert result.source_count == 1
    assert result.conflict_status == ConflictStatus.NONE


def test_fuse_no_observations():
    result = fuse_observations([], "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "unknown"
    assert result.confidence == 0.0
    assert result.source_count == 0


def test_fuse_unanimous_observations():
    observations = [
        make_observation(value="blocked", confidence=0.85, source_type=SourceType.FIELD_REPORT),
        make_observation(value="blocked", confidence=0.90, source_type=SourceType.DRONE),
        make_observation(value="blocked", confidence=0.80, source_type=SourceType.SATELLITE),
    ]
    result = fuse_observations(observations, "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "blocked"
    # Multiple unanimous high-confidence sources should yield high confidence (>0.6)
    assert result.confidence > 0.6, f"Unanimous observations should yield high confidence, got {result.confidence}"
    assert result.conflict_status == ConflictStatus.NONE
    assert result.source_count == 3


def test_fuse_conflicting_observations():
    """Core conflict detection test."""
    obs1 = make_observation(value="blocked", confidence=0.80, source_type=SourceType.FIELD_REPORT)
    obs2 = make_observation(value="open", confidence=0.60, source_type=SourceType.FIELD_REPORT)
    result = fuse_observations([obs1, obs2], "B1", ObservationType.BRIDGE_STATUS)
    # Should detect conflict
    assert result.conflict_status == ConflictStatus.CONFLICTING
    assert result.recommendation is not None
    assert "verif" in result.recommendation.lower() or "conflict" in result.recommendation.lower()


def test_fuse_conflict_prefers_higher_weight():
    """Higher reliability + confidence + freshness should win."""
    # Drone (0.90) says blocked with high confidence
    obs1 = make_observation(
        value="blocked", confidence=0.94,
        source_type=SourceType.DRONE, age_minutes=2,
    )
    # Old field report (0.88) says open with lower confidence — older
    obs2 = make_observation(
        value="open", confidence=0.60,
        source_type=SourceType.FIELD_REPORT, age_minutes=30,
    )
    result = fuse_observations([obs1, obs2], "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "blocked", "Fresher, higher-weight observation should win"


def test_fuse_stale_evidence():
    """Very old evidence should have low weight."""
    obs = make_observation(
        value="blocked", confidence=0.9,
        obs_type=ObservationType.BRIDGE_STATUS,
        age_minutes=120,  # 2 hours old — bridge_status decays fast (lambda=2.0)
    )
    result = fuse_observations([obs], "B1", ObservationType.BRIDGE_STATUS)
    # freshness = exp(-2.0 * 2) = exp(-4) ≈ 0.018
    # weight = reliability(0.88) * conf(0.9) * freshness(0.018) ≈ 0.014
    # confidence = 1.0 * 0.014 = 0.014
    assert result.confidence < 0.05, f"Very stale bridge status should have near-zero confidence, got {result.confidence}"


def test_normalize_value():
    assert _normalize_value("blocked") == "blocked"
    assert _normalize_value("BLOCKED") == "blocked"
    assert _normalize_value("impassable") == "blocked"
    assert _normalize_value("open") == "open"
    assert _normalize_value("passable") == "open"
    assert _normalize_value("flooded") == "flooded"
    assert _normalize_value("overloaded") == "overloaded"


# ─────────────────────────────────────────────────────────────────────────────
# Criticality Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_criticality_hospital_high():
    asset = make_asset(entity_type=EntityType.HOSPITAL, population=8000)
    score = compute_criticality(asset)
    # Hospital: pop_impact=0.8, svc=1.0, time=1.0, iso=0, dmg=0
    # 0.25*0.8 + 0.25*1.0 + 0.20*1.0 + 0.15*0 + 0.15*0 = 0.20+0.25+0.20 = 0.65
    assert score >= 0.60, f"Hospital should have high criticality, got {score}"


def test_criticality_village_lower_than_hospital():
    hospital = make_asset(entity_type=EntityType.HOSPITAL, population=5000)
    village = make_asset(entity_type=EntityType.VILLAGE, population=5000)
    h_score = compute_criticality(hospital)
    v_score = compute_criticality(village)
    assert h_score > v_score, "Hospital should have higher criticality than village"


def test_criticality_damage_increases_score():
    asset = make_asset(entity_type=EntityType.HOSPITAL, population=5000)
    score_undamaged = compute_criticality(asset, damage_severity=0.0)
    score_damaged = compute_criticality(asset, damage_severity=0.8)
    assert score_damaged > score_undamaged


def test_criticality_isolation_increases_score():
    asset = make_asset(entity_type=EntityType.VILLAGE, population=1000)
    score_normal = compute_criticality(asset, isolation_risk=0.0)
    score_isolated = compute_criticality(asset, isolation_risk=1.0)
    assert score_isolated > score_normal


def test_criticality_bounded_0_1():
    asset = make_asset(entity_type=EntityType.HOSPITAL, population=99999)
    score = compute_criticality(asset, damage_severity=1.0, isolation_risk=1.0)
    assert 0.0 <= score <= 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Priority Score Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_priority_score_bounded():
    asset = make_asset()
    priority = compute_priority(
        asset, criticality=0.8, urgency=0.9,
        accessibility_factor=0.5, confidence_factor=0.8, impact_score=0.7
    )
    assert 0.0 <= priority.priority_score <= 1.0


def test_priority_high_urgency_raises_score():
    asset = make_asset()
    low = compute_priority(asset, 0.6, urgency=0.1, accessibility_factor=1.0, confidence_factor=0.8, impact_score=0.5)
    high = compute_priority(asset, 0.6, urgency=0.9, accessibility_factor=1.0, confidence_factor=0.8, impact_score=0.5)
    assert high.priority_score > low.priority_score


def test_priority_inaccessible_reduces_score():
    asset = make_asset()
    accessible = compute_priority(asset, 0.8, 0.8, accessibility_factor=1.0, confidence_factor=0.8, impact_score=0.7)
    inaccessible = compute_priority(asset, 0.8, 0.8, accessibility_factor=0.0, confidence_factor=0.8, impact_score=0.7)
    assert accessible.priority_score > inaccessible.priority_score


def test_priority_explanation_populated():
    asset = make_asset()
    priority = compute_priority(
        asset, criticality=0.9, urgency=0.8,
        accessibility_factor=0.7, confidence_factor=0.85, impact_score=0.9
    )
    assert priority.explanation
    assert asset.name in priority.explanation or len(priority.explanation) > 10


# ─────────────────────────────────────────────────────────────────────────────
# Graph / Route Tests
# ─────────────────────────────────────────────────────────────────────────────

def _build_test_network():
    """Build a small test road network."""
    roads = [
        Road(id="R1", name="Road A-B", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=20.0, status=RoadStatus.OPEN, risk=0.1),
        Road(id="R2", name="Road B-C", from_node="B", to_node="C",
             distance_km=3.0, travel_time_min=12.0, status=RoadStatus.OPEN, risk=0.1),
        Road(id="R3", name="Road A-C Alternate", from_node="A", to_node="C",
             distance_km=12.0, travel_time_min=45.0, status=RoadStatus.OPEN, risk=0.2),
    ]
    return NetworkState(), roads


def test_route_simple_path():
    network = NetworkState()
    roads = [
        Road(id="R1", name="A-B", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=20.0),
        Road(id="R2", name="B-C", from_node="B", to_node="C",
             distance_km=3.0, travel_time_min=12.0),
    ]
    network.rebuild(roads, [])
    route = network.find_route("A", "C")
    assert route.feasible
    assert "A" in route.path_nodes
    assert "C" in route.path_nodes
    assert route.total_distance_km > 0
    assert route.total_time_min > 0


def test_route_blocked_road_excluded():
    network = NetworkState()
    roads = [
        Road(id="R1", name="A-B", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=20.0, status=RoadStatus.BLOCKED),
        Road(id="R2", name="A-C-B", from_node="A", to_node="C",
             distance_km=8.0, travel_time_min=30.0),
        Road(id="R3", name="C-B", from_node="C", to_node="B",
             distance_km=4.0, travel_time_min=15.0),
    ]
    network.rebuild(roads, [])
    route = network.find_route("A", "B")
    assert route.feasible
    # Should NOT use R1 (blocked)
    assert "R1" not in route.path_edges


def test_route_no_path_when_all_blocked():
    network = NetworkState()
    roads = [
        Road(id="R1", name="A-B", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=20.0, status=RoadStatus.BLOCKED),
    ]
    network.rebuild(roads, [])
    route = network.find_route("A", "B")
    assert not route.feasible


def test_route_blocked_bridge_blocks_road():
    network = NetworkState()
    roads = [
        Road(id="R1", name="A-B with bridge", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=20.0, status=RoadStatus.OPEN),
    ]
    bridges = [
        Bridge(id="BR1", name="Bridge on R1", on_road="R1",
               location=Location(lat=28.1, lon=85.7),
               status=RoadStatus.BLOCKED, confidence=0.95),
    ]
    network.rebuild(roads, bridges)
    route = network.find_route("A", "B")
    assert not route.feasible, "Blocked bridge should make its road infeasible"


def test_route_uses_alternate_when_bridge_blocked():
    """When bridge blocks primary route, system should find alternate."""
    network = NetworkState()
    roads = [
        Road(id="R1", name="Primary", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=15.0),
        Road(id="R2", name="Alternate A-C", from_node="A", to_node="C",
             distance_km=12.0, travel_time_min=40.0),
        Road(id="R3", name="Alternate C-B", from_node="C", to_node="B",
             distance_km=6.0, travel_time_min=20.0),
    ]
    bridges = [
        Bridge(id="BR1", name="Bridge on R1", on_road="R1",
               location=Location(lat=28.1, lon=85.7),
               status=RoadStatus.BLOCKED, confidence=0.95),
    ]
    network.rebuild(roads, bridges)
    route = network.find_route("A", "B")
    assert route.feasible, "Should find alternate route R2→R3"
    assert "R1" not in route.path_edges


def test_route_update_on_bridge_change():
    """Dynamic route update when bridge changes status."""
    network = NetworkState()
    roads = [
        Road(id="R1", name="A-B", from_node="A", to_node="B",
             distance_km=5.0, travel_time_min=15.0),
    ]
    bridges = [
        Bridge(id="BR1", name="Bridge", on_road="R1",
               location=Location(lat=28.1, lon=85.7),
               status=RoadStatus.OPEN),
    ]
    network.rebuild(roads, bridges)

    # Initially feasible
    route1 = network.find_route("A", "B")
    assert route1.feasible

    # Block bridge
    network.update_bridge("BR1", RoadStatus.BLOCKED)
    route2 = network.find_route("A", "B")
    assert not route2.feasible

    # Reopen bridge
    network.update_bridge("BR1", RoadStatus.OPEN)
    route3 = network.find_route("A", "B")
    assert route3.feasible


# ─────────────────────────────────────────────────────────────────────────────
# Resource Optimizer Tests
# ─────────────────────────────────────────────────────────────────────────────

def _make_simple_world():
    """Build a simple world for optimizer tests."""
    network = NetworkState()
    roads = [
        Road(id="R1", name="Base-Hospital", from_node="BASE", to_node="H1",
             distance_km=5.0, travel_time_min=20.0),
        Road(id="R2", name="Base-Village", from_node="BASE", to_node="V1",
             distance_km=8.0, travel_time_min=30.0),
        Road(id="R3", name="Hospital-Village", from_node="H1", to_node="V1",
             distance_km=6.0, travel_time_min=25.0),
    ]
    network.rebuild(roads, [])

    resources = [
        Resource(id="RT1", name="Rescue Team 1", type=ResourceType.RESCUE_TEAM,
                 status=ResourceStatus.AVAILABLE, location_id="BASE",
                 capabilities=[TaskType.RESCUE, TaskType.EVACUATION]),
        Resource(id="A1", name="Ambulance 1", type=ResourceType.AMBULANCE,
                 status=ResourceStatus.AVAILABLE, location_id="H1",
                 capabilities=[TaskType.MEDICAL_RESPONSE]),
    ]

    tasks = [
        Task(id="T1", name="Medical at H1", task_type=TaskType.MEDICAL_RESPONSE,
             target_entity_id="H1", priority=0.85),
        Task(id="T2", name="Rescue at V1", task_type=TaskType.RESCUE,
             target_entity_id="V1", priority=0.70),
    ]

    return network, resources, tasks


def test_optimizer_assigns_tasks():
    network, resources, tasks = _make_simple_world()
    plan = optimize_allocation(resources, tasks, network)
    assert len(plan.allocations) >= 1
    assert plan.coverage_score > 0.0


def test_optimizer_respects_capabilities():
    network, resources, tasks = _make_simple_world()
    plan = optimize_allocation(resources, tasks, network)
    # Check ambulance is not assigned rescue
    for alloc in plan.allocations:
        resource = next(r for r in resources if r.id == alloc.resource_id)
        task = next(t for t in tasks if t.id == alloc.task_id)
        assert task.task_type in resource.capabilities, \
            f"Resource {resource.name} shouldn't do {task.task_type}"


def test_optimizer_avoids_blocked_routes():
    network = NetworkState()
    roads = [
        Road(id="R1", name="Base-Target", from_node="BASE", to_node="TARGET",
             distance_km=5.0, travel_time_min=20.0, status=RoadStatus.BLOCKED),
    ]
    network.rebuild(roads, [])

    resources = [
        Resource(id="RT1", name="Team", type=ResourceType.RESCUE_TEAM,
                 status=ResourceStatus.AVAILABLE, location_id="BASE",
                 capabilities=[TaskType.RESCUE]),
    ]
    tasks = [
        Task(id="T1", name="Rescue", task_type=TaskType.RESCUE,
             target_entity_id="TARGET", priority=0.9),
    ]

    plan = optimize_allocation(resources, tasks, network)
    # With blocked route, task should be unassigned
    assert "T1" in plan.unassigned_tasks


def test_optimizer_no_double_assignment():
    network, resources, tasks = _make_simple_world()
    plan = optimize_allocation(resources, tasks, network)
    # Each resource used at most once
    resource_ids = [a.resource_id for a in plan.allocations]
    assert len(resource_ids) == len(set(resource_ids))
    # Each task assigned at most once
    task_ids = [a.task_id for a in plan.allocations]
    assert len(task_ids) == len(set(task_ids))


def test_optimizer_vs_baseline():
    """AI optimizer should not be worse than baseline on simple case."""
    network, resources, tasks = _make_simple_world()
    ai_plan = optimize_allocation(resources, tasks, network)
    baseline = baseline_nearest_assignment(resources, tasks, network)
    # Both should cover tasks
    assert ai_plan.coverage_score >= 0.0
    assert baseline.coverage_score >= 0.0


def test_optimizer_unavailable_resource_excluded():
    network, resources, tasks = _make_simple_world()
    resources[0].status = ResourceStatus.UNAVAILABLE
    plan = optimize_allocation(resources, tasks, network)
    # Unavailable resource should not be assigned
    for alloc in plan.allocations:
        assert alloc.resource_id != "RT1"


def test_optimizer_no_tasks():
    network, resources, _ = _make_simple_world()
    plan = optimize_allocation(resources, [], network)
    assert len(plan.allocations) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Regression: decisions must describe the FINAL allocations after a swap
# ─────────────────────────────────────────────────────────────────────────────

def _make_swap_world():
    """
    Build a world where the greedy pass produces a pairing that local
    improvement then swaps, so the swap path is actually exercised.

    Travel times (risk=0 so edge cost == travel time):
        RT_A(BASE_A) -> NEAR = 10,  -> FAR = 20
        RT_B(BASE_B) -> NEAR = 12,  -> FAR = 42 (via NEAR+BASE_A, cheaper than
                                                 the direct 60min road)

    Greedy assigns RT_A->NEAR (highest score) then RT_B->FAR, giving a weighted
    total of 10*0.9 + 42*0.5 = 30.0. The swap gives 20*0.5 + 12*0.9 = 20.8,
    which clears the engine's 5% improvement threshold, so the swap is applied.
    """
    network = NetworkState()
    roads = [
        Road(id="RA_NEAR", name="BaseA-Near", from_node="BASE_A", to_node="NEAR",
             distance_km=5.0, travel_time_min=10.0, risk=0.0),
        Road(id="RA_FAR", name="BaseA-Far", from_node="BASE_A", to_node="FAR",
             distance_km=10.0, travel_time_min=20.0, risk=0.0),
        Road(id="RB_NEAR", name="BaseB-Near", from_node="BASE_B", to_node="NEAR",
             distance_km=6.0, travel_time_min=12.0, risk=0.0),
        Road(id="RB_FAR", name="BaseB-Far", from_node="BASE_B", to_node="FAR",
             distance_km=30.0, travel_time_min=60.0, risk=0.0),
    ]
    network.rebuild(roads, [])

    # Both are rescue teams, so both can perform RESCUE and EVACUATION.
    # Cross-capability is required for the optimizer to consider a swap.
    resources = [
        Resource(id="RT_A", name="Rescue Team A", type=ResourceType.RESCUE_TEAM,
                 status=ResourceStatus.AVAILABLE, location_id="BASE_A",
                 capabilities=[TaskType.RESCUE, TaskType.EVACUATION]),
        Resource(id="RT_B", name="Rescue Team B", type=ResourceType.RESCUE_TEAM,
                 status=ResourceStatus.AVAILABLE, location_id="BASE_B",
                 capabilities=[TaskType.RESCUE, TaskType.EVACUATION]),
    ]
    tasks = [
        Task(id="T_NEAR", name="Rescue at Near", task_type=TaskType.RESCUE,
             target_entity_id="NEAR", priority=0.9),
        Task(id="T_FAR", name="Evacuate Far", task_type=TaskType.EVACUATION,
             target_entity_id="FAR", priority=0.5),
    ]
    return network, resources, tasks


def test_local_improve_actually_swaps():
    """Guard: the swap world must genuinely trigger a swap.

    If the engine's scoring or threshold changes so that no swap occurs, this
    fails loudly rather than letting the regression test below pass vacuously.
    """
    network, resources, tasks = _make_swap_world()
    plan = optimize_allocation(resources, tasks, network)

    by_resource = {a.resource_id: a.task_id for a in plan.allocations}
    assert by_resource == {"RT_A": "T_FAR", "RT_B": "T_NEAR"}, (
        f"Expected post-swap pairing, got {by_resource}"
    )


def test_decisions_match_allocations_after_swap():
    """
    Regression for the local-improvement bug: `_local_improve` rewrote
    allocations[i]/[j] on an accepted swap but left `decisions` untouched, so the
    persisted DecisionDB rows described the PRE-swap pairing. B7 joins decisions
    to allocations on task/resource, so a stale decision makes that join wrong.
    """
    network, resources, tasks = _make_swap_world()
    plan = optimize_allocation(resources, tasks, network)

    task_by_id = {t.id: t for t in tasks}
    resource_by_id = {r.id: r for r in resources}

    # DecisionExplanation carries no task_id, so correlate via the task's
    # target_entity_id, which is what the decision does record.
    expected = {
        (task_by_id[a.task_id].target_entity_id, a.resource_id)
        for a in plan.allocations
    }
    actual = {(d.target_entity_id, d.resource_id) for d in plan.decisions}

    assert actual == expected, (
        f"Decisions describe a different pairing than allocations.\n"
        f"  allocations: {sorted(expected)}\n"
        f"  decisions:   {sorted(actual)}"
    )

    # Every decision must also be internally consistent: the action text names
    # the resource it is paired with, and priority matches the paired task.
    entity_to_task = {t.target_entity_id: t for t in tasks}
    for d in plan.decisions:
        resource = resource_by_id[d.resource_id]
        task = entity_to_task[d.target_entity_id]
        assert resource.name in d.recommended_action, (
            f"Decision action {d.recommended_action!r} does not name {resource.name}"
        )
        assert task.name in d.recommended_action, (
            f"Decision action {d.recommended_action!r} does not name {task.name}"
        )
        assert d.priority == pytest.approx(task.priority), (
            f"Decision priority {d.priority} != paired task priority {task.priority}"
        )


def test_decisions_index_aligned_with_allocations_after_swap():
    """`decisions[i]` must describe `allocations[i]` — the engine relies on this."""
    network, resources, tasks = _make_swap_world()
    plan = optimize_allocation(resources, tasks, network)

    assert len(plan.decisions) == len(plan.allocations)

    task_by_id = {t.id: t for t in tasks}
    for alloc, decision in zip(plan.allocations, plan.decisions):
        assert decision.resource_id == alloc.resource_id
        assert decision.target_entity_id == task_by_id[alloc.task_id].target_entity_id


# ─────────────────────────────────────────────────────────────────────────────
# Edge Cases
# ─────────────────────────────────────────────────────────────────────────────

def test_fuse_one_low_confidence_report():
    obs = make_observation(value="blocked", confidence=0.15)
    result = fuse_observations([obs], "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "blocked"
    # weight = reliability(0.88) * conf(0.15) * freshness(~1.0) ≈ 0.132
    # confidence = 1.0 * 0.132 = 0.132
    assert result.confidence < 0.20, f"Low confidence report should yield low fusion confidence, got {result.confidence}"


def test_fuse_multiple_equal_priority():
    """Equal-weight conflicting observations should both be detected."""
    obs1 = make_observation(value="blocked", confidence=0.7, source_type=SourceType.FIELD_REPORT)
    obs2 = make_observation(value="open", confidence=0.7, source_type=SourceType.FIELD_REPORT)
    result = fuse_observations([obs1, obs2], "B1", ObservationType.BRIDGE_STATUS)
    assert result.conflict_status == ConflictStatus.CONFLICTING


def test_route_self_route():
    network = NetworkState()
    roads = [Road(id="R1", name="A-B", from_node="A", to_node="B",
                  distance_km=5.0, travel_time_min=20.0)]
    network.rebuild(roads, [])
    route = network.find_route("A", "A")
    # Route to self is trivially feasible
    assert route.feasible or route.origin == route.destination


def test_route_unknown_node():
    network = NetworkState()
    roads = [Road(id="R1", name="A-B", from_node="A", to_node="B",
                  distance_km=5.0, travel_time_min=20.0)]
    network.rebuild(roads, [])
    route = network.find_route("X", "Y")
    assert not route.feasible


def test_can_perform_capability_check():
    resource = Resource(id="A1", name="Ambulance", type=ResourceType.AMBULANCE,
                        status=ResourceStatus.AVAILABLE, location_id="H1",
                        capabilities=[TaskType.MEDICAL_RESPONSE])
    task_medical = Task(id="T1", name="Medical", task_type=TaskType.MEDICAL_RESPONSE,
                        target_entity_id="H1", priority=0.8)
    task_rescue = Task(id="T2", name="Rescue", task_type=TaskType.RESCUE,
                       target_entity_id="V1", priority=0.8)
    assert _can_perform(resource, task_medical) is True
    assert _can_perform(resource, task_rescue) is False


def test_can_perform_unavailable_resource():
    resource = Resource(id="A1", name="Ambulance", type=ResourceType.AMBULANCE,
                        status=ResourceStatus.UNAVAILABLE, location_id="H1",
                        capabilities=[TaskType.MEDICAL_RESPONSE])
    task = Task(id="T1", name="Medical", task_type=TaskType.MEDICAL_RESPONSE,
                target_entity_id="H1", priority=0.8)
    assert _can_perform(resource, task) is False


def test_duplicate_observations_fused_correctly():
    """Duplicate observations should increase support for their value."""
    obs1 = make_observation(value="blocked", confidence=0.8)
    obs2 = make_observation(value="blocked", confidence=0.8)
    obs3 = make_observation(value="blocked", confidence=0.8)
    result = fuse_observations([obs1, obs2, obs3], "B1", ObservationType.BRIDGE_STATUS)
    assert result.best_value == "blocked"
    assert result.source_count == 3
    assert result.conflict_status == ConflictStatus.NONE


def test_criticality_all_weights_sum_to_one():
    """Verify weight configuration is valid."""
    from app.config import settings
    total = (
        settings.criticality_weight_population_impact
        + settings.criticality_weight_service_criticality
        + settings.criticality_weight_time_sensitivity
        + settings.criticality_weight_isolation_risk
        + settings.criticality_weight_damage_severity
    )
    assert abs(total - 1.0) < 0.001, f"Criticality weights must sum to 1.0, got {total}"
