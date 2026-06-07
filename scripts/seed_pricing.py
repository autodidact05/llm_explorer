from backend.init_db import initialize_database
from backend.pricing_service import upsert_model_pricing


def main() -> None:
    initialize_database()
    upsert_model_pricing("meta-llama", "llama-3.1-8b-instruct", 0.041, 0.069)
    upsert_model_pricing("meta-llama", "llama-3.3-70b-instruct", 0.265, 0.489)
    print("Pricing seeded.")


if __name__ == "__main__":
    main()
