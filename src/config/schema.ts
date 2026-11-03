import { RULE_IDS, type RuleId } from "../shared/types.js";
import { CONFIG_SCHEMA_VERSION, type LogxConfig } from "./defaults.js";

export interface ConfigIssue {
  /** JSON-path-like location, e.g. `rules.LOGX009`. */
  path: string;
  message: string;
}

export type ValidationResult =
  { ok: true; config: LogxConfig } | { ok: false; issues: ConfigIssue[] };

const KNOWN_KEYS = new Set(["schemaVersion", "include", "exclude", "rules", "python"]);

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}

/** Validate parsed JSON as a LogX configuration. Missing optional fields get defaults. */
export function validateConfig(value: unknown, defaults: LogxConfig): ValidationResult {
  const issues: ConfigIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "$", message: "configuration must be a JSON object" }] };
  }
  const raw = value as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) issues.push({ path: key, message: "unknown setting" });
  }

  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `must be ${CONFIG_SCHEMA_VERSION} (found ${JSON.stringify(raw.schemaVersion)})`,
    });
  }

  for (const key of ["include", "exclude"] as const) {
    if (key in raw && !isStringArray(raw[key])) {
      issues.push({ path: key, message: "must be an array of non-empty glob strings" });
    }
  }
  if (Array.isArray(raw.include) && raw.include.length === 0) {
    issues.push({ path: "include", message: "must contain at least one pattern" });
  }

  const rules: Record<RuleId, boolean> = { ...defaults.rules };
  if ("rules" in raw) {
    const rawRules = raw.rules;
    if (typeof rawRules !== "object" || rawRules === null || Array.isArray(rawRules)) {
      issues.push({ path: "rules", message: "must be an object mapping rule IDs to true/false" });
    } else {
      for (const [id, enabled] of Object.entries(rawRules)) {
        if (!(RULE_IDS as readonly string[]).includes(id)) {
          issues.push({
            path: `rules.${id}`,
            message: `unknown rule (known: ${RULE_IDS.join(", ")})`,
          });
        } else if (typeof enabled !== "boolean") {
          issues.push({ path: `rules.${id}`, message: "must be true or false" });
        } else {
          rules[id as RuleId] = enabled;
        }
      }
    }
  }

  if (
    "python" in raw &&
    raw.python !== null &&
    (typeof raw.python !== "string" || raw.python.trim() === "")
  ) {
    issues.push({ path: "python", message: "must be null or a non-empty executable path/name" });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    config: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      include: (raw.include as string[] | undefined) ?? defaults.include,
      exclude: (raw.exclude as string[] | undefined) ?? defaults.exclude,
      rules,
      python: (raw.python as string | null | undefined) ?? null,
    },
  };
}
