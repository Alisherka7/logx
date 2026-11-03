import { resolve } from "node:path";
import { statKind } from "../analyzer/files.js";
import { findProjectRoot } from "../config/load.js";
import { LogxError } from "../shared/errors.js";

/** Explicit path wins; otherwise the nearest initialized ancestor of cwd, else cwd itself. */
export function resolveProjectRoot(pathArg: string | undefined): string {
  if (pathArg !== undefined) {
    const root = resolve(pathArg);
    if (statKind(root) !== "directory") {
      throw new LogxError(`Not a directory: ${root}`, "Pass the repository root directory.");
    }
    return root;
  }
  const cwd = process.cwd();
  return findProjectRoot(cwd) ?? cwd;
}
