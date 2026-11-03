export const RULE_IDS = ["LOGX001", "LOGX002", "LOGX003"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Severity = "info" | "warning";

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  /** Project-relative POSIX path. */
  path: string;
  /** One-based. */
  line: number;
  /** One-based, in characters. */
  column: number;
  message: string;
  suggestion: string;
}

export type ScanErrorKind =
  | "syntax_error"
  | "read_error"
  | "config_error"
  | "target_error"
  | "python_unavailable"
  | "analyzer_failure"
  | "timeout"
  | "internal_error";

export interface ScanError {
  kind: ScanErrorKind;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  fix?: string;
}
