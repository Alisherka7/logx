import type { RuleId } from "../shared/types.js";

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_DIR = ".logx";
export const CONFIG_FILE = ".logx/config.json";

export interface LogxConfig {
  schemaVersion: number;
  /** Glob patterns (see src/config/glob.ts) selecting files to scan. */
  include: string[];
  /** Glob patterns removing files from the scan. Applied after `include`. */
  exclude: string[];
  rules: Record<RuleId, boolean>;
  /** Python executable to run the analyzer with; null means auto-detect. */
  python: string | null;
}

/** Written by `logx init`; also used by `logx check` when no config file exists. */
export function defaultConfig(): LogxConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    include: ["**/*.py"],
    exclude: ["**/tests/**", "**/test_*.py", "**/*_test.py", "**/conftest.py", "**/migrations/**"],
    rules: { LOGX001: true, LOGX002: true, LOGX003: true },
    python: null,
  };
}

/**
 * Directories never scanned, regardless of configuration: VCS metadata, virtual environments,
 * dependency folders, caches, build output, and agent/LogX state. Matched by directory name.
 */
export const BUILTIN_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "build",
  "dist",
  "site-packages",
  ".eggs",
  ".logx",
  ".claude",
  ".cursor",
]);

/** Generated-file suffixes never scanned (protobuf/gRPC stubs). */
export const BUILTIN_EXCLUDED_FILE_SUFFIXES: readonly string[] = ["_pb2.py", "_pb2_grpc.py"];
