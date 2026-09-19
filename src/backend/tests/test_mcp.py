"""
MCP server tests (B13/B14/B17).

The MCP tools are thin formatters over the FastAPI endpoints, so the failure mode
that matters is a key name in the tool that the endpoint does not actually
return — a KeyError at runtime.

These tests drive the real tool functions over REAL endpoint payloads: every
response is fetched from the live ASGI app first, then handed to the tool through
a patched transport. Nothing is fabricated, so a tool reading a key the endpoint
does not emit fails here exactly as it would in production.
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from httpx import AsyncClient, ASGITransport

REPO_ROOT = Path(__file__).resolve().parents[3]
MCP_SERVER_PATH = REPO_ROOT / "src" / "mcp" / "server.py"
MCP_CONFIG_PATH = REPO_ROOT / "src" / "mcp" / "mcp_config.json"


def _load_mcp_server():
    """Import src/mcp/server.py directly — it is not an installed package."""
    spec = importlib.util.spec_from_file_location("mcp_server_under_test", MCP_SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _startup():
    from app.db.database import init_db, AsyncSessionLocal
    from app.db.seed import seed_database
    from app.engines.simulation import sim_engine
    await init_db()
    async with AsyncSessionLocal() as session:
        await seed_database(session)
        await sim_engine.load_from_db(session)


def _remove_test_db():
    try:
        os.remove("disaster_response.db")
    except (FileNotFoundError, PermissionError, OSError):
        pass


@pytest.fixture(scope="module")
async def mcp(request):
    """Real MCP module wired to the real app through a recorded transport."""
    _remove_test_db()
    await _startup()

    from app.main import app
    server = _load_mcp_server()

    cache: dict[tuple[str, str], dict] = {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:

        async def record(method: str, path: str, payload=None, params=None):
            """Call the real endpoint and cache the real response body."""
            if method == "GET":
                resp = await ac.get(path, params=params)
            else:
                resp = await ac.post(path, json=payload, params=params)
            body = resp.json() if resp.content else {}
            cache[(method, path)] = body
            return body

        def fake_call(method: str, path: str, **kwargs):
            """Stand-in for server._call that serves the recorded real response."""
            key = (method, path)
            if key not in cache:
                raise AssertionError(
                    f"MCP tool requested an un-recorded endpoint: {method} {path}. "
                    f"Add it to the recording step."
                )
            return cache[key]

        server._call = fake_call

        yield server, record, cache

    from app.db.database import engine
    await engine.dispose()
    _remove_test_db()


async def _record_common(record):
    """Drive the scenario far enough to have evidence, decisions and a plan."""
    await record("POST", "/simulate/reset")
    # Advance through the whole scenario so B1 has its conflicting reports and
    # the optimizer has produced decisions.
    for _ in range(14):
        body = await record("POST", "/simulate/next")
        if body.get("status") == "no_more_events":
            break
    await record("GET", "/situation")
    await record("GET", "/priorities")
    await record("GET", "/evidence/B1")
    await record("GET", "/resources")
    await record("GET", "/timeline")
    await record("GET", "/benchmark")
    await record("POST", "/optimize")
    # get_route uses GET /routes with query params.
    await record("GET", "/routes", params={
        "origin": "CC1", "destination": "HP1", "vehicle_type": "heavy",
    })
    await record("POST", "/ai/question", payload={
        "question": "What is the highest priority location right now?",
    })
    decisions = await record("GET", "/decisions")
    return decisions


# ─────────────────────────────────────────────────────────────────────────────
# B13 — every tool formats real endpoint output without raising
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_all_fourteen_tools_are_registered(mcp):
    server, _, _ = mcp
    assert len(server.TOOLS) == 14, f"Expected 14 MCP tools, found {len(server.TOOLS)}"
    for name, tool in server.TOOLS.items():
        assert callable(tool["fn"]), f"{name} has no callable implementation"
        assert tool["description"], f"{name} has no description"


@pytest.mark.asyncio
async def test_all_tools_respond_over_real_payloads(mcp):
    """Each tool must render real endpoint output without error."""
    server, record, _ = mcp
    decisions = await _record_common(record)

    decision_id = None
    if decisions.get("decisions"):
        decision_id = decisions["decisions"][0]["id"]
        await record("GET", f"/decisions/{decision_id}")

    # simulate_event needs its own recorded POST body.
    await record("POST", "/simulate/event", payload={
        "event_type": "bridge_confirmed_blocked",
        "entity_id": "B1",
        "observation_type": "bridge_status",
        "value": "blocked",
        "confidence": 0.95,
        "severity": 0.9,
        "description": "B1 confirmed impassable.",
        "source_type": "authority_report",
    })
    # Re-record /situation so post-injection state is available.
    await record("GET", "/situation")

    invocations = {
        "get_current_situation": {},
        "get_priority_sites": {"top_n": 5},
        "get_entity_evidence": {"entity_id": "B1"},
        "get_route": {"origin": "CC1", "destination": "HP1", "vehicle_type": "heavy"},
        "get_resource_status": {},
        "generate_response_plan": {},
        "simulate_event": {
            "event_type": "bridge_confirmed_blocked",
            "entity_id": "B1",
            "observation_type": "bridge_status",
            "value": "blocked",
            "confidence": 0.95,
            "severity": 0.9,
            "description": "B1 confirmed impassable.",
            "source_type": "authority_report",
        },
        "simulate_next_event": {},
        "recalculate_allocation": {},
        "get_benchmark_metrics": {},
        "ask_operator_question": {
            "question": "What is the highest priority location right now?",
        },
        "get_timeline": {},
        "reset_simulation": {},
    }
    if decision_id:
        invocations["explain_decision"] = {"decision_id": decision_id}

    for name, kwargs in invocations.items():
        fn = server.TOOLS[name]["fn"]
        result = fn(**kwargs)
        assert isinstance(result, str) and result.strip(), (
            f"MCP tool {name} returned nothing"
        )
        assert not result.startswith("Error:"), (
            f"MCP tool {name} reported an error: {result[:200]}"
        )

    # Every tool except explain_decision was exercised; assert we covered them.
    exercised = set(invocations)
    missing = set(server.TOOLS) - exercised
    assert not missing, f"MCP tools never exercised: {sorted(missing)}"


# ─────────────────────────────────────────────────────────────────────────────
# Correction 1 — the /situation key reads
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_situation_priority_keys_match_endpoint(mcp):
    """Guard: the keys the tools read must be the ones /situation emits.

    The tools previously read 'name', 'priority', 'urgency' and 'accessibility';
    /situation emits 'entity_name', 'priority_score', 'urgency_score' and
    'accessibility_factor'. Reading the short names raised KeyError at runtime.
    """
    _, record, _ = mcp
    situation = await record("GET", "/situation")
    top = situation["top_priorities"]
    assert top, "Scenario produced no priorities to check against"

    entry = top[0]
    for correct in (
        "entity_name", "priority_score", "urgency_score", "accessibility_factor",
    ):
        assert correct in entry, f"/situation top_priorities lost {correct}"
    for wrong in ("name", "priority", "urgency", "accessibility"):
        assert wrong not in entry, (
            f"/situation unexpectedly emits short key {wrong!r}; "
            "the MCP fix assumed the long form"
        )


@pytest.mark.asyncio
async def test_get_current_situation_renders_entity_name(mcp):
    server, record, _ = mcp
    situation = await record("GET", "/situation")
    expected_name = situation["top_priorities"][0]["entity_name"]

    output = server.TOOLS["get_current_situation"]["fn"]()
    assert expected_name in output, (
        "get_current_situation did not render the entity name from /situation"
    )


@pytest.mark.asyncio
async def test_simulate_next_event_renders_entity_name(mcp):
    server, record, _ = mcp
    await record("POST", "/simulate/reset")
    body = await record("POST", "/simulate/next")

    output = server.TOOLS["simulate_next_event"]["fn"]()
    assert not output.startswith("Error:")

    top = body.get("situation_update", {}).get("top_priorities", [])
    if top:
        assert top[0]["entity_name"] in output


@pytest.mark.asyncio
async def test_get_entity_evidence_returns_fused_and_raw(mcp):
    """B9/B12: B1 must expose both fused summaries and the raw reports."""
    server, record, _ = mcp
    await _record_common(record)

    evidence = await record("GET", "/evidence/B1")
    assert evidence["evidence_summaries"], "B1 has no fused evidence"
    assert evidence["raw_observations"], "B1 has no raw observations"

    output = server.TOOLS["get_entity_evidence"]["fn"](entity_id="B1")
    assert "FUSED EVIDENCE SUMMARIES" in output
    assert "RAW OBSERVATIONS" in output


# ─────────────────────────────────────────────────────────────────────────────
# B14 — config portability
# ─────────────────────────────────────────────────────────────────────────────

def test_mcp_config_has_no_absolute_developer_paths():
    raw = MCP_CONFIG_PATH.read_text(encoding="utf-8")
    assert "/workspaces/" not in raw, "mcp_config.json still contains /workspaces/"
    assert "/opt/conda" not in raw, "mcp_config.json still pins /opt/conda"

    config = json.loads(raw)
    server_cfg = config["mcpServers"]["disaster-response"]

    # The interpreter must be PATH-resolved, not an absolute path.
    command = server_cfg["command"]
    assert not command.startswith("/"), f"command is an absolute path: {command}"
    assert not (len(command) > 1 and command[1] == ":"), (
        f"command is an absolute Windows path: {command}"
    )

    # The script path must be repo-relative.
    for arg in server_cfg["args"]:
        assert not arg.startswith("/"), f"arg is an absolute path: {arg}"
    assert any("server.py" in arg for arg in server_cfg["args"])


def test_mcp_config_is_valid_json_and_points_at_real_script():
    config = json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8"))
    args = config["mcpServers"]["disaster-response"]["args"]
    script = next(a for a in args if a.endswith("server.py"))
    assert (REPO_ROOT / script).is_file(), (
        f"mcp_config.json points at {script}, which does not exist"
    )
