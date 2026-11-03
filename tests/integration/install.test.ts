import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir, repoRoot, runCli } from "../helpers/cli.js";

afterAll(cleanupTempDirs);

const SKILL = join(".claude", "skills", "logx", "SKILL.md");

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else
        out[rel] =
          `${statSync(join(current, entry.name)).mtimeMs}:${readFileSync(join(current, entry.name), "utf8")}`;
    }
  };
  walk(dir, "");
  return out;
}

describe("logx install", () => {
  it("installs the canonical skill for Claude Code and records ownership", () => {
    const project = makeTempDir();
    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(0);
    expect(readFileSync(join(project, SKILL), "utf8")).toBe(
      readFileSync(join(repoRoot, "skills", "logx", "SKILL.md"), "utf8"),
    );
    expect(existsSync(join(project, ".claude", "skills", "logx", "references", "rules.md"))).toBe(
      true,
    );
    const manifest = JSON.parse(readFileSync(join(project, ".logx", "installed.json"), "utf8"));
    expect(Object.keys(manifest.installs.claude.files)).toContain(".claude/skills/logx/SKILL.md");
    expect(manifest.installs.claude.files[".claude/skills/logx/SKILL.md"]).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    // No hooks or settings files are created.
    expect(readdirSync(join(project, ".claude"))).toEqual(["skills"]);
  });

  it("does nothing when repeated with identical content", () => {
    const project = makeTempDir();
    expect(runCli(["install", "--agent", "claude"], { cwd: project }).code).toBe(0);
    const before = snapshot(project);
    const again = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("already up to date");
    expect(snapshot(project)).toEqual(before);
  });

  it("preserves unrelated files, including extra files inside the skill directory", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".claude", "skills", "other"), { recursive: true });
    writeFileSync(join(project, ".claude", "settings.json"), '{"keep": true}\n');
    writeFileSync(join(project, ".claude", "skills", "other", "SKILL.md"), "other skill\n");
    expect(runCli(["install", "--agent", "claude"], { cwd: project }).code).toBe(0);
    writeFileSync(join(project, ".claude", "skills", "logx", "NOTES.md"), "my notes\n");
    expect(runCli(["install", "--agent", "claude"], { cwd: project }).code).toBe(0);
    expect(readFileSync(join(project, ".claude", "settings.json"), "utf8")).toBe(
      '{"keep": true}\n',
    );
    expect(readFileSync(join(project, ".claude", "skills", "other", "SKILL.md"), "utf8")).toBe(
      "other skill\n",
    );
    expect(readFileSync(join(project, ".claude", "skills", "logx", "NOTES.md"), "utf8")).toBe(
      "my notes\n",
    );
  });

  it("refuses to overwrite locally modified files", () => {
    const project = makeTempDir();
    runCli(["install", "--agent", "claude"], { cwd: project });
    const edited = `${readFileSync(join(project, SKILL), "utf8")}\nTeam addition.\n`;
    writeFileSync(join(project, SKILL), edited);
    const before = snapshot(project);
    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("modified locally");
    expect(result.stderr).toContain("Nothing was written");
    expect(snapshot(project)).toEqual(before);
  });

  it("refuses to overwrite files it does not own", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".claude", "skills", "logx"), { recursive: true });
    writeFileSync(join(project, SKILL), "someone else's skill\n");
    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not installed by LogX");
    expect(result.stderr).toMatch(/fix:/);
    expect(readFileSync(join(project, SKILL), "utf8")).toBe("someone else's skill\n");
    expect(existsSync(join(project, ".logx"))).toBe(false);
  });

  it("restores deleted owned files and updates unmodified owned files", () => {
    const project = makeTempDir();
    runCli(["install", "--agent", "claude"], { cwd: project });
    // Simulate an older LogX version: owned file content and manifest hash both differ.
    const manifestPath = join(project, ".logx", "installed.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(join(project, SKILL), "old skill content\n");
    manifest.installs.claude.files[".claude/skills/logx/SKILL.md"] =
      "sha256:" + sha256("old skill content\n");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    rmSync(join(project, ".claude", "skills", "logx", "references", "rules.md"));
    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/update\s+\.claude\/skills\/logx\/SKILL\.md/);
    expect(result.stdout).toMatch(/create\s+\.claude\/skills\/logx\/references\/rules\.md/);
    expect(readFileSync(join(project, SKILL), "utf8")).toBe(
      readFileSync(join(repoRoot, "skills", "logx", "SKILL.md"), "utf8"),
    );
    expect(existsSync(join(project, ".claude", "skills", "logx", "references", "rules.md"))).toBe(
      true,
    );
  });

  it("removes unmodified files from an older skill version but keeps edited ones", () => {
    const project = makeTempDir();
    runCli(["install", "--agent", "claude"], { cwd: project });
    const manifestPath = join(project, ".logx", "installed.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const dir = join(project, ".claude", "skills", "logx");
    writeFileSync(join(dir, "old.md"), "obsolete\n");
    writeFileSync(join(dir, "edited.md"), "edited by user\n");
    manifest.installs.claude.files[".claude/skills/logx/old.md"] = "sha256:" + sha256("obsolete\n");
    manifest.installs.claude.files[".claude/skills/logx/edited.md"] =
      "sha256:" + sha256("original\n");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, "old.md"))).toBe(false);
    expect(readFileSync(join(dir, "edited.md"), "utf8")).toBe("edited by user\n");
    const after = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(Object.keys(after.installs.claude.files)).not.toContain(".claude/skills/logx/edited.md");
  });

  it("supports --dry-run without writing anything", () => {
    const project = makeTempDir();
    const result = runCli(["install", "--agent", "cursor", "--dry-run"], { cwd: project });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain(".cursor/skills/logx/SKILL.md");
    expect(readdirSync(project)).toEqual([]);
  });

  it("installs for Cursor into .cursor/skills/logx with a matching name", () => {
    const project = makeTempDir();
    const result = runCli(["install", "--agent", "cursor"], { cwd: project });
    expect(result.code).toBe(0);
    const skill = readFileSync(join(project, ".cursor", "skills", "logx", "SKILL.md"), "utf8");
    expect(skill.startsWith("---\nname: logx\ndescription: ")).toBe(true);
    expect(result.stdout).toContain("Cursor also loads skills from .claude/skills/");
  });

  it("exits 2 with a fix for a corrupt ownership manifest", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".logx"));
    writeFileSync(join(project, ".logx", "installed.json"), "garbage");
    const result = runCli(["install", "--agent", "claude"], { cwd: project });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("installed.json");
    expect(result.stderr).toContain("fix:");
  });
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
