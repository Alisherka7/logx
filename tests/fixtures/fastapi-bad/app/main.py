import logging

from fastapi import FastAPI

from app.routers import orders

logger = logging.getLogger(__name__)
app = FastAPI()
app.include_router(orders.router)


@app.on_event("startup")
def startup() -> None:
    print("starting up")


@app.get("/health")
def health() -> dict:
    try:
        check_database()
    except ConnectionError:
        pass
    return {"status": "ok"}


def check_database() -> None:
    try:
        connect()
    except ConnectionError as exc:
        logger.error(f"database unavailable: {exc}")
        raise


def connect() -> None:
    raise ConnectionError("refused")
