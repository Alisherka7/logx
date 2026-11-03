import { describe, expect, it } from "vitest";
import { GlobSet, globToRegExp } from "../../src/config/glob.js";

const matches = (pattern: string, path: string): boolean => globToRegExp(pattern).test(path);

describe("glob semantics", () => {
  it("matches basename-only patterns at any depth", () => {
    expect(matches("*.py", "main.py")).toBe(true);
    expect(matches("*.py", "app/api/main.py")).toBe(true);
    expect(matches("conftest.py", "app/tests/conftest.py")).toBe(true);
    expect(matches("*.py", "main.pyc")).toBe(false);
  });

  it("treats ** as zero or more segments", () => {
    expect(matches("**/tests/**", "tests/test_a.py")).toBe(true);
    expect(matches("**/tests/**", "svc/tests/unit/test_a.py")).toBe(true);
    expect(matches("**/tests/**", "svc/contests/a.py")).toBe(false);
    expect(matches("app/**/models.py", "app/models.py")).toBe(true);
    expect(matches("app/**/models.py", "app/a/b/models.py")).toBe(true);
  });

  it("keeps * and ? within one segment", () => {
    expect(matches("app/*.py", "app/main.py")).toBe(true);
    expect(matches("app/*.py", "app/sub/main.py")).toBe(false);
    expect(matches("app/?.py", "app/a.py")).toBe(true);
    expect(matches("app/?.py", "app/ab.py")).toBe(false);
  });

  it("anchors patterns containing a slash at the project root", () => {
    expect(matches("scripts/*.py", "scripts/run.py")).toBe(true);
    expect(matches("scripts/*.py", "app/scripts/run.py")).toBe(false);
    expect(matches("./scripts/*.py", "scripts/run.py")).toBe(true);
  });

  it("treats a trailing slash as the whole directory and escapes regex characters", () => {
    expect(matches("legacy/", "legacy/a/b.py")).toBe(true);
    expect(matches("my+app (v1)/*.py", "my+app (v1)/x.py")).toBe(true);
  });

  it("GlobSet matches any pattern", () => {
    const set = new GlobSet(["**/migrations/**", "*_test.py"]);
    expect(set.matches("app/migrations/0001.py")).toBe(true);
    expect(set.matches("app/x_test.py")).toBe(true);
    expect(set.matches("app/main.py")).toBe(false);
  });
});
