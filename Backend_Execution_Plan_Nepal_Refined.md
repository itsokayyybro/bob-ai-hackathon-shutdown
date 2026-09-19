
# Backend Execution Plan — Nepal Scenario
## AI Emergency Operations & Resource Orchestration System

This plan is the authoritative backend implementation guide for the next implementation pass.

Important context:
The existing Nepal/Bhote Valley scenario is intentionally retained.

The Gujarat flood scenario, Gujarat terminology, and India-specific operational examples are CONTEXT ONLY. They are useful for explaining the general disaster-response problem and evaluation story, but they must NOT replace the current Nepal scenario.

Do not convert the scenario to Gujarat.

Do not rename Nepal locations to Gujarat locations.

Do not introduce Gujarat-specific entities into the running scenario.

The final working demo remains the Nepal-inspired Bhote Valley emergency scenario.

---

## 1. Implementation objective

Evolve the existing Nepal scenario-driven emergency operations system into a complete operator decision-support workflow without replacing its working reasoning engines.

Target flow:

Nepal scenario events
→ observations
→ evidence fusion
→ conflict/freshness
→ accessibility
→ prioritization
→ resource optimization
→ response recommendation
→ human review/action
→ new information
→ affected-plan detection
→ automatic replanning
→ updated recommendation

The existing architecture is strong. The work should be additive and focused.

---

## 2. Protected IBM repository rules

Do NOT modify:

- `.github/workflows/validate.yml`
- `submission.yaml`, unless explicitly required later for final submission metadata
- required template files/folders
- validation infrastructure

Do not rename or delete required Bobathon files.

Do not rewrite the backend framework.

Do not replace existing engines.

Do not introduce fake API responses.

Do not hard-code recommendations.

Do not modify template infrastructure simply to simplify development.

Keep changes primarily within the existing application, tests, scenario data, MCP implementation, and documentation where required.

---

## 3. Existing backend capabilities to preserve

The audit confirms the current backend already provides:

- FastAPI
- SQLite persistence
- ObservationDB
- decision/audit persistence
- source-aware evidence fusion
- confidence calculation
- freshness decay
- conflict detection
- EvidenceSummary
- NetworkX graph routing
- road/bridge accessibility
- deterministic priority scoring
- explainable priority factors
- capability-aware resource optimization
- continuous full replanning
- deterministic AI provider
- optional watsonx.ai / Granite integration
- benchmark comparison against a nearest-resource baseline
- approximately 64 automated tests
- 14 real MCP tools

These are not prototypes to replace. They are the core implementation.

---

# 4. Phase B0 — Baseline inspection

Before changing code:

1. Run the complete backend test suite.
2. Inspect `main.py`.
3. Inspect domain models.
4. Inspect DB/ORM models.
5. Inspect simulation engine.
6. Inspect evidence fusion.
7. Inspect priority engine.
8. Inspect graph engine.
9. Inspect resource optimizer.
10. Inspect decision/audit persistence.
11. Inspect benchmark.
12. Inspect MCP server.
13. Inspect scenario loading/seed.
14. Verify current API responses.

Create a concise internal map of exact files/functions that need modification.

Do not change engines during this inspection.

---

# 5. Phase B1 — KEEP THE NEPAL SCENARIO

This is a deliberate decision.

The current scenario remains:

- Bhote Valley
- Nepal-inspired emergency scenario
- existing villages/assets
- existing Nepal coordinates
- existing roads
- existing bridges
- existing resources
- existing 13-event sequence unless changes are genuinely needed

Do NOT create `scenario_gujarat_flood.json`.

Do NOT rename the existing scenario to Gujarat.

Do NOT replace Nepal place names.

The scenario is simulated and should be presented as such.

The refined problem context is domain context, not a requirement that the demonstration geography must be Gujarat.

The backend must therefore remain geographically generic while the active demo remains Nepal.

---

# 6. Phase B2 — Make scenario metadata clean

The backend should expose the scenario consistently.

Where appropriate, return metadata such as:

- scenario name
- scenario type
- geography
- simulation status
- current simulation time
- current event index

Example:

Scenario:
`Bhote Valley Emergency Simulation`

Geography:
`Nepal-inspired`

Do not scatter scenario strings throughout business logic.

If the existing scenario JSON already provides metadata, use it.

If not, centralize it without redesigning the architecture.

---

# 7. Phase B3 — Complete human decision capture

This is the most important backend functional gap.

Current situation:

The system produces recommendations and `DecisionExplanation`, but the operator's explicit acceptance/rejection is not captured through the main application flow.

Implement a backend endpoint consistent with the existing API design.

Preferred form:

`POST /decisions/{decision_id}/confirm`

Request:

- `status`: accepted | rejected | modified
- `operator_notes`: optional

Only support `modified` if the current decision/resource model can represent it cleanly.

Do not build a large workflow system.

The endpoint must:

1. Validate the decision exists in the database.
2. Validate the requested status is one of: `accepted`, `rejected`, `modified`.
3. Persist operator action by updating `DecisionDB` with new columns: `operator_status` (string) and `operator_notes` (text, nullable).
4. Preserve the original `recommended_action` and all evidence fields unchanged.
5. Store optional notes in `operator_notes`.
6. Write an `AuditRecord` with `event_type="operator_decision"`, `entity_id` from the decision's `target_entity_id`, `previous_state={"operator_status": null}`, `new_state={"operator_status": status, "notes": operator_notes}`, `decision_id`.
7. Return the full updated decision including the new `operator_status` field.

The `DecisionDB` ORM model requires two new nullable columns:

```
operator_status: String, nullable=True, default=None
operator_notes:  Text,   nullable=True, default=None
```

The `GET /decisions` and `GET /decisions/{id}` responses must include these fields so the frontend can display operator action status.

---

# 8. Phase B4 — Preserve recommendation history

Do not overwrite a recommendation when the system replans.

The system must distinguish:

SYSTEM RECOMMENDATION
from
OPERATOR DECISION
from
NEW SYSTEM RECOMMENDATION

Example:

Decision D-104:
Recommended → Ambulance A2

Operator:
Accepted

Later:
Bridge B2 becomes blocked

System:
Previous plan affected

New recommendation:
Ambulance A3

The historical acceptance must remain visible in the audit trail.

Implementation requirement:
When `_run_optimizer()` generates new decisions after a replan, it must insert new `DecisionDB` rows rather than updating existing ones. Existing rows with an `operator_status` already set must never be overwritten.

Do not turn the system into an immutable event-sourcing architecture. Use the existing DB/audit structures.

---

# 9. Phase B5 — Detect affected response plans

The existing simulation already performs:

fuse
→ recalculate priority
→ regenerate tasks
→ optimize

Keep this.

Add a lightweight comparison around the existing response plan.

Before event:
capture previous `ResponsePlan` (specifically its `allocations` list: each entry has `task_id`, `resource_id`, `estimated_arrival_min`, and `route.feasible`).

After event:
generate new `ResponsePlan`.

Compare them.

Return a list of `PlanChange` objects for meaningful changes only.

Each `PlanChange` must contain:

- `task_id`
- `entity_id` (from the task's `target_entity_id`)
- `previous_resource_id`
- `new_resource_id`
- `previous_eta_min` (if available)
- `new_eta_min` (if available)
- `previous_route_feasible` (bool)
- `new_route_feasible` (bool)
- `change_reason` (string — human-readable, e.g. "Bridge B2 blocked, route infeasible")
- `triggering_event_id` (the event that caused the replan)
- `triggering_event_type` (string)
- `affected_infrastructure_id` (the road/bridge/entity whose status changed, if identifiable)
- `review_required` (bool — True if `new_route_feasible` is False where it was previously True, or if resource changed)

**`review_required` must be True when:**
- a previously feasible route is now infeasible for the assigned resource
- a resource assignment changed (different `resource_id`)

**`review_required` must be False when:**
- only ETA changed within a minor threshold (e.g., < 10%)
- no allocations changed

Do NOT implement a second optimization system.

Do NOT duplicate routing logic.

The existing optimizer remains authoritative.

---

# 10. Phase B6 — Expose replan changes through simulation APIs

For:

- `/simulate/next`
- `/simulate/event`

return the existing response plus the replan comparison result.

The response structure must be:

```json
{
  "status": "event_processed",
  "event": { ... },
  "situation_update": { ... },
  "plan_changes": [
    {
      "task_id": "...",
      "entity_id": "...",
      "previous_resource_id": "...",
      "new_resource_id": "...",
      "previous_eta_min": 0.0,
      "new_eta_min": 0.0,
      "previous_route_feasible": true,
      "new_route_feasible": false,
      "change_reason": "...",
      "triggering_event_id": "...",
      "triggering_event_type": "...",
      "affected_infrastructure_id": "...",
      "review_required": true
    }
  ],
  "affected_decision_ids": ["DEC-XXXXX", "DEC-YYYYY"]
}
```

`plan_changes` is the full list of `PlanChange` objects defined in B5.

`affected_decision_ids` is the list of `DecisionDB.id` values whose `target_entity_id` matches any entity affected by the plan changes. This allows the frontend to highlight specific decisions that require re-review.

If there are no plan changes, return `plan_changes: []` and `affected_decision_ids: []`.

Keep the API backward compatible: `situation_update` continues to carry all existing fields.

Existing frontend functionality must continue to work.

---

# 11. Phase B7 — Recommendation API contract

Verify that the frontend can retrieve current response decisions containing all fields required by the evaluation criteria.

The `/plan` endpoint already returns `ResponsePlan` which includes `allocations` and `decisions`. The `/decisions` and `/decisions/{id}` endpoints return `DecisionDB` rows. Verify these together cover:

- `decision_id`
- `task_id` (from allocation's `task_id`)
- `target_entity_id` (the incident/asset)
- `resource_id`
- `resource_type` (join from resources if not in DecisionDB — or include from the plan allocation)
- `capability` (from resource capabilities — include in plan response if not already present)
- `route_feasible` (bool, from `AllocationResult.route.feasible`)
- `estimated_arrival_min`
- `priority_score`
- `explanation` (from `DecisionExplanation.reasons` list)
- `supporting_factors` (list — from `PriorityScore.supporting_factors` for the target entity)
- `human_verification_required` (bool, always True)
- `operator_status` (from B3 — null if not yet acted on)
- `last_evidence_verified` (the most recent `EvidenceSummary.last_verified` timestamp across all evidence for the target entity — required by Eval Doc Screen 3 "Last field verification: 11 minutes ago")
- `target_entity_accessibility` (the `accessibility_factor` from `PriorityScore` for the target entity — required by Eval Doc Screen 3 "Ground route blocked")

**Conflict with original B7:**
The original plan listed `supporting_factors` and `explanation` but omitted `last_evidence_verified` and `target_entity_accessibility`. These two fields are explicitly required by the Evaluation Documentation (Screen 2: "Current confidence/freshness"; Screen 3: "Last field verification" and "Ground route blocked"). They must be included.

If `/plan` or an existing decision endpoint already provides this, reuse it.

Do not create duplicate recommendation logic.

The existing `PriorityScore` already carries `accessibility_factor` and `confidence_factor`. The `EvidenceSummary` already carries `last_verified`. Retrieve these from `world_state` when building the plan/decision response — do not re-query.

---

# 12. Phase B8 — Evidence/provenance preservation

Do not weaken the existing evidence model.

Every recommendation/change should remain traceable to actual state.

Preserve:

- observation IDs
- source type
- source ID
- raw text
- timestamp
- confidence
- freshness
- supporting observations
- conflicting observations
- EvidenceSummary
- triggering event

The LLM must never become the authoritative source of evidence.

---

# 13. Phase B9 — Incident/correlation scope

Do NOT claim or implement a huge generic incident-resolution engine.

The current backend already groups observations by:

`entity_id + observation_type`

and fuses them.

That is sufficient for the current implementation if described accurately.

Do not add semantic incident matching unless it is genuinely needed for the Nepal scenario and can be implemented without destabilizing the existing system.

The backend should accurately describe the current behavior as:

"Multiple observations for the same operational entity are fused into an evidence summary."

Do not claim automatic discovery of completely unrelated reports as the same incident.

**Clarification required by Evaluation Documentation alignment:**

The Evaluation Documentation §3.3 Step 3 uses the Bridge X multi-report example (police report + citizen report + field team report, all fused into one operational entity) as the canonical illustration of incident correlation. The Nepal scenario already demonstrates this through EVT-003 and EVT-004 (two conflicting field reports for bridge B1). This must be explicitly called out in the API documentation and demo guide as satisfying the multi-source correlation requirement. The implementation is correct; the description must be accurate so evaluators can verify it.

Specifically: the `/evidence/{entity_id}` endpoint already returns `evidence_summaries` (fused) and `raw_observations` (all individual reports). The demo guide must reference this endpoint when demonstrating multi-source correlation for B1.

---

# 14. Phase B10 — Free-text scope

Do not implement a general NLP extraction engine merely because the broader context mentions free-text reports.

Current raw text is valuable as provenance.

Preserve it.

If a small structured extraction capability already fits the architecture, it may be considered later, but it is NOT a P0 requirement.

Do not allow LLM extraction to directly modify authoritative state without validation.

**Clarification required by Evaluation Documentation alignment:**

The Evaluation Documentation §6.3 states that AI should assist with "extracting structured facts from free-text reports; semantic incident matching; summarizing large evidence sets; explaining contradictory observations; answering natural-language operational questions; generating human-readable situation briefs."

The existing system already satisfies the latter four items through:

- `DeterministicProvider.generate_situation_summary()` — generates human-readable situation briefs from actual state
- `DeterministicProvider.explain_decision()` — explains contradictions and decisions
- `DeterministicProvider.answer_operator_question()` — answers natural-language operational questions
- `WatsonxProvider` — uses IBM Granite for the same three functions when credentials are available

This existing AI provider capability satisfies the Evaluation Documentation's AI usage requirement for summarization and explanation. The only AI task being explicitly deprioritized here is free-text NLP extraction (structured fact extraction from unstructured input). This distinction must be stated clearly in documentation so judges see that the AI usage boundary is deliberate, not an omission.

---

# 15. Phase B11 — Resource state integrity

Preserve the current resource optimizer.

Ensure:

- unavailable resources cannot be newly assigned
- capability constraints remain enforced
- route feasibility remains enforced
- bridge/road restrictions remain enforced
- current assignments affect availability correctly

The existing vehicle/bridge capability logic is an important demonstration asset.

Do not add boats merely because a generic flood narrative could use them.

Use the existing Nepal resource types.

---

# 16. Phase B12 — Nepal scenario event sequence

Keep the current Nepal event structure unless a test or demo requirement identifies a concrete issue.

The implementation should demonstrate all 12 steps from Evaluation Documentation §6.1:

1. A flood scenario begins. ← EVT-001 (normal state) + EVT-002 (flood detection)
2. Multiple reports enter the platform. ← EVT-003 + EVT-004 (two B1 bridge reports)
3. Reports come from different source types. ← field_report + satellite in same scenario
4. The system normalizes them. ← evidence_fusion._normalize_value()
5. Duplicate/correlated reports are fused. ← EvidenceSummary for B1 with 2 supporting observations
6. At least one contradiction is introduced. ← EVT-004 conflicting bridge report
7. The system shows uncertainty. ← EvidenceSummary.conflict_status = CONFLICTING
8. An affected location is linked to accessibility. ← _compute_accessibility() + accessibility_factor in priority
9. A resource is matched to the incident. ← optimize_allocation() after EVT-006 (HP1 overloaded)
10. The operator reviews the recommendation. ← POST /decisions/{id}/confirm (B3)
11. A new report changes the situation. ← EVT-008 (B2 confirmed blocked) or EVT-005 (R7 blocked)
12. The system updates the incident and flags affected decisions. ← B5 plan_changes + B6 affected_decision_ids

The mapping of existing events to evaluation steps must be documented in the demo guide.

Do not fabricate Gujarat events.

---

# 17. Phase B13 — MCP correctness

The 14 MCP tools are a major existing strength.

Verify all tools continue to work.

**Fix the MCP `entity_name` bug in all three locations where it occurs in `server.py`:**

1. `get_current_situation()` — line ~84: `p['name']` must be changed to `p['entity_name']`
2. `simulate_event()` — line ~335: `top[0]['name']` must be changed to `top[0]['entity_name']`
3. `simulate_next_event()` — line ~374: `p['name']` must be changed to `p['entity_name']`

All three locations reference the same `/situation` endpoint's `top_priorities` list, which returns `entity_name` (not `name`) per the `PriorityScore` model.

Do not change the tool set unnecessarily.

The tools should continue to call real FastAPI endpoints.

No hard-coded responses.

---

# 18. Phase B14 — MCP path portability

The audit reports absolute paths in `mcp_config.json`.

Fix portability only if the current IBM submission structure permits it without violating protected template files.

Preferred approach:

- project-relative script path
- environment-resolved Python executable
- clear setup documentation

Do not make the MCP config depend on a specific developer workspace such as `/workspaces/...`.

Do not alter `.github/workflows/validate.yml`.

---

# 19. Phase B15 — IBM Bob boundary

The architecture should remain:

Bob/MCP
→ backend operational APIs
→ deterministic engines
→ real state

Bob should not directly calculate authoritative priority or resource allocation.

The AI provider may explain:

- situation
- evidence
- priority
- recommendations
- changes

The deterministic engines remain authoritative for:

- confidence calculation
- conflict detection
- priority
- route feasibility
- resource capability
- optimization

---

# 20. Phase B16 — Benchmark

Preserve the existing benchmark.

Run it after implementation.

Capture actual values for:

- coverage rate
- total travel time
- weighted response time
- conflict detection rate
- blocked-route violations
- decision confidence
- resource utilization
- unmet critical demand
- replanning events

Do not invent target results.

Do not state that benchmark results prove real-world disaster impact.

They demonstrate prototype behavior under the Nepal scenario.

---

# 21. Phase B17 — Testing

Add tests for every backend change.

### Decision tests

- accept works: `POST /decisions/{id}/confirm` with `status=accepted` persists `operator_status=accepted`
- reject works: `POST /decisions/{id}/confirm` with `status=rejected` persists `operator_status=rejected`
- modified works if supported: `POST /decisions/{id}/confirm` with `status=modified` and `operator_notes` persists correctly
- invalid ID returns 404
- invalid status (not `accepted`/`rejected`/`modified`) returns 422
- action is persisted: re-fetch decision and verify `operator_status` is set
- audit record is written: `GET /audit` contains an entry with `event_type=operator_decision` referencing the decision
- original recommendation is unchanged: `recommended_action`, `reasons`, `confidence` remain identical after confirm

### Replanning tests

- **same plan produces empty plan_changes**: inject an event that does not change any route or resource assignment; verify `plan_changes == []` in the response
- resource reassignment is detected: make RT2 unavailable; verify the task previously assigned to RT2 has a `PlanChange` with `previous_resource_id=RT2`
- route change is detected: block a road that an existing allocation's route uses; verify a `PlanChange` with `new_route_feasible=False`
- blocked infrastructure triggers `review_required=True`: block B2; verify affected allocation `PlanChange.review_required == True`
- previous operator decision is preserved: accept a decision, then trigger a replan; verify the accepted decision's `operator_status` is unchanged and a new decision row exists for the new assignment
- affected_decision_ids is populated: block infrastructure affecting an active decision; verify `affected_decision_ids` contains that decision's ID
- `plan_changes` is empty list when no tasks exist: reset simulation before any events; verify empty

### Scenario tests

- Nepal scenario loads: `GET /entities` returns >= 14 assets with Nepal coordinates
- existing entities remain valid: H1, B1, B2, R7, CC1, V3 all present
- existing event sequence works: process all 13 events without error
- graph routing works: CC1 → H1 feasible initially, infeasible after B1 blocked
- resource optimization works: after EVT-006 (HP1 overloaded), a MEDICAL_RESPONSE task is assigned to an ambulance
- conflict detection works: after EVT-003 + EVT-004, `GET /evidence/B1` shows `conflict_status=conflicting`

### MCP tests

- all 14 tools respond without error when backend is running
- corrected `entity_name` field: `get_current_situation()` and `simulate_next_event()` return `entity_name` (not `name`) in priority objects
- `get_entity_evidence()` returns both `evidence_summaries` and `raw_observations` for B1 after conflict events
- `mcp_config.json` does not contain absolute `/workspaces/` paths

### Regression

Run the entire existing suite.

Do not delete tests to make the implementation pass.

---

# 22. Backend acceptance criteria

Complete backend implementation only when:

- Nepal scenario remains unchanged in geography and identity
- evidence fusion still works
- conflict detection still works
- freshness still works
- routing still works
- prioritization still works
- optimization still works
- continuous replanning still works
- recommendations are accessible through API with `last_evidence_verified` and `target_entity_accessibility` fields (B7)
- operator acceptance/rejection is persisted via `POST /decisions/{id}/confirm` (B3)
- audit history records operator action with `event_type=operator_decision` (B3)
- plan changes can be detected with `review_required` flag (B5)
- `plan_changes` and `affected_decision_ids` are returned by simulation endpoints (B6)
- MCP entity_name bug is fixed in all three locations in `server.py` (B13)
- MCP configuration is portable, no absolute workspace paths (B14)
- benchmark runs and produces real metric values
- all tests pass
- protected IBM files remain untouched

---

# 23. Explicitly out of scope

Do NOT implement:

- Gujarat scenario conversion
- Gujarat-specific source types solely for naming
- utility-grid simulation
- full NGO platform
- autonomous dispatch
- generalized NLP incident resolution
- new ML models
- SSE/WebSockets
- new routing engine
- new optimizer
- authentication redesign
- database redesign

The objective is to make the existing Nepal system complete and demonstrable.
