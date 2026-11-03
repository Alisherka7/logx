import logging as log_module

from fastapi import APIRouter, HTTPException

router = APIRouter()
log = log_module.getLogger("app.orders")


@router.post("/orders")
def create_order(payload: dict) -> dict:
    try:
        return {"id": submit(payload)}
    except ValueError as err:
        log.error("order rejected: " + str(err))
        raise HTTPException(status_code=422) from err


@router.delete("/orders/{order_id}")
def cancel_order(order_id: int) -> dict:
    try:
        cancel(order_id)
    except KeyError as err:
        # Correct: traceback is preserved; must not be flagged.
        log.error(f"cancel failed: {err}", exc_info=True)
    except Exception:
        log.exception("unexpected cancel failure")
    return {"cancelled": order_id}


def submit(payload: dict) -> int:
    return 1


def cancel(order_id: int) -> None:
    pass
