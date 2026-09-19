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


def _remove_test_db():
    """Delete the scratch SQLite file, tolerating platform differences.

    On Windows the file stays locked until the async engine has released its
    connections, so a PermissionError here is a cleanup artifact and must not
    fail the run. No assertion depends on the file being gone.
    """
    try:
        os.remove("disaster_response.db")
    except (FileNotFoundError, PermissionError, OSError):
        pass


@pytest.fixture(scope="module")
async def client():
    """Module-scoped client with manual startup."""
    # Clean start
    _remove_test_db()

    await _startup()

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    # Release the engine's file handles before attempting deletion.
    from app.db.database import engine
    await engine.dispose()
    _remove_test_db()


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


# ─────────────────────────────────────────────────────────────────────────────
# B2 — scenario metadata sourced from data, not literals
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scenario_metadata_endpoint(client):
    """GET /scenario exposes name, type, geography, counts and live progress."""
    from app.scenario import load_scenario
    scenario = load_scenario()

    resp = await client.get("/scenario")
    assert resp.status_code == 200
    data = resp.json()

    # Identity must come from the scenario file, not a literal in a handler.
    assert data["scenario_name"] == scenario["scenario_name"]
    assert data["description"] == scenario["description"]
    assert data["scenario_type"] == scenario["scenario_type"]
    assert data["geography"] == scenario["geography"]
    assert data["synthetic"] is True

    # Counts must reflect the actual scenario contents.
    counts = data["counts"]
    assert counts["assets"] == len(scenario["assets"])
    assert counts["roads"] == len(scenario["roads"])
    assert counts["bridges"] == len(scenario["bridges"])
    assert counts["resources"] == len(scenario["resources"])
    assert counts["simulation_events"] == len(scenario["simulation_events"])

    sim = data["simulation"]
    assert sim["status"] in ("not_started", "in_progress", "completed")
    assert sim["current_event_index"] == sim["processed_events"]
    assert sim["processed_events"] + sim["pending_events"] == sim["total_events"]


@pytest.mark.asyncio
async def test_situation_scenario_name_comes_from_data(client):
    """/situation's `scenario` value must match the scenario file.

    Guards against the literal that used to be inlined in the handler.
    """
    from app.scenario import load_scenario
    expected = load_scenario()["scenario_name"]

    resp = await client.get("/situation")
    assert resp.status_code == 200
    assert resp.json()["scenario"] == expected


@pytest.mark.asyncio
async def test_situation_response_shape_preserved(client):
    """The /situation contract the frontend depends on must not drift."""
    resp = await client.get("/situation")
    data = resp.json()

    for key in (
        "sim_time_min", "scenario", "top_priorities", "blocked_infrastructure",
        "evidence_conflicts", "unavailable_resources", "current_plan_summary",
        "pending_events", "total_events", "processed_events",
    ):
        assert key in data, f"/situation lost required key: {key}"

    # top_priorities entries keep every key the dashboard reads.
    if data["top_priorities"]:
        p = data["top_priorities"][0]
        for key in (
            "entity_id", "entity_name", "entity_type", "priority_score",
            "criticality_score", "urgency_score", "accessibility_factor",
            "confidence_factor", "impact_score", "explanation",
            "supporting_factors", "rank",
        ):
            assert key in p, f"top_priorities lost required key: {key}"


@pytest.mark.asyncio
async def test_map_data_scenario_name_comes_from_data(client):
    from app.scenario import load_scenario
    expected = load_scenario()["scenario_name"]

    resp = await client.get("/map-data")
    assert resp.status_code == 200
    assert resp.json()["metadata"]["scenario"] == expected


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
# B3 — operator decision capture
# ─────────────────────────────────────────────────────────────────────────────

async def _purge_injected_events():
    """Delete EVT-INJ-* rows so the scheduled sequence is exactly the scenario's.

    Injected events are persisted to sim_events and deliberately SURVIVE a reset
    — reset only marks events unprocessed, so injected ones get replayed. That is
    correct product behaviour, but it means a test asserting on the scheduled
    13-event sequence, or on an exact observation count, must clear them first.
    """
    from sqlalchemy import delete
    from app.db.database import AsyncSessionLocal, SimEventDB
    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(SimEventDB).where(SimEventDB.id.like("EVT-INJ-%"))
        )
        await session.commit()


async def _reset_to_pristine_scenario(client):
    """Reset to the scheduled scenario only, with no replayed injected events."""
    await _purge_injected_events()
    resp = await client.post("/simulate/reset")
    assert resp.status_code == 200


async def _get_any_decision(client) -> dict:
    """Return some persisted decision, advancing the simulation if needed.

    Decisions are only written by the optimizer after an event that leaves a
    pending task, so this makes the tests independent of ordering within the
    module. The bound is generous because earlier tests may have injected extra
    events that replay ahead of the scheduled ones.
    """
    for _ in range(30):
        resp = await client.get("/decisions")
        assert resp.status_code == 200
        decisions = resp.json()["decisions"]
        if decisions:
            return decisions[0]
        advance = await client.post("/simulate/next")
        assert advance.status_code == 200
        if advance.json().get("status") == "no_more_events":
            break
    raise AssertionError("No decisions were produced; cannot exercise B3 endpoints.")


@pytest.mark.asyncio
async def test_confirm_decision_accepted(client):
    decision = await _get_any_decision(client)

    resp = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "accepted"},
    )
    assert resp.status_code == 200
    assert resp.json()["operator_status"] == "accepted"


@pytest.mark.asyncio
async def test_confirm_decision_rejected(client):
    decision = await _get_any_decision(client)

    resp = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "rejected", "operator_notes": "Route unsafe in monsoon."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["operator_status"] == "rejected"
    assert body["operator_notes"] == "Route unsafe in monsoon."


@pytest.mark.asyncio
async def test_confirm_decision_modified(client):
    decision = await _get_any_decision(client)

    resp = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "modified", "operator_notes": "Sending RT2 instead."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["operator_status"] == "modified"
    assert body["operator_notes"] == "Sending RT2 instead."


@pytest.mark.asyncio
async def test_confirm_decision_persists(client):
    """The operator action must still be there on a fresh read."""
    decision = await _get_any_decision(client)

    confirm = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "accepted", "operator_notes": "Confirmed by duty officer."},
    )
    assert confirm.status_code == 200

    refetch = await client.get(f"/decisions/{decision['id']}")
    assert refetch.status_code == 200
    body = refetch.json()
    assert body["operator_status"] == "accepted"
    assert body["operator_notes"] == "Confirmed by duty officer."


@pytest.mark.asyncio
async def test_confirm_decision_invalid_id_returns_404(client):
    resp = await client.post(
        "/decisions/DEC-DOESNOTEXIST/confirm",
        json={"status": "accepted"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_confirm_decision_invalid_status_returns_422(client):
    decision = await _get_any_decision(client)

    resp = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "maybe_later"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_confirm_decision_preserves_recommendation(client):
    """B3/B4: confirming must not alter what the system recommended."""
    decision = await _get_any_decision(client)

    before = await client.get(f"/decisions/{decision['id']}")
    before_body = before.json()

    confirm = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "rejected", "operator_notes": "Operator override."},
    )
    assert confirm.status_code == 200

    after = await client.get(f"/decisions/{decision['id']}")
    after_body = after.json()

    for field in (
        "recommended_action", "reasons", "confidence", "priority",
        "target_entity_id", "resource_id", "task_id", "evidence_ids",
        "constraints", "alternatives_considered", "simulation_time_min",
    ):
        assert after_body[field] == before_body[field], (
            f"confirm() mutated recommendation field {field!r}: "
            f"{before_body[field]!r} -> {after_body[field]!r}"
        )


@pytest.mark.asyncio
async def test_confirm_decision_writes_audit_record(client):
    """B3 item 6: audit entry with event_type=operator_decision."""
    decision = await _get_any_decision(client)

    confirm = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "accepted", "operator_notes": "Audit check."},
    )
    assert confirm.status_code == 200

    audit = await client.get("/audit", params={"limit": 200})
    assert audit.status_code == 200
    entries = audit.json()["audit_log"]

    matching = [
        e for e in entries
        if e["event_type"] == "operator_decision" and e.get("decision_id") == decision["id"]
    ]
    assert matching, "No operator_decision audit entry referencing the decision"

    entry = matching[0]
    assert entry["new_state"]["operator_status"] == "accepted"
    assert entry["new_state"]["notes"] == "Audit check."
    assert entry["entity_id"] == decision["target_entity_id"]


@pytest.mark.asyncio
async def test_confirm_decision_audit_is_persisted(client):
    """The operator audit entry must reach the audit_log table, not just memory."""
    from sqlalchemy import select as sa_select
    from app.db.database import AsyncSessionLocal, AuditDB

    decision = await _get_any_decision(client)
    confirm = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "accepted"},
    )
    assert confirm.status_code == 200

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            sa_select(AuditDB).where(AuditDB.decision_id == decision["id"])
        )
        rows = list(result.scalars())

    assert rows, "operator_decision was not persisted to the audit_log table"
    assert any(r.event_type == "operator_decision" for r in rows)


# ─────────────────────────────────────────────────────────────────────────────
# B1/B12/B17 — Nepal scenario integrity
# ─────────────────────────────────────────────────────────────────────────────

#: Bhote Valley sits north of Kathmandu. Measured extent of the scenario assets
#: is lat 28.0850..28.1350, lon 85.6800..85.7350; these bounds are deliberately
#: wider so the test guards against a geography swap, not minor data edits.
NEPAL_LAT_RANGE = (27.0, 29.0)
NEPAL_LON_RANGE = (85.0, 86.0)


@pytest.mark.asyncio
async def test_nepal_scenario_loads_with_nepal_coordinates(client):
    """B1: the scenario must remain the Nepal-inspired Bhote Valley one."""
    resp = await client.get("/entities")
    assert resp.status_code == 200
    data = resp.json()

    assets = data["assets"]
    assert len(assets) >= 14, f"Expected >=14 assets, got {len(assets)}"

    for asset in assets:
        assert NEPAL_LAT_RANGE[0] <= asset["lat"] <= NEPAL_LAT_RANGE[1], (
            f"{asset['id']} latitude {asset['lat']} is outside Nepal"
        )
        assert NEPAL_LON_RANGE[0] <= asset["lon"] <= NEPAL_LON_RANGE[1], (
            f"{asset['id']} longitude {asset['lon']} is outside Nepal"
        )


@pytest.mark.asyncio
async def test_expected_scenario_entities_present(client):
    """B1/B17: the entities the demo narrative depends on must all exist."""
    data = (await client.get("/entities")).json()
    asset_ids = {a["id"] for a in data["assets"]}
    road_ids = {r["id"] for r in data["roads"]}
    bridge_ids = {b["id"] for b in data["bridges"]}

    for expected in ("H1", "CC1", "V3", "HP1", "S1"):
        assert expected in asset_ids, f"Asset {expected} missing from scenario"
    for expected in ("B1", "B2"):
        assert expected in bridge_ids, f"Bridge {expected} missing from scenario"
    assert "R7" in road_ids, "Road R7 missing from scenario"

    # Topology facts the demo and the tests rely on.
    bridges = {b["id"]: b for b in data["bridges"]}
    assert bridges["B1"]["on_road"] == "R2", (
        "B1 is expected to sit on R2; the routing tests depend on this"
    )
    assert bridges["B2"]["on_road"] == "R9", (
        "B2 is expected to sit on R9; it is in the other chain from B1"
    )


@pytest.mark.asyncio
async def test_full_thirteen_event_sequence_processes(client):
    """B12/B17: the whole scheduled sequence runs without error."""
    await _reset_to_pristine_scenario(client)

    scenario = (await client.get("/scenario")).json()
    total = scenario["counts"]["simulation_events"]
    assert total == 13, f"Expected the 13-event Nepal sequence, found {total}"

    processed = 0
    for _ in range(total + 2):
        resp = await client.post("/simulate/next")
        assert resp.status_code == 200
        if resp.json().get("status") == "no_more_events":
            break
        processed += 1

    assert processed == total, f"Processed {processed} of {total} events"

    final = (await client.get("/scenario")).json()["simulation"]
    assert final["processed_events"] == total
    assert final["pending_events"] == 0
    assert final["status"] == "completed"
    # T+0 .. T+180 at 15-minute spacing.
    assert final["current_time_min"] == 180


@pytest.mark.asyncio
async def test_graph_routing_cc1_to_hp1_breaks_when_b1_blocked(client):
    """Correction 2: B1 is on R2, so CC1->HP1 is the route it severs.

    CC1->H1 traverses only R1, which carries no bridge, so it stays feasible no
    matter what happens to B1. Asserting otherwise would be asserting an
    impossibility. Blocking B1 cuts HP1, S1, SH1, V3 and HPwr1 off from CC1.
    """
    await _reset_to_pristine_scenario(client)

    before = (await client.get("/routes", params={
        "origin": "CC1", "destination": "HP1", "vehicle_type": "heavy",
    })).json()
    assert before["feasible"] is True, "CC1->HP1 should be feasible initially"

    resp = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    assert resp.status_code == 200

    after = (await client.get("/routes", params={
        "origin": "CC1", "destination": "HP1", "vehicle_type": "heavy",
    })).json()
    assert after["feasible"] is False, (
        "CC1->HP1 should be infeasible once B1 (on R2) is blocked"
    )

    # The control: CC1->H1 uses R1 only and is unaffected.
    h1_route = (await client.get("/routes", params={
        "origin": "CC1", "destination": "H1", "vehicle_type": "heavy",
    })).json()
    assert h1_route["feasible"] is True, (
        "CC1->H1 must remain feasible after B1 is blocked: R1 carries no bridge"
    )


@pytest.mark.asyncio
async def test_medical_response_assigned_to_ambulance_after_surge(client):
    """B17: after EVT-006 (HP1 overloaded) a medical task goes to an ambulance."""
    await _reset_to_pristine_scenario(client)

    surge_seen = False
    for _ in range(14):
        resp = await client.post("/simulate/next")
        body = resp.json()
        if body.get("status") == "no_more_events":
            break
        if body["event"]["event_type"] == "hospital_demand_surge":
            surge_seen = True
            break
    assert surge_seen, "hospital_demand_surge event was never reached"

    tasks = (await client.get("/tasks")).json()["tasks"]
    medical = [t for t in tasks if t["task_type"] == "medical_response"]
    assert medical, "No medical_response task generated after the surge"

    plan = (await client.get("/plan")).json()["plan"]
    assert plan, "No plan after the surge"

    resources = {r["id"]: r for r in (await client.get("/resources")).json()["resources"]}
    medical_task_ids = {t["id"] for t in medical}
    assigned = [a for a in plan["allocations"] if a["task_id"] in medical_task_ids]
    assert assigned, f"No allocation for medical tasks {medical_task_ids}"

    for alloc in assigned:
        resource_type = resources[alloc["resource_id"]]["type"]
        assert resource_type in ("ambulance", "medical_unit"), (
            f"medical_response assigned to {resource_type}, which cannot perform it"
        )
    assert any(
        resources[a["resource_id"]]["type"] == "ambulance" for a in assigned
    ), "Expected an ambulance to take the medical_response task"


@pytest.mark.asyncio
async def test_b1_conflict_detected_from_two_sources(client):
    """Correction 3: B1 yields 1 supporting + 1 conflicting, source_count 2.

    EVT-003 reports 'partially_blocked' and EVT-004 reports 'open'.
    `_normalize_value` maps those to two DIFFERENT canonical groups, so the
    summary is NOT "2 supporting observations".

    `best_value` is deliberately NOT asserted. With bridge_status lambda = 2.0/hr
    the 15-minute-older report decays to ~0.6065 freshness, making the two
    weights nearly identical (measured 0.437673 vs 0.440000, a 0.26 percentage
    point margin in support). Which value wins would flip under any change to
    lambda, source reliability, or event timing.
    """
    # Pristine: an injected B1 report from another test would replay and add a
    # third observation, breaking the source_count assertion.
    await _reset_to_pristine_scenario(client)

    for _ in range(14):
        resp = await client.post("/simulate/next")
        body = resp.json()
        if body.get("status") == "no_more_events":
            break
        if body["event"]["id"] == "EVT-004":
            break

    evidence = (await client.get("/evidence/B1")).json()
    summaries = [
        s for s in evidence["evidence_summaries"]
        if s["observation_type"] == "bridge_status"
    ]
    assert summaries, "No bridge_status evidence for B1"
    summary = summaries[0]

    assert summary["conflict_status"] == "conflicting", (
        "Two contradictory B1 reports must be flagged as conflicting"
    )
    assert summary["source_count"] == 2, (
        f"Expected 2 contributing observations, got {summary['source_count']}"
    )
    assert len(summary["supporting_observations"]) == 1, (
        "Expected exactly 1 supporting observation, not 2 — the two reports "
        "normalize to different canonical values"
    )
    assert len(summary["conflicting_observations"]) == 1, (
        "Expected exactly 1 conflicting observation"
    )
    # Uncertainty must be surfaced, and verification recommended.
    assert summary["recommendation"], "Conflict must carry a recommendation"
    assert "verification" in summary["recommendation"].lower()

    # Both raw reports remain available as provenance (B8/B9).
    raw_values = {
        o["value"] for o in evidence["raw_observations"]
        if o["observation_type"] == "bridge_status"
    }
    assert {"partially_blocked", "open"} <= raw_values, (
        f"Both raw B1 reports should be retained; found {raw_values}"
    )


@pytest.mark.asyncio
async def test_conflict_surfaced_in_situation(client):
    """B12 step 7: the system must show uncertainty to the operator."""
    await _reset_to_pristine_scenario(client)
    for _ in range(14):
        body = (await client.post("/simulate/next")).json()
        if body.get("status") == "no_more_events":
            break
        if body["event"]["id"] == "EVT-004":
            break

    situation = (await client.get("/situation")).json()
    assert situation["evidence_conflicts"], (
        "A detected conflict must appear in /situation evidence_conflicts"
    )


# ─────────────────────────────────────────────────────────────────────────────
# B7 — recommendation contract
# ─────────────────────────────────────────────────────────────────────────────

#: Every field §11 (B7) requires a recommendation to expose.
B7_REQUIRED_FIELDS = (
    "decision_id", "task_id", "target_entity_id", "resource_id",
    "resource_type", "capability", "route_feasible", "estimated_arrival_min",
    "priority_score", "explanation", "supporting_factors",
    "human_verification_required", "last_evidence_verified",
    "target_entity_accessibility",
)


@pytest.mark.asyncio
async def test_plan_recommendations_expose_all_b7_fields(client):
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    body = (await client.get("/plan")).json()
    recommendations = body["recommendations"]
    assert recommendations, "No recommendations exposed on /plan"

    for rec in recommendations:
        for field in B7_REQUIRED_FIELDS:
            assert field in rec, f"/plan recommendation missing {field}"

        # Human verification is always required — the system never self-dispatches.
        assert rec["human_verification_required"] is True
        assert rec["task_id"], "Recommendation must carry its task id"
        assert isinstance(rec["explanation"], list) and rec["explanation"]
        assert isinstance(rec["supporting_factors"], list)
        assert isinstance(rec["capability"], list)


@pytest.mark.asyncio
async def test_recommendation_evidence_and_accessibility_are_real(client):
    """last_evidence_verified and target_entity_accessibility must come from state."""
    from app.engines.simulation import world_state

    await client.post("/simulate/reset")
    await _get_any_decision(client)

    recommendations = (await client.get("/plan")).json()["recommendations"]
    assert recommendations

    checked = 0
    for rec in recommendations:
        entity_id = rec["target_entity_id"]

        priority = world_state.priorities.get(entity_id)
        if priority is not None:
            assert rec["target_entity_accessibility"] == pytest.approx(
                priority.accessibility_factor
            ), "accessibility_factor was not read from the PriorityScore"
            assert rec["priority_score"] == pytest.approx(priority.priority_score)
            checked += 1

        summaries = world_state.get_all_evidence_for_entity(entity_id)
        if summaries:
            expected = max(s.last_verified for s in summaries).isoformat()
            assert rec["last_evidence_verified"] == expected, (
                "last_evidence_verified was not the newest EvidenceSummary timestamp"
            )
        else:
            assert rec["last_evidence_verified"] is None

    assert checked, "No recommendation could be cross-checked against a PriorityScore"


@pytest.mark.asyncio
async def test_recommendation_route_feasible_matches_allocation(client):
    """route_feasible/ETA must mirror the optimizer's allocation, not a re-route."""
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    body = (await client.get("/plan")).json()
    allocations = {
        (a["task_id"], a["resource_id"]): a for a in body["plan"]["allocations"]
    }
    assert allocations

    matched = 0
    for rec in body["recommendations"]:
        key = (rec["task_id"], rec["resource_id"])
        alloc = allocations.get(key)
        if alloc is None:
            continue
        assert rec["estimated_arrival_min"] == pytest.approx(
            alloc["estimated_arrival_min"]
        )
        expected_feasible = alloc["route"]["feasible"] if alloc["route"] else None
        assert rec["route_feasible"] == expected_feasible
        matched += 1

    assert matched, "No recommendation matched an allocation on (task_id, resource_id)"


@pytest.mark.asyncio
async def test_decisions_endpoint_exposes_b7_context(client):
    """/decisions must also carry the B7 context fields, not just /plan."""
    await client.post("/simulate/reset")
    decision = await _get_any_decision(client)

    detail = (await client.get(f"/decisions/{decision['id']}")).json()
    for field in (
        "task_id", "resource_type", "capability", "route_feasible",
        "estimated_arrival_min", "priority_score", "supporting_factors",
        "last_evidence_verified", "target_entity_accessibility",
        "operator_status", "human_verification_required",
    ):
        assert field in detail, f"/decisions/{{id}} missing {field}"


@pytest.mark.asyncio
async def test_plan_recommendations_empty_without_plan(client):
    """Before any plan exists, the key is present and empty rather than absent."""
    await client.post("/simulate/reset")
    body = (await client.get("/plan")).json()
    assert "recommendations" in body
    if body["plan"] is None:
        assert body["recommendations"] == []


# ─────────────────────────────────────────────────────────────────────────────
# B5/B6 — plan change detection and exposure
# ─────────────────────────────────────────────────────────────────────────────

PLAN_CHANGE_KEYS = {
    "task_id", "entity_id", "previous_resource_id", "new_resource_id",
    "previous_eta_min", "new_eta_min", "previous_route_feasible",
    "new_route_feasible", "change_reason", "triggering_event_id",
    "triggering_event_type", "affected_infrastructure_id", "review_required",
}


@pytest.mark.asyncio
async def test_simulate_next_exposes_plan_change_keys(client):
    """B6: both new keys are always present, and the old ones are untouched."""
    await client.post("/simulate/reset")
    resp = await client.post("/simulate/next")
    assert resp.status_code == 200
    body = resp.json()

    # Pre-existing contract preserved.
    assert body["status"] == "event_processed"
    assert "event" in body
    assert "situation_update" in body
    # B6 additions.
    assert body["plan_changes"] == []
    assert body["affected_decision_ids"] == []


@pytest.mark.asyncio
async def test_no_more_events_still_returns_plan_change_keys(client):
    await client.post("/simulate/reset")
    await client.post("/simulate/auto")
    resp = await client.post("/simulate/next")
    body = resp.json()
    assert body["status"] == "no_more_events"
    assert body["plan_changes"] == []
    assert body["affected_decision_ids"] == []


@pytest.mark.asyncio
async def test_plan_changes_detected_across_scenario(client):
    """Stepping the real scenario must produce well-formed, reviewable changes."""
    await client.post("/simulate/reset")

    all_changes = []
    for _ in range(20):
        resp = await client.post("/simulate/next")
        body = resp.json()
        if body.get("status") == "no_more_events":
            break
        for change in body["plan_changes"]:
            assert set(change) == PLAN_CHANGE_KEYS, (
                f"PlanChange key set drifted: {sorted(set(change) ^ PLAN_CHANGE_KEYS)}"
            )
            assert change["task_id"]
            assert change["change_reason"]
            assert change["triggering_event_id"] == body["event"]["id"]
            assert change["triggering_event_type"] == body["event"]["event_type"]
            all_changes.append(change)

    assert all_changes, "Scenario produced no plan changes at all"
    assert any(c["review_required"] for c in all_changes), (
        "No change in the whole scenario was flagged review_required"
    )


@pytest.mark.asyncio
async def test_resource_unavailable_produces_reassignment_change(client):
    """B17: a task assigned to a resource that becomes unavailable is re-planned."""
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    plan = (await client.get("/plan")).json()["plan"]
    assert plan and plan["allocations"], "No allocations to invalidate"
    assigned = plan["allocations"][0]
    resource_id = assigned["resource_id"]

    # observation_type and value are required: _process_event treats an event
    # without them as a non-observation system event and applies no state change.
    resp = await client.post("/simulate/event", json={
        "event_type": "resource_unavailable",
        "entity_id": resource_id,
        "observation_type": "resource_status",
        "value": "unavailable",
        "confidence": 0.95,
        "severity": 0.9,
        "description": f"{resource_id} withdrawn (mechanical failure).",
        "source_type": "authority_report",
        "metadata": {"reason": "mechanical_failure"},
    })
    assert resp.status_code == 200
    changes = resp.json()["plan_changes"]

    losing = [c for c in changes if c["previous_resource_id"] == resource_id]
    assert losing, (
        f"No PlanChange recorded for the task previously assigned to {resource_id}. "
        f"Changes: {changes}"
    )
    assert all(c["review_required"] for c in losing), (
        "Losing the assigned resource must require operator review"
    )
    assert all(c["new_resource_id"] != resource_id for c in losing)


#: Blocking B1 (on road R2, H1<->HP1) severs chain 1 beyond HP1, making HP1, S1,
#: SH1, V3 and HPwr1 unreachable from the CC1 command centre. B2 sits on R9 in
#: the other chain, so it cannot affect a chain-1 allocation — the two chains
#: meet only at CC1.
BLOCK_B1_EVENT = {
    "event_type": "bridge_confirmed_blocked",
    "entity_id": "B1",
    "observation_type": "bridge_status",
    "value": "blocked",
    "confidence": 0.95,
    "severity": 0.9,
    "description": "B1 confirmed impassable by engineering survey.",
    "source_type": "authority_report",
}


@pytest.mark.asyncio
async def test_blocked_bridge_requires_review(client):
    """B17: blocking the bridge on the assigned route flags review_required."""
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    resp = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    assert resp.status_code == 200
    changes = resp.json()["plan_changes"]

    assert changes, "Blocking B1 produced no plan changes"
    assert any(c["review_required"] for c in changes)
    # The triggering infrastructure is identified on changes caused by it.
    assert any(c["affected_infrastructure_id"] == "B1" for c in changes)
    # The previously feasible assignment must no longer be servable as before.
    assert any(
        c["previous_route_feasible"] is True
        and (c["new_route_feasible"] is not True or c["new_resource_id"] is None)
        for c in changes
    ), f"No loss of a feasible assignment recorded: {changes}"


@pytest.mark.asyncio
async def test_repeat_event_produces_no_plan_changes(client):
    """B17: an event that changes nothing yields an empty plan_changes list."""
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    # The first report genuinely changes the plan...
    first = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    assert first.status_code == 200
    assert first.json()["plan_changes"], (
        "Guard: the first block must change the plan, or the idempotency "
        "assertion below would pass vacuously"
    )

    # ...re-reporting the same already-applied state must not churn it.
    second = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    assert second.status_code == 200
    assert second.json()["plan_changes"] == [], (
        f"Idempotent re-report produced changes: {second.json()['plan_changes']}"
    )


@pytest.mark.asyncio
async def test_affected_decision_ids_excludes_unconfirmed_superseded(client):
    """Documents the deliberate scoping rule at its sharpest edge.

    Blocking B1 leaves the V3 rescue task with no feasible resource at all, so
    the new generation contains no row for that entity. The prior recommendation
    is superseded and no operator acted on it, so by the scoping rule it is NOT
    flagged: only current rows, plus history an operator committed to, are
    returned. The plan change itself still reports the loss.
    """
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    resp = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    body = resp.json()

    assert body["plan_changes"], "Expected the loss of assignment to be reported"
    assert any(c["review_required"] for c in body["plan_changes"])
    assert body["affected_decision_ids"] == [], (
        "Unconfirmed superseded recommendations must not be returned; only "
        "current rows plus operator-acted history are in scope"
    )


@pytest.mark.asyncio
async def test_affected_decision_ids_populated_and_scoped(client):
    """B6 + Correction 4 scoping, on the reassignment path.

    Withdrawing the assigned resource leaves the task servable by another, so a
    current recommendation exists for the affected entity and is reported.
    """
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    plan = (await client.get("/plan")).json()["plan"]
    assert plan and plan["allocations"]
    resource_id = plan["allocations"][0]["resource_id"]

    resp = await client.post("/simulate/event", json={
        "event_type": "resource_unavailable",
        "entity_id": resource_id,
        "observation_type": "resource_status",
        "value": "unavailable",
        "confidence": 0.95,
        "severity": 0.9,
        "description": f"{resource_id} withdrawn.",
        "source_type": "authority_report",
        "metadata": {"reason": "mechanical_failure"},
    })
    body = resp.json()
    affected_ids = body["affected_decision_ids"]
    changed_entities = {c["entity_id"] for c in body["plan_changes"] if c["entity_id"]}

    assert affected_ids, "No affected decisions reported despite plan changes"

    all_decisions = (await client.get("/decisions", params={"limit": 500})).json()
    by_id = {d["id"]: d for d in all_decisions["decisions"]}

    for dec_id in affected_ids:
        dec = by_id.get(dec_id)
        if dec is None:
            continue  # Outside the page limit; scoping still checked below.
        assert dec["target_entity_id"] in changed_entities, (
            "affected_decision_ids included a decision for an unaffected entity"
        )
        assert dec["is_current"] or dec["operator_status"] is not None, (
            "affected_decision_ids included a superseded decision "
            "that no operator had acted on"
        )


@pytest.mark.asyncio
async def test_affected_decision_ids_include_acted_on_history(client):
    """A superseded-but-accepted decision stays flagged for re-review."""
    await client.post("/simulate/reset")
    decision = await _get_any_decision(client)

    confirm = await client.post(
        f"/decisions/{decision['id']}/confirm",
        json={"status": "accepted", "operator_notes": "Approved."},
    )
    assert confirm.status_code == 200
    entity_id = confirm.json()["target_entity_id"]

    # Block the bridge that severs the route to this entity, so the accepted
    # decision is deterministically superseded rather than relying on which
    # scheduled event happens to touch it.
    resp = await client.post("/simulate/event", json=BLOCK_B1_EVENT)
    assert resp.status_code == 200
    body = resp.json()

    touched = {c["entity_id"] for c in body["plan_changes"] if c["entity_id"]}
    assert entity_id in touched, (
        f"Expected a plan change for {entity_id}; changes touched {touched}"
    )

    refetched = (await client.get(f"/decisions/{decision['id']}")).json()
    assert refetched["is_current"] is False, "Decision should now be history"
    assert refetched["operator_status"] == "accepted"

    assert decision["id"] in body["affected_decision_ids"], (
        "An accepted decision for an affected entity was not flagged for "
        "re-review after it was superseded"
    )


# ─────────────────────────────────────────────────────────────────────────────
# B4 — recommendation history (insert-only + generation currency)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_replan_advances_plan_generation(client):
    """Each optimizer run that persists decisions advances the generation.

    The generation tracks persisted decision sets, not processed events: the
    optimizer returns early while no tasks are pending, so early events in the
    scenario legitimately produce no new generation.
    """
    await client.post("/simulate/reset")

    before = (await client.get("/decisions")).json()["current_plan_generation"]
    assert before == 0

    # Advance until the scenario actually produces tasks and therefore decisions.
    await _get_any_decision(client)

    after = (await client.get("/decisions")).json()["current_plan_generation"]
    assert after > before, "plan_generation did not advance once decisions existed"

    # Running the rest of the scenario must produce further generations: the
    # counter is not a one-shot flag. Asserted over the whole remainder rather
    # than per-event, because an individual event that leaves no pending task
    # correctly produces no new generation.
    await client.post("/simulate/auto")
    final = (await client.get("/decisions")).json()["current_plan_generation"]
    assert final > after, (
        "plan_generation did not advance further across the remaining events"
    )


@pytest.mark.asyncio
async def test_operator_decision_survives_replan(client):
    """B4's worked example, end to end.

    A recommendation is accepted, new information arrives, the system replans.
    The accepted row must keep its operator_status AND its original
    recommendation, while a newer current row exists for the same task.
    """
    await client.post("/simulate/reset")

    # Produce a first generation of decisions.
    accepted = None
    for _ in range(6):
        resp = await client.post("/simulate/next")
        if resp.json().get("status") == "no_more_events":
            break
        decisions = (await client.get("/decisions", params={"limit": 100})).json()["decisions"]
        with_task = [d for d in decisions if d["task_id"]]
        if with_task:
            accepted = with_task[0]
            break
    assert accepted is not None, "No task-bound decision was produced"

    confirm = await client.post(
        f"/decisions/{accepted['id']}/confirm",
        json={"status": "accepted", "operator_notes": "Dispatch approved."},
    )
    assert confirm.status_code == 200
    accepted_gen = confirm.json()["plan_generation"]

    # New information -> replan. Block a bridge to force re-evaluation.
    inject = await client.post("/simulate/event", json={
        "event_type": "bridge_confirmed_blocked",
        "entity_id": "B2",
        "observation_type": "bridge_status",
        "value": "blocked",
        "confidence": 0.95,
        "severity": 0.9,
        "description": "B2 confirmed impassable by engineering team.",
        "source_type": "authority_report",
    })
    assert inject.status_code == 200

    # The accepted decision is untouched apart from remaining accepted.
    refetch = (await client.get(f"/decisions/{accepted['id']}")).json()
    assert refetch["operator_status"] == "accepted"
    assert refetch["operator_notes"] == "Dispatch approved."
    assert refetch["recommended_action"] == accepted["recommended_action"]
    assert refetch["reasons"] == accepted["reasons"]
    assert refetch["confidence"] == accepted["confidence"]
    assert refetch["resource_id"] == accepted["resource_id"]

    # It is now history, not the live recommendation.
    current_gen = (await client.get("/decisions")).json()["current_plan_generation"]
    assert current_gen > accepted_gen
    assert refetch["is_current"] is False

    # A newer recommendation exists for the same task, and it is a NEW row.
    history = (await client.get("/decisions", params={
        "task_id": accepted["task_id"], "limit": 100,
    })).json()["decisions"]
    assert len(history) >= 2, "Replan did not insert a new row for the task"

    current_rows = [d for d in history if d["is_current"]]
    assert current_rows, "No current recommendation for the task after replan"
    assert all(d["id"] != accepted["id"] for d in current_rows), (
        "Replan reused the accepted row instead of inserting a new one"
    )
    # The operator's acceptance remains visible as history.
    assert any(
        d["id"] == accepted["id"] and d["operator_status"] == "accepted"
        for d in history
    )


@pytest.mark.asyncio
async def test_current_only_filter_returns_single_generation(client):
    await client.post("/simulate/reset")
    await _get_any_decision(client)

    body = (await client.get("/decisions", params={
        "current_only": "true", "limit": 100,
    })).json()
    current_gen = body["current_plan_generation"]
    assert body["decisions"], "No current decisions found"
    for d in body["decisions"]:
        assert d["plan_generation"] == current_gen
        assert d["is_current"] is True


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
async def test_simulate_reset_clears_progress_counters(client):
    """Reset must rewind simulation progress, not just the entity state.

    load_from_db() rebuilds entities but does not touch the progress counters
    that live only on WorldState, so these were previously left stale and the
    simulation reported itself part-way through a run it had just rewound.
    """
    # Advance far enough that the counters are definitely non-zero.
    for _ in range(3):
        advance = await client.post("/simulate/next")
        if advance.json().get("status") == "no_more_events":
            break

    reset = await client.post("/simulate/reset")
    assert reset.status_code == 200

    scenario = await client.get("/scenario")
    sim = scenario.json()["simulation"]
    assert sim["current_time_min"] == 0
    assert sim["processed_events"] == 0
    assert sim["current_event_index"] == 0
    assert sim["pending_events"] == sim["total_events"]
    assert sim["status"] == "not_started"

    situation = await client.get("/situation")
    assert situation.json()["processed_events"] == 0

    decisions = await client.get("/decisions")
    assert decisions.json()["current_plan_generation"] == 0


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
    """B16: the benchmark must produce real metric values.

    Driven from a pristine reset and advanced until tasks actually exist, rather
    than relying on whatever state earlier tests happened to leave. Previously
    this could reach /benchmark with no tasks and skip itself, so none of the
    metric assertions below ran.
    """
    await _reset_to_pristine_scenario(client)

    tasks = []
    for _ in range(20):
        tasks = (await client.get("/tasks")).json()["tasks"]
        if tasks:
            break
        resp = await client.post("/simulate/next")
        if resp.json().get("status") == "no_more_events":
            break
    assert tasks, "Scenario produced no tasks, so the benchmark cannot be measured"

    resp = await client.get("/benchmark")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") != "no_tasks", (
        "Benchmark reported no tasks despite tasks existing"
    )

    assert "ai_system" in data
    assert "baseline" in data
    assert "improvements" in data

    ai = data["ai_system"]
    # Every metric B16 requires must be present and numerically sane.
    assert 0.0 <= ai["coverage_rate"] <= 1.0
    assert ai["total_travel_time_min"] >= 0.0
    assert ai["weighted_response_time"] >= 0.0
    assert 0.0 <= ai["conflict_detection_rate"] <= 1.0
    assert ai["blocked_route_violations"] >= 0
    assert 0.0 <= ai["decision_confidence_avg"] <= 1.0
    assert 0.0 <= ai["resource_utilization"] <= 1.0
    assert 0.0 <= ai["unmet_critical_demand"] <= 1.0
    assert ai["replanning_events"] >= 0

    # The comparison baseline must be real, not a copy of the AI figures.
    assert "coverage_rate" in data["baseline"]
    assert "total_travel_time_min" in data["baseline"]
