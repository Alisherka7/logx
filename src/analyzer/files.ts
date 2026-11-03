import { lstatSync, readdirSync, realpathSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_EXCLUDED_DIRS,
  BUILTIN_EXCLUDED_FILE_SUFFIXES,
  type LogxConfig,
} from "../config/defaults.js";
import { GlobSet } from "../config/glob.js";
import { errorMessage } from "../shared/errors.js";
import { isWithin, toPosixRelative } from "../shared/paths.js";
import type { ScanError } from "../shared/types.js";

export interface SourceFile {
  /** Project-relative POSIX path, used in all output. */
  path: string;
  absPath: string;
}

export interface FileSelection {
  files: SourceFile[];
  /** Symlinks skipped because they resolve outside the project root (relative paths). */
  skippedSymlinks: string[];
  /** Directories that could not be read; the scan is incomplete when non-empty. */
  errors: ScanError[];
}

function isExcludedDir(name: string, absPath: string): boolean {
  if (BUILTIN_EXCLUDED_DIRS.has(name) || name.endsWith(".egg-info")) return true;
  // Any virtual environment, whatever it is called, has a pyvenv.cfg at its root.
  return existsSync(join(absPath, "pyvenv.cfg"));
}

function isBuiltinExcludedFile(name: string): boolean {
  return BUILTIN_EXCLUDED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Select Python files under `target` (a directory inside `root`).
 * Never follows a symlink whose real path is outside `root`; follows in-root symlinks once.
 */
export function selectFiles(root: string, target: string, config: LogxConfig): FileSelection {
  const include = new GlobSet(config.include);
  const exclude = new GlobSet(config.exclude);
  const realRoot = realpathSync(root);
  const visitedDirs = new Set<string>();
  const seenFiles = new Set<string>();
  const files: SourceFile[] = [];
  const skippedSymlinks: string[] = [];
  const errors: ScanError[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      const realDir = realpathSync(dir);
      if (visitedDirs.has(realDir)) return;
      visitedDirs.add(realDir);
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errors.push({
        kind: "read_error",
        path: toPosixRelative(root, dir) || ".",
        message: `cannot read directory: ${errorMessage(error)}`,
        fix: 'Fix the directory permissions, or exclude it via "exclude" in .logx/config.json.',
      });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = toPosixRelative(root, abs);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      let realPath = abs;

      if (entry.isSymbolicLink()) {
        try {
          realPath = realpathSync(abs);
        } catch {
          continue; // Dangling link.
        }
        if (!isWithin(realRoot, realPath)) {
          skippedSymlinks.push(rel);
          continue;
        }
        const stats = statSync(realPath);
        isDir = stats.isDirectory();
        isFile = stats.isFile();
      }

      if (isDir) {
        if (!isExcludedDir(entry.name, abs)) walk(abs);
      } else if (isFile && entry.name.endsWith(".py") && !isBuiltinExcludedFile(entry.name)) {
        if (!include.matches(rel) || exclude.matches(rel)) continue;
        const key = entry.isSymbolicLink() ? realPath : realpathSync(abs);
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
        files.push({ path: rel, absPath: abs });
      }
    }
  };

  if (isWithin(realRoot, realpathSync(target))) walk(target);
  else skippedSymlinks.push(toPosixRelative(root, target));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, skippedSymlinks, errors };
}

/** True if `path` exists and is a regular file or directory (following links). */
export function statKind(path: string): "file" | "directory" | "other" | "missing" {
  try {
    const stats = lstatSync(path).isSymbolicLink() ? statSync(path) : lstatSync(path);
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    return "other";
  } catch {
    return "missing";
  }
}
