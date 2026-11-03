import { resources } from "../shared/paths.js";
import type { RuleId, ScanError } from "../shared/types.js";
import type { SourceFile } from "./files.js";
import { runProcess } from "./process.js";
import type { PythonCommand } from "./python.js";
import { PROTOCOL_VERSION, parseAnalyzerResponse, type AnalyzerResponse } from "./validate.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

function timeoutMs(): number {
  const fromEnv = Number(process.env.LOGX_ANALYZER_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS;
}

export type AnalyzerOutcome =
  { ok: true; response: AnalyzerResponse } | { ok: false; error: ScanError };

/**
 * Run the bundled Python analyzer on `files`. Python runs in isolated mode (-I) from the
 * package's own directory, so nothing from the target project is imported or executed.
 */
export async function runAnalyzer(
  python: PythonCommand,
  root: string,
  files: SourceFile[],
  rules: RuleId[],
): Promise<AnalyzerOutcome> {
  const request = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, root, files, rules });
  const limit = timeoutMs();
  const result = await runProcess(python.executable, {
    args: [...python.prefixArgs, "-I", "-B", resources.analyzerEntry],
    cwd: resources.analyzerDir,
    input: request,
    timeoutMs: limit,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
  });

  const fail = (kind: ScanError["kind"], message: string, fix: string): AnalyzerOutcome => ({
    ok: false,
    error: { kind, message, fix },
  });
  const reportFix =
    "Re-run with a smaller path to isolate the problem, and report it with the output above.";

  switch (result.kind) {
    case "spawn_error":
      return fail(
        "python_unavailable",
        `Could not start ${python.label}: ${result.error.message}`,
        'Check the Python installation or the "python" setting in .logx/config.json.',
      );
    case "timeout":
      return fail(
        "timeout",
        `Analyzer did not finish within ${limit} ms; the scan is incomplete.`,
        'Scan a narrower path, or exclude large generated files via "exclude" in .logx/config.json.',
      );
    case "output_limit":
      return fail(
        "analyzer_failure",
        `Analyzer exceeded the ${result.stream} size limit and was stopped; the scan is incomplete.`,
        'Scan a narrower path, or exclude generated files via "exclude" in .logx/config.json.',
      );
    case "exited":
      if (result.code !== 0) {
        const stderr = result.stderr.trim().split("\n").slice(-5).join("\n");
        return fail(
          "analyzer_failure",
          `Analyzer exited with ${result.code ?? result.signal}${stderr ? `:\n${stderr}` : ""}`,
          reportFix,
        );
      }
      try {
        return { ok: true, response: parseAnalyzerResponse(result.stdout) };
      } catch (error) {
        return fail(
          "analyzer_failure",
          `Invalid analyzer response: ${(error as Error).message}`,
          reportFix,
        );
      }
  }
}
