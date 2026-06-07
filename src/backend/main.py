import argparse
import logging
import sys

from backend.audit_service import insert_usage_audit
from backend.credit_service import deduct_credit
from backend.use_cases.answering_agent import invoke_prompt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

DEFAULT_PROVIDER = "meta-llama"
DEFAULT_MODEL = "llama-3.1-8b-instruct"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Invoke an LLM via OpenRouter and log usage"
    )
    parser.add_argument("prompt", help="The prompt to send to the model")
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        help=f"Model provider (default: {DEFAULT_PROVIDER})",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Model name (default: {DEFAULT_MODEL})",
    )
    args = parser.parse_args()

    try:
        result = invoke_prompt(
            provider=args.provider,
            model=args.model,
            prompt=args.prompt,
        )
    except Exception as exc:
        logger.error("Failed to invoke LLM: %s", exc)
        sys.exit(1)

    total_cost = float(result["input_cost"]) + float(result["output_cost"])  # type: ignore[arg-type]

    try:
        insert_usage_audit(
            provider=args.provider,
            model=args.model,
            prompt_tokens=int(result["prompt_tokens"]),  # type: ignore[arg-type]
            response_tokens=int(result["response_tokens"]),  # type: ignore[arg-type]
            input_cost=float(result["input_cost"]),  # type: ignore[arg-type]
            output_cost=float(result["output_cost"]),  # type: ignore[arg-type]
            time_taken=float(result["time_taken"]),  # type: ignore[arg-type]
            http_code=int(result["http_code"]),  # type: ignore[arg-type]
            prompt_messages=result["prompt_messages"],  # type: ignore[arg-type]
            response_content=str(result["response_content"]),
        )
        deduct_credit(total_cost, f"LLM call: {args.provider}/{args.model}")
    except Exception as exc:
        logger.error("Failed to record audit: %s", exc)

    print(result["content"])
    print("\n--- Usage ---")
    print(f"Prompt Tokens  : {result['prompt_tokens']}")
    print(f"Response Tokens: {result['response_tokens']}")
    print(f"Input Cost     : ${result['input_cost']:.8f}")
    print(f"Output Cost    : ${result['output_cost']:.8f}")
    print(f"Total Cost     : ${total_cost:.8f}")
    print(f"Time Taken     : {result['time_taken']:.2f}s")
    print(f"HTTP Code      : {result['http_code']}")


if __name__ == "__main__":
    main()
