"""
Configuration for the disaster response system.
All tunable parameters are here — no magic numbers scattered through code.
"""
from __future__ import annotations
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── Application ──────────────────────────────────────────────────────────
    app_port: int = Field(default=8000, alias="APP_PORT")
    app_env: str = Field(default="development", alias="APP_ENV")
    debug: bool = Field(default=True, alias="DEBUG")

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = Field(default="sqlite+aiosqlite:///./disaster_response.db", alias="DATABASE_URL")

    # ── AI Provider ──────────────────────────────────────────────────────────
    watsonx_api_key: str = Field(default="", alias="WATSONX_API_KEY")
    watsonx_project_id: str = Field(default="", alias="WATSONX_PROJECT_ID")
    watsonx_url: str = Field(default="https://us-south.ml.cloud.ibm.com", alias="WATSONX_URL")
    watsonx_model_id: str = Field(default="ibm/granite-3-8b-instruct", alias="WATSONX_MODEL_ID")

    # ── Source Reliability Defaults (configurable) ───────────────────────────
    reliability_satellite: float = 0.85
    reliability_drone: float = 0.90
    reliability_field_report: float = 0.88
    reliability_emergency_call: float = 0.75
    reliability_hospital: float = 0.95
    reliability_school: float = 0.85
    reliability_sensor: float = 0.80
    reliability_authority_report: float = 0.92
    reliability_simulation: float = 1.00

    # ── Freshness Decay Lambdas (per hour) ───────────────────────────────────
    # freshness = exp(-lambda * age_hours)
    freshness_lambda_bridge_status: float = 2.0      # fast decay
    freshness_lambda_road_status: float = 1.5
    freshness_lambda_hospital_capacity: float = 2.0
    freshness_lambda_structural_damage: float = 0.5  # moderate
    freshness_lambda_population: float = 0.1         # slow
    freshness_lambda_flood_level: float = 3.0        # very fast
    freshness_lambda_default: float = 1.0

    # ── Criticality Weights ──────────────────────────────────────────────────
    criticality_weight_population_impact: float = 0.25
    criticality_weight_service_criticality: float = 0.25
    criticality_weight_time_sensitivity: float = 0.20
    criticality_weight_isolation_risk: float = 0.15
    criticality_weight_damage_severity: float = 0.15

    # ── Priority Weights ─────────────────────────────────────────────────────
    priority_weight_criticality: float = 0.30
    priority_weight_urgency: float = 0.25
    priority_weight_impact: float = 0.20
    priority_weight_accessibility: float = 0.15
    priority_weight_confidence: float = 0.10

    # ── Risk penalties for unknown roads ─────────────────────────────────────
    risk_penalty_unknown_road: float = 0.4
    risk_penalty_high_risk_road: float = 0.6
    risk_penalty_partially_blocked: float = 0.8

    # ── Conflict threshold ───────────────────────────────────────────────────
    conflict_weight_difference_threshold: float = 0.3

    model_config = {"env_file": "src/.env", "populate_by_name": True, "extra": "ignore"}


settings = Settings()


def get_source_reliability(source_type: str) -> float:
    mapping = {
        "satellite": settings.reliability_satellite,
        "drone": settings.reliability_drone,
        "field_report": settings.reliability_field_report,
        "emergency_call": settings.reliability_emergency_call,
        "hospital": settings.reliability_hospital,
        "school": settings.reliability_school,
        "sensor": settings.reliability_sensor,
        "authority_report": settings.reliability_authority_report,
        "simulation": settings.reliability_simulation,
    }
    return mapping.get(source_type, 0.70)


def get_freshness_lambda(observation_type: str) -> float:
    mapping = {
        "bridge_status": settings.freshness_lambda_bridge_status,
        "road_status": settings.freshness_lambda_road_status,
        "capacity": settings.freshness_lambda_hospital_capacity,
        "structural": settings.freshness_lambda_structural_damage,
        "population": settings.freshness_lambda_population,
        "flood_level": settings.freshness_lambda_flood_level,
    }
    return mapping.get(observation_type, settings.freshness_lambda_default)
