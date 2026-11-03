# LogX

LogX is an open-source logging toolkit for AI coding agents and the developers who use them. It
helps you inspect and improve backend logging with:

- a local CLI (`logx`),
- deterministic source-code checks (Python's `ast`, no code execution),
- an installable skill that teaches Claude Code or Cursor how to audit a module's logging,
- a project-specific `LOGGING.md` conventions file.

The first supported stack is **Python/FastAPI with standard-library `logging`**.

LogX is a development tool, not a logging runtime or monitoring service. Your application never
imports or depends on LogX and keeps working without it installed. LogX makes no network calls,
collects no telemetry, and does not call LLMs itself.

> **Status:** 0.1.0 MVP. Not yet published to npm. The name `logx` on npm belongs to an
> unrelated package, so this package is named `logx-cli` (bin: `logx`) and marked `private` until
> a publication decision is made. Install it from a local checkout as shown below.

## Quickstart (local checkout)

Requires Node.js ≥ 22.12 and Python ≥ 3.10 on PATH.

```sh
git clone <this repository> logx && cd logx
npm ci
npm run build
npm link            # puts `logx` on your PATH; or run `node /path/to/logx/dist/cli.js`
logx --help
```

To install it like a released package: `npm pack`, then `npm install -g ./logx-cli-0.1.0.tgz`.

## Usage

```sh
cd ~/code/orders-service

logx init                          # create .logx/config.json and LOGGING.md (never overwrites)
logx check                         # scan the project
logx check app/routers/orders.py   # scan one module
logx check . --json                # one JSON object on stdout, for agents and CI
logx install --agent claude        # install the skill into .claude/skills/logx/
logx install --agent cursor --dry-run
logx doctor                        # diagnose Python, config and skill setup
```

### Sample output

```text
$ logx check
Note: no .logx/config.json found; using default settings (run `logx init` to customize).

app/main.py:14:5  info  LOGX001  Direct print() call; its output bypasses logging levels, handlers and formatting.
    next: In application code, use a module logger (logger = logging.getLogger(__name__)) at a suitable level. Printing is fine for intentional CLI or script output; ignore the finding there.
app/main.py:21:5  warning  LOGX003  Exception handler for `ConnectionError` contains only `pass`; the exception is silently discarded.
    next: Review whether suppression is intended. If it is, narrow the exception type and add a comment (or use contextlib.suppress). Otherwise handle it or log it, e.g. logger.debug("...", exc_info=True).
app/main.py:30:9  warning  LOGX002  logger.error() inside an exception handler logs the exception message but not its traceback.
    next: Use logger.exception(...) in the handler, or pass exc_info=True, so the traceback is recorded.
app/routers/orders.py:14:9  warning  LOGX002  log.error() inside an exception handler logs the exception message but not its traceback.
    next: Use log.exception(...) in the handler, or pass exc_info=True, so the traceback is recorded.

Scanned 4 files: 4 findings (3 warning, 1 info).
Findings are deterministic review candidates, not proof of a bug. Rule details and limits: skills/logx/references/rules.md in the LogX package.
```

```text
$ logx check app/routers/orders.py --json
{
  "schemaVersion": 1,
  "tool": { "name": "logx", "version": "0.1.0" },
  "root": "/home/me/code/orders-service",
  "config": { "source": "defaults", "path": null },
  "findings": [
    {
      "ruleId": "LOGX002",
      "severity": "warning",
      "path": "app/routers/orders.py",
      "line": 14,
      "column": 9,
      "message": "log.error() inside an exception handler logs the exception message but not its traceback.",
      "suggestion": "Use log.exception(...) in the handler, or pass exc_info=True, so the traceback is recorded."
    }
  ],
  "errors": [],
  "skippedSymlinks": [],
  "summary": { "filesScanned": 1, "filesAnalyzed": 1, "findings": 1, "errors": 0,
               "bySeverity": { "warning": 1, "info": 0 }, "byRule": { "LOGX002": 1 }, "complete": true }
}
```

(The actual JSON output is pretty-printed with one field per line.)

```text
$ logx doctor
LogX 0.1.0 doctor: /home/me/code/orders-service

[ok]   Node.js 24.11.1
[ok]   Bundled skill, templates and analyzer present
[ok]   Configuration valid (.logx/config.json)
[ok]   Python 3.13.7 (python3)
[ok]   Analyzer self-test passed
[ok]   LOGGING.md present
[ok]   Claude Code skill installed and current (.claude/skills/logx)
[warn] Cursor skill not installed
         fix: Run `logx install --agent cursor` if you use Cursor (optional).

No blockers. 1 optional item(s).
```

### Exit codes

| Command           | 0                                   | 1                       | 2                                                                                    |
| ----------------- | ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `check`           | scan complete, no findings          | scan complete, findings | operational failure, invalid config, missing Python, syntax errors (incomplete scan) |
| `doctor`          | no blockers                         | blockers found          | doctor itself failed                                                                 |
| `init`, `install` | success (including "nothing to do") | —                       | failure or conflict                                                                  |

Usage errors exit 2 for every command.

## Rules

| ID      | Severity | Detects                                                                                                                             |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| LOGX001 | info     | Direct `print(...)` call. A review candidate: printing is fine in CLI programs and scripts.                                         |
| LOGX002 | warning  | A recognized stdlib logger's `.error(...)` in an `except ... as e` block logging `str(e)` or an f-string of `e` without `exc_info`. |
| LOGX003 | warning  | An exception handler whose body is only `pass`. A review candidate: suppression may be intentional.                                 |

What each rule recognizes, its false positives and false negatives, and how to fix findings are
documented in [skills/logx/references/rules.md](skills/logx/references/rules.md).

## Configuration

`logx init` writes `.logx/config.json`:

```json
{
  "schemaVersion": 1,
  "include": ["**/*.py"],
  "exclude": ["**/tests/**", "**/test_*.py", "**/*_test.py", "**/conftest.py", "**/migrations/**"],
  "rules": { "LOGX001": true, "LOGX002": true, "LOGX003": true },
  "python": null
}
```

- **Patterns** are matched against project-relative paths with `/` separators. `*` matches
  within one path segment, `**` matches zero or more segments, `?` matches one character. A
  pattern without `/` matches the file name at any depth (`*.py`, `conftest.py`). A trailing `/`
  means everything below that directory. Matching is case-sensitive, and there is no brace or
  character-class syntax.
- A file is scanned when it ends in `.py`, matches an `include` pattern, and matches no `exclude`
  pattern. A file named explicitly on the command line is scanned even if excluded.
- **Always excluded:** `.git`, `.hg`, `.svn`, `node_modules`, `__pycache__`, `.venv`, `venv`, any
  directory containing `pyvenv.cfg`, `.tox`, `.nox`, `.mypy_cache`, `.pytest_cache`,
  `.ruff_cache`, `build`, `dist`, `site-packages`, `.eggs`, `*.egg-info`, `.logx`, `.claude`,
  `.cursor`, and generated `*_pb2.py` / `*_pb2_grpc.py` files. Symlinks pointing outside the
  project root are never followed.
- **`python`**: an interpreter path or name. `null` auto-detects (`python3`, `python`, and `py -3`
  on Windows). The `LOGX_PYTHON` environment variable is used when the config doesn't set one.
- Without a config file, `logx check` uses these defaults. Unknown keys and rule IDs are errors.

## Agent skill

`logx install --agent claude|cursor` copies the canonical skill
([skills/logx/SKILL.md](skills/logx/SKILL.md) plus `references/`) to the agent's project-scope
skill directory, `.claude/skills/logx/` or `.cursor/skills/logx/`. The skill tells the agent to:
read `LOGGING.md`, run `logx check <module> --json`, explain each finding and its limits, keep
deterministic findings separate from its own interpretation, propose small reviewable changes
that keep the existing logging framework, and validate with the project's tests.

Installation records file hashes in `.logx/installed.json`. Running it again with identical
content writes nothing. A file you edited, or one LogX did not create, is reported as a conflict
with instructions, never overwritten. No hooks or global agent settings are touched. Cursor also
reads `.claude/skills/`, so if you install for both agents Cursor may list the skill twice.

## Supported environments

| Component                 | Supported                                                             |
| ------------------------- | --------------------------------------------------------------------- |
| Node.js                   | ≥ 22.12 (LTS lines 22, 24, 26)                                        |
| Python (for the analyzer) | ≥ 3.10, standard library only, nothing to `pip install`               |
| OS                        | Linux, macOS, Windows (CI runs all three)                             |
| Analyzed code             | Python source using standard-library `logging` (FastAPI or otherwise) |
| Agents                    | Claude Code, Cursor (project-scope skills)                            |

## Available vs. planned

**Available in 0.1.0:** `init`, `install` (Claude Code, Cursor), `check` (LOGX001–003, text and
JSON output), `doctor`, the canonical skill, and the `LOGGING.md` template.

**Planned or under consideration (not implemented):** more rules, inline suppressions, more
precise logger resolution across modules, structlog/loguru awareness, more agents, and npm
publication. LogX will not add a dashboard, hosted service, telemetry, production log streaming,
or automatic code rewriting.

## Known limitations

- Rules are syntactic and per-file. Loggers imported from other project modules aren't
  recognized (LOGX002 false negatives), and a name bound to a logger anywhere in a file counts
  as a logger throughout that file. `logger.error("%s", exc)` isn't flagged.
- LOGX001 flags all `print` calls in scanned files, including intentional CLI output. Exclude such
  files or treat the findings as informational.
- No inline suppression comments yet. Use `exclude` patterns or disable a rule.
- LogX does **not** detect sensitive data in logs, missing request context, or distributed
  tracing gaps. A clean scan says nothing about these.
- Stack detection in `init` only searches dependency files for package names. It is a hint.
- Python must already be installed. LogX never downloads it.

## Development

See [docs/development.md](docs/development.md) and [docs/architecture.md](docs/architecture.md).

```sh
npm run validate   # format check, typecheck, Python + Vitest tests, packaging smoke test
```

## License

MIT
