"""
IBM Bob MCP Server — AI Emergency Operations & Resource Orchestration System.

Exposes operational tools that Bob can call to query the disaster response engine.
All tools call the actual FastAPI backend — no hardcoded responses.

Tools:
  get_current_situation()
  get_priority_sites()
  get_entity_evidence(entity_id)
  get_route(origin, destination, vehicle_type)
  get_resource_status()
  generate_response_plan()
  simulate_event(event_type, entity_id, ...)
  simulate_next_event()
  recalculate_allocation()
  explain_decision(decision_id)
  get_benchmark_metrics()
  ask_operator_question(question)
  get_timeline()
  reset_simulation()
"""
from __future__ import annotations

import json
import sys
import os

# Add vendor/backend path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")


def _call(method: str, path: str, **kwargs) -> dict:
    """Make a synchronous HTTP call to the backend."""
    url = f"{BACKEND_URL}{path}"
    try:
        with httpx.Client(timeout=15.0) as client:
            if method == "GET":
                resp = client.get(url, params=kwargs.get("params"))
            elif method == "POST":
                resp = client.post(url, json=kwargs.get("json"), params=kwargs.get("params"))
            else:
                raise ValueError(f"Unsupported method: {method}")
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        return {"error": f"Cannot connect to backend at {BACKEND_URL}. Ensure the backend is running."}
    except httpx.HTTPStatusError as e:
        return {"error": f"Backend error {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Tool implementations (called by MCP framework)
# ─────────────────────────────────────────────────────────────────────────────

def get_current_situation() -> str:
    """
    Get the current emergency situation overview.
    Returns top priorities, blocked infrastructure, evidence conflicts, and response plan.
    """
    data = _call("GET", "/situation")
    if "error" in data:
        return f"Error: {data['error']}"

    lines = [
        f"# BHOTE VALLEY EMERGENCY SITUATION — T+{data['sim_time_min']} minutes",
        "",
        f"**Pending Events:** {data['pending_events']} / {data['total_events']} total",
        "",
    ]

    priorities = data.get("top_priorities", [])
    if priorities:
        lines.append("## TOP PRIORITY LOCATIONS")
        for p in priorities[:5]:
            lines.append(
                f"  {p['rank']}. **{p['name']}** — priority={p['priority']:.3f}, "
                f"urgency={p['urgency']:.0%}, accessibility={p['accessibility']:.0%}"
            )
            lines.append(f"     {p['explanation']}")

    blocked = data.get("blocked_infrastructure", [])
    if blocked:
        lines.append(f"\n## BLOCKED INFRASTRUCTURE ({len(blocked)})")
        for b in blocked:
            lines.append(f"  ⛔ {b}")

    conflicts = data.get("evidence_conflicts", [])
    if conflicts:
        lines.append(f"\n## ⚠ CONFLICTING EVIDENCE ({len(conflicts)})")
        for c in conflicts:
            lines.append(f"  • {c}")

    unavail = data.get("unavailable_resources", [])
    if unavail:
        lines.append(f"\n## UNAVAILABLE RESOURCES: {', '.join(unavail)}")

    plan = data.get("current_plan_summary", "")
    if plan:
        lines.append(f"\n## RESPONSE PLAN: {plan}")

    return "\n".join(lines)


def get_priority_sites(top_n: int = 5) -> str:
    """
    Get the top-N highest priority locations requiring attention.
    Returns priority scores, urgency, accessibility, and supporting evidence.
    """
    data = _call("GET", "/priorities")
    if "error" in data:
        return f"Error: {data['error']}"

    priorities = data.get("priorities", [])[:top_n]
    if not priorities:
        return "No priority data available. Run simulation events first."

    lines = [f"# TOP {top_n} PRIORITY SITES\n"]
    for p in priorities:
        lines.append(
            f"**#{p['rank']} {p['entity_name']}** ({p['entity_type']})"
        )
        lines.append(f"  Priority Score: {p['priority_score']:.3f}")
        lines.append(f"  Criticality: {p['criticality_score']:.3f}")
        lines.append(f"  Urgency: {p['urgency_score']:.0%}")
        lines.append(f"  Accessibility: {p['accessibility_factor']:.0%}")
        lines.append(f"  Confidence: {p['confidence_factor']:.0%}")
        lines.append(f"  {p['explanation']}")
        if p.get("supporting_factors"):
            lines.append(f"  Factors: {', '.join(p['supporting_factors'])}")
        lines.append("")

    return "\n".join(lines)


def get_entity_evidence(entity_id: str) -> str:
    """
    Get all evidence for a specific entity (asset, road, or bridge).
    Shows fused evidence summaries and raw observations with source reliability.
    """
    data = _call("GET", f"/evidence/{entity_id}")
    if "error" in data:
        return f"Error: {data['error']}"

    lines = [f"# EVIDENCE FOR ENTITY: {entity_id}\n"]

    summaries = data.get("evidence_summaries", [])
    if summaries:
        lines.append("## FUSED EVIDENCE SUMMARIES")
        for s in summaries:
            conflict_flag = " ⚠ CONFLICTING" if s["conflict_status"] == "conflicting" else ""
            lines.append(
                f"  **{s['observation_type']}**: {s['best_value'].upper()}"
                f" (confidence={s['confidence']:.0%}{conflict_flag})"
            )
            lines.append(f"    Sources: {s['source_count']} observations")
            if s.get("recommendation"):
                lines.append(f"    ⚠ {s['recommendation']}")

    raw_obs = data.get("raw_observations", [])
    if raw_obs:
        lines.append(f"\n## RAW OBSERVATIONS ({len(raw_obs)})")
        for obs in raw_obs:
            lines.append(
                f"  [{obs['timestamp'][:16]}] {obs['source_type'].upper()} "
                f"({obs['source_id']}): {obs['value']} "
                f"(conf={obs['confidence']:.0%}, fresh={obs['freshness']:.0%})"
            )
            if obs.get("raw_text"):
                lines.append(f"    \"{obs['raw_text'][:100]}\"")

    if not summaries and not raw_obs:
        lines.append("No evidence recorded for this entity.")

    return "\n".join(lines)


def get_route(origin: str, destination: str, vehicle_type: str = "heavy") -> str:
    """
    Calculate the best feasible route between two locations.
    Accounts for blocked roads and bridges.
    """
    data = _call("GET", "/routes", params={
        "origin": origin,
        "destination": destination,
        "vehicle_type": vehicle_type,
    })
    if "error" in data:
        return f"Error: {data['error']}"

    if not data.get("feasible", True):
        return (
            f"# ROUTE: {origin} → {destination}\n\n"
            f"**❌ NO FEASIBLE ROUTE**\n"
            f"Reason: {data.get('reason', 'All paths blocked')}\n"
            f"Blocked alternatives: {', '.join(data.get('blocked_alternatives', []))}"
        )

    lines = [f"# ROUTE: {origin} → {destination} ({vehicle_type} vehicle)\n"]
    lines.append(f"**Status: ✅ FEASIBLE**")
    lines.append(f"**Path:** {' → '.join(data.get('path_nodes', []))}")
    lines.append(f"**Roads:** {', '.join(data.get('path_edges', []))}")
    lines.append(f"**Distance:** {data.get('total_distance_km', 0):.1f} km")
    lines.append(f"**Estimated Time:** {data.get('total_time_min', 0):.0f} minutes")
    lines.append(f"**Risk Level:** {data.get('total_risk', 0):.1%}")
    if data.get("blocked_alternatives"):
        lines.append(f"**Blocked Alternatives:** {', '.join(data['blocked_alternatives'])}")
    lines.append(f"\n_{data.get('reason', '')}_")

    return "\n".join(lines)


def get_resource_status() -> str:
    """
    Get status of all response resources (rescue teams, ambulances, etc.).
    """
    data = _call("GET", "/resources")
    if "error" in data:
        return f"Error: {data['error']}"

    resources = data.get("resources", [])
    lines = ["# RESOURCE STATUS\n"]

    by_status = {"available": [], "deployed": [], "unavailable": [], "en_route": []}
    for r in resources:
        by_status.setdefault(r["status"], []).append(r)

    for status, items in by_status.items():
        if items:
            emoji = {"available": "✅", "deployed": "🚨", "unavailable": "❌", "en_route": "🚗"}.get(status, "•")
            lines.append(f"## {emoji} {status.upper()} ({len(items)})")
            for r in items:
                lines.append(
                    f"  • **{r['name']}** ({r['type']}) — at {r['location_id']}"
                    f" — capabilities: {', '.join(r['capabilities'])}"
                )

    return "\n".join(lines)


def generate_response_plan() -> str:
    """
    Generate an optimized response plan assigning resources to tasks.
    Uses evidence-aware constrained optimization vs. baseline nearest-resource strategy.
    """
    data = _call("POST", "/optimize")
    if "error" in data:
        return f"Error: {data['error']}"

    plan = data.get("plan", {})
    baseline = data.get("baseline", {})
    comparison = data.get("comparison", {})

    lines = ["# RESPONSE PLAN — AI OPTIMIZED\n"]
    lines.append(f"Coverage: {plan.get('coverage_score', 0):.0%} of tasks assigned")
    lines.append(f"Total travel time: {plan.get('total_travel_time', 0):.0f} min")
    lines.append("")

    allocations = plan.get("allocations", [])
    if allocations:
        lines.append("## ASSIGNMENTS")
        for a in allocations:
            lines.append(
                f"  • Task `{a['task_id']}` → Resource `{a['resource_id']}` "
                f"(ETA: {a['estimated_arrival_min']:.0f}min)"
            )
            lines.append(f"    {a.get('explanation', '')}")

    unassigned = plan.get("unassigned_tasks", [])
    if unassigned:
        lines.append(f"\n⚠ **Unassigned tasks:** {', '.join(unassigned)}")

    if comparison:
        lines.append("\n## VS BASELINE (Nearest Resource)")
        lines.append(f"  Our travel time: {comparison.get('our_total_travel', 0):.0f} min")
        lines.append(f"  Baseline travel time: {comparison.get('baseline_total_travel', 0):.0f} min")
        lines.append(f"  Improvement: {comparison.get('improvement_pct', 0):.1f}%")

    return "\n".join(lines)


def simulate_event(
    event_type: str,
    entity_id: str = None,
    observation_type: str = None,
    value: str = None,
    confidence: float = 0.85,
    severity: float = 0.7,
    description: str = "Bob-injected event",
    source_type: str = "field_report",
) -> str:
    """
    Inject a custom simulation event into the disaster response system.
    The system will process it, update evidence, recalculate priorities and routes.
    
    Common event_types: bridge_damage_report, road_blockage, hospital_demand_surge,
    school_evacuation, resource_unavailable, satellite_observation, alternate_route_opened
    """
    payload = {
        "event_type": event_type,
        "entity_id": entity_id,
        "observation_type": observation_type,
        "value": value,
        "confidence": confidence,
        "severity": severity,
        "description": description,
        "source_type": source_type,
        "metadata": {},
    }
    data = _call("POST", "/simulate/event", json=payload)
    if "error" in data:
        return f"Error: {data['error']}"

    evt_id = data.get("event_id", "unknown")
    situation = data.get("situation_update", {})

    lines = [
        f"# EVENT INJECTED: {event_type}",
        f"Event ID: {evt_id}",
        f"Entity: {entity_id or 'N/A'}",
        f"Value: {value or 'N/A'}",
        "",
        "## SYSTEM RESPONSE",
        f"Simulation time: T+{situation.get('sim_time_min', 0)} minutes",
    ]

    top = situation.get("top_priorities", [])
    if top:
        lines.append(f"New #1 Priority: **{top[0]['name']}** (score={top[0]['priority']:.3f})")

    blocked = situation.get("blocked_infrastructure", [])
    if blocked:
        lines.append(f"Blocked: {', '.join(blocked)}")

    conflicts = situation.get("evidence_conflicts", [])
    if conflicts:
        lines.append(f"⚠ Evidence conflicts: {len(conflicts)}")

    return "\n".join(lines)


def simulate_next_event() -> str:
    """
    Advance the simulation by processing the next scheduled event in the timeline.
    """
    data = _call("POST", "/simulate/next")
    if "error" in data:
        return f"Error: {data['error']}"

    if data.get("status") == "no_more_events":
        return "All simulation events have been processed. Use reset_simulation() to restart."

    evt = data.get("event", {})
    situation = data.get("situation_update", {})

    lines = [
        f"# EVENT PROCESSED: T+{evt.get('time_offset_min', 0)} minutes",
        f"**Type:** {evt.get('event_type', 'unknown')}",
        f"**Entity:** {evt.get('entity_id', 'N/A')}",
        f"**Description:** {evt.get('description', '')}",
        "",
        "## UPDATED SITUATION",
    ]

    top = situation.get("top_priorities", [])
    if top:
        for p in top[:3]:
            lines.append(f"  #{p['rank']} {p['name']}: priority={p['priority']:.3f}")

    blocked = situation.get("blocked_infrastructure", [])
    if blocked:
        lines.append(f"⛔ Blocked: {', '.join(blocked)}")

    conflicts = situation.get("evidence_conflicts", [])
    if conflicts:
        lines.append(f"⚠ {len(conflicts)} evidence conflict(s) detected")

    plan = situation.get("current_plan_summary", "")
    if plan:
        lines.append(f"📋 Plan: {plan}")

    return "\n".join(lines)


def recalculate_allocation() -> str:
    """
    Force recalculation of resource allocation based on current system state.
    Calls POST /optimize to re-run the optimizer with current state.
    Returns updated plan and comparison with baseline.
    """
    data = _call("POST", "/optimize")
    if "error" in data:
        return f"Error: {data['error']}"

    plan = data.get("plan", {})
    baseline = data.get("baseline", {})
    comparison = data.get("comparison", {})

    lines = ["# REALLOCATION — RECALCULATED\n"]
    lines.append(f"Coverage: {plan.get('coverage_score', 0):.0%} of tasks assigned")
    lines.append(f"Total travel time: {plan.get('total_travel_time', 0):.0f} min")
    lines.append("")

    allocations = plan.get("allocations", [])
    if allocations:
        lines.append("## REASSIGNMENTS")
        for a in allocations:
            lines.append(
                f"  • Task `{a['task_id']}` → Resource `{a['resource_id']}` "
                f"(ETA: {a['estimated_arrival_min']:.0f}min)"
            )
            lines.append(f"    {a.get('explanation', '')}")

    unassigned = plan.get("unassigned_tasks", [])
    if unassigned:
        lines.append(f"\n⚠ **Unassigned tasks:** {', '.join(unassigned)}")

    if comparison:
        lines.append("\n## VS BASELINE (Nearest Resource)")
        lines.append(f"  Our travel time: {comparison.get('our_total_travel', 0):.0f} min")
        lines.append(f"  Baseline travel time: {comparison.get('baseline_total_travel', 0):.0f} min")
        lines.append(f"  Improvement: {comparison.get('improvement_pct', 0):.1f}%")

    return "\n".join(lines)


def explain_decision(decision_id: str) -> str:
    """
    Get a detailed explanation for a specific decision, including evidence basis,
    constraints, and alternatives considered.
    """
    data = _call("GET", f"/decisions/{decision_id}")
    if "error" in data:
        # Try listing decisions if ID not found
        decisions_data = _call("GET", "/decisions")
        if "decisions" in decisions_data and decisions_data["decisions"]:
            available = [d["id"] for d in decisions_data["decisions"][:5]]
            return f"Decision '{decision_id}' not found. Available IDs: {available}"
        return f"Error: {data['error']}"

    lines = [
        f"# DECISION EXPLANATION: {data['id']}",
        f"**Action:** {data['recommended_action']}",
        f"**Confidence:** {data['confidence']:.0%}",
        f"**Priority:** {data['priority']:.3f}",
        f"**Sim Time:** T+{data['simulation_time_min']} minutes",
        "",
        "## REASONS",
    ]
    for r in data.get("reasons", []):
        lines.append(f"  • {r}")

    if data.get("constraints"):
        lines.append("\n## CONSTRAINTS")
        for c in data["constraints"]:
            lines.append(f"  • {c}")

    if data.get("alternatives_considered"):
        lines.append("\n## ALTERNATIVES CONSIDERED")
        for a in data["alternatives_considered"]:
            lines.append(f"  • {a}")

    if data.get("human_verification_required"):
        lines.append("\n⚠ **Human operator verification required before execution.**")

    if data.get("ai_explanation"):
        lines.append(f"\n## AI EXPLANATION\n{data['ai_explanation']}")

    return "\n".join(lines)


def get_benchmark_metrics() -> str:
    """
    Run the benchmark and return performance metrics comparing AI system vs. baseline.
    All metrics computed from actual simulation state.
    """
    data = _call("GET", "/benchmark")
    if "error" in data:
        return f"Error: {data['error']}"

    if data.get("status") == "no_tasks":
        return f"No tasks available: {data.get('message', '')}. Run simulation events first."

    ai = data.get("ai_system", {})
    baseline = data.get("baseline", {})
    improvements = data.get("improvements", {})

    lines = [
        "# BENCHMARK RESULTS",
        f"Scenario: {data.get('scenario', 'N/A')}",
        f"Simulation time: T+{data.get('sim_time_min', 0)} minutes",
        "",
        "## AI SYSTEM (Evidence-Aware Optimizer)",
        f"  Coverage Rate: {ai.get('coverage_rate', 0):.0%}",
        f"  Total Travel Time: {ai.get('total_travel_time_min', 0):.0f} min",
        f"  Weighted Response Time: {ai.get('weighted_response_time', 0):.1f}",
        f"  Unmet Critical Demand: {ai.get('unmet_critical_demand', 0):.0%}",
        f"  Resource Utilization: {ai.get('resource_utilization', 0):.0%}",
        f"  Conflict Detection Rate: {ai.get('conflict_detection_rate', 0):.0%}",
        f"  Avg Decision Confidence: {ai.get('decision_confidence_avg', 0):.0%}",
        "",
        "## BASELINE (Nearest Resource)",
        f"  Coverage Rate: {baseline.get('coverage_rate', 0):.0%}",
        f"  Total Travel Time: {baseline.get('total_travel_time_min', 0):.0f} min",
        f"  Blocked Route Violations: {baseline.get('blocked_route_violations', 0)}",
        "",
        "## IMPROVEMENTS",
        f"  Travel Time Reduction: {improvements.get('travel_time_reduction_pct', 0):.1f}%",
        f"  Conflicts Detected: {improvements.get('conflicts_detected', 0)}",
        f"  Blocked Violations Avoided: {improvements.get('blocked_route_violations_avoided', 0)}",
        "",
        f"_{data.get('methodology', '')}_",
    ]

    return "\n".join(lines)


def ask_operator_question(question: str) -> str:
    """
    Ask a natural-language question about the current disaster situation.
    Answers are grounded in actual system state.
    
    Example questions:
    - "What is the highest priority location right now?"
    - "Why is Hospital H1 the top priority?"
    - "Can Ambulance A1 reach the hospital?"
    - "What route should Rescue Team 2 take?"
    - "What changed after Bridge B1 was blocked?"
    """
    data = _call("POST", "/ai/question", json={"question": question})
    if "error" in data:
        return f"Error: {data['error']}"

    lines = [
        f"# Q: {question}",
        "",
        f"## A: {data.get('answer', 'No answer available')}",
        "",
    ]

    ctx = data.get("context_snapshot", {})
    if ctx:
        lines.append(
            f"_Context: T+{ctx.get('sim_time_min', 0)}min, "
            f"top priority: {ctx.get('top_priority', 'N/A')}, "
            f"{ctx.get('blocked_count', 0)} blocked, "
            f"{ctx.get('conflict_count', 0)} conflicts_"
        )

    return "\n".join(lines)


def get_timeline() -> str:
    """
    Get the full simulation timeline showing all events with their status.
    """
    data = _call("GET", "/timeline")
    if "error" in data:
        return f"Error: {data['error']}"

    events = data.get("events", [])
    lines = [
        f"# SIMULATION TIMELINE",
        f"Processed: {data.get('processed_count', 0)} / {len(events)} events",
        f"Current time: T+{data.get('sim_time_min', 0)} minutes",
        "",
    ]

    for evt in events:
        status = "✅" if evt["processed"] else "⏳"
        lines.append(
            f"{status} T+{evt['time_offset_min']:03d}min [{evt['event_type']}]"
            f" {evt['description'][:80]}"
        )
        if evt.get("entity_id"):
            lines.append(
                f"    Entity: {evt['entity_id']}, Value: {evt.get('value', 'N/A')}"
                f", Confidence: {evt.get('confidence', 0):.0%}"
            )

    return "\n".join(lines)


def reset_simulation() -> str:
    """
    Reset the simulation to its initial state. All events will be requeued.
    """
    data = _call("POST", "/simulate/reset")
    if "error" in data:
        return f"Error: {data['error']}"
    return (
        f"# SIMULATION RESET\n"
        f"Status: {data.get('status', 'unknown')}\n"
        f"Message: {data.get('message', '')}\n"
        f"Time: T+{data.get('sim_time_min', 0)} minutes"
    )


# ─────────────────────────────────────────────────────────────────────────────
# MCP Server entrypoint (stdio protocol)
# ─────────────────────────────────────────────────────────────────────────────

TOOLS = {
    "get_current_situation": {
        "fn": get_current_situation,
        "description": "Get the current emergency situation overview including priorities, blocked infrastructure, and evidence conflicts.",
        "parameters": {},
    },
    "get_priority_sites": {
        "fn": get_priority_sites,
        "description": "Get the top-N highest priority locations requiring immediate response.",
        "parameters": {
            "top_n": {"type": "integer", "description": "Number of top sites to return (default: 5)", "default": 5}
        },
    },
    "get_entity_evidence": {
        "fn": get_entity_evidence,
        "description": "Get all evidence (fused + raw observations) for a specific entity.",
        "parameters": {
            "entity_id": {"type": "string", "description": "Entity ID (e.g. H1, B1, R4, V2)"}
        },
        "required": ["entity_id"],
    },
    "get_route": {
        "fn": get_route,
        "description": "Calculate the best feasible route between two nodes, avoiding blocked roads/bridges.",
        "parameters": {
            "origin": {"type": "string", "description": "Origin node ID"},
            "destination": {"type": "string", "description": "Destination node ID"},
            "vehicle_type": {"type": "string", "description": "Vehicle type: light/medium/heavy (default: heavy)", "default": "heavy"},
        },
        "required": ["origin", "destination"],
    },
    "get_resource_status": {
        "fn": get_resource_status,
        "description": "Get status of all response resources (rescue teams, ambulances, engineering teams, etc.).",
        "parameters": {},
    },
    "generate_response_plan": {
        "fn": generate_response_plan,
        "description": "Generate an optimized response plan assigning available resources to active tasks.",
        "parameters": {},
    },
    "simulate_event": {
        "fn": simulate_event,
        "description": "Inject a custom simulation event to test system response. The system will update evidence, priorities, routes, and allocations.",
        "parameters": {
            "event_type": {"type": "string", "description": "Event type (e.g. bridge_damage_report, road_blockage, hospital_demand_surge)"},
            "entity_id": {"type": "string", "description": "Target entity ID"},
            "observation_type": {"type": "string", "description": "Observation type (e.g. bridge_status, road_status, capacity)"},
            "value": {"type": "string", "description": "Observed value (e.g. blocked, open, overloaded)"},
            "confidence": {"type": "number", "description": "Confidence 0-1 (default: 0.85)"},
            "severity": {"type": "number", "description": "Severity 0-1 (default: 0.7)"},
            "description": {"type": "string", "description": "Human-readable event description"},
            "source_type": {"type": "string", "description": "Source type (field_report, satellite, drone, etc.)"},
        },
        "required": ["event_type"],
    },
    "simulate_next_event": {
        "fn": simulate_next_event,
        "description": "Advance simulation by processing the next scheduled event.",
        "parameters": {},
    },
    "recalculate_allocation": {
        "fn": recalculate_allocation,
        "description": "Force recalculation of resource allocation based on current system state.",
        "parameters": {},
    },
    "explain_decision": {
        "fn": explain_decision,
        "description": "Get detailed explanation for a specific decision including evidence basis and alternatives.",
        "parameters": {
            "decision_id": {"type": "string", "description": "Decision ID (e.g. DEC-XXXXXX)"}
        },
        "required": ["decision_id"],
    },
    "get_benchmark_metrics": {
        "fn": get_benchmark_metrics,
        "description": "Run benchmark comparing AI system vs baseline. Returns coverage, travel time, and improvement metrics.",
        "parameters": {},
    },
    "ask_operator_question": {
        "fn": ask_operator_question,
        "description": "Ask a natural-language question about the disaster situation. Answers grounded in actual system state.",
        "parameters": {
            "question": {"type": "string", "description": "Natural language question about the emergency situation"}
        },
        "required": ["question"],
    },
    "get_timeline": {
        "fn": get_timeline,
        "description": "Get the full simulation timeline showing all events and their processing status.",
        "parameters": {},
    },
    "reset_simulation": {
        "fn": reset_simulation,
        "description": "Reset the simulation to initial state.",
        "parameters": {},
    },
}


def _handle_request(request: dict) -> dict:
    """Handle a single JSON-RPC 2.0 request."""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    # MCP protocol methods
    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "disaster-response-mcp",
                    "version": "1.0.0",
                    "description": "AI Emergency Operations & Resource Orchestration System MCP tools",
                },
            },
        }

    if method == "tools/list":
        tools_list = []
        for name, tool in TOOLS.items():
            tools_list.append({
                "name": name,
                "description": tool["description"],
                "inputSchema": {
                    "type": "object",
                    "properties": tool.get("parameters", {}),
                    "required": tool.get("required", []),
                },
            })
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools_list}}

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})

        if tool_name not in TOOLS:
            return {
                "jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        try:
            result = TOOLS[tool_name]["fn"](**tool_args)
            return {
                "jsonrpc": "2.0", "id": req_id,
                "result": {"content": [{"type": "text", "text": result}]},
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32603, "message": str(e)},
            }

    if method == "notifications/initialized":
        return None  # No response for notifications

    return {
        "jsonrpc": "2.0", "id": req_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main():
    """Run MCP server over stdio."""
    import sys
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = _handle_request(request)
            if response is not None:
                print(json.dumps(response), flush=True)
        except json.JSONDecodeError as e:
            error_resp = {
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32700, "message": f"Parse error: {e}"},
            }
            print(json.dumps(error_resp), flush=True)
        except Exception as e:
            error_resp = {
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32603, "message": f"Internal error: {e}"},
            }
            print(json.dumps(error_resp), flush=True)


if __name__ == "__main__":
    main()
