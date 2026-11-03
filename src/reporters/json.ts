import { packageVersion } from "../shared/paths.js";
import { REPORT_SCHEMA_VERSION, summarize, type CheckReport } from "./report.js";

/** The single JSON object written to stdout by `logx check --json`. */
export function renderJson(report: CheckReport): string {
  const output = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "logx", version: packageVersion },
    root: report.root,
    config: report.config,
    findings: report.findings,
    errors: report.errors,
    skippedSymlinks: report.skippedSymlinks,
    summary: summarize(report),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}
