import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir, repoRoot, runCli } from "../helpers/cli.js";

afterAll(cleanupTempDirs);

describe("logx CLI basics (run outside the source directory)", () => {
  const cwd = makeTempDir();

  it("prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      version: string;
    };
    const result = runCli(["--version"], { cwd });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("prints help with examples and all commands", () => {
    const result = runCli(["--help"], { cwd });
    expect(result.code).toBe(0);
    for (const word of ["init", "install", "check", "doctor", "Examples:", "Exit codes"]) {
      expect(result.stdout).toContain(word);
    }
  });

  it("prints subcommand help", () => {
    const result = runCli(["install", "--help"], { cwd });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--dry-run");
  });

  it("exits 2 on usage errors", () => {
    expect(runCli(["bogus"], { cwd }).code).toBe(2);
    expect(runCli(["install"], { cwd }).code).toBe(2);
    const bad = runCli(["install", "--agent", "vim"], { cwd });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("claude, cursor");
  });
});
