# Architecture: AI Emergency Operations & Resource Orchestration System

## Overview

The system is composed of five functional layers: a presentation layer (React dashboard + IBM Bob), an API and tool-exposure layer (FastAPI + MCP server), a simulation and analytical engine (Python, modular), a persistence layer (SQLite), and an evidence/reasoning subsystem that spans the engine layer. Each layer has a clearly defined responsibility and a well-defined interface with its neighbors.

---

## System Diagram

```mermaid
flowchart TD
    User(["👤 Human Operator"])
    Bob(["🤖 IBM Bob\n(Natural Language)"])

    subgraph Presentation ["Presentation Layer"]
        Dashboard["React Dashboard\n(Map · Incidents · Resources · Alerts)"]
    end

    subgraph API ["API & Tool Layer"]
        FastAPI["FastAPI\n(REST endpoints)"]
        MCP["MCP Server\n(Bob tool registration)"]
    end

    subgraph Engine ["Simulation & Analytical Engine"]
        Sim["Simulation Engine\n(tick loop · event injection · state advance)"]
        Evidence["Evidence Fusion Module\n(weight · decay · conflict detection)"]
        Impact["Impact & Priority Engine\n(criticality · urgency · scoring)"]
        Graph["Graph / Accessibility Engine\n(dynamic edge weights · route planning)"]
        Optimizer["Resource Optimizer\n(constrained allocation · replanning)"]
    end

    subgraph Persistence ["Persistence Layer"]
        DB[("SQLite\n(observations · situations · resources\n· routes · allocations · audit log)")]
    end

    User -->|"view / confirm actions"| Dashboard
    Bob -->|"MCP tool calls"| MCP
    Dashboard -->|"REST API calls"| FastAPI
    MCP -->|"delegates to"| FastAPI

    FastAPI --> Sim
    Sim --> Evidence
    Evidence --> Impact
    Evidence --> Graph
    Impact --> Optimizer
    Graph --> Optimizer
    Optimizer -->|"recommendations"| FastAPI

    Sim <-->|"read / write state"| DB
    Evidence <-->|"read / write evidence"| DB
    Impact <-->|"read / write scores"| DB
    Graph <-->|"read edge weights"| DB
    Optimizer <-->|"read / write allocations"| DB
```

---

## Component Responsibilities

### React Dashboard

The dashboard renders the current situation model as an interactive map (village markers sized and colored by priority score), an incident feed sorted by priority, a resource roster with current assignment status, and a live alert panel. All data is fetched from the FastAPI backend via polling (every 5 seconds).

The dashboard surfaces optimizer recommendations as actionable cards — each card shows the recommended action, the rationale, the priority score, and a confidence indicator. Operators click **Confirm** or **Reject** on each card; neither action is performed automatically.

### FastAPI + MCP Layer

FastAPI serves as the single backend entry point for both the dashboard and IBM Bob. It exposes the following REST endpoints:

- `GET /health` — health check with simulation time and counts
- `GET /situation` — current situation overview (priorities, blocked infra, conflicts, plan)
- `GET /entities` — all assets, roads, and bridges
- `GET /entities/{id}` — single entity with evidence and priority data
- `GET /evidence/{entity_id}` — all evidence (fused + raw) for an entity
- `GET /priorities` — priority-ranked list of all entities
- `GET /resources` — all resources with current status
- `GET /routes?origin=X&destination=Y&vehicle_type=Z` — calculate feasible route
- `POST /simulate/next` — process the next simulation event
- `POST /simulate/auto` — process all remaining events
- `POST /simulate/event` — inject a custom event
- `POST /simulate/reset` — reset simulation to initial state
- `POST /optimize` — trigger resource optimization (AI + baseline comparison)
- `GET /decisions` — recent decisions with explanations
- `GET /decisions/{id}` — single decision with AI explanation
- `GET /benchmark` — run benchmark (AI vs baseline)
- `GET /timeline` — full simulation timeline
- `GET /map-data` — GeoJSON map data for the frontend
- `POST /ai/question` — natural-language operator Q&A
- `GET /audit` — recent audit log entries
- `GET /tasks` — all current tasks
- `GET /plan` — current response plan

The MCP server wraps a subset of these endpoints as registered Bob tools via HTTP calls to the FastAPI backend. Bob resolves intent, selects the appropriate tool, calls the corresponding endpoint, and formats the response as readable prose with key metrics highlighted.

### Simulation Engine

The simulation engine drives the Bhote Valley scenario as a discrete time-stepped process. Each tick advances simulated time by a configurable interval (default: 15 minutes). On each tick, the engine:

1. Injects scheduled observations (new field reports, drone imagery updates, sensor readings) according to the scenario script
2. Updates the raw observation store in SQLite
3. Triggers the Evidence Fusion Module to reprocess affected subjects
4. Triggers the Impact and Priority Engine to recalculate affected location scores
5. Triggers the Graph Engine to recompute edge weights for affected route segments
6. Triggers the Resource Optimizer to evaluate whether current allocations remain optimal
7. Publishes any threshold-crossing events to the alert queue

The simulation engine also supports **manual event injection** via the API — operators or demo facilitators can inject a new field report or infrastructure status change at any time.

### Evidence Fusion Module

This is the epistemic core of the system. For each subject (a location, a road segment, a bridge, a population estimate), the module maintains a set of observations and computes a fused evidence record.

**Freshness decay:**
```
freshness(obs) = exp(-λ × age_hours)
```
Where λ (lambda) is the decay rate parameter, configurable per observation category:

| Category | λ (decay rate) | Half-life |
|---|---|---|
| Infrastructure status | 0.35 | ~2.0 hours |
| Population count | 0.10 | ~6.9 hours |
| Medical severity | 0.25 | ~2.8 hours |
| Road passability | 0.40 | ~1.7 hours |
| Weather/flood level | 0.50 | ~1.4 hours |

**Evidence weight:**
```
weight(obs) = source_reliability × confidence × freshness
```
Source reliability is a per-source-type baseline (e.g., drone imagery: 0.90, field officer: 0.75, community volunteer: 0.60, historical baseline: 0.40). Confidence is the value reported with or inferred from the observation.

**Conflict detection:** When two observations for the same subject produce fused values that differ by more than a configurable threshold (default: 0.3 normalized units), the module flags an active conflict, records both contributing observations, and propagates a reduced confidence score to downstream consumers.

### Impact & Priority Engine

Receives fused evidence records and computes two scores per location.

**Criticality score** (intrinsic severity, independent of operational factors):
```
criticality = 0.25 × population_score
            + 0.25 × service_need_score
            + 0.20 × time_sensitivity_score
            + 0.15 × isolation_score
            + 0.15 × damage_severity_score
```

**Priority score** (operational decision weight, including what we can do):
```
priority = 0.30 × criticality
         + 0.25 × urgency_score
         + 0.20 × impact_score
         + 0.15 × accessibility_score
         + 0.10 × confidence_score
```

All input scores are normalized to [0, 1]. The distinction between criticality and priority is deliberate: a location may be critically affected (high criticality) but temporarily deprioritized because all access routes are below confidence threshold (low accessibility). The priority score reflects what we should do *now*; criticality reflects the underlying need.

### Graph / Accessibility Engine

Models the road and trail network as a directed graph G = (V, E). Each edge carries:

- **Base travel time** — the expected transit time under normal conditions
- **Accessibility probability** — currently `p(e) ∈ [0, 1]`, derived from fused evidence for that edge's road segments and associated infrastructure
- **Effective weight** — `base_time / p(e)` (lower accessibility inflates effective cost)

Route queries specify an origin, destination, and minimum confidence threshold. The engine runs a modified Dijkstra search that prunes edges below the threshold and returns the top-3 routes ranked by effective cost, along with per-segment confidence and the evidence records that produced each accessibility score.

When edge accessibility changes (due to new evidence), the engine recomputes edge weights and recalculates routes as needed. Affected allocations are flagged for potential replanning.

### Resource Optimizer

Formulates a linear assignment problem: given a set of available resources (typed) and a set of unserved high-priority incidents (typed), find the assignment that maximizes total priority-weighted impact subject to:

- Resource-to-incident type compatibility
- Route accessibility threshold constraints
- Travel time feasibility (resource must be able to arrive within incident time window)
- Capacity constraints (each resource serves one incident at a time)

The optimizer does not produce hard assignments — it produces **allocation recommendations** with explicit rationale. These are surfaced to operators via the dashboard and Bob. The recommendations are logged as decisions and fed back into the situation model for future replanning cycles.

### SQLite Persistence

All state is persisted to SQLite across several primary tables: `assets`, `roads`, `bridges`, `resources`, `observations`, `audit_log`, `decisions`, and `sim_events`. The audit log records every significant state change with timestamp, entity, previous state, new state, and reason. This supports post-incident review.

---

## AI vs. Deterministic Boundary

A key design decision is the explicit boundary between AI-assisted and deterministic components:

| Component | Type | Rationale |
|---|---|---|
| IBM Bob (intent parsing, prose generation) | AI (LLM) | Natural language is LLM's native domain |
| Evidence fusion weights | Deterministic (formula) | Must be auditable; formula is traceable |
| Priority scoring | Deterministic (formula) | Reproducible; parameters are domain-tunable |
| Route planning | Deterministic (graph algorithm) | Correct by construction; fast |
| Resource optimization | Deterministic (LP/assignment) | Optimal by definition given inputs |
| Conflict detection | Deterministic (threshold) | Consistent; no hallucination risk |

Evidence quality assessment and scoring are **never delegated to the LLM**. Bob's role is interface translation: turning natural language into structured API calls and turning structured API responses into readable prose. The analytical engine is deterministic, auditable, and reproducible.

---

## Data Flow Summary

1. Simulation tick fires → new observations written to SQLite
2. Evidence Fusion reads new observations, recomputes weights and fused values, writes updated evidence records and flags conflicts
3. Priority Engine reads updated evidence, recomputes criticality and priority scores, writes to `locations` table
4. Graph Engine reads updated infrastructure evidence, recomputes edge accessibility, invalidates stale routes
5. Optimizer reads current priorities, resources, and graph state, generates updated recommendation set
6. FastAPI exposes current state via REST; SSE stream pushes delta events to dashboard
7. Bob tool calls arrive via MCP → FastAPI → returns structured data → Bob formats and presents to operator
8. Operator confirms allocation → `POST /actions/allocate` → written to `allocations` + `audit_log` → replanning cycle triggered
