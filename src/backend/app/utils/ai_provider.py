"""
AI Provider abstraction.

Provides a clean interface for natural-language generation.
Two implementations:
  1. DeterministicProvider — works without any external credentials.
     Generates structured summaries from actual system state.
  2. WatsonxProvider — uses IBM watsonx.ai if credentials are configured.

The deterministic provider is the fallback and produces useful output.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class AIProvider(ABC):
    """Abstract AI provider interface."""

    @abstractmethod
    def generate_situation_summary(self, state_summary: dict) -> str:
        """Generate a BLUF situation summary from structured state."""
        ...

    @abstractmethod
    def explain_decision(self, decision_data: dict) -> str:
        """Generate a natural-language explanation for a decision."""
        ...

    @abstractmethod
    def answer_operator_question(self, question: str, context: dict) -> str:
        """Answer a natural-language operator question given structured context."""
        ...


class DeterministicProvider(AIProvider):
    """
    Generates human-readable summaries from structured state without any LLM.
    All output is derived from actual system state — no fabrication.
    """

    def generate_situation_summary(self, state_summary: dict) -> str:
        """Generate BLUF from structured state."""
        from app.scenario import get_scenario_name
        lines = [f"## SITUATION REPORT — {get_scenario_name().upper()}\n"]
        lines.append(f"**Simulation Time:** T+{state_summary.get('sim_time_min', 0)} minutes\n")

        top_priorities = state_summary.get("top_priorities", [])
        if top_priorities:
            lines.append("**HIGHEST PRIORITY LOCATIONS:**")
            for i, p in enumerate(top_priorities[:3], 1):
                lines.append(
                    f"  {i}. {p['name']} (priority={p['priority']:.2f}, "
                    f"urgency={p['urgency']:.0%})"
                )

        blocked = state_summary.get("blocked_infrastructure", [])
        if blocked:
            lines.append(f"\n**BLOCKED INFRASTRUCTURE:** {', '.join(blocked)}")

        conflicts = state_summary.get("evidence_conflicts", [])
        if conflicts:
            lines.append(f"\n**⚠ CONFLICTING EVIDENCE ({len(conflicts)}):**")
            for c in conflicts:
                lines.append(f"  - {c}")

        unavailable = state_summary.get("unavailable_resources", [])
        if unavailable:
            lines.append(f"\n**UNAVAILABLE RESOURCES:** {', '.join(unavailable)}")

        plan = state_summary.get("current_plan_summary", "")
        if plan:
            lines.append(f"\n**RESPONSE PLAN:** {plan}")

        lines.append("\n*Model assessment — requires operator verification.*")
        return "\n".join(lines)

    def explain_decision(self, decision_data: dict) -> str:
        """Build natural-language explanation from structured decision data."""
        action = decision_data.get("recommended_action", "Unknown action")
        reasons = decision_data.get("reasons", [])
        confidence = decision_data.get("confidence", 0.5)
        constraints = decision_data.get("constraints", [])
        alternatives = decision_data.get("alternatives_considered", [])

        lines = [f"**Decision:** {action}\n"]
        lines.append(f"**Confidence:** {confidence:.0%}")

        if reasons:
            lines.append("\n**Why this decision:**")
            for r in reasons:
                lines.append(f"  • {r}")

        if constraints:
            lines.append("\n**Constraints applied:**")
            for c in constraints:
                lines.append(f"  • {c}")

        if alternatives:
            lines.append("\n**Alternatives considered:**")
            for a in alternatives:
                lines.append(f"  • {a}")

        lines.append("\n*Recommended action — human operator verification required.*")
        return "\n".join(lines)

    def answer_operator_question(self, question: str, context: dict) -> str:
        """Rule-based Q&A using structured context."""
        q_lower = question.lower()
        
        # Highest priority / what should we do
        if any(kw in q_lower for kw in ["priority", "first", "highest", "most important", "focus"]):
            top = context.get("top_priorities", [])
            if top:
                p = top[0]
                return (
                    f"**Highest priority: {p['name']}** (score: {p['priority']:.2f})\n\n"
                    f"{p.get('explanation', '')}\n\n"
                    f"Confidence: {p.get('confidence', 'unknown')}"
                )
            return "No priority data available yet. Run simulation or inject events first."

        # Route questions
        if any(kw in q_lower for kw in ["route", "reach", "get to", "path", "way to"]):
            routes = context.get("routes", {})
            blocked = context.get("blocked_infrastructure", [])
            if blocked:
                return (
                    f"**Blocked infrastructure:** {', '.join(blocked)}\n\n"
                    "Routing engine has recalculated around blocked segments. "
                    "Check the route panel for current feasible paths."
                )
            return "All major routes currently appear feasible. Use route panel for specific paths."

        # Bridge questions
        if any(kw in q_lower for kw in ["bridge", "b1", "crossing"]):
            bridges = context.get("bridges", {})
            b1 = bridges.get("B1", {})
            if b1:
                status = b1.get("status", "unknown")
                conf = b1.get("confidence", 0)
                conflict = b1.get("conflict_status", "none")
                resp = f"**Bridge B1 (Bhote Koshi Main Bridge):** Status = {status.upper()}, Confidence = {conf:.0%}"
                if conflict == "conflicting":
                    resp += "\n⚠ **CONFLICTING EVIDENCE** — verify before routing."
                return resp
            return "Bridge status information not available."

        # Resources
        if any(kw in q_lower for kw in ["resource", "ambulance", "rescue", "team", "available"]):
            resources = context.get("resources", [])
            available = [r for r in resources if r.get("status") == "available"]
            unavailable = [r for r in resources if r.get("status") == "unavailable"]
            resp = f"**Available resources ({len(available)}):** {', '.join(r['name'] for r in available)}"
            if unavailable:
                resp += f"\n**Unavailable:** {', '.join(r['name'] for r in unavailable)}"
            return resp

        # Evidence / why
        if any(kw in q_lower for kw in ["why", "evidence", "reason", "explain", "confidence"]):
            conflicts = context.get("evidence_conflicts", [])
            if conflicts:
                return (
                    f"**Evidence conflicts detected ({len(conflicts)}):**\n"
                    + "\n".join(f"  • {c}" for c in conflicts)
                    + "\n\nSystem prioritizes higher-confidence, more recent observations. "
                    "Human verification recommended for conflicting items."
                )
            return (
                "Decision is based on evidence fusion from all active observations. "
                "Higher-reliability sources (hospital, drone) are weighted more heavily. "
                "Freshness decay reduces weight of older observations."
            )

        # Current situation
        if any(kw in q_lower for kw in ["situation", "status", "overview", "what is happening"]):
            return self.generate_situation_summary(context)

        # Default
        return (
            f"I understand you're asking about: '{question}'\n\n"
            "Available information:\n"
            f"• Simulation time: T+{context.get('sim_time_min', 0)} minutes\n"
            f"• Priority locations: {len(context.get('top_priorities', []))}\n"
            f"• Evidence conflicts: {len(context.get('evidence_conflicts', []))}\n"
            f"• Blocked infrastructure: {len(context.get('blocked_infrastructure', []))}\n\n"
            "Use specific MCP tools for detailed queries: get_priority_sites(), "
            "get_entity_evidence(), get_route(), get_resource_status()."
        )


class WatsonxProvider(AIProvider):
    """
    IBM watsonx.ai provider. Used only when credentials are configured.
    Calls are non-authoritative — deterministic engine owns all state decisions.
    """

    def __init__(self, api_key: str, project_id: str, url: str, model_id: str) -> None:
        self.api_key = api_key
        self.project_id = project_id
        self.url = url
        self.model_id = model_id
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from ibm_watsonx_ai import Credentials
                from ibm_watsonx_ai.foundation_models import ModelInference
                credentials = Credentials(url=self.url, api_key=self.api_key)
                self._client = ModelInference(
                    model_id=self.model_id,
                    credentials=credentials,
                    project_id=self.project_id,
                )
                logger.info(f"WatsonxProvider initialized with model: {self.model_id}")
            except Exception as e:
                logger.error(f"Failed to initialize watsonx client: {e}")
                return None
        return self._client

    def _generate(self, prompt: str, max_tokens: int = 400) -> str:
        client = self._get_client()
        if client is None:
            return "[watsonx unavailable — falling back to deterministic provider]"
        try:
            response = client.generate_text(
                prompt=prompt,
                params={"max_new_tokens": max_tokens, "temperature": 0.3},
            )
            return response
        except Exception as e:
            logger.error(f"watsonx generation failed: {e}")
            return f"[watsonx error: {e}]"

    def generate_situation_summary(self, state_summary: dict) -> str:
        top = state_summary.get("top_priorities", [])
        blocked = state_summary.get("blocked_infrastructure", [])
        conflicts = state_summary.get("evidence_conflicts", [])
        sim_time = state_summary.get("sim_time_min", 0)

        prompt = (
            "You are an emergency operations AI assistant. "
            "Generate a concise BLUF (Bottom Line Up Front) situation summary for emergency operators.\n\n"
            f"Simulation time: T+{sim_time} minutes\n"
            f"Top priority locations: {[p['name'] for p in top[:3]]}\n"
            f"Blocked infrastructure: {blocked}\n"
            f"Evidence conflicts: {conflicts}\n\n"
            "Write a 3-4 sentence operational summary. Be factual, concise, and action-oriented. "
            "Start with the most critical finding."
        )
        result = self._generate(prompt)
        if result.startswith("[watsonx"):
            return DeterministicProvider().generate_situation_summary(state_summary)
        return result + "\n\n*AI-generated summary — requires operator verification.*"

    def explain_decision(self, decision_data: dict) -> str:
        action = decision_data.get("recommended_action", "")
        reasons = decision_data.get("reasons", [])
        prompt = (
            "You are an emergency operations AI. Explain this decision to an operator:\n\n"
            f"Recommended action: {action}\n"
            f"Supporting reasons: {reasons}\n\n"
            "Explain clearly in 2-3 sentences why this decision was made. "
            "Mention key constraints and confidence level."
        )
        result = self._generate(prompt, max_tokens=200)
        if result.startswith("[watsonx"):
            return DeterministicProvider().explain_decision(decision_data)
        return result

    def answer_operator_question(self, question: str, context: dict) -> str:
        top = context.get("top_priorities", [])
        blocked = context.get("blocked_infrastructure", [])
        sim_time = context.get("sim_time_min", 0)

        prompt = (
            "You are an emergency operations AI assistant for a disaster response system. "
            "Answer the operator's question based on the current system state.\n\n"
            f"Current state summary:\n"
            f"- Simulation time: T+{sim_time} minutes\n"
            f"- Priority locations: {[p['name'] + ' (' + str(p['priority']) + ')' for p in top[:3]]}\n"
            f"- Blocked infrastructure: {blocked}\n"
            f"- Evidence conflicts: {context.get('evidence_conflicts', [])}\n\n"
            f"Operator question: {question}\n\n"
            "Answer concisely and factually based on the system state above. "
            "If information is not available, say so. Max 150 words."
        )
        result = self._generate(prompt, max_tokens=250)
        if result.startswith("[watsonx"):
            return DeterministicProvider().answer_operator_question(question, context)
        return result


def get_ai_provider() -> AIProvider:
    """
    Factory function. Returns WatsonxProvider if credentials are configured,
    otherwise returns DeterministicProvider.
    
    The application ALWAYS works — credentials are optional.
    """
    from app.config import settings
    if settings.watsonx_api_key and settings.watsonx_project_id:
        logger.info("Using WatsonxProvider")
        return WatsonxProvider(
            api_key=settings.watsonx_api_key,
            project_id=settings.watsonx_project_id,
            url=settings.watsonx_url,
            model_id=settings.watsonx_model_id,
        )
    logger.info("Using DeterministicProvider (no watsonx credentials configured)")
    return DeterministicProvider()
