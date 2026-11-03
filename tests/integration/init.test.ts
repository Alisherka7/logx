import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, copyFixture, makeTempDir, runCli } from "../helpers/cli.js";

afterAll(cleanupTempDirs);

describe("logx init", () => {
  const cwd = makeTempDir("logx cwd");

  it("creates config and LOGGING.md with stack hints", () => {
    const project = copyFixture("fastapi-good");
    const result = runCli(["init", project], { cwd });
    expect(result.code).toBe(0);
    const config = JSON.parse(readFileSync(join(project, ".logx", "config.json"), "utf8"));
    expect(config).toMatchObject({ schemaVersion: 1, include: ["**/*.py"], python: null });
    expect(Object.keys(config.rules)).toEqual(["LOGX001", "LOGX002", "LOGX003"]);
    const logging = readFileSync(join(project, "LOGGING.md"), "utf8");
    expect(logging).toContain("proposed conventions");
    expect(logging).toContain("fastapi (mentioned in pyproject.toml)");
    expect(logging).not.toContain("{{");
    expect(result.stdout).toContain("not proof");
  });

  it("is safe to run repeatedly and never overwrites existing files", () => {
    const project = copyFixture("fastapi-bad");
    mkdirSync(join(project, ".logx"));
    writeFileSync(join(project, "LOGGING.md"), "# Our own conventions\n");
    expect(runCli(["init"], { cwd: project }).code).toBe(0);
    const configAfterFirst = readFileSync(join(project, ".logx", "config.json"), "utf8");

    const second = runCli(["init"], { cwd: project });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("left unchanged");
    expect(readFileSync(join(project, "LOGGING.md"), "utf8")).toBe("# Our own conventions\n");
    expect(readFileSync(join(project, ".logx", "config.json"), "utf8")).toBe(configAfterFirst);
  });

  it("warns about, but preserves, an invalid existing config", () => {
    const project = makeTempDir();
    mkdirSync(join(project, ".logx"));
    writeFileSync(join(project, ".logx", "config.json"), "{broken");
    const result = runCli(["init", project], { cwd });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("invalid and was not modified");
    expect(readFileSync(join(project, ".logx", "config.json"), "utf8")).toBe("{broken");
  });

  it("notes when structlog/loguru is present and fails for a missing directory", () => {
    const project = makeTempDir();
    writeFileSync(join(project, "requirements.txt"), "fastapi\nstructlog>=24\n");
    expect(runCli(["init", project], { cwd }).code).toBe(0);
    expect(readFileSync(join(project, "LOGGING.md"), "utf8")).toContain("appears to use structlog");

    const missing = runCli(["init", join(project, "nope")], { cwd });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("Not a directory");
    expect(existsSync(join(project, "nope"))).toBe(false);
  });
});
