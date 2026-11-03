import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, copyFixture, makeTempDir, runCli } from "../helpers/cli.js";

afterAll(cleanupTempDirs);

interface JsonReport {
  schemaVersion: number;
  findings: {
    ruleId: string;
    severity: string;
    path: string;
    line: number;
    column: number;
    message: string;
    suggestion: string;
  }[];
  errors: { kind: string; path?: string; message: string; fix?: string }[];
  summary: { filesScanned: number; findings: number; complete: boolean };
  config: { source: string };
}

function checkJson(target: string, cwd: string, env?: Record<string, string | undefined>) {
  const result = runCli(["check", target, "--json"], { cwd, env });
  // The whole of stdout must be exactly one JSON value.
  const report = JSON.parse(result.stdout) as JsonReport;
  return { ...result, report };
}

describe("logx check", () => {
  const cwd = makeTempDir("logx cwd");

  it("reports findings with stable ordering and exits 1", () => {
    const project = copyFixture("fastapi-bad");
    const { code, report, stderr } = checkJson(project, cwd);
    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(report.schemaVersion).toBe(1);
    expect(report.findings.map((f) => `${f.ruleId} ${f.path}:${f.line}:${f.column}`)).toEqual([
      "LOGX001 app/main.py:14:5",
      "LOGX003 app/main.py:21:5",
      "LOGX002 app/main.py:30:9",
      "LOGX002 app/routers/orders.py:14:9",
    ]);
    expect(report.findings[0]).toMatchObject({ severity: "info" });
    for (const f of report.findings) {
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.suggestion.length).toBeGreaterThan(10);
    }
    // tests/** (default exclude) and .venv (built-in exclude) are not scanned.
    expect(report.summary).toMatchObject({ filesScanned: 4, findings: 4, complete: true });
    expect(
      report.findings.some((f) => f.path.startsWith("tests/") || f.path.startsWith(".venv/")),
    ).toBe(false);
  });

  it("produces identical output across runs", () => {
    const project = copyFixture("fastapi-bad");
    expect(runCli(["check", project, "--json"], { cwd }).stdout).toBe(
      runCli(["check", project, "--json"], { cwd }).stdout,
    );
  });

  it("exits 0 with no findings for good code", () => {
    const project = copyFixture("fastapi-good");
    const { code, report } = checkJson(project, cwd);
    expect(code).toBe(0);
    expect(report.findings).toEqual([]);
    const text = runCli(["check", project], { cwd });
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("Scanned 2 files: 0 findings.");
  });

  it("checks the current directory by default and scans a single named file", () => {
    const project = copyFixture("fastapi-bad");
    expect(runCli(["check"], { cwd: project }).code).toBe(1);
    // Uninitialized project: paths are relative to the cwd that contains the target.
    const fromRoot = checkJson(join("app", "routers", "orders.py"), project);
    expect(fromRoot.report.findings.map((f) => f.path)).toEqual(["app/routers/orders.py"]);
    // Initialized project: paths are relative to the directory holding .logx/config.json.
    runCli(["init", project], { cwd });
    const fromElsewhere = checkJson(join(project, "app", "routers", "orders.py"), cwd);
    expect(fromElsewhere.report.findings.map((f) => f.path)).toEqual(["app/routers/orders.py"]);
    const subdir = checkJson(join(project, "app", "routers"), cwd);
    expect(subdir.report.findings.map((f) => f.path)).toEqual(["app/routers/orders.py"]);
  });

  it("reports syntax errors as incomplete analysis and exits 2", () => {
    const project = copyFixture("syntax-error");
    const { code, report } = checkJson(project, cwd);
    expect(code).toBe(2);
    expect(report.errors).toEqual([
      expect.objectContaining({ kind: "syntax_error", path: "app/broken.py", line: 1 }),
    ]);
    expect(report.findings.map((f) => f.ruleId)).toEqual(["LOGX003"]);
    expect(report.summary.complete).toBe(false);
    const text = runCli(["check", project], { cwd });
    expect(text.code).toBe(2);
    expect(text.stdout).toContain("Analysis incomplete:");
    expect(text.stdout).toContain("app/broken.py:1");
  });

  it("exits 2 with a JSON error for invalid configuration", () => {
    const project = copyFixture("fastapi-good");
    mkdirSync(join(project, ".logx"));
    writeFileSync(
      join(project, ".logx", "config.json"),
      JSON.stringify({ schemaVersion: 1, rules: { LOGX999: true } }),
    );
    const { code, report } = checkJson(project, cwd);
    expect(code).toBe(2);
    expect(report.errors[0]).toMatchObject({ kind: "config_error" });
    expect(report.errors[0]?.message).toContain("rules.LOGX999");

    writeFileSync(join(project, ".logx", "config.json"), "{ not json");
    const text = runCli(["check", project], { cwd });
    expect(text.code).toBe(2);
    expect(text.stdout).toContain("not valid JSON");
  });

  it("honors configured include/exclude patterns and disabled rules", () => {
    const project = copyFixture("fastapi-bad");
    mkdirSync(join(project, ".logx"));
    writeFileSync(
      join(project, ".logx", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        include: ["app/**"],
        exclude: ["app/routers/**"],
        rules: { LOGX001: false },
      }),
    );
    const { code, report } = checkJson(project, cwd);
    expect(code).toBe(1);
    expect(report.config.source).toBe("file");
    expect(report.findings.map((f) => `${f.ruleId} ${f.path}`)).toEqual([
      "LOGX003 app/main.py",
      "LOGX002 app/main.py",
    ]);
  });

  it("exits 2 with an actionable error when Python is missing", () => {
    const project = copyFixture("fastapi-bad");
    const { code, report } = checkJson(project, cwd, {
      LOGX_PYTHON: join(project, "no such python"),
    });
    expect(code).toBe(2);
    expect(report.errors[0]).toMatchObject({ kind: "python_unavailable" });
    expect(report.errors[0]?.fix).toMatch(/python/i);
    expect(report.findings).toEqual([]);
  });

  it("exits 2 for a missing target path", () => {
    const { code, report } = checkJson(join(cwd, "does not exist"), cwd);
    expect(code).toBe(2);
    expect(report.errors[0]).toMatchObject({ kind: "target_error" });
  });

  it("reports an analyzer timeout as an operational failure", () => {
    const project = copyFixture("fastapi-bad");
    const { code, report } = checkJson(project, cwd, { LOGX_ANALYZER_TIMEOUT_MS: "1" });
    expect(code).toBe(2);
    expect(report.errors[0]).toMatchObject({ kind: "timeout" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports unreadable directories as incomplete analysis",
    () => {
      const project = copyFixture("fastapi-bad");
      const locked = join(project, "app", "locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "x.py"), "print(1)\n");
      chmodSync(locked, 0o000);
      try {
        const { code, report } = checkJson(project, cwd);
        expect(code).toBe(2);
        expect(report.errors).toEqual([
          expect.objectContaining({ kind: "read_error", path: "app/locked" }),
        ]);
        expect(report.findings).toHaveLength(4);
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it.skipIf(process.platform === "win32")("does not follow symlinks outside the scan root", () => {
    const outside = makeTempDir("logx outside");
    writeFileSync(join(outside, "secret.py"), "print('outside')\n");
    const project = copyFixture("fastapi-good");
    symlinkSync(outside, join(project, "linked-dir"));
    symlinkSync(join(outside, "secret.py"), join(project, "app", "linked.py"));
    // In-root symlinks are followed but not double-counted.
    symlinkSync(join(project, "app"), join(project, "app-alias"));
    const { code, report } = checkJson(project, cwd);
    expect(code).toBe(0);
    expect(report.summary.filesScanned).toBe(2);
    expect((report as unknown as { skippedSymlinks: string[] }).skippedSymlinks.sort()).toEqual([
      "app/linked.py",
      "linked-dir",
    ]);
  });
});
