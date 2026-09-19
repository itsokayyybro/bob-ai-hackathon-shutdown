# Repository-to-Problem Alignment Audit Prompt
## IBM BOB AI Hackathon — AI Emergency Operations & Resource Orchestration System

### Purpose

Use this document as the master prompt for an AI coding/repository agent such as IBM Bob.

The goal is to make the agent inspect the **entire existing repository as it currently exists**, understand what was actually implemented for the first round, compare that implementation against the newly clarified **AI Emergency Operations Evaluation Documentation**, identify where the current product genuinely solves the intended problem and where it does not, and then produce an actionable change plan.

This is an **audit and alignment task first**, not a rewrite task.

The agent must not assume that the current architecture, features, terminology, or implementation are correct merely because they exist. It must inspect the code and determine what the product actually does.

---

# MASTER PROMPT

You are performing a deep repository audit for an IBM BOB AI Hackathon project.

The project was developed for an earlier first-round understanding of a disaster-response problem. We have now clarified the problem substantially: the target is not “build a disaster dashboard” or “use AI for disaster management” in a generic sense.

The current target is:

> Build an AI-assisted operational intelligence layer for emergency operations that transforms fragmented, changing, and uncertain disaster information into an evidence-linked, continuously updated operational picture and resource recommendations, while keeping authorized human decision-makers in control.

Your task is to determine whether the **current repository execution actually implements that problem**.

You must inspect the complete repository before reaching conclusions.

Do not infer functionality from filenames, README claims, screenshots, comments, or intended architecture alone. Verify what is actually implemented in code.

---

# 1. REQUIRED CONTEXT

The project should be evaluated against the following clarified problem model.

## 1.1 Real operational problem

The disaster-response ecosystem already has agencies, emergency operations centres, warning systems, NDRF/SDRF, police, fire, health services, public works, utilities, NGOs, volunteers, GIS systems, and resource inventories.

The problem is not absence of information.

The problem is:

**information velocity + fragmentation + uncertainty + changing operational conditions + resource coordination + decision latency.**

During a disaster, information can arrive from multiple sources:

- weather and hazard-warning systems;
- rainfall/river/water-level observations;
- satellite/geospatial information;
- police;
- fire and rescue teams;
- NDRF/SDRF;
- district/taluka/local administration;
- hospitals and ambulances;
- public works and road authorities;
- electricity/water/telecommunications utilities;
- NGOs;
- trained volunteers;
- citizens;
- rescue/resource inventories.

These sources have different formats, timestamps, reliability, geographic resolution, and operational meaning.

The target system therefore needs to help transform:

**Reports → Evidence → Operational Context → Priority → Resource Feasibility → Human Decision → Continuous Update**

The system is not intended to replace the Collector, DEOC, SEOC, NDRF, SDRF, police, fire, medical authorities, NGOs, or field commanders.

---

# 2. PRIMARY AUDIT QUESTION

Answer this question:

> **Does the current implementation genuinely function as an AI-assisted emergency operational intelligence system, or is it primarily a dashboard / visualization / generic AI application that only describes this problem?**

Do not soften the answer.

If the current implementation only partially matches the clarified problem, explicitly say so.

If major parts are missing, identify them.

If some existing components already solve parts of the clarified problem well, preserve them and explain how they should be repositioned.

---

# 3. REPOSITORY INSPECTION — MANDATORY

Before giving any evaluation, inspect the complete repository.

You must inspect at minimum:

- all source-code directories;
- frontend;
- backend;
- API routes;
- services;
- models/schemas;
- database/data stores;
- seed/sample/simulation data;
- AI/LLM integration;
- IBM Bob integration;
- configuration;
- environment variables;
- authentication/authorization;
- mapping/geospatial code;
- dashboards;
- incident logic;
- resource logic;
- recommendation logic;
- alerting/change detection;
- tests;
- scripts;
- deployment files;
- documentation;
- README;
- screenshots/demo assets where available;
- existing problem statements;
- existing solution descriptions;
- architecture documentation.

Also inspect dependencies and configuration to determine what is really used versus merely declared.

Search for:

- TODOs;
- placeholders;
- mocked responses;
- hard-coded demo data;
- dead code;
- unreachable code;
- unused APIs;
- fake AI responses;
- static recommendations;
- manually encoded “AI” decisions;
- disconnected frontend/backend components;
- features documented but not implemented.

Do not trust documentation until it is validated against implementation.

---

# 4. BUILD A REAL SYSTEM MAP

After inspection, construct a concrete map of the current product.

For every major subsystem, identify:

1. What it does.
2. Where it is implemented.
3. What data it accepts.
4. What data it produces.
5. Whether it is actually connected to the rest of the system.
6. Whether it works dynamically or is hard-coded.
7. Whether AI is genuinely involved.
8. Whether the output affects an operational decision.

Create an internal flow similar to:

```text
INPUT
  ↓
INGESTION
  ↓
PROCESSING
  ↓
CORRELATION
  ↓
EVIDENCE / CONFIDENCE
  ↓
GEOSPATIAL / ACCESSIBILITY
  ↓
RESOURCE STATE
  ↓
PRIORITIZATION
  ↓
RECOMMENDATION
  ↓
HUMAN DECISION
  ↓
NEW INFORMATION
  ↓
REPLAN
```

Then map the actual repository implementation onto this flow.

Explicitly identify missing stages.

---

# 5. TRACE THE DATA END-TO-END

For each available input type, answer:

### Where does it originate?

Examples:

- simulated incident reports;
- CSV/JSON;
- API;
- database;
- user entry;
- external service;
- sensor feed;
- generated scenario.

### Where does it enter the system?

Identify:

- API endpoint;
- file loader;
- database table;
- frontend form;
- message/event queue;
- service.

### How is it processed?

Identify:

- validation;
- normalization;
- classification;
- extraction;
- enrichment;
- correlation;
- geolocation;
- confidence scoring;
- prioritization;
- AI reasoning.

### Where does it go?

Identify:

- database;
- internal service;
- recommendation engine;
- map;
- dashboard;
- alert;
- operator workflow.

### What happens afterward?

Determine whether the result:

- changes incident state;
- affects resources;
- creates a recommendation;
- changes priority;
- produces an operator action;
- creates an audit trail;
- triggers replanning.

If a flow stops at visualization, explicitly state that.

---

# 6. AUDIT THE CURRENT DATA SOURCES

Create a table for all actual input/data sources.

Use this structure:

| Current Source | Actual Implementation | Data Type | Frequency / Trigger | Realistic? | Supports Operational Problem? | Gap |
|---|---|---|---|---|---|---|

Classify each source as one or more of:

- real external source;
- simulated operational source;
- user-generated report;
- static dataset;
- hard-coded scenario;
- derived data;
- AI-generated data.

Do not treat simulation as a weakness by itself.

A hackathon prototype can legitimately simulate government/field feeds.

The key question is whether the simulated data behaves like the operational information problem we are trying to model.

---

# 7. AUDIT INCIDENT HANDLING

Determine whether the current implementation can represent an operational incident with at least:

```text
Incident ID
Type
Location
Timestamp
Source
Observation
Affected population
Need
Accessibility
Status
Evidence
Confidence
Last updated
```

Then verify which of these fields truly exist.

Do not give credit for fields that only appear in documentation.

Check whether multiple reports can:

- refer to one incident;
- update an existing incident;
- conflict;
- become stale;
- change incident state.

If every report simply becomes a separate card/row, identify that as a major gap.

---

# 8. AUDIT EVIDENCE, UNCERTAINTY, AND CONFLICT

This is one of the most important audits.

Determine whether the implementation can distinguish:

- confirmed information;
- reported information;
- conflicting information;
- stale information;
- low-confidence information.

Test or inspect scenarios such as:

```text
14:05 — Police: Road A blocked.
14:17 — Citizen: Road A open.
14:25 — Field team: Road A unsafe.
```

The system should ideally produce:

```text
Accessibility: UNCERTAIN
Recent evidence: field team + police
Contradicting evidence: citizen report
Last verified: 14:25
```

If the current system instead blindly overwrites the previous value, identify the problem.

If it uses an opaque score, explain whether the evidence behind the score is visible.

---

# 9. AUDIT RESOURCE COORDINATION

Determine whether the system models resources as operational entities rather than simply displaying a list.

Check whether a resource has attributes such as:

```text
Resource ID
Type
Capability
Location
Status
Availability
Current Assignment
Capacity
Last Updated
```

Then determine whether the product can answer:

> Which available resource can realistically respond to this incident?

Check:

- resource-to-incident matching;
- geographic feasibility;
- accessibility;
- resource availability;
- existing assignment;
- capability requirements;
- prioritization conflicts.

If resources are just displayed on a map without decision relevance, identify that.

---

# 10. AUDIT PRIORITIZATION

Determine exactly how the system decides that an incident is important.

Look for actual logic using variables such as:

- number of affected people;
- medical urgency;
- danger severity;
- accessibility;
- resource requirements;
- evidence confidence;
- information freshness;
- cascading consequences;
- current response status.

Determine whether priority is:

1. hard-coded;
2. rule-based;
3. ML-based;
4. LLM-generated;
5. hybrid.

Then inspect whether the rationale is shown to the user.

A black-box priority number without evidence is not enough for the clarified use case.

---

# 11. AUDIT CONTINUOUS REPLANNING

This is a critical differentiator.

Determine whether the current application reacts when new information changes the situation.

Example:

```text
Initial:
Bridge C accessible.
Ground rescue recommended.

New report:
Bridge C unsafe.

Expected:
Incident updates.
Accessibility changes.
Ground recommendation becomes invalid or lower-confidence.
Alternative resource/path is surfaced.
Operator is notified.
```

Inspect whether this actually happens.

If the product only refreshes the dashboard but does not reconsider previous recommendations, classify it as missing continuous replanning.

---

# 12. AUDIT USER INTERACTION

Identify the actual user.

Determine whether the current application is designed for:

- emergency coordinator;
- incident commander;
- field operator;
- public user;
- general dashboard viewer.

Then document the real user journey.

Answer:

1. What does the user see first?
2. What does the user need to understand?
3. What action can the user take?
4. What evidence is shown?
5. What happens after the user accepts/rejects a recommendation?
6. How does the system notify the user that the situation changed?

Compare the actual journey to:

```text
Situation overview
→ Incident details
→ Evidence / confidence
→ Priority
→ Resource feasibility
→ Recommendation
→ Human decision
→ Change alert
→ Replanning
```

---

# 13. AUDIT AI — DO NOT GIVE CREDIT FOR AI NAME-DROPPING

Identify every actual AI/LLM capability.

For each, answer:

- What model/service is used?
- Where is it called?
- What input reaches it?
- What output does it produce?
- Does that output affect system behavior?
- Is the output persisted?
- Can it be inspected/explained?
- Is the AI task actually useful for the operational problem?
- Could the feature be replaced by a static string without changing the product?

If replacing the AI call with a static JSON response would make no functional difference, flag that as weak AI integration.

Separate:

**AI used for development**
from
**AI used as part of the product.**

Both may be useful, but do not confuse them.

---

# 14. AUDIT IBM BOB USAGE

Inspect the repository and development artifacts for genuine Bob usage.

Determine:

- where IBM Bob contributed to implementation;
- whether Bob is used as an agent/development workflow;
- whether Bob-related integrations exist;
- whether Bob is part of the actual application experience;
- whether the implementation demonstrates meaningful Bob dependence;
- whether Bob is merely mentioned in documentation.

The conclusion must be evidence-based.

---

# 15. COMPARE AGAINST THE CLARIFIED EVALUATION CRITERIA

Evaluate the current execution against exactly six criteria.

## A. Problem Understanding — 20 points

Assess whether the implementation reflects:

- multi-source disaster information;
- uncertainty;
- conflicting reports;
- information freshness;
- operational context;
- resource constraints;
- accessibility;
- changing conditions;
- human decision-makers.

Do not award credit merely because the README says these things.

## B. Solution Effectiveness — 25 points

Assess whether the actual software:

- ingests relevant data;
- normalizes it;
- correlates incidents;
- handles uncertainty;
- detects conflicts;
- considers accessibility;
- matches resources;
- prioritizes incidents;
- explains recommendations;
- updates decisions when information changes.

## C. UX-Design — 15 points

Assess:

- clarity;
- cognitive load;
- information hierarchy;
- incident comprehension;
- evidence visibility;
- actionability;
- resource visibility;
- change awareness;
- operator workflow.

## D. Impact and Value — 20 points

Assess whether the current product could plausibly reduce:

- manual information consolidation;
- duplicate/conflicting-report confusion;
- stale situational awareness;
- time spent locating usable resources;
- decision latency.

Do not invent measured impact.

Separate:

**demonstrated impact**
from
**potential impact**.

## E. Execution Quality — 15 points

Assess:

- actual completeness;
- frontend/backend connectivity;
- reliability;
- error handling;
- testability;
- architecture;
- reproducibility;
- data flow integrity;
- deployment readiness;
- absence of mock-only functionality.

## F. IBM Bob Usage — 5 points

Assess whether Bob is genuinely used and load-bearing enough to be credible.

---

# 16. CREATE AN ALIGNMENT MATRIX

Produce this exact style of matrix:

| Clarified Requirement | Current Implementation | Evidence in Repo | Match | Severity | Required Change |
|---|---|---|---|---|---|
| Multi-source inputs | ... | file/function/API | FULL/PARTIAL/MISSING | Critical/High/Medium/Low | ... |
| Incident correlation | ... | ... | ... | ... | ... |
| Evidence provenance | ... | ... | ... | ... | ... |
| Conflict detection | ... | ... | ... | ... | ... |
| Freshness/staleness | ... | ... | ... | ... | ... |
| Accessibility | ... | ... | ... | ... | ... |
| Resource state | ... | ... | ... | ... | ... |
| Resource matching | ... | ... | ... | ... | ... |
| Explainable priority | ... | ... | ... | ... | ... |
| Human-in-the-loop | ... | ... | ... | ... | ... |
| Continuous replanning | ... | ... | ... | ... | ... |
| IBM Bob | ... | ... | ... | ... | ... |

Use only verified repository evidence.

---

# 17. IDENTIFY THE PRODUCT'S CURRENT REAL IDENTITY

After inspecting the repository, classify what the current product actually is.

Choose the most accurate description:

- Disaster visualization dashboard.
- Incident management dashboard.
- Resource management tool.
- AI incident assistant.
- Evidence-aware operational intelligence system.
- Hybrid system.
- Other.

Then explain why.

This is important because the team may discover that the current execution is not yet aligned with the newly clarified problem.

Do not force the product into the desired category.

---

# 18. IDENTIFY THE THREE LEVELS OF GAPS

Separate gaps into:

### Level 1 — Positioning gaps

The underlying functionality exists, but the problem framing, UX, naming, or flow does not communicate it.

Example:

The system already correlates incidents but calls itself a “Disaster Dashboard.”

### Level 2 — Functional gaps

The product claims a capability but implementation is incomplete.

Example:

The UI displays resource availability, but no actual incident-to-resource matching exists.

### Level 3 — Architectural gaps

The current architecture fundamentally cannot support the clarified workflow.

Example:

The system has no persistent incident identity, so reports cannot update or conflict with an existing incident.

This classification is essential because not every mismatch requires rebuilding the product.

---

# 19. GENERATE EFFECTIVE CHANGES

After the audit, generate changes in priority order.

Do NOT produce a giant feature wishlist.

Create:

## P0 — Must Fix

Changes required for the product to honestly claim it solves the clarified problem.

## P1 — High Impact

Changes that significantly improve solution effectiveness, UX, or evaluation performance.

## P2 — Demonstration Enhancements

Changes that strengthen the demo/story but are not fundamental.

## P3 — Nice to Have

Changes that should only be implemented if time remains.

For every proposed change include:

```text
Change:
Why it matters:
Current state:
Target state:
Files/components likely affected:
Dependencies:
Risk:
Expected evaluation impact:
How to demonstrate it:
```

---

# 20. PRIORITIZE CHANGES BY EVALUATION VALUE

Use this principle:

> Do not improve a feature merely because it looks impressive. Improve it because it closes a problem-solution gap.

Prioritize features that simultaneously improve:

- Problem Understanding;
- Solution Effectiveness;
- UX;
- Impact;
- Execution.

A small functional change that improves all five should be prioritized over a visually impressive feature that improves only the UI.

---

# 21. DEFINE THE TARGET END-TO-END DEMO

After auditing the repository, define the smallest complete scenario that proves the clarified problem.

The preferred scenario is a Gujarat flood simulation.

The target flow should be:

```text
Flood warning
      ↓
Multiple reports arrive
      ↓
Reports have different sources/timestamps
      ↓
Reports are normalized
      ↓
Same incident is correlated
      ↓
One contradiction occurs
      ↓
Confidence / evidence state changes
      ↓
Affected people + location identified
      ↓
Access constraint identified
      ↓
Available resource identified
      ↓
Recommendation generated
      ↓
Human operator reviews
      ↓
Situation changes
      ↓
Existing recommendation becomes affected
      ↓
System replans
```

The final demo should prove that the product is useful precisely because the situation changes and information is imperfect.

---

# 22. FINAL OUTPUT FORMAT

After repository inspection, return a report with exactly these sections:

## 1. Executive Verdict

Give a direct answer:

> Does the existing implementation actually match the clarified problem?

Use:

- Strong match;
- Partial match;
- Weak match;
- Fundamental mismatch.

Then explain why in concrete implementation terms.

## 2. What the Current Product Actually Does

Describe the implemented system based only on code evidence.

## 3. Current End-to-End Data Flow

Show:

```text
Actual input
→ actual processing
→ actual AI
→ actual storage
→ actual UI
→ actual user action
```

## 4. Requirement-by-Requirement Alignment

Use the alignment matrix.

## 5. Evaluation Criteria Assessment

For each of the six criteria give:

- current evidence;
- strengths;
- gaps;
- what prevents full credit.

Do not invent numeric scores unless explicitly requested.

## 6. Critical Gaps

List only the gaps that materially prevent the current system from solving the clarified problem.

## 7. Positioning Gaps

Identify cases where implementation may be better than the current explanation.

## 8. P0/P1/P2/P3 Changes

Prioritized and implementation-oriented.

## 9. Target Architecture

Describe the architecture required after the changes.

## 10. Target User Journey

Describe exactly what the emergency coordinator will do.

## 11. Target Gujarat Flood Demo

Give the exact scenario and sequence.

## 12. Final Recommendation

Answer:

> Should we preserve the current codebase and evolve it, partially refactor it, or fundamentally rebuild parts of it?

Base this on evidence from the repository.

---

# 23. RULES FOR THE AUDIT AGENT

Follow these rules strictly.

### Rule 1 — Inspect before judging.

Do not give a high-level assessment before reading the repository.

### Rule 2 — Code beats documentation.

If README says a feature exists but code does not implement it, mark it as not implemented.

### Rule 3 — Working behavior beats architecture diagrams.

A beautiful architecture diagram does not count as implementation.

### Rule 4 — Do not invent integrations.

If a government feed, sensor feed, API, or IBM service is simulated, explicitly call it simulated.

### Rule 5 — Do not overclaim AI.

An LLM response is not automatically an intelligent operational system.

### Rule 6 — Preserve what already works.

Do not recommend rewriting existing functioning components without a reason.

### Rule 7 — Separate prototype capability from real-world deployment.

A simulated disaster dataset can demonstrate the concept, but it must not be described as a live government integration.

### Rule 8 — Human authority remains central.

Recommendations should support authorized operators rather than pretending to autonomously command emergency responders.

### Rule 9 — Prefer end-to-end completeness over feature count.

One complete operational workflow is more important than many disconnected features.

### Rule 10 — Every proposed change must connect to an identified gap.

Do not add technology for its own sake.

---

# 24. SUCCESS CONDITION

The audit is successful only when the repository's current behavior can be clearly mapped to the clarified problem.

At the end, there should be no ambiguity about:

- where the data comes from;
- what the current system does with it;
- what AI actually does;
- what the operator sees;
- what decision the operator can make;
- what happens when new information arrives;
- what the current implementation already solves;
- what it does not solve;
- what must change before the project can honestly position itself as an AI-assisted emergency operational intelligence system.

The final objective is not to make the repository sound better.

The objective is to make the **implementation, problem statement, UX, and evaluation story all describe the same real system.**
