from __future__ import annotations

import json
import sys
from typing import Any, Dict, List

from . import PROTOCOL_VERSION
from .rules import ALL_RULES, check
from .source import ParsedSource, parse_file


def _read_request() -> Dict[str, Any]:
    raw = sys.stdin.buffer.read()
    request = json.loads(raw.decode("utf-8"))
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError(f"expected protocolVersion {PROTOCOL_VERSION}")
    files = request.get("files")
    rules = request.get("rules")
    if not isinstance(files, list) or not all(
        isinstance(f, dict) and isinstance(f.get("path"), str) and isinstance(f.get("absPath"), str) for f in files
    ):
        raise ValueError("files must be a list of {path, absPath}")
    if not isinstance(rules, list) or not all(isinstance(r, str) and r in ALL_RULES for r in rules):
        raise ValueError(f"rules must be a list drawn from {sorted(ALL_RULES)}")
    return request


def analyze(files: List[Dict[str, str]], rules: List[str]) -> Dict[str, Any]:
    findings: List[Dict[str, object]] = []
    errors: List[Dict[str, object]] = []
    analyzed = 0
    for entry in files:
        path = entry["path"]
        result = parse_file(entry["absPath"], path)
        if not isinstance(result, ParsedSource):
            error: Dict[str, object] = {"kind": result.kind, "path": path, "message": result.message}
            if result.line is not None:
                error["line"] = result.line
            if result.column is not None:
                error["column"] = result.column
            errors.append(error)
            continue
        analyzed += 1
        findings.extend(f.to_json(path) for f in check(result, rules))
    findings.sort(key=lambda f: (f["path"], f["line"], f["column"], f["ruleId"]))
    return {"protocolVersion": PROTOCOL_VERSION, "findings": findings, "errors": errors, "filesAnalyzed": analyzed}


def main() -> int:
    try:
        request = _read_request()
    except (ValueError, UnicodeDecodeError) as exc:
        sys.stderr.write(f"logx analyzer: invalid request: {exc}\n")
        return 2
    response = analyze(request["files"], request["rules"])
    sys.stdout.write(json.dumps(response, ensure_ascii=True))
    sys.stdout.write("\n")
    return 0
