"""
Integration tests for the disaster response system.
Tests API endpoints, simulation flow, and end-to-end scenarios.
"""
import sys
import os
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from httpx import AsyncClient, ASGITransport


async def _startup():
    """Manually trigger app startup (init DB + seed + load world state)."""
    from app.db.database import init_db, AsyncSessionLocal
    from app.db.seed import seed_database
    from app.engines.simulation import sim_engine
    await init_db()
    async with AsyncSessionLocal() as session:
        await seed_database(session)
        await sim_engine.load_from_db(session)


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def client():
    """Module-scoped client with manual startup."""
    # Clean start
    try:
        os.remove("disaster_response.db")
    except FileNotFoundError:
        pass

    await _startup()

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    try:
        os.remove("disaster_response.db")
    except FileNotFoundError:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Basic API tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["assets"] >= 14


@pytest.mark.asyncio
async def test_situation(client):
    resp = await client.get("/situation")
    assert resp.status_code == 200
    data = resp.json()
    assert "sim_time_min" in data
    assert "top_priorities" in data
    assert isinstance(data["top_priorities"], list)


@pytest.mark.asyncio
async def test_entities(client):
    resp = await client.get("/entities")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["assets"]) >= 14
    assert len(data["roads"]) >= 12
    assert len(data["bridges"]) >= 2


@pytest.mark.asyncio
async def test_entity_detail(client):
    resp = await client.get("/entities/H1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity"]["id"] == "H1"
    assert "priority" in data
    assert "evidence" in data


@pytest.mark.asyncio
async def test_entity_not_found(client):
    resp = await client.get("/entities/NONEXISTENT_XYZ")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_priorities(client):
    resp = await client.get("/priorities")
    assert resp.status_code == 200
    data = resp.json()
    priorities = data["priorities"]
    assert len(priorities) > 0
    scores = [p["priority_score"] for p in priorities]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.asyncio
async def test_resources(client):
    resp = await client.get("/resources")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["resources"]) >= 8


@pytest.mark.asyncio
async def test_route(client):
    resp = await client.get("/routes?origin=CC1&destination=H1&vehicle_type=heavy")
    assert resp.status_code == 200
    data = resp.json()
    assert data["feasible"] is True
    assert data["total_time_min"] > 0


@pytest.mark.asyncio
async def test_timeline(client):
    resp = await client.get("/timeline")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["events"]) >= 13


@pytest.mark.asyncio
async def test_map_data(client):
    resp = await client.get("/map-data")
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0


# ─────────────────────────────────────────────────────────────────────────────
# Simulation flow tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_simulate_next_event(client):
    resp = await client.post("/simulate/next")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("event_processed", "no_more_events")
    if data["status"] == "event_processed":
        assert "event" in data
        assert "situation_update" in data


@pytest.mark.asyncio
async def test_inject_road_blockage(client):
    resp = await client.post("/simulate/event", json={
        "event_type": "road_blockage",
        "entity_id": "R7",
        "observation_type": "road_status",
        "value": "blocked",
        "confidence": 0.90,
        "severity": 0.80,
        "description": "Integration test: R7 blocked",
        "source_type": "field_report",
        "metadata": {},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "event_injected"
    assert "situation_update" in data


@pytest.mark.asyncio
async def test_inject_bridge_conflict_detected(client):
    """Two conflicting bridge reports should flag conflict in evidence."""
    await client.post("/simulate/event", json={
        "event_type": "bridge_damage_report",
        "entity_id": "B2",
        "observation_type": "bridge_status",
        "value": "blocked",
        "confidence": 0.82,
        "severity": 0.85,
        "description": "B2 appears blocked",
        "source_type": "field_report",
        "metadata": {},
    })
    await client.post("/simulate/event", json={
        "event_type": "conflicting_bridge_report",
        "entity_id": "B2",
        "observation_type": "bridge_status",
        "value": "open",
        "confidence": 0.50,
        "severity": 0.30,
        "description": "B2 may still be passable",
        "source_type": "field_report",
        "metadata": {},
    })
    ev = (await client.get("/evidence/B2")).json()
    summaries = ev["evidence_summaries"]
    has_conflict = any(s["conflict_status"] == "conflicting" for s in summaries)
    assert has_conflict, "Should detect conflicting evidence for B2"


@pytest.mark.asyncio
async def test_evidence_endpoint(client):
    resp = await client.get("/evidence/H1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_id"] == "H1"
    assert "evidence_summaries" in data
    assert "raw_observations" in data


@pytest.mark.asyncio
async def test_optimize(client):
    resp = await client.post("/optimize")
    assert resp.status_code == 200
    data = resp.json()
    assert "plan" in data
    assert "baseline" in data
    assert "comparison" in data
    assert data["plan"]["coverage_score"] >= 0.0


@pytest.mark.asyncio
async def test_ai_question(client):
    resp = await client.post("/ai/question", json={"question": "What is the highest priority?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert len(data["answer"]) > 10


@pytest.mark.asyncio
async def test_audit_log(client):
    resp = await client.get("/audit")
    assert resp.status_code == 200
    data = resp.json()
    assert "audit_log" in data


@pytest.mark.asyncio
async def test_decisions(client):
    resp = await client.get("/decisions")
    assert resp.status_code == 200
    data = resp.json()
    assert "decisions" in data


# ─────────────────────────────────────────────────────────────────────────────
# Reset and end-to-end
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_simulate_reset(client):
    resp = await client.post("/simulate/reset")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "reset_complete"
    assert data["sim_time_min"] == 0


@pytest.mark.asyncio
async def test_end_to_end_disaster_scenario(client):
    """Full scenario: reset → process events → verify state → optimize."""
    reset = await client.post("/simulate/reset")
    assert reset.json()["status"] == "reset_complete"

    processed_count = 0
    for _ in range(7):
        resp = await client.post("/simulate/next")
        d = resp.json()
        if d["status"] == "no_more_events":
            break
        if d["status"] == "event_processed":
            processed_count += 1

    assert processed_count > 0

    situation = (await client.get("/situation")).json()
    assert len(situation["top_priorities"]) > 0

    route = (await client.get("/routes?origin=CC1&destination=H1")).json()
    assert "feasible" in route

    opt = (await client.post("/optimize")).json()
    assert opt["plan"]["coverage_score"] >= 0.0

    qa = (await client.post("/ai/question", json={"question": "What happened?"})).json()
    assert len(qa["answer"]) > 5


@pytest.mark.asyncio
async def test_benchmark(client):
    """After events, benchmark should produce real metrics."""
    for _ in range(5):
        resp = await client.post("/simulate/next")
        if resp.json().get("status") == "no_more_events":
            break

    resp = await client.get("/benchmark")
    assert resp.status_code == 200
    data = resp.json()

    if data.get("status") == "no_tasks":
        pytest.skip("No tasks available")

    assert "ai_system" in data
    assert "baseline" in data
    assert "improvements" in data
    assert 0 <= data["ai_system"]["coverage_rate"] <= 1.0
    assert data["ai_system"]["decision_confidence_avg"] >= 0.0
