from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.audit_service import insert_usage_audit
from backend.credit_service import deduct_credit
from backend.llm_common import LLMCallError
from backend.use_cases.answering_agent import invoke_prompt
from backend.use_cases.groq_models import assert_groq_model_allowed

router = APIRouter()


class InvokeRequest(BaseModel):
    provider: str
    model: str
    prompt: str


@router.post("/api/invoke")
def invoke(req: InvokeRequest) -> dict[str, Any]:
    assert_groq_model_allowed(provider=req.provider, model=req.model)
    try:
        result = invoke_prompt(provider=req.provider, model=req.model, prompt=req.prompt)
    except LLMCallError as exc:
        insert_usage_audit(
            provider=req.provider,
            model=req.model,
            prompt_tokens=0,
            response_tokens=0,
            input_cost=0.0,
            output_cost=0.0,
            time_taken=exc.time_taken,
            http_code=exc.http_code,
            prompt_messages=[{"role": "user", "content": req.prompt}],
            response_content=f"ERROR: {exc}",
            write_log=False,
        )
        raise HTTPException(exc.http_code, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    total_cost = float(result["input_cost"]) + float(result["output_cost"])  # type: ignore[arg-type]

    event_id = insert_usage_audit(
        provider=req.provider,
        model=req.model,
        prompt_tokens=int(result["prompt_tokens"]),  # type: ignore[arg-type]
        response_tokens=int(result["response_tokens"]),  # type: ignore[arg-type]
        input_cost=float(result["input_cost"]),  # type: ignore[arg-type]
        output_cost=float(result["output_cost"]),  # type: ignore[arg-type]
        time_taken=float(result["time_taken"]),  # type: ignore[arg-type]
        http_code=int(result["http_code"]),  # type: ignore[arg-type]
        prompt_messages=result["prompt_messages"],  # type: ignore[arg-type]
        response_content=str(result["response_content"]),
    )

    if total_cost > 0:
        deduct_credit(total_cost, f"LLM call: {req.provider}/{req.model}", conversation_id=None)

    return {
        "event_id": event_id,
        "content": result["content"],
        "prompt_tokens": result["prompt_tokens"],
        "response_tokens": result["response_tokens"],
        "input_cost": result["input_cost"],
        "output_cost": result["output_cost"],
        "total_cost": total_cost,
        "time_taken": result["time_taken"],
        "http_code": result["http_code"],
    }
