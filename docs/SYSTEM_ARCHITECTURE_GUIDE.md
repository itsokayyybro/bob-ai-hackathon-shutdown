# AI Emergency Operations & Resource Orchestration System
## Complete Architecture & Execution Guide

> **Bhote Valley Emergency Simulation** — Evidence-aware disaster response decision support  
> IBM Bob AI Hackathon Submission  
> Team: shutdown (Om Prajapati, Jeet Pandya, Prince Patel, Darshan Mandalaywala)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Layer-by-Layer Breakdown](#3-layer-by-layer-breakdown)
   - [Presentation Layer](#31-presentation-layer)
   - [API & Tool Layer](#32-api--tool-layer)
   - [Simulation & Analytical Engine](#33-simulation--analytical-engine)
   - [Persistence Layer](#34-persistence-layer)
   - [AI Layer](#35-ai-layer)
4. [The Core Data Pipeline](#4-the-core-data-pipeline)
5. [Detailed Engine Explanations](#5-detailed-engine-explanations)
   - [Evidence Fusion](#51-evidence-fusion)
   - [Priority & Criticality Scoring](#52-priority--criticality-scoring)
   - [Graph-Based Accessibility](#53-graph-based-accessibility)
   - [Resource Optimization](#54-resource-optimization)
   - [Simulation Engine](#55-simulation-engine)
   - [Benchmark Engine](#56-benchmark-engine)
6. [IBM Bob MCP Integration](#6-ibm-bob-mcp-integration)
7. [Database Schema](#7-database-schema)
8. [Scenario Data](#8-scenario-data)
9. [Human-in-the-Loop Design](#9-human-in-the-loop-design)
10. [Running the System](#10-running-the-system)
11. [Known Limitations](#11-known-limitations)

---

## 1. System Overview

The system is a **decision support platform** for disaster response operations in a mountainous region modeled on Nepal's Bhote Valley. When a monsoon flood triggers simultaneous crises across seven villages, the system fuses conflicting, uncertain, time-decaying observations from multiple sources, computes graph-based route accessibility, optimizes constrained resource allocation, and continuously replans as new information arrives — all surfaced through a React dashboard and IBM Bob natural-language interface.

**The core philosophy**: Uncertainty is not an obstacle to decision-making — it is an input to it. The system treats every observation as partial evidence, quantifies what is known and unknown, and produces the best available guidance with transparent confidence and reasoning.

**What makes this system different from dashboards, chatbots, or GIS routers**:
- Fuses conflicting evidence from multiple sources with uncertainty quantification
- Models information age and freshness decay
- Computes dynamic accessibility scoring based on evolving conditions
- Performs multi-resource constrained optimization
- Proactively replans when new information arrives
- Provides natural-language interface via IBM Bob
- Every action requires human confirmation (human-in-the-loop)
- All reasoning is transparent and traceable

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                              │
│                                                                         │
│  ┌──────────────────┐          ┌──────────────────┐                   │
│  │  React Dashboard  │          │   IBM Bob (NLP)   │                   │
│  │  - Interactive    │          │   Natural Language │                   │
│  │    Map (Leaflet)  │          │   Interface        │                   │
│  │  - Incident Feed  │          │                    │                   │
│  │  - Resource Roster│          │  14 MCP Tools      │                   │
│  │  - Alerts Panel   │          │                    │                   │
│  │  - Simulation     │          │                    │                   │
│  │    Controls       │          │                    │                   │
│  │  - Benchmark      │          │                    │                   │
│  │    Panel          │          │                    │                   │
│  └────────┬─────────┘          └────────┬──────────┘                   │
│           │                             │                               │
└───────────┼─────────────────────────────┼───────────────────────────────┘
            │ REST API calls              │ MCP tool calls              │
            │ (polling every 5s)          │ (JSON-RPC 2.0 over stdio)   │
            ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       API & TOOL LAYER                                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    FastAPI Server (port 8000)                     │  │
│  │                                                                   │  │
│  │  GET  /health  │  GET /situation  │  GET /entities               │  │
│  │  GET  /evidence/{id}  │  GET /priorities  │  GET /resources        │  │
│  │  GET  /routes  │  POST /simulate/next  │  POST /simulate/auto     │  │
│  │  POST /simulate/event  │  POST /simulate/reset                    │  │
│  │  POST /optimize  │  GET /decisions  │  POST /decisions/{id}/confirm│  │
│  │  GET  /benchmark  │  GET /timeline  │  GET /map-data               │  │
│  │  POST /ai/question  │  GET /audit  │  GET /tasks  │  GET /plan    │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│           ┌───────────────┼───────────────┐                             │
│           ▼               ▼               ▼                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │  MCP Server  │ │  Static File │ │  (optional)  │                  │
│  │  (14 tools)  │ │  Serving     │ │  Watsonx.ai  │                  │
│  │  JSON-RPC    │ │  Frontend    │ │  (optional)  │                  │
│  │              │ │  dist/       │ │              │                  │
│  └──────────────┘ └──────────────┘ └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               SIMULATION & ANALYTICAL ENGINE                             │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   Simulation Engine                              │  │
│  │  - WorldState (in-memory authoritative state)                   │  │
│  │  - Discrete time-stepped event processing                       │  │
│  │  - Coordinates all engines after each event                     │  │
│  │  - Plan diff computation (PlanChange)                           │  │
│  └──────┬───────┬───────┬───────┬───────┬───────┬─────────────────┘  │
│         │       │       │       │       │       │                     │
│         ▼       ▼       ▼       ▼       ▼       ▼                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ Evidence│ │Priority│ │ Graph  │ │Resource│ │Simulation│ │Benchmark│  │
│  │ Fusion  │ │Engine  │ │Engine  │ │Optimizer│ │Engine  │ │Engine  │  │
│  │         │ │        │ │        │ │        │ │(events)│ │        │  │
│  │• Freshness││• Crit- │ │• Net-  │ │• Greedy│ │• Load  │ │• AI vs │  │
│  │  decay  │ │  ical- │ │  workx │ │• Local │ │  from  │ │  baseline│ │
│  │• Weight │ │  ity   │ │• Dijk- │ │  improve│ │  DB    │ │  compare│ │
│  │• Conflict││• Urgency│ │  stra  │ │• LP    │ │• Process│ │         │ │
│  │  detect │ │• Access│ │• Vehicle│ │        │ │  events│ │         │ │
│  │         │ │  ibility│ │  checks│ │        │ │        │ │         │ │
│  └─────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        PERSISTENCE LAYER                                 │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              SQLite (aiosqlite + SQLAlchemy async)               │  │
│  │                                                                   │  │
│  │  ┌─────────┐ ┌────────┐ ┌─────────┐ ┌───────────┐              │  │
│  │  │  assets  │ │ roads  │ │ bridges │ │ resources │              │  │
│  │  ├─────────┤ ├────────┤ ├─────────┤ ├───────────┤              │  │
│  │  │ obs_n   │ │  audit │ │ decisions│ │ sim_events│              │  │
│  │  └─────────┘ └────────┘ └─────────┘ └───────────┘              │  │
│  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │  Seed Data (src/data/scenario_nepal_inspired.json)        │   │  │
│  │  └──────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          AI LAYER                                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    AI Provider Factory                             │  │
│  │                                                                   │  │
│  │  ┌─────────────────────┐    ┌─────────────────────────────┐     │  │
│  │  │ DeterministicProvider│    │  WatsonxProvider (optional)  │     │  │
│  │  │ (always available)   │    │  (if credentials exist)      │     │  │
│  │  │                      │    │                              │     │  │
│  │  │ • Situation summary  │    │  • Situation summary          │     │  │
│  │  │ • Decision explain   │    │  • Decision explain           │     │  │
│  │  │ • Q&A responses      │    │  • Q&A responses              │     │  │
│  │  │                      │    │                              │     │  │
│  │  │ Uses ACTUAL state    │    │  Uses ACTUAL state           │     │  │
│  │  │ No fabrication       │    │  Model: ibm/granite-3-8b     │     │  │
│  │  └─────────────────────┘    └─────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer-by-Layer Breakdown

### 3.1 Presentation Layer

#### React Dashboard (`src/frontend/src/App.tsx`)

The dashboard is built with **React + TypeScript + Vite** and uses **Leaflet (React-Leaflet)** for the interactive map. It is organized into several panels:

**Map Panel** (`DisasterMap` component):
- Renders assets as colored CircleMarkers sized by priority score
- Renders roads as Polyline segments colored by status (green=open, red=blocked, yellow=partial)
- Renders bridges as Point markers with special styling
- Renders resources as offset Point markers
- Clicking any marker opens a Popup with entity details
- Route highlighting with amber-colored polylines
- Dark CARTODB basemap theme

**Priority Panel** (`PriorityPanel` component):
- Displays all locations ranked by priority score
- Each card shows: rank, name, entity type icon, priority badge (CRITICAL/NEEDS ATTENTION/OPERATIONAL)
- Human-readable summary: affected population, urgency level, access level, evidence confidence
- Visual conflict indicators (⚠ flag)
- Progress bar for priority score
- Technical detail on hover (exact scores)

**Entity Detail Panel** (`RecommendationPanel` component):
- Shows entity status badge and population
- Displays **WHY IS THIS HIGH PRIORITY?** explanation with supporting factors
- Shows **RECOMMENDED RESPONSE** with resource, capability, route, ETA, confidence
- **Accept** / **Reject** buttons with optional operator notes
- **WHAT WE KNOW** section showing evidence summaries (fused + raw observations)
- Source reports showing individual observation details with freshness labels
- Quick "Ask Bob" buttons for natural-language followups

**Resource Panel** (`ResourcesPanel` component):
- Groups resources by status (available, deployed, en_route, unavailable)
- Shows each resource's type icon, capabilities, and current assignment
- Displays recommended task and ETA for each resource
- Shows operator confirmation status

**Simulation Controls** (`SimControls` component):
- Next Event button (process one scheduled event)
- Auto Play button (process all remaining events)
- Reset button (restore initial state)
- Inject Event button (custom event injection)
- Quick preset buttons for common scenarios
- Custom injection form with event type, entity, observation, value, confidence

**Plan Change Alerts** (`PlanChangeAlert` component):
- Appears after each simulation event
- Shows what changed in the response plan
- Highlights changes requiring review (resource swap or route infeasibility)
- Before/After comparison modal with resource and ETA changes

**Benchmark Panel** (`BenchmarkPanel` component):
- Compares AI system vs. nearest-resource baseline
- Metrics: coverage rate, travel time, time saved, conflicts found, avg confidence
- Dynamically updates after simulation events

---

### 3.2 API & Tool Layer

#### FastAPI Server (`src/backend/app/main.py`)

The FastAPI application serves as the **single entry point** for all backend communication. It uses **Pydantic v2** for request/response validation and **SQLAlchemy async** for database access.

**Startup lifecycle** (`lifespan`):
1. Creates all database tables (`init_db()`)
2. Seeds the database if empty (`seed_database()`)
3. Loads world state from database into memory (`sim_engine.load_from_db()`)
4. Rebuilds the road network graph (`road_network.rebuild()`)
5. Re-fuses all observations (`_fuse_all()`)
6. Recalculates all priorities (`_recalculate_priorities()`)
7. Generates initial tasks (`_generate_tasks()`)

**Key request/response models**:
- `InjectEventRequest` — custom event injection parameters
- `AIQuestionRequest` — natural-language question to Bob
- `ConfirmDecisionRequest` — operator accept/reject/modify action
- `RouteRequest` — route calculation with origin, destination, vehicle type

**CORS configuration**: Allows all origins (for development convenience with React dashboard on port 5173).

**Frontend serving**: When the frontend `dist/` directory exists, FastAPI serves it as static files, making the app self-contained.

#### MCP Server (`src/mcp/server.py`)

The MCP server implements the **JSON-RPC 2.0 protocol over stdio**, allowing IBM Bob to call system capabilities as registered tools.

**Architecture**:
- Each tool is a Python function that makes HTTP calls to the FastAPI backend
- Uses `httpx` synchronous client with 15-second timeout
- `_call(method, path, **kwargs)` is the central HTTP helper
- `_handle_request(request)` dispatches JSON-RPC methods
- `main()` reads JSON-RPC requests from stdin line-by-line

**14 Tools Summary**:

| Tool | HTTP Call | Description |
|---|---|---|
| `get_current_situation` | GET /situation | Full situation overview |
| `get_priority_sites` | GET /priorities | Top-N priority locations |
| `get_entity_evidence` | GET /evidence/{id} | All evidence for an entity |
| `get_route` | GET /routes | Calculate feasible route |
| `get_resource_status` | GET /resources | All resource statuses |
| `generate_response_plan` | POST /optimize | Optimized resource allocation |
| `simulate_event` | POST /simulate/event | Inject custom event |
| `simulate_next_event` | POST /simulate/next | Advance simulation one step |
| `recalculate_allocation` | POST /optimize | Force re-optimization |
| `explain_decision` | GET /decisions/{id} | Full decision explanation |
| `get_benchmark_metrics` | GET /benchmark | AI vs baseline comparison |
| `ask_operator_question` | POST /ai/question | Natural-language Q&A |
| `get_timeline` | GET /timeline | Full simulation timeline |
| `reset_simulation` | POST /simulate/reset | Reset to initial state |

---

### 3.3 Simulation & Analytical Engine

The engine layer is composed of **6 modular Python engines**, each with a single responsibility. All engines are deterministic — they produce the same output for the same input every time.

#### WorldState (`WorldState` class in `simulation.py`)

The **central in-memory data store** that all engines read from and write to. It is the single source of truth:

```python
class WorldState:
    assets: dict[str, Asset]           # All facilities and villages
    roads: dict[str, Road]             # All road segments
    bridges: dict[str, Bridge]         # All bridges
    resources: dict[str, Resource]     # All response resources
    observations: dict[str, Observation]  # All raw observations
    evidence_cache: dict[str, EvidenceSummary]  # Fused evidence
    priorities: dict[str, PriorityScore]      # Computed priority scores
    tasks: dict[str, Task]             # Generated tasks
    current_plan: Optional[ResponsePlan]       # Current allocation plan
    baseline_plan: Optional[ResponsePlan]      # Nearest-resource baseline
    current_time_min: int              # Simulation clock
    unprocessed_events: list[SimulationEvent]  # Pending events
    all_events: list[SimulationEvent]  # Complete event history
    processed_event_ids: set[str]      # Processed event IDs
    audit_log: list[AuditRecord]       # All state changes
    last_plan_changes: list[PlanChange]  # Recent plan diffs
```

#### Simulation Engine (`SimulationEngine` class)

The **orchestrator** that drives the entire system:

**`load_from_db(session)`** — Restores full world state from SQLite:
1. Loads all assets, roads, bridges, resources from database
2. Loads all simulation events ordered by time offset
3. Rebuilds the NetworkX road graph
4. Reconstructs all observations from DB
5. Re-fuses all observations to restore evidence cache
6. Recalculates all priority scores
7. Generates initial tasks

**`process_next_event(session)`** — Main simulation loop:
1. Pops the next unprocessed event from the queue
2. Advances simulation time to the event's time offset
3. Snapshots the current plan (for plan diff computation)
4. Processes the event:
   - Creates an `Observation` object
   - Persists it to the database
   - Applies direct state changes (road block, bridge damage, etc.)
5. Post-event pipeline:
   - `_fuse_all()` — Re-fuses all observations
   - `_recalculate_priorities()` — Updates all priority scores
   - `_generate_tasks()` — Regenerates tasks based on new state
   - `_run_optimizer()` — Re-runs resource allocation
6. Computes plan changes via `_diff_plans()`
7. Returns the event and situation update

**`inject_event()`** — Handles custom event injection from operators or Bob.

**`reset()`** — Restores all entities to initial state, clears observations/decisions/audit, re-seeds, and reloads everything.

---

### 3.4 Persistence Layer

#### Database (`src/backend/app/db/database.py`)

Uses **SQLAlchemy 2.0** with **aiosqlite** for async SQLite access. All database operations are async.

**Engine configuration**:
- `create_async_engine("sqlite+aiosqlite:///./disaster_response.db")`
- `AsyncSessionLocal` for session management
- `check_same_thread=False` for SQLite compatibility

**ORM Tables**:

| Table | Purpose | Key Fields |
|---|---|---|
| `assets` | Facilities and villages | id, name, type, lat, lon, population, criticality, status, metadata |
| `roads` | Road segments | id, name, from_node, to_node, distance_km, travel_time_min, status, risk, confidence |
| `bridges` | Bridges on roads | id, name, on_road, lat, lon, status, capacity, confidence, conflict_status |
| `resources` | Response teams | id, name, type, status, location_id, capabilities, current_task_id |
| `observations` | Raw field reports | id, event_id, timestamp, source_type, entity_id, observation_type, value, confidence, freshness |
| `audit_log` | Change history | id, timestamp, event_type, entity_id, previous_state, new_state, reason, confidence |
| `decisions` | Allocation recommendations | id, recommended_action, target_entity_id, resource_id, priority, confidence, reasons, constraints, alternatives, operator_status, is_current |
| `sim_events` | Scheduled events | id, time_offset_min, event_type, entity_id, observation_type, value, confidence, processed |

#### Seed Data (`src/backend/app/db/seed.py`)

Loads the scenario from `src/data/scenario_nepal_inspired.json`. The seeding is **idempotent** — it checks if any assets exist and skips if already seeded.

The scenario file contains:
- **14 assets**: Hospital, 2 health posts, 2 schools, shelter, hydropower, command center, 5 villages
- **12 road segments** connecting the assets in a valley network
- **2 bridges** on critical road segments
- **8 resources**: 3 rescue teams, 2 ambulances, 1 engineering team, 1 supply vehicle, 1 medical unit
- **13 scripted events**: A sequence of disasters spanning the simulation timeline

---

### 3.5 AI Layer

#### AI Provider Abstraction (`src/backend/app/utils/ai_provider.py`)

The AI layer is a **clean abstraction** with two implementations, both deriving all content from actual system state:

**`DeterministicProvider`** (default, always available):
- `generate_situation_summary()` — Builds a structured text report from top priorities, blocked infrastructure, conflicts, and plan summary
- `explain_decision()` — Formats a human-readable explanation from decision data (reasons, constraints, alternatives)
- `answer_operator_question()` — Rule-based Q&A that matches question keywords to system context
  - Priority questions → Returns top priority with explanation
  - Route questions → Reports blocked infrastructure and rerouting
  - Bridge questions → Returns specific bridge status and conflict info
  - Resource questions → Lists available/unavailable resources
  - "Why" questions → Explains evidence fusion methodology
  - Situation questions → Returns full situation summary

**`WatsonxProvider`** (optional, requires `WATSONX_API_KEY` and `WATSONX_PROJECT_ID`):
- Uses `ibm_watsonx_ai` library with model `ibm/granite-3-8b-instruct`
- Temperature 0.3 for factual consistency
- Falls back to `DeterministicProvider` on any error
- **Never** used for analytical decisions — only for natural language generation

**Factory function** `get_ai_provider()`:
- Checks `settings.watsonx_api_key` and `settings.watsonx_project_id`
- Returns `WatsonxProvider` if credentials exist, else `DeterministicProvider`
- This is called in `GET /decisions/{id}` and `POST /ai/question` endpoints

---

## 4. The Core Data Pipeline

The system operates as a **continuous pipeline** where each stage feeds the next. Here is the complete data flow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE STEP 1: EVENT INJECTION                 │
│                                                                         │
│  Scheduled event (from scenario) OR custom event (from operator/Bob)    │
│  → Creates Observation object with:                                     │
│      • source_type (drone, field_report, satellite, etc.)               │
│      • entity_id (location it pertains to)                               │
│      • observation_type (bridge_status, road_status, capacity, etc.)     │
│      • value (the observed value)                                        │
│      • confidence (0-1)                                                  │
│      • freshness (initially 1.0)                                         │
│      • timestamp (simulated time)                                        │
│      • provenance (event_id, event_type)                                 │
│                                                                         │
│  → Persisted to SQLite observations table                                │
│  → Added to WorldState.observations                                      │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                    PIPELINE STEP 2: EVIDENCE FUSION                      │
│                                                                         │
│  For each entity + observation_type pair:                               │
│                                                                         │
│  a) COMPUTE FRESHNESS:                                                  │
│     freshness = exp(-λ × age_hours)                                    │
│     λ depends on observation type:                                      │
│       bridge_status: 2.0 (fast decay)                                   │
│       road_status: 1.5                                                  │
│       population: 0.1 (slow decay)                                      │
│       flood_level: 3.0 (very fast decay)                                │
│                                                                         │
│  b) COMPUTE WEIGHT:                                                     │
│     weight = source_reliability × confidence × freshness               │
│     Source reliability: drone=0.90, field_report=0.88,                 │
│                           satellite=0.85, hospital=0.95, etc.          │
│                                                                         │
│  c) GROUP BY NORMALIZED VALUE:                                          │
│     "blocked", "impassable", "collapsed" → all map to "blocked"         │
│     "open", "clear", "passable" → all map to "open"                    │
│                                                                         │
│  d) COMPUTE BEST VALUE:                                                 │
│     Value with highest total weighted support wins                      │
│                                                                         │
│  e) CONFLICT DETECTION:                                                 │
│     If second-best value has ≥ 0.3 of total support → CONFLICTING       │
│     Records both observation IDs                                        │
│     Sets recommendation for field verification                          │
│                                                                         │
│  → Produces EvidenceSummary with:                                        │
│      best_value, confidence, conflict_status, confidence_level,         │
│      supporting_observations, conflicting_observations, recommendation  │
│                                                                         │
│  → Stored in WorldState.evidence_cache                                  │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                  PIPELINE STEP 3: PRIORITY & CRITICALITY                 │
│                                                                         │
│  For each asset (village, hospital, school, etc.):                      │
│                                                                         │
│  a) DERIVE URGENCY from evidence:                                       │
│     max urgency across all evidence summaries                           │
│     Values: isolated=0.95, destroyed=1.0, overloaded=0.9,              │
│             evacuation_required=0.85, flooded=0.80, blocked=0.70       │
│                                                                         │
│  b) DERIVE ISOLATION RISK from evidence:                                │
│     1.0 if evidence says "isolated"                                     │
│     0.7 if evidence says "blocked" with confidence ≥ 0.7                │
│     0.0 otherwise                                                       │
│                                                                         │
│  c) DERIVE DAMAGE SEVERITY from evidence:                               │
│     destroyed=1.0×conf, blocked=0.85×conf, flooded=0.75×conf,          │
│     damaged=0.65×conf, overloaded=0.55×conf                             │
│                                                                         │
│  d) DERIVE CONFIDENCE FACTOR:                                           │
│     Average confidence across evidence                                  │
│     Penalty: -0.15 per conflicting evidence                             │
│     Default: 0.3 when no evidence                                       │
│                                                                         │
│  e) COMPUTE ACCESSIBILITY:                                              │
│     Run Dijkstra from command center CC1                                │
│     0.0 if no route exists                                              │
│     max(0.1, 1.0 - route.total_risk) otherwise                          │
│                                                                         │
│  f) COMPUTE CRITICALITY:                                                │
│     0.25×population_impact + 0.25×service_criticality                   │
│     + 0.20×time_sensitivity + 0.15×isolation_risk                       │
│     + 0.15×damage_severity                                              │
│                                                                         │
│  g) COMPUTE PRIORITY:                                                   │
│     0.30×criticality + 0.25×urgency + 0.20×impact                      │
│     + 0.15×accessibility + 0.10×confidence                              │
│                                                                         │
│  h) GENERATE EXPLANATION:                                               │
│     Human-readable sentence describing why this entity has this score   │
│     Lists supporting factors and flags conflicts                        │
│                                                                         │
│  → Produces PriorityScore stored in WorldState.priorities               │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                   PIPELINE STEP 4: GRAPH RECOMPUTATION                   │
│                                                                         │
│  When road/bridge status changes:                                       │
│                                                                         │
│  a) Update edge in NetworkX graph:                                      │
│     Blocked bridge → road becomes BLOCKED                               │
│     Unknown bridge → road gets UNKNOWN risk penalty                     │
│     Partial block → road gets PARTIALLY_BLOCKED penalty                 │
│                                                                         │
│  b) Recompute edge costs:                                               │
│     cost = travel_time × (1 + risk_multiplier)                          │
│     BLOCKED edges have cost = infinity                                  │
│                                                                         │
│  c) Invalidates cached routes that use affected edges                   │
│                                                                         │
│  → NetworkX graph updated in memory                                     │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                   PIPELINE STEP 5: TASK GENERATION                       │
│                                                                         │
│  For each asset with evidence showing a need:                           │
│                                                                         │
│  Map evidence values to task types:                                     │
│    "overloaded" + hospital/health_post → MEDICAL_RESPONSE               │
│    "evacuation_required" → EVACUATION                                   │
│    "isolated" + village → RESCUE, else SUPPLY_DELIVERY                 │
│    "flooded" → RESCUE                                                   │
│    "destroyed" + medical → ENGINEERING                                  │
│                                                                         │
│  Task priority = entity's priority score                                │
│  Task urgency = derived urgency factor                                  │
│                                                                         │
│  → Tasks stored in WorldState.tasks                                     │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                 PIPELINE STEP 6: RESOURCE OPTIMIZATION                   │
│                                                                         │
│  Given available resources and pending tasks:                           │
│                                                                         │
│  a) PRE-COMPUTE ROUTES:                                                 │
│     For each (resource, task) pair where resource can perform task:     │
│       Run Dijkstra from resource location to task target                │
│       Skip if route is infeasible (blocked roads)                       │
│       Record travel time                                                │
│                                                                         │
│  b) SCORE EACH PAIR:                                                    │
│     score = task.priority × capability_bonus × time_efficiency          │
│     time_efficiency = 1 - (travel_time / max_travel_time)              │
│     capability_bonus = 1.0 if direct match, 0.7 if partial             │
│                                                                         │
│  c) GREEDY ASSIGNMENT:                                                  │
│     Sort pairs by score descending                                      │
│     Assign highest-scored pairs first, skipping conflicts               │
│     Each resource and task assigned at most once                        │
│                                                                         │
│  d) LOCAL IMPROVEMENT (pairwise swaps):                                 │
│     For each pair of allocations, try swapping their resources          │
│     Accept swap if it reduces total weighted travel time by >5%         │
│     Rebuild decisions to match new pairing                              │
│     Up to 10 iterations                                               │
│                                                                         │
│  e) PRODUCE ResponsePlan:                                               │
│     allocations, unassigned_tasks, unassigned_resources                 │
│     total_travel_time, coverage_score                                   │
│     DecisionExplanation for each assignment                             │
│                                                                         │
│  f) PRODUCE BASELINE PLAN:                                              │
│     Same but using nearest-resource greedy (no optimization)            │
│     Used for comparison metrics                                         │
│                                                                         │
│  → Plans stored in WorldState.current_plan and WorldState.baseline_plan │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                 PIPELINE STEP 7: PLAN DIFF COMPUTATION                   │
│                                                                         │
│  Compare previous plan vs new plan to produce PlanChange objects:       │
│                                                                         │
│  For each allocation:                                                   │
│    Resource changed → plan change                                       │
│    Route feasibility changed → plan change (review_required)            │
│    ETA changed >10% → plan change                                       │
│    Task lost allocation → plan change (review_required)                 │
│                                                                         │
│  Each PlanChange includes:                                              │
│    previous_resource_id, new_resource_id,                             │
│    previous_eta, new_eta, previous_route_feasible, new_route_feasible,  │
│    change_reason, review_required                                       │
│                                                                         │
│  → PlanChange list returned to API, displayed as alerts in dashboard   │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────┴───────────────────────────────────┐
│                 PIPELINE STEP 8: HUMAN CONFIRMATION                      │
│                                                                         │
│  Operator reviews recommendations in dashboard:                         │
│                                                                         │
│  • Accept → POST /decisions/{id}/confirm with status="accepted"        │
│  • Reject → POST /decisions/{id}/confirm with status="rejected"        │
│  • Modify → POST /decisions/{id}/confirm with status="modified"        │
│                                                                         │
│  What happens on confirmation:                                          │
│    1. Decision.operator_status updated                                    │
│    2. AuditDB record created with previous/new state                    │
│    3. In-memory audit log updated                                       │
│    4. Recommended action is NOT modified (only status is recorded)      │
│                                                                         │
│  → Operator notes stored alongside decision                             │
│  → Future decisions for same entity get is_current=False                │
│  → New recommendation marked as is_current=True                         │
└─────────────────────────────────────┬───────────────────────────────────┘
```

---

## 5. Detailed Engine Explanations

### 5.1 Evidence Fusion

**Purpose**: Transform multiple conflicting observations into a single coherent assessment with uncertainty quantification.

**Why it matters**: In disaster response, a bridge might be reported as "passable" by a field officer at 06:00 but "collapsed" by a drone at 08:30. Simply picking one is dangerous. The system quantifies which observation is more reliable and flags the conflict.

**Algorithm**:

1. **Freshness computation**:
   ```
   freshness = exp(-λ × age_hours)
   ```
   - A 30-minute-old observation has freshness ≈ 0.99
   - A 6-hour-old observation with λ=2.0 has freshness ≈ 0.0025
   - This means **old data becomes negligible** regardless of source quality

2. **Weight computation**:
   ```
   weight = source_reliability × observation_confidence × freshness
   ```
   - Source reliability: drone=0.90, hospital=0.95, field_report=0.88
   - This means **drone data > field report > community report** for the same confidence

3. **Value normalization**:
   - "blocked", "impassable", "collapsed", "closed" → all normalized to "blocked"
   - This allows **semantically different reports to be compared**

4. **Weighted consensus**:
   - Group observations by normalized value
   - Sum weights for each value group
   - Best value = highest total weight
   - Confidence = (fraction supporting best) × (average weight of supporters)
   - A single stale/low-confidence observation produces low confidence

5. **Conflict detection**:
   - If second-best value has ≥ 30% of total weight → **CONFLICTING**
   - Both observation IDs recorded
   - Recommendation generated suggesting field verification

**Example**: Bridge B1 receives:
- Drone observation: "blocked" (confidence=0.95, fresh, reliability=0.90) → weight=0.855
- Field report: "passable" (confidence=0.80, 4 hours old, reliability=0.88) → weight=0.88×0.80×exp(-2.0×4/60)≈0.65
- Drone wins → best_value="blocked", confidence=0.855/(0.855+0.65)≈0.57
- Second-best has 0.43 support < 0.3 threshold → **no conflict**

But if field report is more recent (1 hour old): weight≈0.88×0.80×0.74≈0.52 → still less than drone
If both are recent: weights similar → **conflict detected**

---

### 5.2 Priority & Criticality Scoring

**Purpose**: Rank all locations by urgency so operators know where to focus attention first.

**Two scores are computed deliberately**:

**Criticality** (intrinsic severity — how bad is the situation?):
```
criticality = 0.25×population + 0.25×service_criticality
            + 0.20×time_sensitivity + 0.15×isolation_risk
            + 0.15×damage_severity
```
- **Population impact**: normalized population / 10000 (max expected)
- **Service criticality**: hospital=1.0, command_center=0.95, health_post=0.80, village=0.55
- **Time sensitivity**: hospital=1.0, command_center=0.85, shelter=0.80
- **Isolation risk**: 1.0 if isolated, 0.7 if blocked with confidence ≥0.7
- **Damage severity**: from evidence fusion

**Priority** (operational decision — what should we do now?):
```
priority = 0.30×criticality + 0.25×urgency + 0.20×impact
         + 0.15×accessibility + 0.10×confidence
```
- **Urgency**: derived from worst evidence value (isolated=0.95, destroyed=1.0)
- **Impact**: normalized affected population
- **Accessibility**: from graph engine (0=unreachable, 1=fully accessible)
- **Confidence**: evidence quality factor

**Key insight**: A location may have **high criticality but low priority** if it's completely inaccessible. This prevents wasting resources trying to reach places that can't be reached. Conversely, a moderately affected but easily accessible location might get higher priority because help can actually arrive.

---

### 5.3 Graph-Based Accessibility

**Purpose**: Model the road network and compute feasible routes that account for dynamic conditions.

**Graph structure**:
- **Nodes**: Assets (villages, hospitals, command center CC1, intersections)
- **Edges**: Road segments connecting nodes
- **Directed graph**: Roads are bidirectional (reverse edges added)

**Edge properties**:
- `cost = travel_time × (1 + risk_multiplier)`
- Blocked edges have cost = infinity (effectively excluded)
- Unknown edges get risk penalty of 0.4
- High-risk edges get risk penalty of 0.6
- Partially blocked edges get risk penalty of 0.8

**Bridge interaction**:
- A bridge on a road **overrides** the road's status
- If bridge is BLOCKED → road is BLOCKED (regardless of road status)
- If bridge is HIGH_RISK → road gets max(road_risk, 0.6)
- If bridge is UNKNOWN → road gets max(road_risk, 0.4)
- Bridge confidence is combined with road confidence (minimum)

**Vehicle restrictions**:
- Each road can have vehicle restrictions (light/medium/heavy)
- Each bridge has a capacity rating (light/medium/heavy)
- Vehicle must be ≤ bridge capacity

**Route finding**:
1. Create filtered subgraph excluding blocked/impassable edges and edges with vehicle restrictions
2. Run Dijkstra on filtered subgraph using cost as weight
3. Return Route with path_nodes, path_edges, total_distance, total_time, total_risk
4. If no path exists → return infeasible Route with blocked_alternatives list

**Accessibility factor for priority**:
- Run Dijkstra from CC1 to each asset
- accessibility = 0.0 if no route exists
- accessibility = max(0.1, 1.0 - route.total_risk) otherwise

---

### 5.4 Resource Optimization

**Purpose**: Assign limited resources to the most critical tasks in the most efficient way.

**Problem formulation**:
- **Inputs**: Available resources (typed), pending tasks (typed), road network
- **Constraints**:
  - Resource capability must match task type
  - Route must be feasible (not through blocked roads)
  - Travel time must be within reasonable bounds
  - Each resource assigned to at most one task
- **Objective**: Maximize total priority-weighted impact (minimize total weighted travel time)

**Greedy + Local Improvement algorithm**:

**Step 1: Pre-compute routes**
For each valid (resource, task) pair, run Dijkstra and record travel time. Skip infeasible pairs.

**Step 2: Score all pairs**
```
score = task.priority × cap_bonus × (0.4 + 0.6 × time_efficiency)
```
Higher priority tasks get higher scores. Direct capability matches get cap_bonus=1.0.

**Step 3: Greedy assignment**
Sort pairs by score descending. Assign each pair if neither resource nor task is already taken.

**Step 4: Local improvement**
For each pair of allocations, try swapping their resources:
- Check if swapped resource can perform the other's task
- Compute current total (travel_time₁ × priority₁ + travel_time₂ × priority₂)
- Compute swapped total
- Accept swap if swapped_total < current_total × 0.95 (5% improvement)
- Rebuild decisions to match new pairing
- Repeat up to 10 iterations

**Step 5: Generate decision explanations**
For each allocation, create a `DecisionExplanation` with:
- Recommended action ("Assign Rescue Team Alpha to village V3")
- Supporting reasons (priority, capability match, travel time, route details)
- Constraints (resource type, task type)
- Alternatives considered
- Confidence level (0.85 if route feasible, 0.50 otherwise)
- Human verification required: always True

**Baseline comparison**:
The `baseline_nearest_assignment()` function assigns the nearest available resource to each task in priority order. This provides a reference point — the AI system consistently outperforms this naive strategy.

**Capability map**:
```
RESCUE_TEAM    → [RESCUE, EVACUATION, VERIFICATION]
AMBULANCE      → [MEDICAL_RESPONSE]
ENGINEERING    → [ENGINEERING, VERIFICATION]
SUPPLY_VEHICLE → [SUPPLY_DELIVERY]
MEDICAL_UNIT   → [MEDICAL_RESPONSE, EVACUATION]
```

---

### 5.5 Simulation Engine

**Purpose**: Drive the disaster scenario as a discrete time-stepped process with 13 scripted events.

**Event types** (from `scenario_nepal_inspired.json`):

| Event | Description | Entity | Effect |
|---|---|---|---|
| `normal_state` | Initial state | — | Nothing |
| `bridge_damage_report` | Bridge damage reported | B1, B2 | Bridge status → BLOCKED/PARTIALLY_BLOCKED |
| `conflicting_bridge_report` | Conflicting bridge report | B1, B2 | Creates conflict evidence |
| `road_blockage` | Road blocked by landslide | R5, R7 | Road status → BLOCKED |
| `alternate_route_opened` | Alternate route cleared | R6 | Road status → OPEN |
| `hospital_demand_surge` | Hospital overwhelmed | H1, HP1 | Asset status → OVERLOADED |
| `school_evacuation` | School evacuation needed | S1, S2 | Asset status → EVACUATED |
| `resource_unavailable` | Resource becomes unavailable | RT2 | Resource status → UNAVAILABLE |
| `village_isolation_confirmed` | Village confirmed isolated | V2, V3 | Asset status → FLOODED |
| `satellite_observation` | Satellite image update | Various | Asset status updated from evidence |

**Event processing flow**:
1. Event popped from `unprocessed_events` queue
2. Simulation time advanced to event's `time_offset_min`
3. Previous plan snapshotted (for diff computation)
4. Observation created from event data
5. Direct state changes applied:
   - Road/bridge status updated in both WorldState and NetworkX graph
   - Asset status updated (overloaded, evacuated, flooded)
   - Resource status updated (unavailable)
6. Observation persisted to SQLite
7. Post-event pipeline: fuse → recalculate priorities → generate tasks → optimize → compute plan diffs

**Manual event injection**:
Operators or Bob can inject custom events via `POST /simulate/event` or `simulate_event()` MCP tool. The injected event is:
- Persisted to database as a SimEventDB row
- Processed immediately through the full pipeline
- Returns updated situation with plan changes

**Reset**:
- Deletes all observations, audit records, and decisions from DB
- Resets all assets, roads, bridges, resources to initial state
- Resets all simulation events to unprocessed
- Reloads everything from database

---

### 5.6 Benchmark Engine

**Purpose**: Compare AI system performance against a naive baseline to quantify improvement.

**Metrics computed**:
- **Coverage rate**: fraction of tasks assigned
- **Critical coverage**: fraction of critical sites (hospitals, health posts, shelters) covered
- **Total travel time**: sum of all ETA values
- **Weighted response time**: Σ(ETA × task.priority)
- **Unmet critical demand**: fraction of critical tasks unassigned
- **Resource utilization**: assigned resources / available resources
- **Blocked route violations**: allocations through infeasible routes
- **Conflict detection rate**: conflicting evidence / total evidence
- **Average decision confidence**: mean confidence across all decisions

**Improvements computed**:
- `travel_time_reduction_pct`: percentage reduction vs baseline
- `coverage_improvement`: coverage rate delta
- `conflicts_detected`: whether AI found conflicts (baseline doesn't)
- `blocked_route_violations_avoided`: baseline violations minus AI violations

All metrics computed from **actual simulation state** — never hardcoded. Results saved to `benchmark_results.json`.

---

## 6. IBM Bob MCP Integration

**IBM Bob** is the natural-language interface that allows human operators to query the system using plain English.

**How it works**:
1. Bob receives a natural-language question from the operator
2. Bob resolves intent and selects the appropriate MCP tool
3. Bob calls the tool, which makes an HTTP request to FastAPI
4. FastAPI processes the request using actual system state
5. The MCP tool formats the response as readable prose
6. Bob presents the formatted answer to the operator

**Example interactions**:
- *"Which location has the highest priority right now?"* → `get_priority_sites()` → returns ranked list
- *"Why is Hospital H1 critical?"* → `get_entity_evidence("H1")` + `get_priority_sites()` → returns evidence and priority explanation
- *"Can Ambulance A1 reach the hospital?"* → `get_route()` + `get_resource_status()` → returns route feasibility
- *"What changed after Bridge B1 was confirmed blocked?"* → `get_timeline()` + `get_decisions()` → returns audit trail
- *"Simulate Road R7 becoming blocked"* → `simulate_event()` → triggers full replan
- *"Show me the system benchmark"* → `get_benchmark_metrics()` → returns AI vs baseline comparison

**Key constraint**: Bob does NOT have direct write access. All actions are surfaced as **recommendations requiring human confirmation**. This preserves the human-in-the-loop design.

---

## 7. Database Schema

### Relationships
```
assets ──┬── observations (many-to-one)
         ├── roads (from_node / to_node)
         ├── resources (location_id)
         └── priorities (computed from evidence)

roads ──┬── bridges (on_road)
        └── observations

bridges ├── observations

resources ├── observations
          ├── tasks (assigned)
          └── decisions (recommended)

observations → evidence_summaries (fused)

decisions → audit_log (operator actions)
sim_events → observations (source)
```

### Audit Trail
Every significant state change creates an `AuditRecord`:
- `event_type`: e.g., "bridge_status_updated", "resource_status_updated", "operator_decision"
- `entity_id`: the affected entity
- `previous_state`: JSON snapshot of state before
- `new_state`: JSON snapshot of state after
- `reason`: Human-readable explanation
- `confidence`: Confidence level of the change
- `simulation_time_min`: When it happened

### Decision Currency
- Each entity can have at most one `is_current=True` decision
- When a new decision is created for an entity, existing `is_current=True` rows for that entity are marked `is_current=False`
- Operator-confirmed decisions are **never modified** (only `is_current` is cleared)
- This ensures operators can always see the latest recommendation without losing history

---

## 8. Scenario Data

The **Bhote Valley** scenario is entirely synthetic but modeled on realistic Nepal mountainous geography.

### Assets (14 total)
| ID | Name | Type | Population | Status |
|---|---|---|---|---|
| H1 | General Hospital | hospital | 500 | operational |
| HP1 | Health Post North | health_post | 0 | operational |
| HP2 | Health Post South | health_post | 0 | operational |
| S1 | School A | school | 200 | operational |
| S2 | School B | school | 180 | operational |
| SH1 | Community Shelter | shelter | 350 | operational |
| HP2 | Hydropower Station | hydropower | 0 | operational |
| CC1 | Command Center | command_center | 0 | operational |
| V1 | Sindhupalchok North | village | 340 | operational |
| V2 | Balephi Junction | village | 280 | operational |
| V3 | Tatopani Upstream | village | 220 | operational |
| V4 | Khadichaur | village | 150 | operational |
| V5 | Jalbire | village | 180-400 | operational |
| V6 | Gorkhe Gaun | village | 95 | operational |

### Resources (8 total)
| ID | Name | Type | Capabilities | Status |
|---|---|---|---|---|
| RT1 | Rescue Team Alpha | rescue_team | rescue, evacuation, verification | available |
| RT2 | Rescue Team Bravo | rescue_team | rescue, evacuation, verification | available |
| RT3 | Rescue Team Charlie | rescue_team | rescue, evacuation, verification | available |
| AMB1 | Ambulance Alpha | ambulance | medical_response | available |
| AMB2 | Ambulance Bravo | ambulance | medical_response | available |
| ENG1 | Engineering Team | engineering_team | engineering, verification | available |
| SUP1 | Supply Vehicle | supply_vehicle | supply_delivery | available |
| MED1 | Medical Unit | medical_unit | medical_response, evacuation | available |

### 13 Scripted Events Timeline
```
T+00min  → Normal state (initial)
T+030min → Bridge B1 damage report (drone)
T+060min → Road R5 blockage (field report)
T+090min → Conflicting bridge report on B1 (satellite vs field)
T+120min → Alternate route R6 opened
T+150min → Hospital H1 demand surge
T+180min → School S1 evacuation required
T+210min → Village V2 isolation confirmed
T+240min → Resource RT2 unavailable (mechanical failure)
T+270min → Road R7 blockage (landslide)
T+300min → Bridge B2 damage report
T+330min → Satellite observation update
T+360min → Village V3 isolation confirmed
```

---

## 9. Human-in-the-Loop Design

**Every recommendation requires human confirmation.** This is a core design principle — the system is a **decision support layer**, not an autonomous system.

**How it works**:
1. System generates `ResponsePlan` with `DecisionExplanation` objects
2. Each decision has `human_verification_required = True`
3. Dashboard surfaces decisions as actionable cards
4. Operator reviews:
   - The recommended action
   - Supporting reasons and evidence
   - Confidence level
   - Route feasibility
   - Resource capabilities
5. Operator clicks **Accept**, **Reject**, or **Modify**
6. Decision status is persisted with operator notes
7. System logs the action in the audit trail
8. If accepted, the system may trigger replanning

**Why human-in-the-loop matters**:
- AI can hallucinate or make errors — human oversight catches mistakes
- Operators have contextual knowledge the AI lacks
- Accountability: every decision is attributed to a human
- Trust: operators understand what the system is recommending and why
- Legal/ethical: autonomous life-critical decisions are unacceptable

**Decision history**:
- All decisions are stored with `is_current` flag
- Superseded decisions are marked `is_current=False` but never deleted
- Operator-confirmed decisions are preserved as-is
- Full audit trail enables post-incident review

---

## 10. Running the System

### Prerequisites
- Python 3.14+
- Node.js 18+
- Make

### Installation
```bash
make install
```

This installs all Python dependencies (FastAPI, SQLAlchemy, NetworkX, etc.) and Node dependencies (React, Vite, Leaflet, etc.).

### Starting the Backend
```bash
make dev-backend
# Backend available at http://localhost:8000
# API docs at http://localhost:8000/docs
```

The backend:
1. Creates SQLite database tables
2. Seeds the Bhote Valley scenario
3. Loads all data into memory
4. Starts FastAPI server on port 8000
5. Rebuilds the road network graph
6. Computes initial priorities and tasks

### Starting the Frontend
```bash
make dev-frontend
# Dashboard at http://localhost:5173
```

The frontend:
1. Starts Vite dev server
2. Connects to backend API
3. Polls for data every 5 seconds
4. Renders interactive map, priority panel, and controls

### Running Tests
```bash
make test
```

Runs pytest with 64 unit and integration tests.

### Running Benchmark
```bash
make benchmark
```

Runs the full simulation and compares AI vs baseline. Results displayed in terminal and saved to `benchmark_results.json`.

### Resetting Simulation
```bash
# Via API: POST /simulate/reset
# Via MCP: reset_simulation()
# Via dashboard: Reset button
```

### Seed Data
```bash
make seed
```

Re-seeds the database from `src/data/scenario_nepal_inspired.json`.

---

## 11. Known Limitations

1. **No real-time external data ingestion**: The system uses a pre-scripted simulation scenario. It does not connect to live sensors, weather APIs, or satellite feeds. All events are predetermined or manually injected.

2. **Map tiles require internet**: The CARTODB dark theme requires an internet connection. Falls back gracefully to offline mode if tiles fail to load.

3. **Greedy + local improvement, not full ILP**: The optimizer uses a greedy approach with pairwise swaps rather than solving the full Integer Linear Program. This is sufficient for the hackathon scale (8 resources, ~14 tasks) but may not scale to hundreds of resources without algorithmic changes.

4. **Watsonx.ai is optional**: The system works fully with the `DeterministicProvider`. IBM watsonx.ai credentials are optional and only affect the natural language generation quality, not any analytical decisions.

5. **No SSE streaming**: The dashboard polls the API every 5 seconds rather than using Server-Sent Events for real-time updates. This introduces up to 5 seconds of latency in the UI.

6. **Single-threaded simulation**: The simulation engine processes events sequentially. Parallel event processing would require careful state management.

7. **SQLite concurrency**: SQLite has limited concurrent write performance. For production use, a more robust database (PostgreSQL) would be recommended.

---

## Appendix: File Structure Reference

```
bob-ai-hackathon-shutdown/
├── src/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── main.py              # FastAPI application, all REST endpoints
│   │   │   ├── config.py            # All configurable parameters (Settings)
│   │   │   ├── models/
│   │   │   │   ├── __init__.py
│   │   │   │   └── domain.py        # Pydantic domain models (402 lines)
│   │   │   ├── engines/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── simulation.py    # SimulationEngine + WorldState (1029 lines)
│   │   │   │   ├── evidence_fusion.py  # Evidence fusion algorithm (202 lines)
│   │   │   │   ├── priority_engine.py  # Criticality & priority scoring (244 lines)
│   │   │   │   ├── graph_engine.py    # NetworkX routing (275 lines)
│   │   │   │   ├── resource_optimizer.py # Greedy + local improvement (406 lines)
│   │   │   │   └── benchmark.py       # Benchmark comparison (208 lines)
│   │   │   ├── db/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── database.py      # SQLAlchemy ORM + async session (188 lines)
│   │   │   │   └── seed.py          # Scenario data loader (143 lines)
│   │   │   ├── utils/
│   │   │   │   ├── __init__.py
│   │   │   │   └── ai_provider.py   # AI abstraction layer (315 lines)
│   │   │   └── __init__.py
│   │   ├── tests/
│   │   │   ├── __init__.py
│   │   │   ├── test_integration.py  # Integration tests
│   │   │   └── test_engines.py      # Unit tests for engines
│   │   ├── benchmark_results.json   # Latest benchmark output
│   │   └── disaster_response.db     # SQLite database
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── App.tsx              # Main React component (1108+ lines)
│   │   │   ├── App.css              # Styling
│   │   │   ├── main.tsx             # React entry point
│   │   │   ├── api.ts               # API client + TypeScript types (231 lines)
│   │   │   └── index.css            # Global styles
│   │   ├── dist/                    # Built frontend (served by FastAPI)
│   │   └── package.json             # Node dependencies
│   ├── mcp/
│   │   ├── server.py                # MCP server with 14 tools (802 lines)
│   │   └── mcp_config.json          # MCP server configuration
│   └── data/
│       └── scenario_nepal_inspired.json  # Complete scenario data
├── docs/
│   ├── architecture.md              # This document (architecture diagram)
│   ├── problem-statement.md         # Problem definition
│   ├── solution-overview.md         # Solution design philosophy
│   ├── setup-guide.md               # Setup instructions
│   └── template-guide.md            # Documentation template
├── demo/                            # Demo screenshots and video links
├── presentation/                    # IBM-BOB hackathon deck
├── Makefile                         # Build commands (install, test, benchmark)
├── README.md                        # Project overview
├── submission.yaml                  # Hackathon submission metadata
└── .env.example                     # Environment variable template
```

---

## Appendix: Configuration Parameters

All tunable parameters are in `src/backend/app/config.py`:

**Source Reliability**:
```python
reliability_satellite: 0.85
reliability_drone: 0.90
reliability_field_report: 0.88
reliability_emergency_call: 0.75
reliability_hospital: 0.95
reliability_sensor: 0.80
reliability_authority_report: 0.92
reliability_simulation: 1.00
```

**Freshness Decay Lambdas** (per hour):
```python
freshness_lambda_bridge_status: 2.0    # ~2 hour half-life
freshness_lambda_road_status: 1.5      # ~2.8 hour half-life
freshness_lambda_hospital_capacity: 2.0
freshness_lambda_structural_damage: 0.5
freshness_lambda_population: 0.1       # ~6.9 hour half-life
freshness_lambda_flood_level: 3.0      # ~1.4 hour half-life
```

**Criticality Weights**:
```python
criticality_weight_population_impact: 0.25
criticality_weight_service_criticality: 0.25
criticality_weight_time_sensitivity: 0.20
criticality_weight_isolation_risk: 0.15
criticality_weight_damage_severity: 0.15
```

**Priority Weights**:
```python
priority_weight_criticality: 0.30
priority_weight_urgency: 0.25
priority_weight_impact: 0.20
priority_weight_accessibility: 0.15
priority_weight_confidence: 0.10
```

**Risk Penalties**:
```python
risk_penalty_unknown_road: 0.4
risk_penalty_high_risk_road: 0.6
risk_penalty_partially_blocked: 0.8
```

**Conflict Detection**:
```python
conflict_weight_difference_threshold: 0.3  # Second-best must have ≥30% support
```

---

*Document generated: September 2026*  
*System version: 1.0.0*  
*Scenario: Bhote Valley Emergency Simulation*
