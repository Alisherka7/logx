import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_EXCLUDED_DIRS } from "./defaults.js";

/**
 * Text-only scan of dependency manifests for likely stack components. Nothing is imported or
 * executed, and a match only means the name appears in a dependency file: treat it as a hint.
 */
export const DEPENDENCY_FILES = [
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
  "Pipfile",
  "uv.lock",
  "poetry.lock",
] as const;

const PACKAGES = ["fastapi", "uvicorn", "structlog", "loguru"] as const;
export type DetectedPackage = (typeof PACKAGES)[number];

export interface StackHints {
  /** Dependency files that were read (project-relative). */
  filesRead: string[];
  /** Package -> files mentioning it. */
  packages: Partial<Record<DetectedPackage, string[]>>;
  pythonFilesPresent: boolean;
}

const MAX_BYTES = 1024 * 1024;

function candidateFiles(root: string): string[] {
  const files: string[] = [...DEPENDENCY_FILES];
  const listTxt = (dir: string, prefix: string, filter: (name: string) => boolean): void => {
    try {
      for (const name of readdirSync(join(root, dir)).sort()) {
        if (filter(name)) files.push(prefix + name);
      }
    } catch {
      // Directory absent.
    }
  };
  listTxt(".", "", (name) => /^requirements.*\.(txt|in)$/i.test(name));
  listTxt("requirements", "requirements/", (name) => /\.(txt|in)$/i.test(name));
  return files;
}

export function detectStack(root: string): StackHints {
  const hints: StackHints = { filesRead: [], packages: {}, pythonFilesPresent: false };
  for (const rel of candidateFiles(root)) {
    const abs = join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > MAX_BYTES) continue;
    const text = readFileSync(abs, "utf8").toLowerCase();
    hints.filesRead.push(rel);
    for (const pkg of PACKAGES) {
      // Package names in requirement specifiers: bounded by non-identifier characters.
      if (new RegExp(`(^|[^a-z0-9_.-])${pkg}($|[^a-z0-9_-])`, "m").test(text)) {
        (hints.packages[pkg] ??= []).push(rel);
      }
    }
  }
  hints.pythonFilesPresent = containsPythonFile(root);
  return hints;
}

/** Bounded breadth-first search for any .py file outside excluded directories. */
function containsPythonFile(root: string): boolean {
  const queue = [root];
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const dir = queue.shift()!;
    visited++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".py")) return true;
      if (entry.isDirectory() && !BUILTIN_EXCLUDED_DIRS.has(entry.name))
        queue.push(join(dir, entry.name));
    }
  }
  return false;
}

export function describeHints(hints: StackHints): string[] {
  const lines: string[] = [];
  for (const [pkg, files] of Object.entries(hints.packages)) {
    lines.push(`${pkg} (mentioned in ${files.join(", ")})`);
  }
  return lines;
}
