import type { ScanError } from "../shared/types.js";
import { summarize, type CheckReport } from "./report.js";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function location(error: ScanError): string {
  if (!error.path) return "";
  const line = error.line ? `:${error.line}${error.column ? `:${error.column}` : ""}` : "";
  return `${error.path}${line}  `;
}

export function renderText(report: CheckReport): string {
  const out: string[] = [];
  if (report.config.source === "defaults") {
    out.push(
      "Note: no .logx/config.json found; using default settings (run `logx init` to customize).",
      "",
    );
  }

  for (const f of report.findings) {
    out.push(`${f.path}:${f.line}:${f.column}  ${f.severity}  ${f.ruleId}  ${f.message}`);
    out.push(`    next: ${f.suggestion}`);
  }
  if (report.findings.length > 0) out.push("");

  if (report.errors.length > 0) {
    out.push("Analysis incomplete:");
    for (const error of report.errors) {
      out.push(`  ${location(error)}${error.kind}  ${error.message}`);
      if (error.fix) out.push(`    fix: ${error.fix}`);
    }
    out.push("");
  }

  for (const link of report.skippedSymlinks) {
    out.push(`Skipped symlink pointing outside the project: ${link}`);
  }
  if (report.skippedSymlinks.length > 0) out.push("");

  const s = summarize(report);
  const counts = Object.entries(s.bySeverity)
    .filter(([, n]) => n > 0)
    .map(([severity, n]) => `${n} ${severity}`)
    .join(", ");
  const scanned =
    s.filesAnalyzed === s.filesScanned
      ? `Scanned ${plural(s.filesScanned, "file")}`
      : `Analyzed ${s.filesAnalyzed} of ${plural(s.filesScanned, "file")}`;
  let line = `${scanned}: ${plural(s.findings, "finding")}`;
  if (counts) line += ` (${counts})`;
  line += s.complete ? "." : `; ${plural(s.errors, "error")} — results are incomplete.`;
  out.push(line);
  if (s.findings > 0) {
    out.push(
      "Findings are deterministic review candidates, not proof of a bug. Rule details and limits: skills/logx/references/rules.md in the LogX package.",
    );
  }
  return `${out.join("\n")}\n`;
}
