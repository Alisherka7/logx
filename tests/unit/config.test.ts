import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaults.js";
import { validateConfig } from "../../src/config/schema.js";

describe("validateConfig", () => {
  it("accepts the default configuration", () => {
    const result = validateConfig(defaultConfig(), defaultConfig());
    expect(result).toEqual({ ok: true, config: defaultConfig() });
  });

  it("fills optional settings with defaults", () => {
    const result = validateConfig({ schemaVersion: 1, rules: { LOGX001: false } }, defaultConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.rules).toEqual({ LOGX001: false, LOGX002: true, LOGX003: true });
      expect(result.config.include).toEqual(["**/*.py"]);
      expect(result.config.python).toBeNull();
    }
  });

  it("reports every problem with its location", () => {
    const result = validateConfig(
      {
        schemaVersion: 2,
        include: "*.py",
        rules: { LOGX009: true, LOGX001: "yes" },
        python: 3,
        extra: 1,
      },
      defaultConfig(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(
        ["extra", "include", "python", "rules.LOGX001", "rules.LOGX009", "schemaVersion"].sort(),
      );
    }
  });

  it("rejects non-objects and empty include lists", () => {
    expect(validateConfig([], defaultConfig()).ok).toBe(false);
    expect(validateConfig({ schemaVersion: 1, include: [] }, defaultConfig()).ok).toBe(false);
  });
});
