"""
Evidence Fusion Engine.

Processes multiple observations about the same entity+attribute and produces
a deterministic fused state with uncertainty quantification.

Algorithm:
  1. Compute freshness: exp(-lambda * age_hours)
  2. Compute evidence weight: source_reliability * confidence * freshness
  3. Group observations by normalized value category
  4. Detect conflicts if leading value support < threshold
  5. Produce EvidenceSummary with best estimate, confidence, and conflict flag.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import datetime
from typing import Optional

from app.config import get_freshness_lambda, get_source_reliability, settings
from app.models.domain import (
    ConflictStatus, ConfidenceLevel, EvidenceSummary, Observation, ObservationType
)

logger = logging.getLogger(__name__)


def compute_freshness(observation: Observation, now: Optional[datetime] = None) -> float:
    """
    freshness = exp(-lambda * age_hours)
    Lambda is configurable per observation type.
    """
    if now is None:
        now = datetime.utcnow()
    obs_time = observation.timestamp
    age_seconds = (now - obs_time).total_seconds()
    age_hours = max(0.0, age_seconds / 3600.0)
    lam = get_freshness_lambda(observation.observation_type.value)
    return math.exp(-lam * age_hours)


def compute_evidence_weight(
    observation: Observation,
    freshness: Optional[float] = None,
    now: Optional[datetime] = None,
) -> float:
    """
    weight = source_reliability * observation_confidence * freshness
    All factors in [0, 1].
    """
    reliability = get_source_reliability(observation.source_type.value)
    if freshness is None:
        freshness = compute_freshness(observation, now)
    return reliability * observation.confidence * freshness


def _normalize_value(value: str) -> str:
    """Normalize observation values to canonical categories for conflict detection."""
    v = value.lower().strip()
    # Bridge/road accessibility
    if v in ("blocked", "impassable", "collapsed", "destroyed", "closed"):
        return "blocked"
    if v in ("open", "clear", "passable", "operational", "good"):
        return "open"
    if v in ("partially_blocked", "partial", "damaged", "high_risk"):
        return "partially_blocked"
    if v in ("unknown", "unverified"):
        return "unknown"
    # Flood
    if v in ("flooding", "flooded", "inundated"):
        return "flooded"
    # Status
    if v in ("overloaded", "at_capacity", "full"):
        return "overloaded"
    if v in ("evacuation_required", "evacuated", "evacuating"):
        return "evacuation_required"
    if v in ("isolated", "cut_off", "unreachable"):
        return "isolated"
    if v in ("unavailable", "offline", "out_of_service", "mechanical_failure"):
        return "unavailable"
    # Weather
    if v in ("major_rainfall", "heavy_rain", "storm"):
        return "major_rainfall"
    return v


def _confidence_level(confidence: float) -> ConfidenceLevel:
    if confidence >= 0.75:
        return ConfidenceLevel.HIGH
    if confidence >= 0.50:
        return ConfidenceLevel.MEDIUM
    if confidence >= 0.25:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW


def fuse_observations(
    observations: list[Observation],
    entity_id: str,
    observation_type: ObservationType,
    now: Optional[datetime] = None,
) -> EvidenceSummary:
    """
    Deterministically fuse multiple observations into a single EvidenceSummary.
    
    Returns best current state, confidence, conflict detection.
    """
    if now is None:
        now = datetime.utcnow()

    if not observations:
        return EvidenceSummary(
            entity_id=entity_id,
            observation_type=observation_type,
            best_value="unknown",
            confidence=0.0,
            conflict_status=ConflictStatus.NONE,
            confidence_level=ConfidenceLevel.VERY_LOW,
            source_count=0,
            last_verified=now,
        )

    # Compute weights and freshness for all observations
    weighted: list[tuple[Observation, float, float]] = []
    for obs in observations:
        freshness = compute_freshness(obs, now)
        weight = compute_evidence_weight(obs, freshness=freshness, now=now)
        weighted.append((obs, weight, freshness))

    # Update freshness on observations (in-memory only)
    for obs, _, freshness in weighted:
        obs.freshness = freshness

    # Group by normalized value
    value_groups: dict[str, list[tuple[Observation, float, float]]] = defaultdict(list)
    for obs, weight, freshness in weighted:
        norm_val = _normalize_value(obs.value)
        value_groups[norm_val].append((obs, weight, freshness))

    # Calculate total support per value
    total_weight = sum(w for _, w, _ in weighted)
    if total_weight == 0:
        total_weight = 1e-9

    value_support: dict[str, float] = {}
    for val, group in value_groups.items():
        value_support[val] = sum(w for _, w, _ in group)

    # Best value is highest total weighted support
    best_value = max(value_support, key=lambda v: value_support[v])
    best_support = value_support[best_value]
    # Confidence = (fraction of weight supporting best value) * (average weight of supporting obs)
    # This means a single stale/low-confidence obs gets a low confidence score
    support_fraction = best_support / total_weight
    best_group = value_groups[best_value]
    avg_weight_of_best = best_support / len(best_group)  # average weight per supporting obs
    normalized_confidence = min(1.0, support_fraction * avg_weight_of_best)

    # Conflict detection: if second-best value has significant support
    sorted_values = sorted(value_support.items(), key=lambda x: x[1], reverse=True)
    conflict = ConflictStatus.NONE
    conflicting_obs_ids: list[str] = []

    if len(sorted_values) > 1:
        second_best_val, second_best_support = sorted_values[1]
        second_ratio = second_best_support / total_weight
        # Mark as conflicting if second-best has > threshold of support
        if second_ratio >= settings.conflict_weight_difference_threshold:
            conflict = ConflictStatus.CONFLICTING
            conflicting_obs_ids = [obs.id for obs, _, _ in value_groups[second_best_val]]
            logger.info(
                f"CONFLICT DETECTED: {entity_id}/{observation_type.value} — "
                f"'{best_value}'({normalized_confidence:.2f}) vs "
                f"'{second_best_val}'({second_ratio:.2f})"
            )

    supporting_obs_ids = [obs.id for obs, _, _ in value_groups[best_value]]

    # Recommendation for conflicts
    recommendation = None
    if conflict == ConflictStatus.CONFLICTING:
        recommendation = (
            f"Conflicting evidence for {observation_type.value} on entity {entity_id}. "
            f"Best estimate: '{best_value}' ({normalized_confidence:.0%} support). "
            "Recommend field verification before dispatching resources."
        )

    return EvidenceSummary(
        entity_id=entity_id,
        observation_type=observation_type,
        best_value=best_value,
        confidence=round(normalized_confidence, 4),
        conflict_status=conflict,
        confidence_level=_confidence_level(normalized_confidence),
        supporting_observations=supporting_obs_ids,
        conflicting_observations=conflicting_obs_ids,
        last_verified=max(obs.timestamp for obs in observations),
        source_count=len(observations),
        recommendation=recommendation,
    )
