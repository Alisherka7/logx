import { dirname, resolve } from "node:path";
import { selectFiles, statKind, type SourceFile } from "../analyzer/files.js";
import { describePythonFailure, discoverPython } from "../analyzer/python.js";
import { runAnalyzer } from "../analyzer/run.js";
import { sortErrors, sortFindings } from "../analyzer/validate.js";
import { findProjectRoot, loadConfig } from "../config/load.js";
import { renderJson } from "../reporters/json.js";
import { exitCodeFor, type CheckReport } from "../reporters/report.js";
import { renderText } from "../reporters/text.js";
import { LogxError, errorMessage } from "../shared/errors.js";
import { isWithin, toPosixRelative } from "../shared/paths.js";
import { RULE_IDS, type ScanError } from "../shared/types.js";

export interface CheckOptions {
  json?: boolean;
}

async function buildReport(pathArg: string | undefined): Promise<CheckReport> {
  const target = resolve(pathArg ?? ".");
  const report: CheckReport = {
    root: target,
    config: { source: "unavailable", path: null },
    findings: [],
    errors: [],
    filesScanned: 0,
    filesAnalyzed: 0,
    skippedSymlinks: [],
  };
  const fail = (error: ScanError): CheckReport => {
    report.errors.push(error);
    return report;
  };

  const kind = statKind(target);
  if (kind === "missing" || kind === "other") {
    return fail({
      kind: "target_error",
      message: `Path not found or not a regular file/directory: ${target}`,
      fix: "Pass an existing project directory or Python file.",
    });
  }
  const startDir = kind === "directory" ? target : dirname(target);
  // Root: nearest initialized ancestor; else the cwd when it contains the target; else the target.
  const cwd = process.cwd();
  const root = findProjectRoot(startDir) ?? (isWithin(cwd, startDir) ? cwd : startDir);
  report.root = root;

  let loaded;
  try {
    loaded = loadConfig(root);
  } catch (error) {
    if (!(error instanceof LogxError)) throw error;
    const configError: ScanError = { kind: "config_error", message: error.message };
    if (error.fix) configError.fix = error.fix;
    return fail(configError);
  }
  report.config = {
    source: loaded.source,
    path: loaded.file ? toPosixRelative(root, loaded.file) : null,
  };
  const { config } = loaded;

  let files: SourceFile[];
  if (kind === "file") {
    if (!target.endsWith(".py")) {
      return fail({
        kind: "target_error",
        message: `Not a Python file: ${target}`,
        fix: "Pass a .py file or a directory.",
      });
    }
    // An explicitly named file is scanned even if `exclude` would match it.
    files = [{ path: toPosixRelative(root, target), absPath: target }];
  } else {
    const selection = selectFiles(root, target, config);
    files = selection.files;
    report.skippedSymlinks = selection.skippedSymlinks;
    report.errors.push(...selection.errors);
  }
  report.filesScanned = files.length;

  const rules = RULE_IDS.filter((id) => config.rules[id]);
  if (files.length === 0 || rules.length === 0) return report;

  const discovery = await discoverPython(config.python);
  if (!discovery.ok) {
    return fail({ kind: "python_unavailable", ...describePythonFailure(discovery) });
  }

  const outcome = await runAnalyzer(discovery.python, root, files, rules);
  if (!outcome.ok) return fail(outcome.error);
  report.findings = sortFindings(outcome.response.findings);
  report.errors = sortErrors([...report.errors, ...outcome.response.errors]);
  report.filesAnalyzed = outcome.response.filesAnalyzed;
  return report;
}

export async function checkCommand(
  pathArg: string | undefined,
  options: CheckOptions,
): Promise<number> {
  const report = await buildReport(pathArg);
  process.stdout.write(options.json ? renderJson(report) : renderText(report));
  return exitCodeFor(report);
}
