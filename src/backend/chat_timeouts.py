"""Per-stage timeouts and UX thresholds for chat requests."""

# Per-stage hard limits (seconds)
ROUTER_TIMEOUT_SEC = 20.0
BRAVE_SEARCH_TIMEOUT_SEC = 15.0
ANSWERING_TIMEOUT_SEC = 90.0
IMAGE_GENERATION_TIMEOUT_SEC = 90.0

# Time-to-first-token after the answering stage starts
TTFT_TIMEOUT_SEC = 30.0

# Frontend soft warnings (seconds elapsed since send started)
SOFT_WARN_ELAPSED_SEC = 15
HARD_WARN_ELAPSED_SEC = 45

# OpenAI HTTP client
HTTP_CONNECT_TIMEOUT_SEC = 10.0
