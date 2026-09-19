"""
Database initialization and session management.
Uses SQLAlchemy + aiosqlite for async SQLite.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import AsyncGenerator

from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime, Text,
    event as sa_event
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# ─────────────────────────────────────────────────────────────────────────────
# ORM Tables
# ─────────────────────────────────────────────────────────────────────────────

class AssetDB(Base):
    __tablename__ = "assets"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    elevation_m = Column(Float, nullable=True)
    population = Column(Integer, default=0)
    criticality = Column(Float, default=0.5)
    importance = Column(Float, default=0.5)
    status = Column(String, default="operational")
    metadata_json = Column(Text, default="{}")


class RoadDB(Base):
    __tablename__ = "roads"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    from_node = Column(String, nullable=False)
    to_node = Column(String, nullable=False)
    distance_km = Column(Float, nullable=False)
    travel_time_min = Column(Float, nullable=False)
    status = Column(String, default="open")
    risk = Column(Float, default=0.1)
    vehicle_restrictions_json = Column(Text, default="[]")
    confidence = Column(Float, default=1.0)
    last_updated = Column(DateTime, default=datetime.utcnow)
    metadata_json = Column(Text, default="{}")


class BridgeDB(Base):
    __tablename__ = "bridges"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    on_road = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    elevation_m = Column(Float, nullable=True)
    status = Column(String, default="open")
    capacity = Column(String, default="heavy")
    confidence = Column(Float, default=1.0)
    conflict_status = Column(String, default="none")
    last_updated = Column(DateTime, default=datetime.utcnow)


class ResourceDB(Base):
    __tablename__ = "resources"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    status = Column(String, default="available")
    location_id = Column(String, nullable=False)
    capabilities_json = Column(Text, default="[]")
    capacity = Column(Integer, default=1)
    current_task_id = Column(String, nullable=True)
    metadata_json = Column(Text, default="{}")


class ObservationDB(Base):
    __tablename__ = "observations"
    id = Column(String, primary_key=True)
    event_id = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    source_type = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    observation_type = Column(String, nullable=False)
    value = Column(String, nullable=False)
    severity = Column(Float, default=0.5)
    confidence = Column(Float, default=0.8)
    freshness = Column(Float, default=1.0)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    raw_text = Column(Text, nullable=True)
    structured_data_json = Column(Text, default="{}")
    provenance_json = Column(Text, default="{}")
    status = Column(String, default="active")


class AuditDB(Base):
    __tablename__ = "audit_log"
    id = Column(String, primary_key=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    event_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=True)
    previous_state_json = Column(Text, nullable=True)
    new_state_json = Column(Text, nullable=True)
    decision_id = Column(String, nullable=True)
    reason = Column(Text, default="")
    confidence = Column(Float, default=1.0)
    simulation_time_min = Column(Integer, default=0)


class DecisionDB(Base):
    """A system recommendation.

    Rows are INSERT-ONLY: a replan never rewrites an existing recommendation,
    it inserts a new one. The only column ever updated after insert is the pair
    of operator_* fields below, which record a human's response and are
    explicitly not part of the recommendation itself.
    """
    __tablename__ = "decisions"
    id = Column(String, primary_key=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    recommended_action = Column(Text, nullable=False)
    target_entity_id = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    priority = Column(Float, default=0.5)
    confidence = Column(Float, default=0.5)
    reasons_json = Column(Text, default="[]")
    evidence_ids_json = Column(Text, default="[]")
    constraints_json = Column(Text, default="[]")
    alternatives_json = Column(Text, default="[]")
    human_verification_required = Column(Boolean, default=True)
    simulation_time_min = Column(Integer, default=0)

    # ── B7: exact join key to AllocationResult.task_id ───────────────────────
    # DecisionExplanation historically carried only target_entity_id and
    # resource_id, so joining a decision to the allocation it describes had to
    # be inferred. Task ids are deterministic and stable across replans
    # (TASK-{asset_id}-{task_type}), so this makes the join exact.
    task_id = Column(String, nullable=True, index=True)

    # ── Correction 4 / B4: decision currency ─────────────────────────────────
    # Monotonic counter incremented once per optimizer run that persists
    # decisions. A row is CURRENT iff plan_generation == the world state's
    # current generation; everything lower is superseded history. Chosen over a
    # `superseded_at` timestamp because it requires no write to any existing
    # row, preserving insert-only semantics, and because timestamps collide
    # within a single plan.
    plan_generation = Column(Integer, default=0, index=True)

    # ── B3: operator response (NOT part of the recommendation) ───────────────
    operator_status = Column(String, nullable=True, default=None)
    operator_notes = Column(Text, nullable=True, default=None)


class SimEventDB(Base):
    __tablename__ = "sim_events"
    id = Column(String, primary_key=True)
    time_offset_min = Column(Integer, nullable=False)
    event_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    entity_id = Column(String, nullable=True)
    source_type = Column(String, default="simulation")
    observation_type = Column(String, nullable=True)
    value = Column(String, nullable=True)
    confidence = Column(Float, default=1.0)
    severity = Column(Float, default=0.5)
    metadata_json = Column(Text, default="{}")
    processed = Column(Boolean, default=False)


# ─────────────────────────────────────────────────────────────────────────────
# Session dependency
# ─────────────────────────────────────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created.")
