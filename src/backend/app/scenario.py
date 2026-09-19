"""
Scenario loading and metadata.

Single source of truth for the active scenario's identity. Business logic and
API handlers must read scenario name/type/geography from here rather than
embedding literal strings, so that swapping the scenario file cannot leave
stale names scattered through the code.

The active scenario is the synthetic Nepal-inspired Bhote Valley simulation.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCENARIO_FILENAME = "scenario_nepal_inspired.json"

# ``__file__`` is not guaranteed to be normalized: when this package is imported
# through a sys.path entry that still contains a ".." segment (the test modules
# add ``<backend>/tests/..``), ``__file__`` becomes
# ``<backend>/tests/../app/scenario.py``. ``Path.parent`` strips ".." as a
# literal path component instead of resolving it, which shifts the parent chain
# one level too deep. ``resolve()`` normalizes the path before walking parents.
_THIS_FILE = Path(__file__).resolve()
BACKEND_DIR = _THIS_FILE.parents[1]   # <repo>/src/backend
SRC_DIR = _THIS_FILE.parents[2]       # <repo>/src
REPO_ROOT = _THIS_FILE.parents[3]     # <repo>

SCENARIO_FILE = SRC_DIR / "data" / SCENARIO_FILENAME

# Defaults used only when the scenario file omits the field, so that older or
# minimal scenario files stay loadable.
_METADATA_DEFAULTS: dict[str, Any] = {
    "scenario_name": "Unnamed Scenario",
    "description": "",
    "scenario_type": "disaster_response_simulation",
    "geography": "synthetic",
    "synthetic": True,
}

_cache: dict[str, Any] | None = None


def load_scenario() -> dict[str, Any]:
    """Load and cache the scenario JSON.

    Resolution is anchored on this module's location so it works regardless of
    the current working directory or how the package was imported. The
    cwd-relative candidates remain as a fallback for non-standard layouts.
    """
    global _cache
    if _cache is not None:
        return _cache

    candidates = [
        SCENARIO_FILE,
        Path("src") / "data" / SCENARIO_FILENAME,
        Path("data") / SCENARIO_FILENAME,
    ]
    for p in candidates:
        if p.exists():
            with open(p, encoding="utf-8") as f:
                _cache = json.load(f)
            return _cache

    searched = ", ".join(str(c) for c in candidates)
    raise FileNotFoundError(f"{SCENARIO_FILENAME} not found. Searched: {searched}")


def reload_scenario() -> dict[str, Any]:
    """Drop the cache and re-read the scenario file."""
    global _cache
    _cache = None
    return load_scenario()


def get_scenario_metadata() -> dict[str, Any]:
    """Static scenario identity plus entity counts.

    Runtime simulation state (current time, event index, status) is NOT included
    here — that belongs to the world state, not the scenario file.
    """
    scenario = load_scenario()
    meta = {key: scenario.get(key, default) for key, default in _METADATA_DEFAULTS.items()}
    meta["counts"] = {
        "assets": len(scenario.get("assets", [])),
        "roads": len(scenario.get("roads", [])),
        "bridges": len(scenario.get("bridges", [])),
        "resources": len(scenario.get("resources", [])),
        "simulation_events": len(scenario.get("simulation_events", [])),
    }
    return meta


def get_scenario_name() -> str:
    """Display name of the active scenario."""
    return get_scenario_metadata()["scenario_name"]
