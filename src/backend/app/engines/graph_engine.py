"""
Graph / Accessibility Engine.

Represents the road network as a weighted directed graph using NetworkX.
Computes shortest feasible routes incorporating:
- travel time
- road/bridge status (BLOCKED edges excluded)
- risk penalties
- vehicle restrictions
- uncertainty penalties for UNKNOWN edges
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import networkx as nx

from app.config import settings
from app.models.domain import Road, Bridge, Route, RoadStatus

logger = logging.getLogger(__name__)


@dataclass
class NetworkState:
    """In-memory road network graph."""
    graph: nx.DiGraph = field(default_factory=nx.DiGraph)
    roads: dict[str, Road] = field(default_factory=dict)
    bridges: dict[str, Bridge] = field(default_factory=dict)

    def rebuild(self, roads: list[Road], bridges: list[Bridge]) -> None:
        """Rebuild the graph from road and bridge data."""
        self.graph = nx.DiGraph()
        self.roads = {r.id: r for r in roads}
        self.bridges = {b.id: b for b in bridges}

        # Build bridge-on-road index
        bridge_for_road: dict[str, Bridge] = {}
        for b in bridges:
            bridge_for_road[b.on_road] = b

        for road in roads:
            bridge = bridge_for_road.get(road.id)
            effective_status, effective_risk, effective_confidence = _effective_road_state(
                road, bridge
            )

            # Cost = travel_time * (1 + risk_multiplier) for feasible paths
            cost = _compute_edge_cost(road.travel_time_min, effective_risk, effective_status)

            self.graph.add_edge(
                road.from_node,
                road.to_node,
                road_id=road.id,
                distance_km=road.distance_km,
                travel_time_min=road.travel_time_min,
                status=effective_status.value,
                risk=effective_risk,
                confidence=effective_confidence,
                cost=cost,
                vehicle_restrictions=road.vehicle_restrictions,
                bridge_id=bridge.id if bridge else None,
                bridge_capacity=bridge.capacity if bridge else "none",
            )
            # Add reverse direction (roads are bidirectional)
            self.graph.add_edge(
                road.to_node,
                road.from_node,
                road_id=road.id,
                distance_km=road.distance_km,
                travel_time_min=road.travel_time_min,
                status=effective_status.value,
                risk=effective_risk,
                confidence=effective_confidence,
                cost=cost,
                vehicle_restrictions=road.vehicle_restrictions,
                bridge_id=bridge.id if bridge else None,
                bridge_capacity=bridge.capacity if bridge else "none",
            )

        logger.info(
            f"Graph rebuilt: {self.graph.number_of_nodes()} nodes, "
            f"{self.graph.number_of_edges()} edges"
        )

    def update_road(self, road_id: str, status: RoadStatus, confidence: float = 1.0) -> None:
        """Update a road's status and recompute its edge cost."""
        if road_id not in self.roads:
            logger.warning(f"Road {road_id} not found in network")
            return
        road = self.roads[road_id]
        road.status = status
        road.confidence = confidence
        self._update_edge(road)

    def update_bridge(self, bridge_id: str, status: RoadStatus, confidence: float = 1.0) -> None:
        """Update a bridge's status — affects its associated road."""
        if bridge_id not in self.bridges:
            logger.warning(f"Bridge {bridge_id} not found in network")
            return
        bridge = self.bridges[bridge_id]
        bridge.status = status
        bridge.confidence = confidence
        # Update the road the bridge sits on
        road_id = bridge.on_road
        if road_id in self.roads:
            self._update_edge(self.roads[road_id], bridge)

    def _update_edge(self, road: Road, bridge: Optional[Bridge] = None) -> None:
        if bridge is None:
            bridge = self.bridges.get(
                next((b.id for b in self.bridges.values() if b.on_road == road.id), ""), None
            )
        effective_status, effective_risk, effective_confidence = _effective_road_state(road, bridge)
        cost = _compute_edge_cost(road.travel_time_min, effective_risk, effective_status)

        for u, v, data in list(self.graph.edges(data=True)):
            if data.get("road_id") == road.id:
                self.graph[u][v]["status"] = effective_status.value
                self.graph[u][v]["risk"] = effective_risk
                self.graph[u][v]["confidence"] = effective_confidence
                self.graph[u][v]["cost"] = cost

    def find_route(
        self,
        origin: str,
        destination: str,
        vehicle_type: str = "heavy",
    ) -> Route:
        """
        Find shortest feasible route from origin to destination.
        Blocked edges are excluded. Unknown edges carry risk penalty.
        Returns Route (infeasible if no path exists).
        """
        # Create a filtered subgraph excluding blocked/impassable edges
        feasible_edges = []
        blocked_alternatives = []
        for u, v, data in self.graph.edges(data=True):
            status = data.get("status", "open")
            restrictions = data.get("vehicle_restrictions", [])
            bridge_cap = data.get("bridge_capacity", "none")

            # Skip if vehicle type not allowed
            if vehicle_type in restrictions:
                blocked_alternatives.append(data.get("road_id", f"{u}-{v}"))
                continue
            # Skip if bridge capacity insufficient
            if bridge_cap not in ("none", vehicle_type) and not _vehicle_fits(vehicle_type, bridge_cap):
                blocked_alternatives.append(data.get("road_id", f"{u}-{v}"))
                continue
            # Skip if blocked
            if status == RoadStatus.BLOCKED.value:
                blocked_alternatives.append(data.get("road_id", f"{u}-{v}"))
                continue

            feasible_edges.append((u, v))

        subgraph = self.graph.edge_subgraph(feasible_edges)

        if origin not in subgraph or destination not in subgraph:
            return Route(
                origin=origin,
                destination=destination,
                feasible=False,
                blocked_alternatives=list(set(blocked_alternatives)),
                reason=f"No feasible path: {'origin' if origin not in subgraph else 'destination'} node not reachable",
            )

        try:
            path_nodes = nx.shortest_path(
                subgraph, source=origin, target=destination, weight="cost"
            )
        except nx.NetworkXNoPath:
            return Route(
                origin=origin,
                destination=destination,
                feasible=False,
                blocked_alternatives=list(set(blocked_alternatives)),
                reason="No feasible path — all routes blocked",
            )

        # Build route details
        path_edges = []
        total_distance = 0.0
        total_time = 0.0
        total_risk = 0.0
        edge_count = 0

        for i in range(len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i + 1]
            data = subgraph[u][v]
            path_edges.append(data.get("road_id", f"{u}-{v}"))
            total_distance += data.get("distance_km", 0)
            total_time += data.get("travel_time_min", 0)
            total_risk += data.get("risk", 0)
            edge_count += 1

        avg_risk = total_risk / max(1, edge_count)

        return Route(
            origin=origin,
            destination=destination,
            path_nodes=path_nodes,
            path_edges=path_edges,
            total_distance_km=round(total_distance, 2),
            total_time_min=round(total_time, 1),
            total_risk=round(avg_risk, 3),
            feasible=True,
            blocked_alternatives=list(set(blocked_alternatives)),
            reason=f"Optimal feasible route via {len(path_nodes)} nodes",
            vehicle_type=vehicle_type,
        )

    def get_all_nodes(self) -> list[str]:
        return list(self.graph.nodes())


def _effective_road_state(
    road: Road, bridge: Optional[Bridge]
) -> tuple[RoadStatus, float, float]:
    """
    Determine effective status for a road considering its bridge.
    A blocked bridge makes the road blocked regardless of road status.
    """
    road_status = road.status
    road_risk = road.risk
    road_confidence = road.confidence

    if bridge is None:
        return road_status, road_risk, road_confidence

    # Bridge overrides road: if bridge is blocked, road is blocked
    if bridge.status == RoadStatus.BLOCKED:
        return RoadStatus.BLOCKED, 1.0, min(road_confidence, bridge.confidence)

    if bridge.status == RoadStatus.HIGH_RISK:
        return RoadStatus.HIGH_RISK, max(road_risk, settings.risk_penalty_high_risk_road), min(road_confidence, bridge.confidence)

    if bridge.status == RoadStatus.UNKNOWN:
        return RoadStatus.UNKNOWN, max(road_risk, settings.risk_penalty_unknown_road), min(road_confidence, bridge.confidence)

    if bridge.status == RoadStatus.PARTIALLY_BLOCKED:
        return RoadStatus.PARTIALLY_BLOCKED, max(road_risk, settings.risk_penalty_partially_blocked), min(road_confidence, bridge.confidence)

    return road_status, road_risk, min(road_confidence, bridge.confidence)


def _compute_edge_cost(travel_time: float, risk: float, status: RoadStatus) -> float:
    """
    cost = travel_time * (1 + risk_multiplier)
    Unknown roads get a risk penalty but are NOT excluded — let the router decide.
    """
    if status == RoadStatus.BLOCKED:
        return float("inf")
    if status == RoadStatus.UNKNOWN:
        return travel_time * (1 + settings.risk_penalty_unknown_road)
    if status == RoadStatus.HIGH_RISK:
        return travel_time * (1 + settings.risk_penalty_high_risk_road)
    if status == RoadStatus.PARTIALLY_BLOCKED:
        return travel_time * (1 + settings.risk_penalty_partially_blocked)
    return travel_time * (1 + risk)


def _vehicle_fits(vehicle_type: str, bridge_capacity: str) -> bool:
    """Check if vehicle type can use bridge given its capacity rating."""
    capacity_order = {"light": 1, "medium": 2, "heavy": 3, "none": 0}
    vehicle_weight = capacity_order.get(vehicle_type, 2)
    bridge_weight = capacity_order.get(bridge_capacity, 3)
    return vehicle_weight <= bridge_weight


# Singleton network state
network = NetworkState()
