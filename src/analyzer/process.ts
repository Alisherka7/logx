import { spawn } from "node:child_process";

export interface RunOptions {
  args: readonly string[];
  cwd: string;
  input?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export type RunResult =
  | {
      kind: "exited";
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }
  | { kind: "spawn_error"; error: NodeJS.ErrnoException }
  | { kind: "timeout"; stderr: string }
  | { kind: "output_limit"; stream: "stdout" | "stderr" };

/**
 * Run an executable with an argument array (never a shell), a hard timeout, and bounded output.
 * The child is killed as soon as a limit is exceeded.
 */
export function runProcess(executable: string, options: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const child = spawn(executable, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ kind: "timeout", stderr: Buffer.concat(stderr).toString("utf8") });
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxStdoutBytes) {
        child.kill("SIGKILL");
        finish({ kind: "output_limit", stream: "stdout" });
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > options.maxStderrBytes) {
        child.kill("SIGKILL");
        finish({ kind: "output_limit", stream: "stderr" });
        return;
      }
      stderr.push(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => finish({ kind: "spawn_error", error }));
    child.on("close", (code, signal) =>
      finish({
        kind: "exited",
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );

    // The child may exit before reading stdin (e.g. bad interpreter); ignore EPIPE.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}
