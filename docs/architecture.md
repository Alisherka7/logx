# Architecture

LogX is a single npm package: a TypeScript CLI (compiled to `dist/`) that ships a stdlib-only
Python analyzer, a Markdown agent skill, and templates. It runs entirely locally.

```
logx check ──► config (src/config) ──► file selection (src/analyzer/files.ts)
                                            │
                                            ▼
                       Python discovery (src/analyzer/python.ts)
                                            │  argument array, no shell, -I -B
                                            ▼
                     python/logx_analyzer  (ast only: never imports target code)
                                            │  one JSON object on stdout
                                            ▼
          response validation + ordering (src/analyzer/validate.ts) ──► reporters (text | JSON)
```

## Components

| Path                    | Responsibility                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `src/cli.ts`            | Commander setup, exit-code mapping (usage errors and `LogxError` → 2)                             |
| `src/commands/`         | Thin `init`, `install`, `check`, `doctor` handlers                                                |
| `src/config/`           | Defaults, validation, glob matching, stack-detection hints                                        |
| `src/analyzer/`         | File walking, Python discovery, bounded process execution, response validation                    |
| `src/reporters/`        | Human-readable and JSON output                                                                    |
| `src/install/`          | Skill installation plan/apply and the ownership manifest                                          |
| `src/shared/`           | Types, `LogxError`, package-relative resource paths                                               |
| `python/logx_analyzer/` | Parsing (`source.py`), logger recognition (`loggers.py`), rules (`rules.py`), protocol (`cli.py`) |
| `skills/logx/`          | Canonical skill installed for Claude Code and Cursor                                              |
| `templates/LOGGING.md`  | Conventions template written by `logx init`                                                       |

## Analyzer protocol (version 1)

Request on stdin:

```json
{
  "protocolVersion": 1,
  "root": "/abs/project",
  "rules": ["LOGX001", "LOGX002", "LOGX003"],
  "files": [{ "path": "app/main.py", "absPath": "/abs/project/app/main.py" }]
}
```

Response on stdout (exit status 0):

```json
{
  "protocolVersion": 1,
  "filesAnalyzed": 1,
  "errors": [],
  "findings": [
    {
      "ruleId": "LOGX002",
      "severity": "warning",
      "path": "app/main.py",
      "line": 30,
      "column": 9,
      "message": "...",
      "suggestion": "..."
    }
  ]
}
```

Per-file problems (`syntax_error`, `read_error`) are returned in `errors`; the rest of the files
are still analyzed. Exit status 2 means the request was malformed. The TypeScript side rejects
any response that does not match this shape exactly, so analyzer bugs surface as operational
errors (exit 2) instead of misleading output.

File selection is done in TypeScript, so glob semantics, symlink policy and built-in exclusions
are implemented once and tested with Vitest. Python only reads the files it is given.

## Safety choices

- **No code execution.** Target files are read as bytes and parsed with `ast.parse`. Nothing is
  imported, and the analyzer's `sys.path` holds only LogX's own directory.
- **Isolated interpreter.** Python runs as `python -I -B <pkg>/python/logx_analyzer/__main__.py`
  with `cwd` set to the package directory. `-I` ignores `PYTHON*` variables, user site-packages,
  the current directory and the script directory. `-B` avoids writing bytecode into the package.
- **No shell.** Processes are spawned with an argument array and `shell: false`, so paths with
  spaces or shell metacharacters are passed verbatim.
- **Bounded execution.** 60 s timeout (`LOGX_ANALYZER_TIMEOUT_MS` overrides it), 16 MiB stdout
  and 64 KiB stderr caps, and files over 2 MiB are skipped with a `read_error`. Exceeding a limit
  kills the process and makes the scan incomplete (exit 2).
- **Symlinks.** A symlink is followed only if its real path is inside the project root's real
  path; others are listed in `skippedSymlinks`. Directories are visited once by real path, which
  prevents loops.
- **No downloads.** Python is discovered (config `python` → `LOGX_PYTHON` → `python3`/`python`,
  plus `py -3` on Windows) and must be ≥ 3.10. LogX never installs it.
- **Package-relative resources.** `src/shared/paths.ts` finds the package root from
  `import.meta.url`, so bundled files resolve correctly from any working directory.

## Project root and paths

`logx check [path]` uses the nearest ancestor of `path` that contains `.logx/config.json` as the
project root. Without one, it uses the current directory if it contains `path`, otherwise `path`
itself (or its parent directory for a file). Reported paths are relative to the root and always
use `/`.

## Skill installation and ownership

`logx install --agent <agent>` copies `skills/logx/` to the agent's project-scope directory:

| Agent    | Location               | Reference                              |
| -------- | ---------------------- | -------------------------------------- |
| `claude` | `.claude/skills/logx/` | https://code.claude.com/docs/en/skills |
| `cursor` | `.cursor/skills/logx/` | https://cursor.com/docs/context/skills |

Both agents read the same `SKILL.md` format (YAML frontmatter with `name` and `description`,
optional `references/` files), so the canonical skill is copied unchanged. The frontmatter uses
only portable fields; `name` matches the directory, as Cursor requires. Cursor also loads
`.claude/skills/`, so installing for both agents can show the skill twice in Cursor.

Ownership is tracked in `.logx/installed.json`: for each agent, the LogX version and a SHA-256
hash (over LF-normalized content) of every file LogX wrote. Each target file is classified before
anything is written:

| Situation                              | Action                                             |
| -------------------------------------- | -------------------------------------------------- |
| file absent                            | create                                             |
| identical to bundled content           | unchanged (ownership recorded)                     |
| differs, but matches the recorded hash | update (owned and unmodified)                      |
| differs from the recorded hash         | conflict: modified locally                         |
| differs, never recorded                | conflict: not installed by LogX                    |
| owned file no longer shipped           | removed if unmodified, otherwise kept and disowned |

Any conflict aborts the whole install before writing. A symlink or non-directory in the target
path is also a conflict, so LogX never writes through links. A second identical install writes
nothing. Files LogX did not create, including extra files inside the skill directory, are never
touched. No hooks or global settings are written.
