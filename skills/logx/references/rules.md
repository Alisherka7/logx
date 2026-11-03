# LogX rules

LogX reports **review candidates**: code that matches a narrow, deterministic pattern. Every rule
can have intentional exceptions; read the code before changing it.

Rules can be disabled per project in `.logx/config.json` (`"rules": {"LOGX001": false}`).
Files can be excluded with `"exclude"` glob patterns. There are no inline suppression comments
in this release.

## LOGX001: direct `print()` call (severity: info)

**Detects** calls to the built-in `print(...)` anywhere in a scanned file.

**Why it matters:** in a service, `print` output bypasses logging levels, handlers, formatters
and any structured (JSON) output, and it carries no logger name or request context.

**Not flagged:** files that rebind `print` (for example `from rich import print`, `def print`,
or `print = ...`), and method calls such as `console.print(...)`.

**Expected false positives:** intentional output in CLI programs, scripts, management commands,
and `if __name__ == "__main__":` blocks. Exclude such files or ignore the finding.

**Typical fix:** `logger = logging.getLogger(__name__)` at module level and
`logger.info(...)`/`logger.debug(...)` at an appropriate level.

## LOGX002: exception logged without traceback (severity: warning)

**Detects** a recognized standard-library logger's `.error(...)` call inside an
`except ... as NAME:` block, where the arguments include `str(NAME)` or an f-string that
interpolates `NAME` directly (`f"... {NAME}"`, `{NAME!r}`), and `exc_info` is not enabled.

**Why it matters:** only the exception's message is logged; the traceback that shows where
the error happened is lost.

**Not flagged:** `logger.exception(...)`; `.error(..., exc_info=True)` or `exc_info=<exception>`;
calls passing `**kwargs` (exc_info might be inside); other levels (`warning`, `critical`); code in
functions or lambdas defined inside the handler.

**Recognized loggers** (resolved per file, without following imports):

- `import logging` / `import logging as lg`: `logging.error(...)` (root logger)
- names or attributes assigned from `logging.getLogger(...)`, `getLogger(...)` imported via
  `from logging import getLogger [as alias]`, or `logging.LoggerAdapter(...)`, for example
  `logger = logging.getLogger(__name__)` and `self.logger = logging.getLogger(...)`
- inline `logging.getLogger(...).error(...)`

**Known limits (false negatives):** loggers imported from another project module
(`from app.log import logger`), loggers passed as parameters or stored in containers,
structlog/loguru loggers, and `logger.error("failed: %s", exc)` (the exception object passed as a
format argument).

**Possible false positives:** a name assigned from `getLogger` anywhere in the file is treated as
a logger everywhere in that file, even if it is rebound to something else; an intentional
message-only log where the traceback is recorded elsewhere (for example re-raised and logged by
an outer handler).

**Typical fix:** `logger.exception("context about the failure")`, or keep `.error` and add
`exc_info=True`.

## LOGX003: silently discarded exception (severity: warning)

**Detects** an exception handler (`except`, `except X`, `except X as e`, `except*`) whose body is
exactly one `pass` statement.

**Why it matters:** the error disappears without a trace, which makes failures hard to diagnose.

**Not flagged:** handlers containing anything besides `pass` (including comments plus other
code), handlers whose body is `...`, and `contextlib.suppress(...)`.

**Expected false positives:** deliberate best-effort operations (optional imports, cleanup,
cache warming). If suppression is intended, narrow the exception type and add a comment, or use
`contextlib.suppress`, which documents the intent.

**Typical fix:** handle the error, re-raise it, or log it, e.g.
`logger.debug("optional cache unavailable", exc_info=True)`.

## What LogX does not detect

Sensitive data in log messages, missing request/trace context, distributed tracing gaps,
inconsistent log levels, log volume, or runtime logging configuration problems. Review these
manually; a clean `logx check` says nothing about them.
