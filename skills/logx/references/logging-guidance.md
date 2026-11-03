# Logging guidance for Python/FastAPI (standard-library `logging`)

Use this when the project has no `LOGGING.md`, or to explain a suggestion. Adapt examples to the
project's existing style and framework; do not introduce new dependencies without asking.

## Module loggers

```python
import logging

logger = logging.getLogger(__name__)
```

Configure handlers once at startup (application factory or entry point), for example with
`logging.config.dictConfig(...)`. Library modules should only create loggers, not configure them.

## Exceptions

```python
try:
    charge(order)
except PaymentError:
    logger.exception("payment failed", extra={"order_id": order.id})
    raise
```

- `logger.exception(...)` logs at ERROR level with the traceback. Use it inside `except` blocks.
- At other levels, pass `exc_info=True`: `logger.warning("retrying", exc_info=True)`.
- Log an exception once, where it is handled. Avoid logging and re-raising at every layer.
- Do not swallow exceptions silently. Narrow the type and explain intentional suppression.

## Structured production logs, readable development logs

- Production: one JSON object per line on stdout, with timestamp, level, logger, message and
  context fields. With the standard library this is a custom `logging.Formatter` subclass (or an
  existing project dependency such as `python-json-logger`, only if already present).
- Development: a plain text formatter such as
  `"%(asctime)s %(levelname)s %(name)s: %(message)s"`.
- Pick the formatter from configuration (for example `LOG_FORMAT=json|text`), not by editing code.
- Put variable data in fields (`extra={...}`) and keep messages stable, so logs can be searched.

## Request and task context (FastAPI)

```python
import contextvars
import logging
import uuid

request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        return True


@app.middleware("http")
async def add_request_id(request, call_next):
    token = request_id.set(request.headers.get("x-request-id") or uuid.uuid4().hex)
    try:
        return await call_next(request)
    finally:
        request_id.reset(token)
```

Attach the filter to the handlers configured at startup and include `%(request_id)s` (or a
`request_id` JSON field) in the format. Background tasks should set their own task or job ID.

## Sensitive data

Never log passwords, tokens, API keys, session cookies, authorization headers, full payment
details, or whole request/response bodies. Prefer IDs over personal data. LogX does not detect
these problems; review them manually.

## Uvicorn

Uvicorn configures its own `uvicorn`, `uvicorn.error` and `uvicorn.access` loggers. If the
application configures logging, check that it does not duplicate or silence them unintentionally
(`--log-config` or `log_config=` can align them with the application's format).
