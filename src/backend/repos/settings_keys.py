from __future__ import annotations

from enum import StrEnum


class SettingsKey(StrEnum):
    ACTIVE_LLM_ROUTING = "active_llm_routing"
    GENERIC_SYSTEM_MESSAGE = "generic_system_message"
    ROUTER_LLM_ENABLED = "router_llm_enabled"
    ROUTER_LLM_SYSTEM_MESSAGE = "router_llm_system_message"
    ROUTER_LLM_PROVIDER = "router_llm_provider"
    ROUTER_LLM_MODEL = "router_llm_model"
