import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "logx-cli";

/**
 * Locate the installed package root by walking up from this module until our package.json
 * is found. Works from both `src/` (tests) and `dist/` (installed), independent of cwd.
 */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown };
        if (pkg.name === PACKAGE_NAME) return dir;
      } catch {
        // Not our package.json; keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("LogX package root not found; the installation is broken.");
    dir = parent;
  }
}

export const packageRoot = findPackageRoot();

export const resources = {
  skillDir: join(packageRoot, "skills", "logx"),
  loggingTemplate: join(packageRoot, "templates", "LOGGING.md"),
  analyzerEntry: join(packageRoot, "python", "logx_analyzer", "__main__.py"),
  analyzerDir: join(packageRoot, "python"),
} as const;

export const packageVersion: string = (() => {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
})();

/** Project-relative path using forward slashes, for stable output on every platform. */
export function toPosixRelative(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  return sep === "/" ? rel : rel.split(sep).join("/");
}

/** True if `child` is `parent` or lies inside it. Both must be absolute, normalized paths. */
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
