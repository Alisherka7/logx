/**
 * Minimal, dependency-free glob matching with documented semantics:
 *
 * - Patterns are matched against project-relative paths that use `/` separators.
 * - `*` matches any run of characters except `/`.
 * - `**` as a whole path segment matches zero or more segments (`a/**\/b` matches `a/b`, `a/x/y/b`).
 * - `?` matches exactly one character except `/`.
 * - A pattern containing no `/` matches the file's basename at any depth (`*.py`, `conftest.py`).
 * - A leading `./` is ignored. Matching is case-sensitive. No brace or character-class syntax.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  const basenameOnly = !p.includes("/");
  if (basenameOnly) p = `**/${p}`;
  if (p.endsWith("/")) p += "**";

  const segments = p.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      // Zero or more whole segments. When last, it must match at least something below.
      source += last ? ".*" : "(?:[^/]+/)*";
      return;
    }
    for (const char of segment) {
      if (char === "*") source += "[^/]*";
      else if (char === "?") source += "[^/]";
      else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    if (!last) source += "/";
  });
  return new RegExp(`^${source}$`);
}

export class GlobSet {
  private readonly regexps: RegExp[];

  constructor(patterns: readonly string[]) {
    this.regexps = patterns.map(globToRegExp);
  }

  matches(relativePosixPath: string): boolean {
    return this.regexps.some((re) => re.test(relativePosixPath));
  }
}
