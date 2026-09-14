"""
Priority & Criticality Engine.

Computes criticality and operational priority scores for all facilities.

Criticality formula:
  criticality = w_pop * population_impact
              + w_svc * service_criticality
              + w_time * time_sensitivity
              + w_iso * isolation_risk
              + w_dmg * damage_severity

Priority formula:
  priority = w_crit * criticality
           + w_urg * urgency
           + w_imp * impact
           + w_acc * accessibility_factor
           + w_conf * confidence_factor

All values normalized to [0, 1].
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from app.config import settings
from app.models.domain import (
    Asset, AssetStatus, EntityType, PriorityScore, EvidenceSummary,
    ConflictStatus, ConfidenceLevel
)

logger = logging.getLogger(__name__)

# Service criticality by entity type (configurable baseline)
SERVICE_CRITICALITY: dict[EntityType, float] = {
    EntityType.HOSPITAL: 1.0,
    EntityType.COMMAND_CENTER: 0.95,
    EntityType.HYDROPOWER: 0.85,
    EntityType.HEALTH_POST: 0.80,
    EntityType.SHELTER: 0.75,
    EntityType.SCHOOL: 0.60,
    EntityType.VILLAGE: 0.55,
    EntityType.RESOURCE_BASE: 0.50,
    EntityType.BRIDGE: 0.70,
    EntityType.ROAD: 0.65,
    EntityType.RIVER: 0.10,
    EntityType.INTERSECTION: 0.30,
}

# Time sensitivity by entity type
TIME_SENSITIVITY: dict[EntityType, float] = {
    EntityType.HOSPITAL: 1.0,
    EntityType.HEALTH_POST: 0.90,
    EntityType.SHELTER: 0.80,
    EntityType.VILLAGE: 0.70,
    EntityType.SCHOOL: 0.75,
    EntityType.HYDROPOWER: 0.65,
    EntityType.COMMAND_CENTER: 0.85,
    EntityType.RESOURCE_BASE: 0.50,
    EntityType.BRIDGE: 0.60,
    EntityType.ROAD: 0.55,
    EntityType.RIVER: 0.10,
    EntityType.INTERSECTION: 0.30,
}

MAX_POPULATION = 10000  # Normalization reference


def compute_criticality(
    asset: Asset,
    damage_severity: float = 0.0,
    isolation_risk: float = 0.0,
) -> float:
    """
    Deterministic criticality score for a facility/asset.
    """
    # Population impact: normalized population / max expected
    population_impact = min(1.0, asset.population / MAX_POPULATION) if asset.population > 0 else 0.0

    service_crit = SERVICE_CRITICALITY.get(asset.type, 0.5)
    time_sens = TIME_SENSITIVITY.get(asset.type, 0.5)

    # Damage severity boosts criticality (damaged critical facilities need more attention)
    effective_damage = min(1.0, damage_severity)
    effective_isolation = min(1.0, isolation_risk)

    criticality = (
        settings.criticality_weight_population_impact * population_impact
        + settings.criticality_weight_service_criticality * service_crit
        + settings.criticality_weight_time_sensitivity * time_sens
        + settings.criticality_weight_isolation_risk * effective_isolation
        + settings.criticality_weight_damage_severity * effective_damage
    )
    return round(min(1.0, criticality), 4)


def compute_priority(
    asset: Asset,
    criticality: float,
    urgency: float,
    accessibility_factor: float,
    confidence_factor: float,
    impact_score: float,
    evidence_summaries: Optional[list[EvidenceSummary]] = None,
) -> PriorityScore:
    """
    Deterministic priority score.
    
    accessibility_factor: 0=unreachable, 1=fully accessible
    confidence_factor: based on evidence quality
    urgency: 0-1 derived from damage/demand observations
    impact_score: 0-1 derived from affected population and cascading consequences
    """
    priority = (
        settings.priority_weight_criticality * criticality
        + settings.priority_weight_urgency * urgency
        + settings.priority_weight_impact * impact_score
        + settings.priority_weight_accessibility * accessibility_factor
        + settings.priority_weight_confidence * confidence_factor
    )
    priority = round(min(1.0, max(0.0, priority)), 4)

    # Build explanation
    factors = []
    if criticality >= 0.8:
        factors.append(f"critical facility type ({asset.type.value})")
    elif criticality >= 0.6:
        factors.append(f"important facility ({asset.type.value})")
    if asset.population > 0:
        factors.append(f"serving {asset.population:,} people")
    if urgency >= 0.7:
        factors.append(f"high urgency ({urgency:.0%})")
    if impact_score >= 0.7:
        factors.append(f"high impact ({impact_score:.0%})")
    if accessibility_factor < 0.5:
        factors.append(f"limited accessibility ({accessibility_factor:.0%})")
    if confidence_factor >= 0.8:
        factors.append("high-confidence evidence")
    elif confidence_factor < 0.5:
        factors.append("low-confidence evidence — verify")

    # Check for conflicts
    if evidence_summaries:
        conflict_items = [s for s in evidence_summaries if s.conflict_status == ConflictStatus.CONFLICTING]
        if conflict_items:
            factors.append(f"⚠ {len(conflict_items)} conflicting evidence item(s)")

    explanation = (
        f"{asset.name} priority {priority:.2f}: "
        + (", ".join(factors) if factors else "standard assessment")
    )

    return PriorityScore(
        entity_id=asset.id,
        entity_name=asset.name,
        entity_type=asset.type,
        priority_score=priority,
        criticality_score=criticality,
        urgency_score=urgency,
        accessibility_factor=accessibility_factor,
        confidence_factor=confidence_factor,
        impact_score=impact_score,
        explanation=explanation,
        supporting_factors=factors,
    )


def derive_urgency(asset: Asset, evidence_summaries: list[EvidenceSummary]) -> float:
    """
    Derive urgency from evidence.
    High urgency if: overloaded, evacuation_required, isolated, blocked access.
    """
    urgency = 0.0
    status_contributions = {
        "overloaded": 0.9,
        "evacuation_required": 0.85,
        "isolated": 0.95,
        "flooded": 0.80,
        "blocked": 0.70,
        "damaged": 0.60,
        "destroyed": 1.0,
        "unavailable": 0.75,
    }
    # Take max urgency from any evidence
    for summary in evidence_summaries:
        contribution = status_contributions.get(summary.best_value, 0.0)
        urgency = max(urgency, contribution)

    # Also boost for asset's current status
    status_urgency_map = {
        AssetStatus.OVERLOADED: 0.9,
        AssetStatus.FLOODED: 0.85,
        AssetStatus.DAMAGED: 0.65,
        AssetStatus.DESTROYED: 1.0,
        AssetStatus.EVACUATED: 0.70,
        AssetStatus.UNKNOWN: 0.30,
    }
    urgency = max(urgency, status_urgency_map.get(asset.status, 0.0))
    return min(1.0, urgency)


def derive_isolation_risk(asset: Asset, evidence_summaries: list[EvidenceSummary]) -> float:
    """Determine isolation risk from evidence."""
    for summary in evidence_summaries:
        if summary.best_value == "isolated":
            return summary.confidence
        if summary.best_value in ("blocked",) and summary.confidence >= 0.7:
            return 0.7
    return 0.0


def derive_damage_severity(asset: Asset, evidence_summaries: list[EvidenceSummary]) -> float:
    """Derive damage severity from evidence."""
    severity_map = {
        "destroyed": 1.0,
        "blocked": 0.85,
        "flooded": 0.75,
        "damaged": 0.65,
        "overloaded": 0.55,
        "evacuation_required": 0.50,
        "partially_blocked": 0.45,
        "high_risk": 0.40,
        "unavailable": 0.60,
    }
    max_severity = 0.0
    for summary in evidence_summaries:
        sev = severity_map.get(summary.best_value, 0.0) * summary.confidence
        max_severity = max(max_severity, sev)
    return min(1.0, max_severity)


def derive_confidence_factor(evidence_summaries: list[EvidenceSummary]) -> float:
    """Average confidence across relevant evidence."""
    if not evidence_summaries:
        return 0.3  # Low confidence when no evidence
    confidences = [s.confidence for s in evidence_summaries]
    avg = sum(confidences) / len(confidences)
    # Penalty for conflicting evidence
    conflicts = sum(1 for s in evidence_summaries if s.conflict_status == ConflictStatus.CONFLICTING)
    if conflicts > 0:
        avg *= (1 - 0.15 * conflicts)
    return round(min(1.0, avg), 4)
