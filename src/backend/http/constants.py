from __future__ import annotations

from backend.use_cases.routing_defaults import DEFAULT_ROUTER_SYSTEM_MESSAGE

ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

__all__ = ["ALLOWED_ORIGINS", "DEFAULT_ROUTER_SYSTEM_MESSAGE"]
