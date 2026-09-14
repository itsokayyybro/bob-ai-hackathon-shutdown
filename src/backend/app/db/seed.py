"""
Seed database with the synthetic Bhote Valley scenario data.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import (
    AssetDB, RoadDB, BridgeDB, ResourceDB, SimEventDB
)

logger = logging.getLogger(__name__)

SCENARIO_FILE = Path(__file__).parent.parent.parent.parent.parent / "src" / "data" / "scenario_nepal_inspired.json"


def _load_scenario() -> dict:
    # Try multiple paths (dev vs installed)
    candidates = [
        Path(__file__).parent.parent.parent.parent.parent / "src" / "data" / "scenario_nepal_inspired.json",
        Path("/workspaces/bob-ai-hackathon-shutdown/src/data/scenario_nepal_inspired.json"),
        Path("src/data/scenario_nepal_inspired.json"),
    ]
    for p in candidates:
        if p.exists():
            with open(p) as f:
                return json.load(f)
    raise FileNotFoundError("scenario_nepal_inspired.json not found")


async def seed_database(session: AsyncSession) -> None:
    """Load the scenario file and populate all tables. Idempotent."""
    # Check if already seeded
    from sqlalchemy import select
    result = await session.execute(select(AssetDB).limit(1))
    if result.scalar_one_or_none() is not None:
        logger.info("Database already seeded, skipping.")
        return

    scenario = _load_scenario()
    logger.info(f"Seeding scenario: {scenario['scenario_name']}")

    # Assets
    for a in scenario["assets"]:
        loc = a["location"]
        asset = AssetDB(
            id=a["id"],
            name=a["name"],
            type=a["type"],
            lat=loc["lat"],
            lon=loc["lon"],
            elevation_m=loc.get("elevation_m"),
            population=a.get("population", 0),
            criticality=a.get("criticality", 0.5),
            importance=a.get("importance", 0.5),
            status=a.get("status", "operational"),
            metadata_json=json.dumps(a.get("metadata", {})),
        )
        session.add(asset)

    # Roads
    for r in scenario["roads"]:
        road = RoadDB(
            id=r["id"],
            name=r["name"],
            from_node=r["from_node"],
            to_node=r["to_node"],
            distance_km=r["distance_km"],
            travel_time_min=r["travel_time_min"],
            status=r.get("status", "open"),
            risk=r.get("risk", 0.1),
            vehicle_restrictions_json=json.dumps(r.get("vehicle_restrictions", [])),
            confidence=r.get("confidence", 1.0),
            last_updated=datetime.utcnow(),
            metadata_json=json.dumps(r.get("metadata", {})),
        )
        session.add(road)

    # Bridges
    for b in scenario["bridges"]:
        loc = b["location"]
        bridge = BridgeDB(
            id=b["id"],
            name=b["name"],
            on_road=b["on_road"],
            lat=loc["lat"],
            lon=loc["lon"],
            elevation_m=loc.get("elevation_m"),
            status=b.get("status", "open"),
            capacity=b.get("capacity", "heavy"),
            confidence=b.get("confidence", 1.0),
            conflict_status="none",
            last_updated=datetime.utcnow(),
        )
        session.add(bridge)

    # Resources
    for res in scenario["resources"]:
        resource = ResourceDB(
            id=res["id"],
            name=res["name"],
            type=res["type"],
            status=res.get("status", "available"),
            location_id=res["location_id"],
            capabilities_json=json.dumps(res.get("capabilities", [])),
            capacity=res.get("capacity", 1),
            current_task_id=None,
            metadata_json=json.dumps(res.get("metadata", {})),
        )
        session.add(resource)

    # Simulation events
    for evt in scenario["simulation_events"]:
        sim_evt = SimEventDB(
            id=evt["id"],
            time_offset_min=evt["time_offset_min"],
            event_type=evt["event_type"],
            description=evt["description"],
            entity_id=evt.get("entity_id"),
            source_type=evt.get("source_type", "simulation"),
            observation_type=evt.get("observation_type"),
            value=evt.get("value"),
            confidence=evt.get("confidence", 1.0),
            severity=evt.get("severity", 0.5),
            metadata_json=json.dumps(evt.get("metadata", {})),
            processed=False,
        )
        session.add(sim_evt)

    await session.commit()
    logger.info(
        f"Seeded {len(scenario['assets'])} assets, "
        f"{len(scenario['roads'])} roads, "
        f"{len(scenario['bridges'])} bridges, "
        f"{len(scenario['resources'])} resources, "
        f"{len(scenario['simulation_events'])} events."
    )
