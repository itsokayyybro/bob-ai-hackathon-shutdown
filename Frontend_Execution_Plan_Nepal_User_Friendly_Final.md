
# Frontend Execution Plan — User-Friendly Emergency Operations Center
## Nepal / Bhote Valley Scenario

## 0. Objective

Upgrade the existing React/TypeScript frontend from a technically rich monitoring dashboard into a clear emergency-operations decision workspace.

The target user experience is:

**Situation → Evidence → Priority → Recommendation → Resource → Decision → Situation Change → Replanning**

The existing backend and Nepal/Bhote Valley simulation remain the source of truth. Do not rebuild the application or invent frontend-only intelligence.

The frontend must make the intelligence already present in the backend understandable to a non-technical emergency coordinator and to hackathon juries.

---

## 1. Non-Negotiable Constraints

1. Keep the actual product scenario as **Bhote Valley / Nepal-inspired Emergency Simulation**.
2. Do not convert the UI or data model to Gujarat.
3. Preserve the existing React + TypeScript + Vite stack.
4. Preserve the Leaflet map and current operational layout unless a targeted UX change is required.
5. Do not implement routing, prioritization, optimization, evidence fusion, or confidence calculations inside React.
6. Backend remains authoritative for:
   - evidence/confidence
   - priority
   - accessibility
   - routing
   - resource assignment
   - recommendations
   - replanning
   - benchmark metrics
7. Do not fabricate data, recommendations, events, resources, confidence values, or plan changes.
8. Do not introduce SSE/WebSockets unless the backend already supports them. Keep the existing polling approach.
9. Do not remove working simulation controls, evidence views, Bob interface, benchmark, map, priority queue, or raw observations.
10. Do not modify protected hackathon template files such as `.github/workflows/validate.yml`, `submission.yaml`, or required repository structure.
11. Documentation must describe only behavior verified in the implementation.

---

# PHASE A — BACKEND CONTRACT FIRST

Before changing the frontend, inspect the backend and verify the exact APIs and response schemas currently available.

## A1. Trace the complete operational flow

Inspect:

- `simulation.py`
- `evidence_fusion.py`
- `priority_engine.py`
- `graph_engine.py`
- `resource_optimizer.py`
- API route definitions
- decision persistence
- audit/history persistence
- MCP tools
- current frontend API client/types

Document the actual data flow:

```text
event
→ evidence fusion
→ priority recalculation
→ task generation
→ resource optimization
→ response plan
→ decision persistence
→ subsequent event
→ affected-plan/replanning detection
```

Do not assume the existing documentation is accurate. Code and actual API responses are authoritative.

## A2. Verify recommendation contract

The frontend needs a stable representation of a recommendation containing, where currently supported:

- decision ID
- task/entity ID
- entity name
- entity type
- priority
- recommended resource
- resource type/capability
- route
- ETA/travel time
- score
- explanation
- supporting factors
- human verification requirement
- current operator decision status

If an existing `/plan` or equivalent endpoint already exposes these fields, reuse it.

If the backend does not expose a required field, do not fake it in React. Record the missing contract and make the smallest backend change necessary before frontend implementation.

## A3. Verify human decision workflow

Verify the real backend endpoint for:

- accept
- reject
- modify, only if genuinely supported
- operator notes, only if genuinely supported

Preferred contract if compatible with the existing backend:

`POST /decisions/{decision_id}/confirm`

The response must contain the persisted decision state.

The frontend must never treat a recommendation as accepted based only on local React state.

## A4. Verify plan-change / replanning contract

The backend should expose enough information for the frontend to show:

- triggering event
- affected entity/infrastructure
- previous recommendation
- new recommendation
- previous resource
- new resource
- previous route
- new route
- previous ETA
- new ETA
- reason for change
- review-required status

Preferred response pattern:

```text
plan_changes[]
  decision_id
  entity_id
  entity_name
  event
  reason
  previous_plan
  new_plan
  review_required
```

If the backend already has a different schema, adapt the frontend to the real schema rather than forcing this exact shape.

## A5. Verify evidence contract

Use the existing backend EvidenceSummary/raw observation data.

The frontend should receive and display:

- best/current value
- confidence
- conflict status
- source count
- last observation time
- freshness/age
- supporting observations
- conflicting observations
- recommendation if supplied

Do not duplicate the evidence-fusion formula in the frontend.

## A6. Verify priority explanation

Use backend-provided supporting factors.

Examples may include:

- people affected
- medical urgency
- accessibility
- immediacy
- evidence confidence/freshness

The frontend should explain the priority, not calculate it.

## A7. Verify resource-to-task relationship

The frontend needs to know:

```text
Task
→ recommended resource
→ capability
→ route
→ ETA
→ constraint
```

If the optimizer already produces this relationship, expose it directly.

Do not create a second optimizer or resource scoring algorithm in React.

## A8. Fix backend contract issues discovered during inspection

Known issue to verify/fix before frontend integration:

- MCP situation priority mapping previously used `name` while the API response uses `entity_name`.

Only make backend fixes that are necessary for the frontend/operational workflow and regression-test them.

---

# PHASE B — UX INFORMATION ARCHITECTURE

The screen should answer five questions immediately:

1. **What is happening?**
2. **What is urgent?**
3. **What do we know and how confident are we?**
4. **What action needs review?**
5. **What changed since the last plan?**

The visual hierarchy should become:

```text
ACTION / SITUATION CHANGE
        ↓
CURRENT PRIORITIES
        ↓
RECOMMENDATION
        ↓
WHY / EVIDENCE
        ↓
RESOURCE + ROUTE
        ↓
MAP / SUPPORTING DETAIL
```

Technical metrics remain available but should not compete with the main operational workflow.

---

# PHASE C — USER-FRIENDLY PRIORITY QUEUE

Current queue values such as:

`P: 0.518 | U: 95% | A: 84% | C: 27%`

are too technical for primary presentation.

Replace the primary display with human-readable information:

```text
#2  Gorkhe Gaun
750 people affected
HIGH URGENCY
Access: ISOLATED
Evidence: LOW CONFIDENCE
```

Keep numerical scores available in secondary text/tooltips.

Each queue item should clearly communicate:

- entity
- rank
- affected population where available
- urgency
- accessibility
- evidence confidence
- conflict flag
- current status

Use consistent visual language for:

- Critical
- Needs attention
- Operational
- Unknown/Stale
- Evidence conflict

Do not rely on color alone.

---

# PHASE D — RECOMMENDATION / ACTION WORKSPACE

Create a prominent `RecommendationPanel`.

This is the most important missing UX element.

The panel should show:

```text
ACTION REVIEW REQUIRED

Gorkhe Gaun
750 people affected
High urgency

WHY?
• Isolated access
• High urgency
• Low-confidence evidence
• 2 supporting sources

RECOMMENDED RESPONSE
Rescue Team Alpha

Capability
Rescue / Evacuation

Route
R3 → R7

ETA
18 min

Confidence
27%

[ REVIEW ] [ ACCEPT ] [ REJECT ]
```

Only display fields that actually exist in the backend.

The recommendation must visually distinguish:

- system recommendation
- operator decision
- current decision status

Recommended status labels:

- RECOMMENDED
- ACCEPTED
- REJECTED
- MODIFIED, only if supported

After a decision is submitted:

1. call the backend
2. wait for success
3. update displayed state from backend response
4. refresh affected situation/resource/plan data
5. show the persisted status

Never optimistically mark an action accepted without backend confirmation.

---

# PHASE E — HUMAN DECISION WORKFLOW

The system is decision support, not autonomous dispatch.

Every recommendation should make this explicit:

> **Human verification required**

The operator should be able to:

- inspect evidence
- inspect why the item is prioritized
- inspect recommended resource
- inspect route/ETA
- accept
- reject
- add notes if backend supports notes

After accepting/rejecting, show a small audit state:

```text
✓ ACCEPTED BY OPERATOR
Decision ID: D-014
```

Do not expose unnecessary technical database details in the primary UI.

---

# PHASE F — SITUATION CHANGE / REPLANNING EXPERIENCE

This is critical to demonstrating the real intelligence of the system.

When a simulation event changes the operational state, show a prominent but non-blocking alert:

```text
⚠ SITUATION UPDATED

Bhote Koshi Main Bridge
OPEN → BLOCKED

2 response plans may be affected.

[ REVIEW AFFECTED PLANS ]
```

The alert must be driven by backend plan-change data.

Do not infer affected plans in React.

## Before / After plan comparison

When the operator opens the change:

```text
PREVIOUS PLAN
Rescue Team Alpha
Route: R3
ETA: 12 min

        ↓ BRIDGE BLOCKED ↓

UPDATED PLAN
Rescue Team Bravo
Route: R7
ETA: 24 min

WHY CHANGED?
Previous route is no longer feasible.

[ ACCEPT NEW PLAN ]
```

This is the key demonstration of continuous replanning.

---

# PHASE G — EVIDENCE WORKSPACE

Rename technical labels where possible:

`EVIDENCE SUMMARIES` → `WHAT WE KNOW`

`RAW OBSERVATIONS` → `SOURCE REPORTS`

Example:

```text
WHAT WE KNOW

Flood status
FLOODED
Confidence: 85%
1 source

Accessibility
ISOLATED
Confidence: 90%
2 sources
```

Then:

```text
SOURCE REPORTS

Satellite
FLOODED
Confidence 85%
Recent

Field report
ISOLATED
Confidence 90%
Recent
```

Show:

- source
- timestamp
- reported value
- confidence
- freshness
- supporting/conflicting status

The UI must clearly distinguish:

**reported information** from **system conclusion**.

---

# PHASE H — MAKE “WHY?” OBVIOUS

Every important priority or recommendation should have a concise explanation.

Example:

```text
WHY IS THIS HIGH PRIORITY?

+ 750 people affected
+ High urgency
+ Location isolated
+ Recent field confirmation
− Evidence confidence is low
```

Use backend supporting factors.

Do not invent causal explanations from raw frontend fields.

This is important for both UX and the IBM BOB/AI evaluation because the system becomes explainable rather than a black box.

---

# PHASE I — RESOURCE-TO-TASK VISIBILITY

The current resource list should answer:

> “Available for what?”

Change the resource detail from:

```text
Rescue Team Alpha
AVAILABLE
Rescue / Evacuation
```

to, where backend data supports it:

```text
RESCUE TEAM ALPHA
AVAILABLE

Capability
Rescue / Evacuation

Recommended for
Gorkhe Gaun

Route
R3 → R7

ETA
18 min
```

Also show assignment status where available:

- Available
- Recommended
- Assigned
- En route
- Unavailable

Do not create these states unless the backend provides them.

---

# PHASE J — MAP UX

Keep Leaflet and the current map.

Do not rewrite routing or geographic logic.

Improve visual communication:

- selected entity is visually prominent
- high-priority entity is visually distinguishable
- blocked infrastructure is clearly represented
- active/recommended route is highlighted when backend provides it
- resources can be associated visually with tasks when supported
- legend uses human-readable terms

Suggested legend:

```text
Critical / Blocked
Needs Attention
Operational
Flooded
Unknown / Stale
```

Remove unnecessary visual noise where possible.

Keep required map attribution.

The map should answer:

> “Where is the problem and what can reach it?”

not merely:

> “Where are the objects?”

---

# PHASE K — SIMULATION CONTROLS

Keep:

- Next Event
- Auto Play
- Reset
- Event injection

But make the context obvious:

```text
BHOTE VALLEY EMERGENCY SIMULATION

Simulation time: T+180 min
Events processed: 13 / 26
Latest event: Bridge status changed
Conflicts detected: 1
```

When the user advances the simulation, show a concise event result:

```text
EVENT PROCESSED

Bhote Koshi Main Bridge
OPEN → BLOCKED

Priorities recalculated
2 plans affected
1 new recommendation
```

This makes the simulation understandable to the jury.

---

# PHASE L — BOB INTERFACE

Keep the existing Bob AI interface.

Position it as an operational intelligence assistant, not a generic chatbot.

Show example prompts:

- “Why is Gorkhe Gaun high priority?”
- “Which resources can reach Gorkhe Gaun?”
- “What changed after the bridge blockage?”
- “Which decisions need review?”
- “Show conflicting evidence.”

Responses must come from actual backend/MCP tools and current state.

Do not let Bob invent operational state.

The UI should make it clear that Bob helps the operator query and understand the situation.

---

# PHASE M — BENCHMARK UX

Keep benchmark metrics, but move them into a collapsible `Performance` section.

Primary operational screen should prioritize:

- situation
- priority
- evidence
- recommendation
- resource
- plan change

Benchmark can show:

- AI coverage
- baseline coverage
- travel time
- travel saving
- conflicts
- confidence
- unmet demand
- replanning events

Do not present placeholder benchmark numbers.

Use actual latest benchmark results only.

---

# PHASE N — LOADING / ERROR / EMPTY STATES

Every major panel must have clear states:

Loading:
> Loading current situation…

Error:
> Unable to refresh situation. Last successful update: 09:31.

No recommendation:
> No response recommendation currently requires review.

No evidence:
> No verified evidence available for this entity.

No affected plans:
> No existing response plans were affected by this update.

Never show a blank panel when a meaningful status can be displayed.

---

# PHASE O — RESPONSIVE / VISUAL CLEANUP

Keep the existing dark EOC aesthetic.

Improve:

- typography hierarchy
- spacing
- panel density
- readable labels
- consistent status badges
- button hierarchy
- clear primary action
- reduced technical abbreviations
- reduced unnecessary borders/noise

Primary actions should be visually obvious.

Do not perform a complete visual redesign.

---

# PHASE P — FRONTEND DATA ARCHITECTURE

Create or update typed API models for:

- Situation
- PriorityItem
- EvidenceSummary
- Observation
- Resource
- Recommendation
- OperatorDecision
- PlanChange
- BenchmarkMetrics
- SimulationEvent

Keep API access centralized.

Do not scatter fetch logic throughout components.

Do not maintain duplicate copies of authoritative backend state unless necessary for UI transitions.

Use backend responses as the source of truth.

---

# PHASE Q — TESTING

Before declaring completion:

1. Run existing frontend tests.
2. Run production build.
3. Verify TypeScript compilation.
4. Test initial load.
5. Test entity selection.
6. Test evidence display.
7. Test recommendation display.
8. Test accept/reject.
9. Test simulation event progression.
10. Test a road/bridge change.
11. Verify affected-plan alert.
12. Verify before/after recommendation.
13. Verify backend-persisted decision status.
14. Verify resource-task relationship.
15. Verify Bob queries.
16. Verify benchmark.
17. Verify reset.
18. Verify no fake/locally invented operational state.

If frontend test infrastructure is absent, perform a complete manual end-to-end test and document it.

---

# PHASE R — FINAL DEMO FLOW

The final UI must support this clean 90-second story:

### 1. Establish situation

“Bhote Valley is currently at T+180 minutes.”

### 2. Identify priority

“Gorkhe Gaun has 750 people affected and high urgency.”

### 3. Show uncertainty

“The system has evidence of isolation, but confidence is low, so verification matters.”

### 4. Show recommendation

“The system identifies a feasible rescue resource and explains why.”

### 5. Human decision

“An operator reviews and accepts the recommendation.”

### 6. Change the world

“Now the Bhote Koshi Main Bridge becomes blocked.”

### 7. Detect impact

“The system identifies that an existing plan is affected.”

### 8. Replan

“The route/resource recommendation changes because the previous route is no longer feasible.”

### 9. Human review again

“The operator reviews and accepts the revised plan.”

### 10. Ask Bob

“Why did the plan change?”

Bob explains the change using the current operational state.

This demonstrates:

**Evidence → Uncertainty → Priority → Recommendation → Human Decision → Change → Replanning → Explainability**

---

# PHASE S — ACCEPTANCE CRITERIA

The implementation is complete only when:

- Nepal/Bhote Valley remains the active scenario.
- Existing backend logic remains authoritative.
- No frontend decision logic duplicates backend engines.
- Priority queue is understandable without knowing internal score abbreviations.
- Recommendations are prominently visible.
- Human accept/reject workflow works through the backend.
- Evidence confidence/freshness/conflict are easy to understand.
- Resources are visibly connected to response tasks.
- Situation changes produce clear affected-plan alerts.
- Previous and updated plans can be compared.
- Replanning is visibly demonstrated.
- Bob can answer real operational questions.
- Benchmark data is real.
- Loading/error/empty states exist.
- Existing simulation controls remain functional.
- Production build passes.
- Existing tests/regressions pass.
- No fabricated operational information is introduced.
- Protected hackathon files remain untouched.

---

# OUT OF SCOPE

Do not:

- convert the scenario to Gujarat
- build a new routing engine
- build a new optimizer
- create a generalized incident-management platform
- add autonomous dispatch
- add generalized NLP extraction
- introduce ML just for appearance
- add SSE/WebSockets without backend support
- redesign the database
- replace the current map engine
- add unnecessary authentication/roles
- invent new resource types
- claim real-world disaster impact
- replace human emergency authority

The objective is not to make the application bigger.

The objective is to make the existing intelligence **visible, understandable and actionable**.
