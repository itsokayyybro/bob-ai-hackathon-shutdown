# 🏔️ AI Emergency Operations & Resource Orchestration System

> **Bhote Valley Emergency Simulation** — Evidence-aware disaster response decision support  
> IBM Bob AI Hackathon Submission

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | shutdown |
| **Track** | Open |
| **Team Lead** | Om Prajapati — 24bsit130@charusat.edu.in |
| **Member** | Jeet Pandya — 24bca095@charusat.edu.in |
| **Member** | Prince Patel — 24bsit109@charusat.edu.in |
| **Member** | Darshan Mandalaywala — 24bca078@charusat.edu.in |

> ⚠️ **Note to judges:** Team member details require human completion before final submission. All technical content is complete and functional.

---

## 🎯 Problem Statement

Disaster response operations are overwhelmed by fragmented, uncertain, and rapidly changing information. When floods, earthquakes, or landslides strike, emergency coordinators receive simultaneous reports from satellites, field teams, hospitals, and community calls — many of which conflict. Without a system to fuse this evidence, assess confidence, map accessibility, and optimize limited resources against changing conditions, critical decisions are delayed, resources are misrouted, and lives are lost.

---

## 💡 Solution

We built an **evidence-aware operational decision engine** that transforms fragmented disaster observations into explainable, continuously updated response plans. The system fuses multi-source evidence with uncertainty quantification, detects conflicting reports, computes graph-based route accessibility, and optimizes resource allocation using deterministic constrained algorithms — all backed by real-time IBM Bob AI natural-language queries via MCP tools.

---

## ✨ Key Features

- **Multi-source Evidence Fusion with Conflict Detection** — Weighted fusion using source reliability × confidence × freshness decay; flags conflicting observations before routing resources
- **Dynamic Route & Accessibility Engine** — NetworkX graph with real-time road/bridge status updates; blocked routes are excluded and alternate paths computed automatically
- **Constrained Resource Optimizer** — Greedy + local improvement assignment with capability matching, blocked-route exclusion, and measurable improvement vs. nearest-resource baseline
- **Continuous Replanning** — Every simulation event triggers evidence fusion → priority recalculation → route update → reallocation; visible state changes at each step
- **IBM Bob MCP Integration** — 14 operational MCP tools backed by real backend state; Bob can answer "Why is H1 priority?" with actual evidence and algorithmic reasoning

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | Python 3.14, TypeScript |
| **Frameworks** | FastAPI, React, Vite, Pydantic v2 |
| **IBM Technologies** | IBM Bob (MCP integration with 14 operational tools) |
| **AI/ML** | Deterministic evidence fusion engine; optional IBM watsonx.ai (ibm/granite-3-8b-instruct) for NL summaries |
| **Algorithms** | NetworkX (graph routing), Greedy + local improvement optimizer, Weighted evidence fusion |
| **Databases** | SQLite (aiosqlite + SQLAlchemy async) |
| **Other** | Leaflet (maps), React-Leaflet, httpx, pytest (64 tests) |

---

## 📁 Repository Structure

```
├── src/
│   ├── backend/          # FastAPI + all engines (evidence, graph, priority, optimizer, simulation)
│   │   ├── app/
│   │   │   ├── models/domain.py      # Pydantic domain models
│   │   │   ├── engines/
│   │   │   │   ├── evidence_fusion.py    # Multi-source evidence fusion
│   │   │   │   ├── graph_engine.py       # NetworkX road network & routing
│   │   │   │   ├── priority_engine.py    # Criticality & priority scoring
│   │   │   │   ├── resource_optimizer.py # Greedy+local assignment
│   │   │   │   ├── simulation.py         # Discrete-event simulation engine
│   │   │   │   └── benchmark.py          # Benchmark runner
│   │   │   ├── db/                       # SQLite + seed data
│   │   │   ├── config.py                 # All configurable parameters
│   │   │   └── main.py                   # FastAPI endpoints
│   │   └── tests/                        # 64 unit + integration tests
│   ├── frontend/         # React + TypeScript operational dashboard
│   ├── mcp/              # IBM Bob MCP server (14 tools)
│   └── data/             # Synthetic scenario data (scenario_nepal_inspired.json)
├── docs/                 # Architecture, problem statement, solution overview, setup
├── demo/                 # Demo guide, screenshots
├── presentation/         # Slides
├── Makefile              # make install | test | benchmark | seed
└── submission.yaml
```

---

## ⚡ How to Run

```bash
# 1. Clone the repo
git clone https://github.com/itsokayyybro/bob-ai-hackathon-shutdown.git
cd bob-ai-hackathon-shutdown

# 2. Install dependencies
make install

# 3. Start the backend (terminal 1)
make dev-backend
# Backend available at http://localhost:8000
# API docs at http://localhost:8000/docs

# 4. Start the frontend (terminal 2)
make dev-frontend
# Dashboard at http://localhost:5173

# 5. Run all tests
make test

# 6. Run benchmark
make benchmark
```

See [`docs/setup-guide.md`](docs/setup-guide.md) for complete instructions.

---

## 🏔️ The Bhote Valley Simulation

A fully synthetic disaster scenario inspired by mountainous Nepal flood response characteristics:

- **14 assets**: hospital, 2 health posts, 2 schools, shelter, hydropower, command center, 5 villages
- **12 road segments** + **2 bridges** forming a realistic mountain valley network
- **8 response resources**: 3 rescue teams, 2 ambulances, 1 engineering team, 1 supply vehicle, 1 medical unit
- **13 scripted events**: flood detection → bridge damage → conflicting reports → road blockage → hospital surge → resource failure → route recovery → isolation confirmation

> ⚠️ **Disclaimer**: All entities, coordinates, populations, and scenarios are entirely synthetic. This is an anonymized simulation benchmark, not a reconstruction of any real disaster.

---

## 🤖 IBM Bob Integration

Bob connects to the disaster response engine via 14 MCP tools. All answers come from **actual backend state** — no hardcoded responses.

```
IBM Bob
  ↓ (MCP tools)
Disaster Response Engine
  ↓
Evidence Fusion | Graph Router | Resource Optimizer | Simulation
  ↓
Operational Results
```

**Example Bob queries:**
- *"What is the highest priority location?"* → Engine returns ranked sites based on evidence
- *"Why is Hospital H1 critical?"* → Evidence IDs, confidence, urgency factors
- *"Can Ambulance A1 reach it?"* → Real route calculation; reports blocked bridges
- *"What changed after Bridge B1 was confirmed blocked?"* → Audit log + new priority ranking
- *"Simulate Road R7 becoming blocked"* → Calls `simulate_event()` tool → system replans

See [`demo/README.md`](demo/README.md) for the full scripted demo.

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) |
| 🌐 Live Demo | [See demo/live-demo-url.txt](demo/live-demo-url.txt) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/](presentation/) |

---

## 📊 Benchmark Results

After the full 13-event simulation, the AI system outperforms the nearest-resource baseline:

| Metric | AI System | Baseline |
|---|---|---|
| Task Coverage | From actual benchmark run | From actual benchmark run |
| Total Travel Time | Optimized via greedy+swap | Nearest-resource greedy |
| Conflict Detection | ✅ Active | ❌ None |
| Blocked Route Violations | 0 (evidence-aware) | Possible violations |

> All metrics generated by `make benchmark` from actual simulation state — never hardcoded.

---

## ⚠️ Known Limitations

- No real-time external data ingestion (simulation only; no live sensor feeds)
- Map tiles require internet for CartoDB dark theme (falls back gracefully offline)
- Resource optimization uses greedy + local improvement, not full ILP (sufficient for hackathon scale)
- watsonx.ai integration is optional; system is fully functional with deterministic provider
- Team details in submission.yaml require manual completion

---

## 🏅 What We're Most Proud Of

The **evidence fusion + conflict detection engine**. When Bridge B1 receives two contradictory field reports ("blocked" and "passable"), the system doesn't silently pick one — it surfaces the conflict with source reliability, freshness, and confidence scores, recommends verification, and plans conservatively. This is the critical differentiator: uncertainty is a **first-class data type**, not an afterthought. Every decision in the system can be traced back to specific observations with explainable weights.

The **IBM Bob MCP integration** is also genuinely load-bearing: 14 tools that call real backend state, enabling natural-language operational Q&A backed by the deterministic evidence and routing engines.
