import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent.parent

load_dotenv(BASE_DIR / ".env", override=True)

DB_PATH = BASE_DIR / "data" / "llm_explorer.db"
LOG_PATH = BASE_DIR / "data" / "llm_usage_log.jsonl"
MODELS_CSV_PATH = BASE_DIR / "data" / "models.csv"
UPLOADED_DATA_PATH = BASE_DIR / "data" / "uploaded_data"
GENERATED_IMAGES_PATH = BASE_DIR / "data" / "generated_images"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
OLLAMA_BASE_URL = "http://localhost:11434/v1"

# Groq-hosted models supported by this app (Groq API model IDs).
GROQ_SUPPORTED_MODELS: frozenset[str] = frozenset({
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
})
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "").strip()

# OpenRouter model catalog is restricted to these provider slugs (from model id prefix).
ALLOWED_OPENROUTER_PROVIDERS: frozenset[str] = frozenset({
    "alibaba",
    "amazon",
    "anthropic",
    "baidu",
    "cohere",
    "deepseek",
    "google",
    "meta-llama",
    "microsoft",
    "minimax",
    "mistralai",
    "moonshotai",
    "nvidia",
    "openai",
    "openrouter",
    "perplexity",
    "qwen",
    "stepfun",
    "x-ai",
    "xiaomi",
    "~anthropic",
    "~google",
    "~moonshotai",
    "~openai",
})


def is_allowed_openrouter_provider(provider: str) -> bool:
    return provider in ALLOWED_OPENROUTER_PROVIDERS


def openrouter_provider_sql_clause(
    *,
    provider_column: str = "provider",
    router_column: str = "router",
) -> tuple[str, list[str]]:
    """Non-openrouter rows pass through; openrouter rows must use an allowed provider."""
    placeholders = ", ".join("?" * len(ALLOWED_OPENROUTER_PROVIDERS))
    clause = f"({router_column} != 'openrouter' OR {provider_column} IN ({placeholders}))"
    return clause, list(ALLOWED_OPENROUTER_PROVIDERS)
