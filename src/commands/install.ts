import { existsSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE } from "../install/manifest.js";
import { AGENTS, applyInstall, conflicts, planInstall, type AgentId } from "../install/skill.js";
import { resolveProjectRoot } from "./project.js";

export interface InstallOptions {
  agent: AgentId;
  dryRun?: boolean;
}

const LABELS: Record<string, string> = {
  create: "create",
  update: "update",
  unchanged: "unchanged",
  remove: "remove",
  "keep-modified": "keep (modified locally; no longer owned by LogX)",
};

export function installCommand(pathArg: string | undefined, options: InstallOptions): number {
  const root = resolveProjectRoot(pathArg);
  const agent = AGENTS[options.agent];
  const plan = planInstall(root, options.agent);
  const conflictList = conflicts(plan);

  if (conflictList.length > 0) {
    const lines = [
      `logx: cannot install the ${agent.label} skill into ${agent.skillDir}: ${conflictList.length} conflicting file(s). Nothing was written.`,
      ...conflictList.map((c) => `  conflict  ${c.path}: ${c.reason}`),
      "",
      "fix: LogX never overwrites files it does not own or that were edited after installation.",
      `     Back up any changes you want to keep, then move or delete the listed file(s) (or the`,
      `     whole ${agent.skillDir}/ directory) and run the command again.`,
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
    return 2;
  }

  const out: string[] = [];
  const pending = plan.actions.filter((a) => a.kind !== "unchanged");
  if (pending.length === 0 && plan.nextManifest === null) {
    out.push(
      `LogX skill for ${agent.label} is already up to date in ${agent.skillDir}/. Nothing to do.`,
    );
    process.stdout.write(`${out.join("\n")}\n`);
    return 0;
  }

  out.push(
    `${options.dryRun ? "Dry run: would install" : "Installing"} the LogX skill for ${agent.label} (project scope) in ${root}`,
    "",
  );
  for (const action of plan.actions)
    out.push(`  ${(LABELS[action.kind] ?? action.kind).padEnd(10)} ${action.path}`);
  if (plan.nextManifest)
    out.push(`  ${"record".padEnd(10)} ${MANIFEST_FILE} (file ownership and hashes)`);
  out.push("");

  if (options.dryRun) {
    out.push("Dry run: no files were written.");
  } else {
    applyInstall(plan);
    out.push(
      `Done. ${agent.label} loads project skills from ${agent.skillDir.replace(/\/logx$/, "/")} (${agent.docs}).`,
    );
    out.push(
      "Commit the skill directory and .logx/ to share them. No hooks or global settings were changed.",
    );
  }
  const other: AgentId = options.agent === "claude" ? "cursor" : "claude";
  if (options.agent === "cursor" || existsSync(join(root, AGENTS[other].skillDir))) {
    out.push(
      "Note: Cursor also loads skills from .claude/skills/, so installing for both agents can list the LogX skill twice in Cursor.",
    );
  }
  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}
