from __future__ import annotations

import ast
import io
import re
import tokenize
import warnings
from dataclasses import dataclass
from typing import List, Optional, Union

MAX_FILE_BYTES = 2 * 1024 * 1024
_LINE_BREAK = re.compile(r"\r\n|\r|\n")


@dataclass
class ParsedSource:
    tree: ast.Module
    lines: List[str]

    def column(self, node: ast.AST) -> int:
        offset = getattr(node, "col_offset", 0)
        lineno = getattr(node, "lineno", 1)
        if 1 <= lineno <= len(self.lines):
            prefix = self.lines[lineno - 1].encode("utf-8")[:offset]
            return len(prefix.decode("utf-8", errors="ignore")) + 1
        return offset + 1


@dataclass
class SourceError:
    kind: str  # "syntax_error" | "read_error"
    message: str
    line: Optional[int] = None
    column: Optional[int] = None


def parse_file(abs_path: str, display_path: str) -> Union[ParsedSource, SourceError]:
    try:
        with open(abs_path, "rb") as handle:
            data = handle.read(MAX_FILE_BYTES + 1)
    except OSError as exc:
        return SourceError("read_error", f"cannot read file: {exc.strerror or exc}")
    if len(data) > MAX_FILE_BYTES:
        return SourceError("read_error", f"file exceeds {MAX_FILE_BYTES // (1024 * 1024)} MiB; skipped")
    return parse_bytes(data, display_path)


def parse_bytes(data: bytes, display_path: str) -> Union[ParsedSource, SourceError]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # e.g. SyntaxWarning for invalid escapes
            tree = ast.parse(data, filename=display_path)
    except SyntaxError as exc:
        line = exc.lineno if isinstance(exc.lineno, int) and exc.lineno > 0 else None
        column = exc.offset if isinstance(exc.offset, int) and exc.offset > 0 else None
        return SourceError("syntax_error", f"cannot parse: {exc.msg}", line, column)
    except (ValueError, UnicodeDecodeError) as exc:
        return SourceError("syntax_error", f"cannot parse: {exc}")
    except (RecursionError, MemoryError):
        return SourceError("read_error", "source is too deeply nested or too large to analyze")

    try:
        encoding, _ = tokenize.detect_encoding(io.BytesIO(data).readline)
        text = data.decode(encoding)
    except (SyntaxError, LookupError, UnicodeDecodeError):
        text = data.decode("utf-8", errors="replace")
    return ParsedSource(tree, _LINE_BREAK.split(text))
