---
name: logx
description: Audit and improve backend logging in a Python/FastAPI module. Use when asked to review logging, check exception handling and log quality, or propose logging improvements. Runs LogX's deterministic checks, explains the findings and their limits, and proposes small, reviewable changes that follow the project's LOGGING.md.
---

# LogX: logging audit for a selected module

Use this skill to audit the logging of one module or directory the user names (default: ask which
module, or use the files they are working on) and to propose focused improvements.

LogX itself is a local CLI and a set of deterministic checks. It is not a logging library: never
add a LogX dependency to the application, and never make the application require LogX at runtime.

## Workflow

1. **Read the project's conventions.** If `LOGGING.md` exists at the repository root, read it and
   treat it as the team's intended conventions. If it says the conventions are "proposed", say so
   when you rely on them. If it is missing, use [references/logging-guidance.md](references/logging-guidance.md)
   and mention that `logx init` can create a conventions file.

2. **Identify the existing logging setup** before suggesting anything: search for
   `logging.getLogger`, `logging.config`, `dictConfig`, `structlog`, `loguru`, and custom logging
   modules. Preserve whatever framework the project already uses. Do not migrate between
   frameworks or add new logging dependencies unless the user explicitly asks.

3. **Run the deterministic checks** on the selected path:

   ```sh
   logx check <path> --json
   ```

   - Exit code `0`: no findings. `1`: findings. `2`: the scan failed or is incomplete. Read the
     `errors` array, report it, and do not present partial results as complete.
   - If `logx` is not available on PATH, tell the user and continue with a manual review that you
     clearly label as **manual, non-deterministic**. Do not invent LogX rule IDs for it.

4. **Report findings in two clearly separated parts:**
   - **Deterministic findings (LogX):** list each finding with rule ID, `path:line:column`, and
     the message. For each one, read the surrounding code and state whether it looks like a real
     problem or an intentional pattern. See [references/rules.md](references/rules.md) for what
     each rule detects, when it is a false positive, and what it cannot detect.
   - **Additional observations (AI review):** issues you noticed yourself, such as missing
     request context, inconsistent levels, or noisy logs. Mark these as your interpretation,
     not tool output.

5. **Propose small, reviewable changes.** One concern per change, minimal diffs, matching the
   module's existing style. Show the diff or the exact edit, and explain why. Prefer:
   - `logger.exception(...)` or `exc_info=True` instead of logging `str(exc)` in handlers.
   - A module logger (`logging.getLogger(__name__)`) instead of `print()` in application code.
   - Handling or logging (often at `DEBUG` with `exc_info=True`) instead of a bare `except ...: pass`,
     or a narrowed exception type plus a comment when suppression is intentional.
     Do not apply changes without the user's agreement when they asked only for an audit.

6. **Validate.** After making changes, run the application's own test suite (for example
   `pytest`, or the command documented in the README or CI config), then re-run
   `logx check <path>` and report both results. If tests cannot run, say so.

## Limits you must state honestly

- LogX checks are narrow pattern matches on the syntax tree. They do not execute the code, follow
  imports, or understand runtime configuration.
- LogX does **not** detect sensitive-data leaks, missing distributed tracing, missing correlation
  IDs, or log-volume problems. Never claim the code is free of these because the check passed.
- A clean `logx check` means only that none of the implemented rules matched.
