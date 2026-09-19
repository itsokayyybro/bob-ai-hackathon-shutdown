# Demo Guide: Bhote Valley Emergency Simulation

## What This Demo Shows

The Bhote Valley Emergency Simulation is a scripted but live disaster response
scenario. It runs as a real system — not a slideshow — with a running simulation
engine, live SQLite state, and a connected IBM Bob MCP server.

The scenario is **fully synthetic**, inspired by monsoon flood response in
mountainous Nepal. It covers **T+0 to T+180 minutes (3 hours)** across **13
scripted events**, over a network of **15 assets** (command centre, district
hospital, 2 health posts, 2 schools, 1 shelter, 1 hydropower station, 5 villages,
2 supply bases), **14 road segments** and **2 bridges**, served by **8 response
resources**.

The demo demonstrates five capabilities in sequence:

1. **Evidence fragmentation and fusion** — two contradictory reports about the same
   bridge, fused into a confidence-weighted record with an active conflict flag
2. **Dynamic priority scoring** — locations ranked by need *and* accessibility,
   urgency and information confidence
3. **Graph-based accessibility routing** — routes that reflect current road and
   bridge status, not pre-disaster assumptions
4. **Constrained resource optimization** — capability-aware allocation with rationale
5. **Operator review and automatic replanning** — the human accepts or rejects a
   recommendation; new information supersedes it and flags what needs re-review

---

## Scenario Entities

| ID | Type | Name |
|---|---|---|
| CC1 | command_center | Bhote Valley Command Center |
| H1 | hospital | Bhote District Hospital |
| HP1 / HP2 | health_post | Gorkha Health Post / Sindhupalchok Health Post |
| S1 / S2 | school | Manakamana School / Bhote Higher Secondary School |
| SH1 | shelter | Tatopani Shelter |
| HPwr1 | hydropower | Bhote Hydropower Station |
| V1–V5 | village | Bhote Bazar, Kritipur, Gorkhe Gaun, Laprak, Mohoriyekharka |
| RB1 / RB2 | resource_base | Supply Base Alpha / Supply Base Beta |

Resources: **RT1, RT2** (rescue teams, at CC1), **RT3** (rescue team, at RB1),
**A1** (ambulance, at H1), **A2** (ambulance, at HP1), **MU1** (medical unit, at
H1), **ET1** (engineering team, at RB1), **SV1** (supply vehicle, at RB2).

### Network topology (matters for the demo)

The road network is **two linear chains joined only at CC1**:

```
Chain 1: CC1 -R1- H1 -R2- HP1 -R3- S1 -R4- SH1 -R5- V3 -R6- HPwr1
Chain 2: CC1 -R7- RB1 -R8- V1 -R9- V2 -R10- S2 -R11- HP2 -R12- V4 -R13- V5 -R14- RB2
```

Bridge **B1 sits on R2** (heavy capacity); bridge **B2 sits on R9** (medium).
Roads are bidirectional.

This has a consequence worth stating plainly, because it is easy to get wrong:
blocking **B1** severs chain 1 beyond HP1, cutting off HP1, S1, SH1, V3 and HPwr1
from the command centre. Blocking **B1 does not** make `CC1 → H1` infeasible,
because that route uses only R1, which carries no bridge. Blocking **B2** affects
chain 2 and cannot affect a chain-1 allocation at all.

---

## Running the Demo

### Prerequisites

```bash
# Backend dependencies
pip install -r src/backend/requirements.txt

# Frontend dependencies
cd src/frontend && npm install
```

### Start the System

```bash
# Terminal 1: FastAPI backend (seeds the DB and loads world state on startup)
cd src/backend && PYTHONPATH=$(pwd) python3 -m uvicorn app.main:app --reload --port 8000

# Terminal 2: React dashboard
cd src/frontend && npm run dev

# Terminal 3: MCP server (connects Bob to the backend)
BACKEND_URL=http://localhost:8000 python3 src/mcp/server.py
```

The dashboard **polls** the backend. There is no SSE stream or WebSocket; push
transport is deliberately out of scope.

### Advance the Simulation

The simulation is **event-driven — nothing advances on a timer.** Each call to
`/simulate/next` applies the next event and jumps the clock to that event's offset.

```bash
# Advance by one event
curl -X POST http://localhost:8000/simulate/next

# Run all remaining events
curl -X POST http://localhost:8000/simulate/auto

# Rewind to the start
curl -X POST http://localhost:8000/simulate/reset
```

Note: events injected via `POST /simulate/event` are persisted and **survive a
reset** — they are replayed on the next run-through. Reset rewinds the scheduled
scenario; it does not discard what you injected.

### The 13 scripted events

| Event | Time | Type | Entity | Value |
|---|---|---|---|---|
| EVT-001 | T+0 | normal_state | — | — |
| EVT-002 | T+15 | flood_detection | V3 | flooded |
| EVT-003 | T+30 | bridge_damage_report | B1 | partially_blocked |
| EVT-004 | T+45 | conflicting_bridge_report | B1 | open |
| EVT-005 | T+60 | road_blockage | R7 | blocked |
| EVT-006 | T+75 | hospital_demand_surge | HP1 | overloaded |
| EVT-007 | T+90 | resource_unavailable | RT2 | unavailable |
| EVT-008 | T+105 | bridge_confirmed_blocked | B2 | blocked |
| EVT-009 | T+120 | village_isolation_confirmed | V3 | isolated |
| EVT-010 | T+135 | satellite_observation | V4 | flooded |
| EVT-011 | T+150 | alternate_route_opened | R5 | open |
| EVT-012 | T+165 | school_evacuation | S1 | evacuation_required |
| EVT-013 | T+180 | satellite_observation | V5 | open |

---

## Multi-source correlation: the B1 bridge conflict

This is the canonical illustration of incident correlation, and it is worth
walking through with the API open.

The system groups observations by **operational entity plus observation type**
(`B1` + `bridge_status`) and fuses them. EVT-003 and EVT-004 are two field reports
about the same bridge that disagree.

```bash
curl http://localhost:8000/evidence/B1
```

That endpoint returns both views: `evidence_summaries` (the fused record) and
`raw_observations` (every individual report, retained as provenance).

Measured at T+45:

| Observation | Source | Confidence | Freshness | Weight |
|---|---|---|---|---|
| `partially_blocked` (EVT-003, T+30) | field_report (0.88) | 0.82 | 0.6065 | **0.4377** |
| `open` (EVT-004, T+45) | field_report (0.88) | 0.50 | 1.0000 | **0.4400** |

The two values normalize to **different** canonical categories, so the fused
summary contains **one supporting observation and one conflicting observation, with
`source_count = 2`** — not two supporting observations. `conflict_status` is
`conflicting` and confidence is `0.2206` (`very_low`).

The support shares are 0.4987 vs 0.5013 — a margin of **0.26 percentage points**.
Which value wins is genuinely marginal and would flip under any change to the decay
rate, source reliability or event timing. Do not present the winning value as a
finding. The demonstrable behaviour is that the system **detects the contradiction,
reports low confidence, and recommends field verification** instead of resolving it
confidently.

### What this does and does not claim

The system fuses multiple reports about the *same operational entity*. It does
**not** claim to discover that two unrelated-looking reports describe the same
incident — there is no semantic incident matching. The correlation scope is
deliberately `entity_id + observation_type`, and that is sufficient for this
scenario.

---

## Where AI is and is not used

The deterministic engines are authoritative for **confidence calculation, conflict
detection, priority scoring, route feasibility, resource capability and
optimization**. The LLM never decides any of those.

The AI provider is used for language, over state the engines already computed:

- `generate_situation_summary()` — readable situation briefs
- `explain_decision()` — explaining a recommendation and its contradictions
- `answer_operator_question()` — natural-language operational questions

`DeterministicProvider` does this without any credentials; `WatsonxProvider` uses
IBM Granite for the same three functions when credentials are configured. Either
way the numbers come from the engines.

One AI capability is **deliberately out of scope**: extracting structured facts
from free-text reports. Raw report text is retained as provenance
(`raw_observations[].raw_text`) but is never parsed into authoritative state. This
is a considered boundary, not an omission — LLM extraction is not allowed to
mutate authoritative state without validation.

---

## Evaluation walkthrough: the 12 steps

Mapping of the scenario to the twelve steps in the Evaluation Documentation §6.1.

| # | Step | Where it happens | How to see it |
|---|---|---|---|
| 1 | A flood scenario begins | EVT-001 (normal state), EVT-002 (V3 flooded) | `GET /timeline` |
| 2 | Multiple reports enter the platform | EVT-003 + EVT-004, both about B1 | `GET /evidence/B1` → `raw_observations` |
| 3 | Reports come from different source types | `field_report`, `satellite`, `authority_report` across the sequence | `raw_observations[].source_type` |
| 4 | The system normalizes them | `evidence_fusion._normalize_value()` | fused `best_value` is a canonical category |
| 5 | Duplicate/correlated reports are fused | `EvidenceSummary` for B1 — **1 supporting + 1 conflicting, `source_count` 2** | `GET /evidence/B1` → `evidence_summaries` |
| 6 | At least one contradiction is introduced | EVT-004 contradicts EVT-003 | `GET /timeline` |
| 7 | The system shows uncertainty | `conflict_status = conflicting`, confidence 0.2206 | `GET /situation` → `evidence_conflicts` |
| 8 | An affected location is linked to accessibility | `_compute_accessibility()` feeds `accessibility_factor` | `GET /priorities` |
| 9 | A resource is matched to the incident | after EVT-006, `TASK-HP1-medical_response` → **A2** (ambulance stationed at HP1) | `GET /plan` → `recommendations` |
| 10 | The operator reviews the recommendation | `POST /decisions/{id}/confirm` | response carries `operator_status` |
| 11 | A new report changes the situation | EVT-008 (B2 blocked) or EVT-005 (R7 blocked) | `plan_changes` on the event response |
| 12 | The system updates and flags affected decisions | `plan_changes[].review_required` + `affected_decision_ids` | same response |

### Operator review and replanning, end to end

```bash
# 1. Advance until a recommendation exists
curl -X POST http://localhost:8000/simulate/next   # repeat until /decisions is non-empty

# 2. Read the current recommendations
curl http://localhost:8000/decisions?current_only=true

# 3. Accept one
curl -X POST http://localhost:8000/decisions/DEC-XXXXXXXX/confirm \
  -H 'Content-Type: application/json' \
  -d '{"status":"accepted","operator_notes":"Dispatch approved."}'

# 4. New information arrives and supersedes it
curl -X POST http://localhost:8000/simulate/next

# 5. The acceptance is still visible as history, alongside the new recommendation
curl "http://localhost:8000/decisions?task_id=TASK-HP1-medical_response"
```

Step 5 is the point of the exercise. The accepted row keeps its
`operator_status=accepted` and its original `recommended_action`, `reasons` and
`confidence` — untouched — but reports `is_current: false`. A **new** row carries
the current recommendation. Recommendations are insert-only: a replan never
rewrites what the system previously advised or what a human decided about it.

`POST /decisions/{id}/confirm` also writes an audit record with
`event_type=operator_decision`, visible via `GET /audit`.

Note that confirming a decision **does not dispatch anything**.
`human_verification_required` is always true and acting on the decision stays a
human activity outside this system.

---

## Bob Natural-Language Demo Script

Open IBM Bob with the MCP server connected. All 14 tools call real FastAPI
endpoints; none return canned text.

| Query | Tool exercised | Expected answer type |
|---|---|---|
| *"What is the current emergency situation?"* | `get_current_situation` | Sim time, top priorities with scores, blocked infrastructure, conflicts |
| *"What are the top 5 priority locations?"* | `get_priority_sites` | Ranked list with criticality, urgency, accessibility, confidence |
| *"Why is Gorkha Health Post a priority?"* | `get_priority_sites` / `ask_operator_question` | Score breakdown and supporting factors |
| *"What evidence do we have about bridge B1?"* | `get_entity_evidence` | Fused summary plus every raw report, with the conflict flagged |
| *"Can a heavy vehicle get from CC1 to HP1?"* | `get_route` | Feasibility, path, distance, time, risk |
| *"What resources are available?"* | `get_resource_status` | Resources grouped by status with capabilities |
| *"Generate a response plan."* | `generate_response_plan` | Assignments with ETA and rationale, plus baseline comparison |
| *"Advance the simulation."* | `simulate_next_event` | Event applied, updated priorities |
| *"Report that bridge B1 is confirmed impassable."* | `simulate_event` | Event injected, system response summarised |
| *"Explain decision DEC-XXXXXXXX."* | `explain_decision` | Reasons, constraints, alternatives, AI explanation |
| *"Show me the benchmark metrics."* | `get_benchmark_metrics` | Real metric values vs the nearest-resource baseline |
| *"Show me the event timeline."* | `get_timeline` | All events with processed status |
| *"Reset the simulation."* | `reset_simulation` | Confirmation and rewound clock |

Bob **cannot dispatch resources** and there is no tool that does. Bob reads state
and explains it; the deterministic engines decide, and a human approves.

---

## Screenshots

See `demo/screenshots/`. Suggested captures for a live run:

- Dashboard overview mid-scenario — map with priority-sized markers and the alert panel
- Evidence conflict panel — B1 with its two opposing reports and low confidence
- Priority breakdown — an expanded score with its supporting factors
- Recommendation card — action, rationale, confidence, and Confirm / Reject controls
- Bob conversation — a natural-language query beside the structured response

---

## Benchmark Demonstration

`GET /benchmark` compares the evidence-aware optimizer against a **nearest-resource
greedy baseline** — assign the closest capable resource to each task in priority
order, with no evidence fusion and no swap improvement. (Earlier drafts of this
guide described the baseline as "random allocation". That was wrong; it is
nearest-resource.)

Measured values after running the full 13-event sequence to T+180:

| Metric | AI optimizer | Nearest-resource baseline |
|---|---|---|
| Coverage rate | 0.75 (3 of 4 tasks) | 0.75 |
| Total travel time | 104.0 min | 104.0 min |
| Weighted response time | 51.7 | 51.7 |
| Resource utilization | 0.4286 | 0.4286 |
| Blocked-route violations | 0 | 0 |
| Unmet critical demand | 0.0 | — |
| Conflict detection rate | 0.0909 (1 of 11 evidence items) | — |
| Avg decision confidence | 0.85 | 0.5 (placeholder — see below) |
| Replanning events | 13 | — |

**Read these honestly.** On this scenario the two strategies produce the *same*
assignment: travel-time reduction is **0.0%** and coverage, travel time, weighted
response time and utilization are identical. With 4 tasks and 8 resources there is
not enough contention for the optimizer's swap improvement to differentiate itself.
This benchmark demonstrates that the pipeline runs end to end and produces
explainable, constraint-respecting output — **it does not demonstrate an
optimization advantage on this scenario.**

Two caveats about the baseline column:

- The baseline emits no decision explanations at all, so its "average decision
  confidence" of 0.5 is a **hard-coded placeholder, not a measurement**. It should
  not be presented as a comparison against the AI figure of 0.85.
- `replanning_events` counts processed simulation events (13), not the number of
  optimizer runs that produced a new persisted decision set (9 on this run).

All entities, locations and events are synthetic. These numbers describe prototype
behaviour under a scripted scenario. They are **not** evidence about real-world
disaster response outcomes.
