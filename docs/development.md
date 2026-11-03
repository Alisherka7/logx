# Development

Requirements: Node.js ≥ 22.12 (22, 24 or 26 LTS), npm, Python ≥ 3.10 on PATH.

```sh
npm ci                 # install exact locked dependencies
npm run build          # compile src/ to dist/
npm run typecheck      # type-check sources and tests
npm run test:python    # analyzer unit tests (unittest, stdlib only)
npm test               # build + Vitest unit and integration tests
npm run smoke          # build, npm pack, install the tarball in a temp env, run it
npm run format:check   # Prettier (TypeScript, JSON, Markdown, YAML)
npm run validate       # all of the above
```

Run the CLI from source after building: `node dist/cli.js --help`, or `npm link` to put `logx` on
your PATH (undo with `npm unlink -g logx-cli`).

## Tests

- `python/tests/test_rules.py`: true positives and important false positives for each rule,
  column conversion, encodings, syntax errors, and the stdin/stdout protocol.
- `tests/unit/`: glob semantics, config validation, analyzer-response validation, ordering.
- `tests/integration/`: spawn `dist/cli.js` as a subprocess, with the working directory in a temp
  dir whose name contains spaces (outside the source tree), against copies of `tests/fixtures/`.
- `scripts/smoke-pack.mjs`: packaging test, also run in CI.

Integration tests require a built `dist/` (`npm test` builds first). `LOGX_PYTHON` selects the
interpreter for both the CLI and `npm run test:python`.

## Adding a rule

1. Implement it in `python/logx_analyzer/rules.py` and add its severity to `SEVERITY`.
2. Add the ID to `RULE_IDS` in `src/shared/types.ts` and to `defaultConfig()`.
3. Add true-positive and false-positive tests in `python/tests/test_rules.py`.
4. Document detection, limits and fixes in `skills/logx/references/rules.md`.

Keep rules narrow and deterministic. If a pattern cannot be decided syntactically, leave it to the
agent skill rather than guessing in the analyzer.

## Conventions

- Output paths are project-relative POSIX paths; ordering is by path, line, column, rule ID.
- `--json` mode writes exactly one JSON object to stdout and nothing else.
- User-facing failures throw `LogxError(message, fix)`; the fix line must say what to do next.
