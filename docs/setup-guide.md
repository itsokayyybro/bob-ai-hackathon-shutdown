# Setup Guide — AI Emergency Operations & Resource Orchestration System

> Complete setup instructions for judges, evaluators, and developers.  
> The system runs fully without any external credentials.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.9+ | 3.14 tested; use `/opt/conda/bin/python3` if available |
| Node.js | 18+ | For React frontend |
| npm | 9+ | Bundled with Node.js |
| Git | Any | For cloning |
| Internet | Recommended | For map tiles (CartoDB); falls back gracefully offline |

No Docker, no Kubernetes, no external services required.

> ⚠️ **Required data file:** The scenario file `src/data/scenario_nepal_inspired.json` is required for seeding the database. It is tracked in git despite `.gitignore` patterns. Verify it exists with `ls src/data/scenario_nepal_inspired.json` before proceeding.

---

## Quick Start (5 minutes)

```bash
# Clone
git clone <repo-url>
cd bob-ai-hackathon-shutdown

# Verify the scenario data file is present (required for seeding)
ls src/data/scenario_nepal_inspired.json

# Install all dependencies
make install

# Terminal 1: Start backend
make dev-backend

# Terminal 2: Start frontend  
make dev-frontend

# Open browser
open http://localhost:5173
```

---

## Step-by-Step Setup

### 1. Clone the repository

```bash
git clone <repo-url>
cd bob-ai-hackathon-shutdown
```

### 1.5 Verify scenario data

```bash
ls src/data/scenario_nepal_inspired.json
```

> ⚠️ If this file is missing, the system cannot seed the database. Ensure the file was tracked in git (it is required despite `.gitignore` patterns).

### 2. Install backend dependencies

```bash
cd src/backend
pip install -r requirements.txt
cd ../..
```

**Or with a specific Python interpreter:**
```bash
/opt/conda/bin/python3 -m pip install -r src/backend/requirements.txt
```

### 3. Install frontend dependencies

```bash
cd src/frontend
npm install --legacy-peer-deps
cd ../..
```

### 4. Environment configuration (optional)

```bash
cp src/.env.example src/.env
# Edit src/.env if you have watsonx.ai credentials
# Leave empty for deterministic fallback mode (fully functional)
```

The system **works without any credentials**. The deterministic AI provider generates structured summaries from actual system state.

### 5. Start the backend

```bash
# From repo root:
make dev-backend

# Or manually:
cd src/backend
PYTHONPATH=$(pwd) /opt/conda/bin/python3 -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
```

The backend will:
- Initialize the SQLite database automatically
- Seed the Bhote Valley scenario data
- Load the world state into memory
- Start serving at `http://localhost:8000`

**Verify:** `curl http://localhost:8000/health`

Expected response:
```json
{"status":"healthy","version":"1.0.0","assets":14,"pending_events":13}
```

### 6. Start the frontend

```bash
# From repo root:
make dev-frontend

# Or manually:
cd src/frontend
npm run dev
```

Dashboard available at `http://localhost:5173`

### 7. API documentation

Interactive API docs at `http://localhost:8000/docs` (Swagger UI)

---

## Running the Simulation

### Option A: Step-by-step via dashboard

1. Open `http://localhost:5173`
2. Click **"Next Event"** to process one event at a time
3. Observe: priority queue updates, map changes, evidence panel
4. Click **"Auto Play"** to run all events automatically
5. Click **"Inject Event"** to test custom scenarios
6. Use the AI chat panel to ask questions

### Option B: Via API

```bash
# Process next event
curl -X POST http://localhost:8000/simulate/next

# Auto-run all events
curl -X POST "http://localhost:8000/simulate/auto"

# Get current situation
curl http://localhost:8000/situation | python3 -m json.tool

# Get priorities
curl http://localhost:8000/priorities | python3 -m json.tool

# Inject a custom event
curl -X POST http://localhost:8000/simulate/event \
  -H "Content-Type: application/json" \
  -d '{"event_type":"road_blockage","entity_id":"R7","observation_type":"road_status","value":"blocked","confidence":0.9,"description":"Test blockage","source_type":"field_report","metadata":{}}'

# Ask the AI
curl -X POST http://localhost:8000/ai/question \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the highest priority location?"}'

# Reset simulation
curl -X POST http://localhost:8000/simulate/reset
```

---

## Running Tests

```bash
# All tests (64 unit + integration)
make test

# Or manually:
cd src/backend
PYTHONPATH=$(pwd) /opt/conda/bin/python3 -m pytest tests/ -v
```

Expected output: `64 passed`

### Unit tests only:
```bash
cd src/backend
PYTHONPATH=$(pwd) /opt/conda/bin/python3 -m pytest tests/test_engines.py -v
```

### Integration tests only:
```bash
cd src/backend
PYTHONPATH=$(pwd) /opt/conda/bin/python3 -m pytest tests/test_integration.py -v
```

---

## Running the Benchmark

```bash
make benchmark
```

This will:
1. Initialize and seed the database
2. Run the full 13-event simulation
3. Compare AI system vs. nearest-resource baseline
4. Print metrics to stdout
5. Save results to `src/backend/benchmark_results.json`

---

## IBM Bob MCP Setup

### 1. Configure MCP server

The MCP config is at `src/mcp/mcp_config.json`. Bob uses this to start the MCP server.

```json
{
  "mcpServers": {
    "disaster-response": {
      "command": "/opt/conda/bin/python3",
      "args": ["/path/to/src/mcp/server.py"],
      "env": {
        "BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}
```

### 2. Test MCP tools manually

```bash
# With backend running:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | /opt/conda/bin/python3 src/mcp/server.py

echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | /opt/conda/bin/python3 src/mcp/server.py
```

### 3. Available MCP tools

| Tool | Description |
|---|---|
| `get_current_situation` | Full situation overview |
| `get_priority_sites` | Top-N priority locations |
| `get_entity_evidence` | Evidence for any entity |
| `get_route` | Calculate feasible route |
| `get_resource_status` | All resource status |
| `generate_response_plan` | Optimized assignment plan |
| `simulate_event` | Inject custom event |
| `simulate_next_event` | Advance timeline |
| `recalculate_allocation` | Force reoptimization |
| `explain_decision` | Decision explanation |
| `get_benchmark_metrics` | Performance comparison |
| `ask_operator_question` | Natural language Q&A |
| `get_timeline` | Full event timeline |
| `reset_simulation` | Reset to initial state |

---

## Building the Frontend (Production)

```bash
make build-frontend
# Output in src/frontend/dist/
```

---

## Troubleshooting

### Backend won't start
```bash
# Check Python version
python3 --version  # Need 3.9+

# Try conda Python
/opt/conda/bin/python3 -m uvicorn app.main:app --port 8000
```

### Database errors
```bash
# Delete and recreate
rm src/backend/disaster_response.db
make dev-backend  # Auto-recreates and seeds
```

### Frontend can't reach backend
- Ensure backend is running on port 8000
- Check `src/frontend/vite.config.ts` proxy settings
- The Vite dev server proxies `/api/*` → `http://localhost:8000`

### Map tiles not loading
- Map tiles use CartoDB (internet required)
- The dashboard still functions without tiles; entities and routes are visible

### MCP tools return "Cannot connect to backend"
- Ensure backend is running: `curl http://localhost:8000/health`
- Check `BACKEND_URL` environment variable

---

## Resetting to Clean State

```bash
make clean
make seed
make dev-backend
```
