"""
Resource Optimization Engine.

Implements a greedy + local improvement assignment algorithm:

1. Score each (task, resource) pair: priority * (1/travel_time) * capability_match
2. Use greedy assignment: highest-scored pairs first, excluding conflicts
3. Apply local improvement: swap pairs if it reduces total weighted travel time
4. Return ResponsePlan with explanations

This is a deterministic constrained assignment — NOT simple sorting.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from app.models.domain import (
    Resource, Task, Route, AllocationResult, ResponsePlan,
    DecisionExplanation, ResourceStatus, TaskType, ResourceType
)
from app.engines.graph_engine import NetworkState

logger = logging.getLogger(__name__)

# Which resource types can perform which task types
CAPABILITY_MAP: dict[ResourceType, list[TaskType]] = {
    ResourceType.RESCUE_TEAM: [TaskType.RESCUE, TaskType.EVACUATION, TaskType.VERIFICATION],
    ResourceType.AMBULANCE: [TaskType.MEDICAL_RESPONSE],
    ResourceType.ENGINEERING_TEAM: [TaskType.ENGINEERING, TaskType.VERIFICATION],
    ResourceType.SUPPLY_VEHICLE: [TaskType.SUPPLY_DELIVERY],
    ResourceType.MEDICAL_UNIT: [TaskType.MEDICAL_RESPONSE, TaskType.EVACUATION],
}

# Vehicle type for routing by resource type
RESOURCE_VEHICLE_TYPE: dict[ResourceType, str] = {
    ResourceType.RESCUE_TEAM: "medium",
    ResourceType.AMBULANCE: "heavy",
    ResourceType.ENGINEERING_TEAM: "heavy",
    ResourceType.SUPPLY_VEHICLE: "heavy",
    ResourceType.MEDICAL_UNIT: "medium",
}


def _can_perform(resource: Resource, task: Task) -> bool:
    """Check if resource can perform the task."""
    if resource.status != ResourceStatus.AVAILABLE:
        return False
    allowed = CAPABILITY_MAP.get(ResourceType(resource.type), [])
    return task.task_type in allowed


def _score_pair(
    resource: Resource,
    task: Task,
    travel_time: float,
    max_travel_time: float = 120.0,
) -> float:
    """
    Score a (resource, task) assignment pair.
    
    score = task_priority * capability_bonus * time_efficiency
    
    time_efficiency = 1 - (travel_time / max_travel_time)  [0-1]
    capability_bonus = 1.0 if direct match, 0.7 if partial
    """
    if not _can_perform(resource, task):
        return -1.0

    time_efficiency = max(0.0, 1.0 - (travel_time / max_travel_time))

    # Capability match bonus
    direct = task.task_type in (CAPABILITY_MAP.get(ResourceType(resource.type), []))
    cap_bonus = 1.0 if direct else 0.7

    return task.priority * cap_bonus * (0.4 + 0.6 * time_efficiency)


def optimize_allocation(
    resources: list[Resource],
    tasks: list[Task],
    network: NetworkState,
    simulation_time_min: int = 0,
) -> ResponsePlan:
    """
    Greedy + local improvement resource allocation.
    
    Returns a ResponsePlan with all assignments and explanations.
    """
    available_resources = [r for r in resources if r.status == ResourceStatus.AVAILABLE]
    pending_tasks = [t for t in tasks if t.status == "pending"]

    if not pending_tasks:
        return ResponsePlan(
            simulation_time_min=simulation_time_min,
            unassigned_resources=[r.id for r in available_resources],
            explanation="No pending tasks to assign.",
        )

    # Pre-compute routes for all (resource, task) pairs
    routes: dict[tuple[str, str], Route] = {}
    travel_times: dict[tuple[str, str], float] = {}
    max_travel = 120.0

    for resource in available_resources:
        vehicle_type = RESOURCE_VEHICLE_TYPE.get(ResourceType(resource.type), "heavy")
        for task in pending_tasks:
            if not _can_perform(resource, task):
                continue
            route = network.find_route(
                resource.location_id,
                task.target_entity_id,
                vehicle_type=vehicle_type,
            )
            key = (resource.id, task.id)
            routes[key] = route
            if route.feasible:
                travel_times[key] = route.total_time_min
            else:
                travel_times[key] = float("inf")

    # Build score matrix
    scores: list[tuple[float, str, str]] = []  # (score, resource_id, task_id)
    for resource in available_resources:
        for task in pending_tasks:
            if not _can_perform(resource, task):
                continue
            tt = travel_times.get((resource.id, task.id), float("inf"))
            if tt == float("inf"):
                continue  # Skip infeasible routes
            score = _score_pair(resource, task, tt, max_travel)
            if score > 0:
                scores.append((score, resource.id, task.id))

    # Sort descending by score
    scores.sort(key=lambda x: x[0], reverse=True)

    # Greedy assignment
    assigned_resources: set[str] = set()
    assigned_tasks: set[str] = set()
    allocations: list[AllocationResult] = []
    decisions: list[DecisionExplanation] = []

    for score, resource_id, task_id in scores:
        if resource_id in assigned_resources or task_id in assigned_tasks:
            continue

        resource = next(r for r in available_resources if r.id == resource_id)
        task = next(t for t in pending_tasks if t.id == task_id)
        route = routes.get((resource_id, task_id))
        tt = travel_times.get((resource_id, task_id), 0.0)

        assigned_resources.add(resource_id)
        assigned_tasks.add(task_id)

        allocation = AllocationResult(
            task_id=task_id,
            resource_id=resource_id,
            route=route,
            estimated_arrival_min=tt,
            priority_score=score,
            explanation=(
                f"{resource.name} assigned to {task.name} "
                f"(score={score:.3f}, ETA={tt:.0f}min, "
                f"route={'feasible' if route and route.feasible else 'blocked'})"
            ),
        )
        allocations.append(allocation)

        # Create decision explanation
        reasons = [
            f"Task priority: {task.priority:.2f}",
            f"Resource capability match: {task.task_type.value}",
            f"Estimated travel time: {tt:.0f} minutes",
        ]
        if route and route.feasible:
            reasons.append(f"Route via {len(route.path_nodes)} nodes, {route.total_distance_km:.1f}km")
        else:
            reasons.append("⚠ No direct route — resource may need alternate path")

        decision = DecisionExplanation(
            recommended_action=f"Assign {resource.name} to task: {task.name}",
            target_entity_id=task.target_entity_id,
            resource_id=resource_id,
            priority=task.priority,
            confidence=0.85 if route and route.feasible else 0.50,
            reasons=reasons,
            constraints=[f"Resource type: {resource.type}", f"Task type: {task.task_type.value}"],
            alternatives_considered=[
                f"Other resources: {[r.id for r in available_resources if r.id != resource_id and _can_perform(r, task)]}"
            ],
            simulation_time_min=simulation_time_min,
        )
        decisions.append(decision)

    # Local improvement: try pairwise swaps
    allocations, decisions = _local_improve(
        allocations, decisions, available_resources, pending_tasks, travel_times, routes, simulation_time_min
    )

    # Unassigned
    unassigned_tasks = [t.id for t in pending_tasks if t.id not in assigned_tasks]
    unassigned_resources = [r.id for r in available_resources if r.id not in assigned_resources]

    # Compute summary metrics
    total_travel = sum(a.estimated_arrival_min for a in allocations if a.estimated_arrival_min < float("inf"))
    assigned_tasks_count = len(allocations)
    total_tasks = len(pending_tasks)
    coverage = assigned_tasks_count / total_tasks if total_tasks > 0 else 0.0

    return ResponsePlan(
        simulation_time_min=simulation_time_min,
        allocations=allocations,
        unassigned_tasks=unassigned_tasks,
        unassigned_resources=unassigned_resources,
        total_travel_time=total_travel,
        coverage_score=round(coverage, 3),
        explanation=(
            f"Assigned {assigned_tasks_count}/{total_tasks} tasks. "
            f"Total travel time: {total_travel:.0f}min. "
            f"Coverage: {coverage:.0%}."
        ),
        decisions=decisions,
    )


def _local_improve(
    allocations: list[AllocationResult],
    decisions: list[DecisionExplanation],
    resources: list[Resource],
    tasks: list[Task],
    travel_times: dict[tuple[str, str], float],
    routes: dict[tuple[str, str], Route],
    simulation_time_min: int,
) -> tuple[list[AllocationResult], list[DecisionExplanation]]:
    """
    Try pairwise swaps to improve total weighted travel time.
    One pass — O(n^2) but n is small for hackathon scale.
    """
    if len(allocations) < 2:
        return allocations, decisions

    improved = True
    iterations = 0
    max_iterations = 10

    resource_map = {r.id: r for r in resources}
    task_map = {t.id: t for t in tasks}

    while improved and iterations < max_iterations:
        improved = False
        iterations += 1
        for i in range(len(allocations)):
            for j in range(i + 1, len(allocations)):
                a1 = allocations[i]
                a2 = allocations[j]

                r1_id, t1_id = a1.resource_id, a1.task_id
                r2_id, t2_id = a2.resource_id, a2.task_id

                r1 = resource_map[r1_id]
                r2 = resource_map[r2_id]
                t1 = task_map[t1_id]
                t2 = task_map[t2_id]

                # Can they swap?
                if not _can_perform(r1, t2) or not _can_perform(r2, t1):
                    continue

                # Current total
                current_total = (
                    travel_times.get((r1_id, t1_id), float("inf")) * t1.priority
                    + travel_times.get((r2_id, t2_id), float("inf")) * t2.priority
                )
                # Swapped total
                swapped_total = (
                    travel_times.get((r1_id, t2_id), float("inf")) * t2.priority
                    + travel_times.get((r2_id, t1_id), float("inf")) * t1.priority
                )

                if swapped_total < current_total * 0.95:  # 5% improvement threshold
                    # Apply swap
                    allocations[i] = AllocationResult(
                        task_id=t2_id,
                        resource_id=r1_id,
                        route=routes.get((r1_id, t2_id)),
                        estimated_arrival_min=travel_times.get((r1_id, t2_id), 0.0),
                        priority_score=a1.priority_score,
                        explanation=f"{r1.name} reassigned to {t2.name} after swap optimization",
                    )
                    allocations[j] = AllocationResult(
                        task_id=t1_id,
                        resource_id=r2_id,
                        route=routes.get((r2_id, t1_id)),
                        estimated_arrival_min=travel_times.get((r2_id, t1_id), 0.0),
                        priority_score=a2.priority_score,
                        explanation=f"{r2.name} reassigned to {t1.name} after swap optimization",
                    )
                    improved = True
                    logger.debug(f"Swap improved: {current_total:.1f} → {swapped_total:.1f}")

    return allocations, decisions


def baseline_nearest_assignment(
    resources: list[Resource],
    tasks: list[Task],
    network: NetworkState,
    simulation_time_min: int = 0,
) -> ResponsePlan:
    """
    Baseline 1: Assign nearest available resource to each task in priority order.
    No optimization, no swap improvement.
    """
    available_resources = list(resources)
    pending_tasks = sorted(tasks, key=lambda t: t.priority, reverse=True)
    assigned_resources: set[str] = set()
    allocations: list[AllocationResult] = []

    for task in pending_tasks:
        best_resource = None
        best_time = float("inf")
        best_route = None

        for resource in available_resources:
            if resource.id in assigned_resources:
                continue
            if not _can_perform(resource, task):
                continue
            vehicle_type = RESOURCE_VEHICLE_TYPE.get(ResourceType(resource.type), "heavy")
            route = network.find_route(resource.location_id, task.target_entity_id, vehicle_type)
            if route.feasible and route.total_time_min < best_time:
                best_time = route.total_time_min
                best_resource = resource
                best_route = route

        if best_resource:
            assigned_resources.add(best_resource.id)
            allocations.append(AllocationResult(
                task_id=task.id,
                resource_id=best_resource.id,
                route=best_route,
                estimated_arrival_min=best_time,
                priority_score=task.priority,
                explanation=f"[BASELINE] Nearest: {best_resource.name} → {task.name}",
            ))

    unassigned = [t.id for t in pending_tasks if not any(a.task_id == t.id for a in allocations)]
    total_travel = sum(a.estimated_arrival_min for a in allocations)
    coverage = len(allocations) / len(pending_tasks) if pending_tasks else 0.0

    return ResponsePlan(
        simulation_time_min=simulation_time_min,
        allocations=allocations,
        unassigned_tasks=unassigned,
        total_travel_time=total_travel,
        coverage_score=round(coverage, 3),
        explanation=f"[BASELINE] Nearest-resource strategy: {len(allocations)}/{len(pending_tasks)} assigned.",
    )
