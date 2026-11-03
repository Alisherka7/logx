import logging

from fastapi import FastAPI
from rich import print  # Shadows the builtin: print() here is not flagged.

logger = logging.getLogger(__name__)
app = FastAPI()


@app.get("/items/{item_id}")
def read_item(item_id: int) -> dict:
    try:
        return {"item": load(item_id)}
    except LookupError:
        logger.exception("item lookup failed", extra={"item_id": item_id})
        raise
    except ValueError as exc:
        logger.error("invalid item: %s", exc, exc_info=True)
        raise


def banner() -> None:
    print("[bold]service ready[/bold]")


def load(item_id: int) -> str:
    return str(item_id)
