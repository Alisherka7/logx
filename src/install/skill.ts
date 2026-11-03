import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { packageVersion, resources } from "../shared/paths.js";
import { readManifest, writeManifest, type Manifest } from "./manifest.js";

/**
 * Project-scope skill locations, verified against the official documentation (2026-11):
 * - Claude Code: .claude/skills/<name>/SKILL.md  https://code.claude.com/docs/en/skills
 * - Cursor:      .cursor/skills/<name>/SKILL.md  https://cursor.com/docs/context/skills
 * Both read the same SKILL.md format (YAML frontmatter with `name` and `description`), so one
 * canonical skill is copied unchanged.
 */
export const AGENTS = {
  claude: {
    label: "Claude Code",
    skillDir: ".claude/skills/logx",
    docs: "https://code.claude.com/docs/en/skills",
  },
  cursor: {
    label: "Cursor",
    skillDir: ".cursor/skills/logx",
    docs: "https://cursor.com/docs/context/skills",
  },
} as const;

export type AgentId = keyof typeof AGENTS;
export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export type FileAction =
  | { kind: "create" | "update" | "unchanged" | "remove"; path: string }
  | { kind: "keep-modified"; path: string }
  | { kind: "conflict"; path: string; reason: string };

export interface InstallPlan {
  agent: AgentId;
  projectRoot: string;
  actions: FileAction[];
  /** Desired content per project-relative path. */
  contents: Map<string, Buffer>;
  /** Manifest to persist after applying, or null when it would not change. */
  nextManifest: Manifest | null;
}

/** sha256 over LF-normalized content, so CRLF checkouts do not look locally modified. */
export function hashContent(content: Buffer): string {
  const normalized = content.toString("utf8").replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

/** Bundled skill files, as sorted POSIX paths relative to the skill directory. */
export function bundledSkillFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(resources.skillDir, "");
  return out.sort();
}

/** Reasons LogX refuses to write at `relPath`: a non-directory or symlink on the way there. */
function blockedReason(projectRoot: string, relPath: string): string | null {
  const parts = relPath.split("/");
  let current = projectRoot;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      return null; // Does not exist yet; nothing below it exists either.
    }
    const shown = parts.slice(0, i + 1).join("/");
    if (stats.isSymbolicLink())
      return `${shown} is a symbolic link; LogX does not write through links`;
    const last = i === parts.length - 1;
    if (!last && !stats.isDirectory()) return `${shown} exists and is not a directory`;
    if (last && !stats.isFile()) return `${shown} exists and is not a regular file`;
  }
  return null;
}

export function planInstall(projectRoot: string, agent: AgentId): InstallPlan {
  const manifest = readManifest(projectRoot);
  const owned = manifest.installs[agent]?.files ?? {};
  const base = AGENTS[agent].skillDir;
  const actions: FileAction[] = [];
  const contents = new Map<string, Buffer>();
  const nextFiles: Record<string, string> = {};

  for (const file of bundledSkillFiles()) {
    const relPath = `${base}/${file}`;
    const desired = readFileSync(join(resources.skillDir, ...file.split("/")));
    const desiredHash = hashContent(desired);
    contents.set(relPath, desired);
    nextFiles[relPath] = desiredHash;

    const blocked = blockedReason(projectRoot, relPath);
    if (blocked) {
      actions.push({ kind: "conflict", path: relPath, reason: blocked });
      continue;
    }
    const abs = join(projectRoot, ...relPath.split("/"));
    if (!existsSync(abs)) {
      actions.push({ kind: "create", path: relPath });
      continue;
    }
    const currentHash = hashContent(readFileSync(abs));
    if (currentHash === desiredHash) {
      actions.push({ kind: "unchanged", path: relPath });
    } else if (owned[relPath] === currentHash) {
      actions.push({ kind: "update", path: relPath });
    } else if (owned[relPath]) {
      actions.push({
        kind: "conflict",
        path: relPath,
        reason: "modified locally since LogX installed it",
      });
    } else {
      actions.push({
        kind: "conflict",
        path: relPath,
        reason: "exists but was not installed by LogX",
      });
    }
  }

  // Files LogX installed previously that the current skill no longer ships.
  for (const [relPath, ownedHash] of Object.entries(owned)) {
    if (nextFiles[relPath]) continue;
    const abs = join(projectRoot, ...relPath.split("/"));
    if (!existsSync(abs) || blockedReason(projectRoot, relPath)) continue;
    actions.push({
      kind: hashContent(readFileSync(abs)) === ownedHash ? "remove" : "keep-modified",
      path: relPath,
    });
  }

  const changed = actions.some((a) => a.kind !== "unchanged");
  const sameOwnership =
    manifest.installs[agent] !== undefined &&
    JSON.stringify(Object.entries(owned).sort()) ===
      JSON.stringify(Object.entries(nextFiles).sort());
  const nextManifest: Manifest | null =
    changed || !sameOwnership
      ? {
          schemaVersion: manifest.schemaVersion,
          installs: {
            ...manifest.installs,
            [agent]: { version: packageVersion, files: nextFiles },
          },
        }
      : null;

  return { agent, projectRoot, actions, contents, nextManifest };
}

export function conflicts(plan: InstallPlan): Extract<FileAction, { kind: "conflict" }>[] {
  return plan.actions.filter(
    (a): a is Extract<FileAction, { kind: "conflict" }> => a.kind === "conflict",
  );
}

/** Apply a conflict-free plan. Unrelated files are never touched. */
export function applyInstall(plan: InstallPlan): void {
  if (conflicts(plan).length > 0) throw new Error("refusing to apply a plan with conflicts");
  for (const action of plan.actions) {
    const abs = join(plan.projectRoot, ...action.path.split("/"));
    if (action.kind === "create" || action.kind === "update") {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, plan.contents.get(action.path)!);
    } else if (action.kind === "remove") {
      rmSync(abs);
    }
  }
  if (plan.nextManifest) writeManifest(plan.projectRoot, plan.nextManifest);
}

export type InstallState = "not-installed" | "current" | "outdated" | "modified" | "conflict";

/** Summarize the installed skill for `doctor`. */
export function inspectInstall(
  projectRoot: string,
  agent: AgentId,
): { state: InstallState; plan: InstallPlan } {
  const plan = planInstall(projectRoot, agent);
  const manifest = readManifest(projectRoot);
  const recorded = manifest.installs[agent] !== undefined;
  const kinds = new Set(plan.actions.map((a) => a.kind));
  const conflictList = conflicts(plan);

  if (conflictList.some((c) => c.reason.startsWith("modified locally")))
    return { state: "modified", plan };
  if (conflictList.length > 0) return { state: "conflict", plan };
  if (!recorded) {
    return { state: kinds.has("create") ? "not-installed" : "outdated", plan };
  }
  if (kinds.has("keep-modified")) return { state: "modified", plan };
  if (plan.nextManifest !== null) return { state: "outdated", plan };
  return { state: "current", plan };
}
