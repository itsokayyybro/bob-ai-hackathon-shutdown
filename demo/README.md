# Demo Guide: Bhote Valley Emergency Simulation

## What This Demo Shows

The Bhote Valley Emergency Simulation is a scripted but live disaster response scenario. It runs as a real system — not a slideshow — with a running simulation engine, live SQLite state, and a connected IBM Bob MCP server. The scenario represents a synthetic six-hour monsoon flood event affecting seven villages in a Nepal-inspired mountainous corridor.

The demo demonstrates five capabilities in sequence:

1. **Evidence fragmentation and fusion** — multiple conflicting reports about the same bridge, resolved into a confidence-weighted evidence record with an active conflict flag
2. **Dynamic priority scoring** — locations ranked not just by need but by accessibility, urgency, and information confidence
3. **Graph-based accessibility routing** — route recommendations that reflect current road status, not pre-disaster assumptions
4. **Constrained resource optimization** — allocation recommendations across typed resources with rationale
5. **Natural-language operational queries via Bob** — the full analytical engine accessible through conversation

---

## Running the Demo

### Prerequisites

```bash
# Install backend dependencies
cd backend && pip install -r requirements.txt

# Install frontend dependencies
cd frontend && npm install
```

### Start the System

```bash
# Terminal 1: start the simulation engine + FastAPI backend
cd src/backend && PYTHONPATH=$(pwd) python3 -m uvicorn app.main:app --reload --port 8000

# Terminal 2: start the React dashboard
cd src/frontend && npm run dev

# Terminal 3: start the MCP server (connects Bob to the backend)
cd src/mcp && python3 server.py
```

### Advance the Simulation

The simulation starts at T+0 (flood onset). Use the dashboard's **Next Event** button or the API directly to step through the scenario:

```bash
# Advance by one event
curl -X POST http://localhost:8000/simulate/next

# Auto-run all events
curl -X POST http://localhost:8000/simulate/auto
```

Key scenario moments to demonstrate:
- **T+0 to T+1h**: Initial reports arrive, several locations have low-confidence status
- **T+1h to T+3h**: Conflicting bridge reports trigger active conflict flags; priority scores shift
- **T+3h to T+6h**: Resources dispatched, routes degrade, replanning events fire

---

## Bob Natural-Language Demo Script

Open IBM Bob with the MCP server connected. Run these queries in sequence to walk through the demo narrative.

| Query | Expected Answer Type |
|---|---|
| *"What is the current status of the simulation?"* | Summary: elapsed time, active incidents, resources available |
| *"Which location has the highest priority right now?"* | Named location, priority score, top contributing factors |
| *"Why is Sindhupalchok North ranked above Tatopani?"* | Comparison of criticality and accessibility scores with evidence citations |
| *"What routes are available to Balephi Junction?"* | Ranked route list with per-route confidence and travel time |
| *"Are there any active evidence conflicts?"* | List of subjects with conflict flags, conflicting source summaries |
| *"What is the confidence score for the main bridge report?"* | Fused weight, contributing observations, freshness values |
| *"Which medical incidents are currently unserved?"* | Filtered incident list with priority scores |
| *"What is the recommended allocation for medical team 2?"* | Optimizer recommendation with rationale and route confidence |
| *"Assign medical team 2 to the highest-priority unserved medical incident."* | Confirmation prompt — requires operator approval before action is applied |
| *"Show me the allocation audit log for the last hour."* | Timestamped log of confirmed and rejected recommendations |

---

## Screenshot Placeholders

The following screenshots should be captured during a live demo run and inserted here:

- **Dashboard overview at T+3h** — map with sized/colored location markers, active alert panel visible
- **Evidence conflict panel** — showing the Tatopani bridge conflict with two opposing source entries
- **Priority score breakdown** — expanded view of Sindhupalchok North's scoring factors
- **Route recommendation panel** — three route options to Balephi Junction with confidence bars
- **Bob conversation panel** — natural-language query and structured response side by side

---

## Benchmark Demonstration

To demonstrate the improvement over manual prioritization, the demo includes a **baseline comparison mode** that replays the same scenario events with random resource allocation (simulating unassisted human triage under time pressure). The comparison shows:

- Priority-weighted coverage at T+6h: system allocation vs. random allocation
- Number of high-priority locations left unserved at T+6h under each approach
- Total route failures encountered (dispatches sent down inaccessible routes)

**All benchmark values are synthetic** and generated from the simulation itself. They are not derived from real incident data and are provided solely to illustrate the relative value of the evidence-fusion and optimization approach over unstructured allocation.
