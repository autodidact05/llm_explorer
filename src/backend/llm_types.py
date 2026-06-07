from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LLMRunResult:
    """Normalized result from an LLM agent or streaming completion."""

    content: str
    prompt_tokens: int
    response_tokens: int
    input_cost: float
    output_cost: float
    time_taken: float
    http_code: int
    prompt_messages: list[dict[str, Any]]
    response_content: str

    @property
    def total_cost(self) -> float:
        return self.input_cost + self.output_cost

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "prompt_tokens": self.prompt_tokens,
            "response_tokens": self.response_tokens,
            "input_cost": self.input_cost,
            "output_cost": self.output_cost,
            "time_taken": self.time_taken,
            "http_code": self.http_code,
            "prompt_messages": self.prompt_messages,
            "response_content": self.response_content,
        }

    @classmethod
    def from_agent_run(
        cls,
        *,
        run: dict[str, Any],
        prompt_messages: list[dict[str, Any]],
        content: str | None = None,
    ) -> LLMRunResult:
        body = content if content is not None else str(run.get("final_output") or "")
        return cls(
            content=body,
            prompt_tokens=int(run["prompt_tokens"]),
            response_tokens=int(run["response_tokens"]),
            input_cost=float(run["input_cost"]),
            output_cost=float(run["output_cost"]),
            time_taken=float(run["time_taken"]),
            http_code=int(run["http_code"]),
            prompt_messages=prompt_messages,
            response_content=body,
        )

    @classmethod
    def from_usage_dict(
        cls,
        *,
        usage: dict[str, Any],
        content: str,
        prompt_messages: list[dict[str, Any]],
    ) -> LLMRunResult:
        return cls(
            content=content,
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            response_tokens=int(usage.get("response_tokens", 0)),
            input_cost=float(usage.get("input_cost", 0)),
            output_cost=float(usage.get("output_cost", 0)),
            time_taken=float(usage.get("time_taken", 0)),
            http_code=int(usage.get("http_code", 200)),
            prompt_messages=prompt_messages,
            response_content=content,
        )
