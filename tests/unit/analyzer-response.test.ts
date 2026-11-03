import { describe, expect, it } from "vitest";
import { parseAnalyzerResponse, sortFindings } from "../../src/analyzer/validate.js";
import type { Finding } from "../../src/shared/types.js";

const finding = (
  path: string,
  line: number,
  column: number,
  ruleId: Finding["ruleId"] = "LOGX001",
): Finding => ({
  ruleId,
  severity: "info",
  path,
  line,
  column,
  message: "m",
  suggestion: "s",
});

describe("parseAnalyzerResponse", () => {
  it("accepts a well-formed response", () => {
    const response = parseAnalyzerResponse(
      JSON.stringify({
        protocolVersion: 1,
        findings: [finding("a.py", 1, 1)],
        errors: [{ kind: "syntax_error", path: "b.py", message: "cannot parse", line: 2 }],
        filesAnalyzed: 1,
      }),
    );
    expect(response.findings).toHaveLength(1);
    expect(response.errors[0]).toEqual({
      kind: "syntax_error",
      path: "b.py",
      message: "cannot parse",
      line: 2,
    });
  });

  it.each([
    ["not json", "nope"],
    [
      "wrong protocol",
      JSON.stringify({ protocolVersion: 2, findings: [], errors: [], filesAnalyzed: 0 }),
    ],
    [
      "bad rule",
      JSON.stringify({
        protocolVersion: 1,
        findings: [{ ...finding("a.py", 1, 1), ruleId: "X" }],
        errors: [],
        filesAnalyzed: 1,
      }),
    ],
    [
      "zero line",
      JSON.stringify({
        protocolVersion: 1,
        findings: [finding("a.py", 0, 1)],
        errors: [],
        filesAnalyzed: 1,
      }),
    ],
    [
      "unknown error kind",
      JSON.stringify({
        protocolVersion: 1,
        findings: [],
        errors: [{ kind: "boom", path: "a", message: "m" }],
        filesAnalyzed: 0,
      }),
    ],
  ])("rejects %s", (_label, stdout) => {
    expect(() => parseAnalyzerResponse(stdout)).toThrow();
  });
});

describe("sortFindings", () => {
  it("orders by path, line, column, then rule ID", () => {
    const sorted = sortFindings([
      finding("b.py", 1, 1),
      finding("a.py", 10, 1),
      finding("a.py", 2, 5, "LOGX003"),
      finding("a.py", 2, 5, "LOGX002"),
      finding("a.py", 2, 1),
    ]);
    expect(sorted.map((f) => `${f.path}:${f.line}:${f.column}:${f.ruleId}`)).toEqual([
      "a.py:2:1:LOGX001",
      "a.py:2:5:LOGX002",
      "a.py:2:5:LOGX003",
      "a.py:10:1:LOGX001",
      "b.py:1:1:LOGX001",
    ]);
  });
});
