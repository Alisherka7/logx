import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const cliPath = join(repoRoot, "dist", "cli.js");
export const fixturesDir = join(repoRoot, "tests", "fixtures");

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the built CLI as a separate process; cwd defaults to a temp dir outside the repo. */
export function runCli(
  args: string[],
  options: { cwd: string; env?: Record<string, string | undefined> },
): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const created: string[] = [];

/** Temp directory whose name contains spaces, to exercise path handling. */
export function makeTempDir(label = "logx test"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${label} `)));
  created.push(dir);
  return dir;
}

/** Copy a fixture project into a fresh temp directory (with spaces in its path). */
export function copyFixture(name: string): string {
  const dir = join(makeTempDir(), `project ${name}`);
  cpSync(join(fixturesDir, name), dir, { recursive: true });
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
