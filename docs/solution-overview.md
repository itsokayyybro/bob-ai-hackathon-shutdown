# Solution Overview: AI Emergency Operations & Resource Orchestration System

## Design Philosophy

The system is built around a single principle: **uncertainty is not an obstacle to decision-making — it is an input to it**. Rather than waiting for a complete and consistent picture before surfacing recommendations, the system treats every observation as partial evidence, quantifies what is known and unknown, and produces the best available guidance given the current state of information — while making its confidence and reasoning transparent to the human operator who must ultimately act.

This distinguishes the system from both passive dashboards (which present data without reasoning) and autonomous AI systems (which act without adequate human oversight). It is designed as a **decision support layer**, not a replacement for human judgment.

---

## The Core Pipeline

### 1. Observation → Evidence

Raw inputs arrive from multiple heterogeneous sources: field officer radio reports, drone imagery feeds, community health volunteer messages, satellite imagery, weather sensor readings, and historical baseline records. Each observation is tagged with:

- **Source type** — with an associated baseline reliability score
- **Timestamp** — used to compute information age and freshness decay
- **Confidence** — as reported by the source or inferred from source type
- **Subject** — the location, infrastructure element, or population it pertains to

No observation is discarded. No observation is trusted unconditionally.

### 2. Evidence Fusion with Uncertainty

Multiple observations about the same subject are fused into a single evidence record using a weighted combination. Each observation's contribution is governed by:

```
weight = source_reliability × confidence × freshness
freshness = exp(-λ × age_hours)
```

The exponential decay function ensures that a 6-hour-old field report contributes less than a 30-minute-old drone observation, even if the field officer is a generally reliable source. The decay rate λ is configurable per observation category — infrastructure status decays faster than population estimates, for instance.

When observations conflict — one source reports a bridge as intact, another reports it as damaged — the system does not silently pick a winner. It records the **conflict explicitly**, computes a weighted consensus value, and preserves the conflict metadata so that operators can see exactly why confidence in that subject is low.

### 3. Situation Assessment

Fused evidence feeds into a **situation model**: a continuously updated representation of each affected location's state. For each location, the situation model tracks:

- Estimated population at risk (with uncertainty bounds)
- Infrastructure accessibility (road, bridge, and route status)
- Medical severity (injuries, disease risk, medical supply status)
- Resource presence (what teams and supplies are currently allocated)
- Time since last reliable report

The situation model is the system's working memory. It is the basis for all downstream reasoning.

### 4. Impact and Priority Scoring

Each location receives a **criticality score** based on five normalized factors:

```
criticality = 0.25×population + 0.25×service_need + 0.20×time_sensitivity
            + 0.15×isolation + 0.15×damage_severity
```

This is combined with operational factors into a **priority score**:

```
priority = 0.30×criticality + 0.25×urgency + 0.20×impact
         + 0.15×accessibility + 0.10×confidence
```

Accessibility and confidence are included as first-class priority factors — a critically isolated village that can only be reached by a route with 0.3 confidence scores differently than one with a confirmed clear route.

### 5. Graph-Based Accessibility Engine

The transportation network is modeled as a weighted directed graph. Edge weights encode not just distance and travel time but **current accessibility probability** — a value between 0 and 1 derived from the fused evidence about each road segment, bridge, and chokepoint. Weights are recalculated continuously as new observations arrive.

Route planning uses modified shortest-path algorithms that incorporate accessibility probability thresholds. A coordinator can query: "What is the fastest route to Sindhupalchok North with at least 0.7 route confidence?" The engine returns not just a route but the confidence breakdown of each segment, the expected travel time, and alternative routes ranked by the confidence/time tradeoff.

This is fundamentally different from conventional routing: the system models **what we know, what we don't know, and how that uncertainty affects operational decisions**.

### 6. Constrained Resource Optimization

Given the situation model, priority scores, and accessibility graph, the system formulates a **resource allocation problem**: assign available teams and supplies to locations in a way that maximizes expected impact subject to capacity, travel time, and availability constraints.

The optimizer accounts for:
- Resource type matching (medical teams to medical incidents, engineering teams to infrastructure failures)
- Travel time feasibility given current accessibility
- Resource capacity limits
- The possibility of cascading failures if high-priority locations are left unattended

The output is a set of **allocation recommendations** with explicit rationale — not just "send Team A to Location X" but "send Team A to Location X because it has priority 0.87, is the only location within range for medical response, and the route has 0.81 confidence."

### 7. Continuous Replanning

The system does not produce a one-time plan. As new observations arrive, evidence is re-fused, situations are reassessed, priority scores are recalculated, and the optimizer re-runs. If a previously dispatched team's route becomes inaccessible while they are en route, the system flags the conflict and surfaces an updated routing recommendation. Operators receive proactive alerts when situations cross configurable thresholds.

---

## IBM Bob MCP Integration

The system exposes its full analytical capability through an **MCP (Model Context Protocol) server** integrated with IBM Bob. This means coordinators can interact with the live operational picture using natural language:

> *"Which location has the highest priority right now and why?"*
> *"What routes are available to Balephi Junction with confidence above 0.7?"*
> *"Assign medical team 2 to the highest-priority unserved medical incident."*
> *"Show me all observations about the Tatopani bridge from the last 2 hours."*

Bob does not have direct write access to the simulation state. All actions are surfaced as **recommendations that a human operator must confirm** before they are applied. This preserves the human-in-the-loop design while removing the latency of manual data synthesis.

---

## Human-in-the-Loop Design

Every recommendation produced by the system includes:
- The score or value that triggered it
- The evidence inputs that produced that score
- The confidence level
- Any active conflicts in the underlying evidence

Operators can accept, modify, or reject any recommendation. Accepted recommendations update the simulation state, which feeds back into the evidence model and triggers a replanning cycle. Rejected recommendations are logged with operator rationale, creating a record that can be reviewed post-incident.

---

## What Makes This Different

| Capability | Dashboard | Chatbot | GIS Router | This System |
|---|---|---|---|---|
| Fuses conflicting evidence | ✗ | ✗ | ✗ | ✓ |
| Models information age/decay | ✗ | ✗ | ✗ | ✓ |
| Dynamic accessibility scoring | ✗ | ✗ | Partial | ✓ |
| Multi-resource optimization | ✗ | ✗ | ✗ | ✓ |
| Proactive replanning | ✗ | ✗ | ✗ | ✓ |
| Natural-language interface | ✗ | ✓ | ✗ | ✓ |
| Human-confirmed actions | N/A | Varies | N/A | ✓ |
| Transparent reasoning | ✗ | Partial | ✗ | ✓ |

The system does not replace the GIS dashboard, the chatbot, or the routing tool. It integrates and reasons across all of them — and adds the analytical layer that turns data into defensible, confidence-weighted, continuously updated operational guidance.
