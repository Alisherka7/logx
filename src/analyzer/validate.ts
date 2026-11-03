import { RULE_IDS, type Finding, type RuleId, type ScanError } from "../shared/types.js";

export const PROTOCOL_VERSION = 1;

export interface AnalyzerResponse {
  findings: Finding[];
  errors: ScanError[];
  filesAnalyzed: number;
}

const FILE_ERROR_KINDS = new Set(["syntax_error", "read_error"]);

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the analyzer's stdout. Anything unexpected is rejected rather than passed through,
 * so a broken or mismatched analyzer surfaces as an operational error instead of bad output.
 */
export function parseAnalyzerResponse(stdout: string): AnalyzerResponse {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("analyzer output is not valid JSON");
  }
  if (!isRecord(data)) throw new Error("analyzer output is not a JSON object");
  if (data.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `analyzer protocol mismatch (expected ${PROTOCOL_VERSION}, got ${JSON.stringify(data.protocolVersion)})`,
    );
  }
  if (!Array.isArray(data.findings) || !Array.isArray(data.errors)) {
    throw new Error("analyzer output is missing findings/errors arrays");
  }
  if (typeof data.filesAnalyzed !== "number" || !Number.isInteger(data.filesAnalyzed)) {
    throw new Error("analyzer output is missing filesAnalyzed");
  }

  const findings = data.findings.map((item, index): Finding => {
    if (
      !isRecord(item) ||
      !(RULE_IDS as readonly unknown[]).includes(item.ruleId) ||
      (item.severity !== "info" && item.severity !== "warning") ||
      typeof item.path !== "string" ||
      !isPositiveInt(item.line) ||
      !isPositiveInt(item.column) ||
      typeof item.message !== "string" ||
      typeof item.suggestion !== "string"
    ) {
      throw new Error(`analyzer finding #${index} is malformed`);
    }
    return {
      ruleId: item.ruleId as RuleId,
      severity: item.severity,
      path: item.path,
      line: item.line,
      column: item.column,
      message: item.message,
      suggestion: item.suggestion,
    };
  });

  const errors = data.errors.map((item, index): ScanError => {
    if (
      !isRecord(item) ||
      typeof item.kind !== "string" ||
      !FILE_ERROR_KINDS.has(item.kind) ||
      typeof item.path !== "string" ||
      typeof item.message !== "string"
    ) {
      throw new Error(`analyzer error #${index} is malformed`);
    }
    const error: ScanError = {
      kind: item.kind as ScanError["kind"],
      path: item.path,
      message: item.message,
    };
    if (isPositiveInt(item.line)) error.line = item.line;
    if (isPositiveInt(item.column)) error.column = item.column;
    return error;
  });

  return { findings, errors, filesAnalyzed: data.filesAnalyzed };
}

const compare = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Stable output order: path, line, column, rule ID (code-point comparison, locale independent). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compare(a.path, b.path) ||
      compare(a.line, b.line) ||
      compare(a.column, b.column) ||
      compare(a.ruleId, b.ruleId),
  );
}

export function sortErrors(errors: ScanError[]): ScanError[] {
  return [...errors].sort(
    (a, b) =>
      compare(a.path ?? "", b.path ?? "") ||
      compare(a.line ?? 0, b.line ?? 0) ||
      compare(a.kind, b.kind),
  );
}
