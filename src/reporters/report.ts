import type { Finding, ScanError } from "../shared/types.js";

export const REPORT_SCHEMA_VERSION = 1;

export interface CheckReport {
  root: string;
  config: { source: "file" | "defaults" | "unavailable"; path: string | null };
  findings: Finding[];
  errors: ScanError[];
  filesScanned: number;
  filesAnalyzed: number;
  /** Symlinks skipped because they point outside the project root. */
  skippedSymlinks: string[];
}

export function exitCodeFor(report: CheckReport): 0 | 1 | 2 {
  if (report.errors.length > 0) return 2;
  return report.findings.length > 0 ? 1 : 0;
}

export function summarize(report: CheckReport) {
  const bySeverity: Record<string, number> = { warning: 0, info: 0 };
  const byRule: Record<string, number> = {};
  for (const id of [...new Set(report.findings.map((f) => f.ruleId))].sort()) byRule[id] = 0;
  for (const finding of report.findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }
  return {
    filesScanned: report.filesScanned,
    filesAnalyzed: report.filesAnalyzed,
    findings: report.findings.length,
    errors: report.errors.length,
    bySeverity,
    byRule,
    complete: report.errors.length === 0,
  };
}
