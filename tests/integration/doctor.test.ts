import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, copyFixture, makeTempDir, runCli } from "../helpers/cli.js";

afterAll(cleanupTempDirs);

describe("logx doctor", () => {
  it("reports optional setup as warnings without blockers", () => {
    const project = makeTempDir();
    const result = runCli(["doctor"], { cwd: project });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\[ok\]\s+Node\.js/);
    expect(result.stdout).toMatch(/\[ok\]\s+Python 3\./);
    expect(result.stdout).toContain("Analyzer self-test passed");
    expect(result.stdout).toMatch(/\[warn\] No \.logx\/config\.json/);
    expect(result.stdout).toMatch(/\[warn\] Claude Code skill not installed/);
    expect(result.stdout).toContain("No blockers.");
  });

  it("is all green after init and install", () => {
    const project = copyFixture("fastapi-good");
    runCli(["init"], { cwd: project });
    runCli(["install", "--agent", "claude"], { cwd: project });
    runCli(["install", "--agent", "cursor"], { cwd: project });
    const result = runCli(["doctor"], { cwd: project });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("[warn]");
    expect(result.stdout).toContain("Claude Code skill installed and current");
  });

  it("treats invalid configuration and missing Python as blockers", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".logx"));
    writeFileSync(join(project, ".logx", "config.json"), '{"schemaVersion": 1, "include": 5}');
    const result = runCli(["doctor", project], {
      cwd: makeTempDir(),
      env: { LOGX_PYTHON: join(project, "missing python") },
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/\[fail\] Configuration is invalid/);
    expect(result.stdout).toMatch(/\[fail\] Python >= 3\.10 not available/);
    expect(result.stdout).toContain("fix:");
  });

  it("reports skill conflicts and local modifications", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".cursor", "skills", "logx"), { recursive: true });
    writeFileSync(join(project, ".cursor", "skills", "logx", "SKILL.md"), "foreign\n");
    runCli(["install", "--agent", "claude"], { cwd: project });
    writeFileSync(join(project, ".claude", "skills", "logx", "SKILL.md"), "edited\n");
    const result = runCli(["doctor"], { cwd: project });
    expect(result.stdout).toContain("Claude Code skill was modified locally");
    expect(result.stdout).toContain("Cursor skill location contains files not installed by LogX");
  });
});
