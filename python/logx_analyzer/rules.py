from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, List

from .loggers import LoggerIndex, dotted_name
from .source import ParsedSource

SEVERITY = {"LOGX001": "info", "LOGX002": "warning", "LOGX003": "warning"}
ALL_RULES = frozenset(SEVERITY)


@dataclass
class Finding:
    rule_id: str
    line: int
    column: int
    message: str
    suggestion: str

    def to_json(self, path: str) -> Dict[str, object]:
        return {
            "ruleId": self.rule_id,
            "severity": SEVERITY[self.rule_id],
            "path": path,
            "line": self.line,
            "column": self.column,
            "message": self.message,
            "suggestion": self.suggestion,
        }


def _binds_print(tree: ast.Module) -> bool:
    """True if the file rebinds `print` anywhere (e.g. `from rich import print`)."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if any((alias.asname or alias.name.split(".")[0]) == "print" for alias in node.names):
                return True
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == "print":
            return True
        elif isinstance(node, ast.Name) and node.id == "print" and isinstance(node.ctx, (ast.Store, ast.Del)):
            return True
        elif isinstance(node, ast.arg) and node.arg == "print":
            return True
    return False


def _is_falsy_constant(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value in (False, None, 0)


def _formats_exception(node: ast.AST, caught: FrozenSet[str]) -> bool:
    """True if `node` contains `str(exc)` or an f-string interpolating `exc` directly."""
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == "str"
            and len(child.args) == 1
            and not child.keywords
            and isinstance(child.args[0], ast.Name)
            and child.args[0].id in caught
        ):
            return True
        if isinstance(child, ast.FormattedValue) and isinstance(child.value, ast.Name) and child.value.id in caught:
            return True
    return False


class _Checker:
    def __init__(self, source: ParsedSource, rules: FrozenSet[str]) -> None:
        self.source = source
        self.rules = rules
        self.loggers = LoggerIndex(source.tree)
        self.check_print = "LOGX001" in rules and not _binds_print(source.tree)
        self.findings: List[Finding] = []

    def add(self, rule_id: str, node: ast.AST, message: str, suggestion: str) -> None:
        self.findings.append(Finding(rule_id, node.lineno, self.source.column(node), message, suggestion))

    def visit(self, node: ast.AST, caught: FrozenSet[str]) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            # Code defined inside a handler runs later; the handler's exception is out of scope.
            caught = frozenset()
        elif isinstance(node, ast.ExceptHandler):
            self.check_handler(node)
            if node.type is not None:
                self.visit(node.type, caught)
            inner = caught | {node.name} if node.name else caught
            for statement in node.body:
                self.visit(statement, inner)
            return
        elif isinstance(node, ast.Call):
            self.check_call(node, caught)

        for child in ast.iter_child_nodes(node):
            self.visit(child, caught)

    # LOGX003
    def check_handler(self, handler: ast.ExceptHandler) -> None:
        if "LOGX003" not in self.rules:
            return
        if len(handler.body) == 1 and isinstance(handler.body[0], ast.Pass):
            caught = f"`{ast.unparse(handler.type)}`" if handler.type is not None else "all exceptions (bare `except:`)"
            self.add(
                "LOGX003",
                handler,
                f"Exception handler for {caught} contains only `pass`; the exception is silently discarded.",
                "Review whether suppression is intended. If it is, narrow the exception type and add a comment "
                "(or use contextlib.suppress). Otherwise handle it or log it, e.g. "
                "logger.debug(\"...\", exc_info=True).",
            )

    def check_call(self, call: ast.Call, caught: FrozenSet[str]) -> None:
        func = call.func
        # LOGX001
        if self.check_print and isinstance(func, ast.Name) and func.id == "print":
            self.add(
                "LOGX001",
                call,
                "Direct print() call; its output bypasses logging levels, handlers and formatting.",
                "In application code, use a module logger (logger = logging.getLogger(__name__)) at a suitable "
                "level. Printing is fine for intentional CLI or script output; ignore the finding there.",
            )
        # LOGX002
        if (
            "LOGX002" in self.rules
            and caught
            and isinstance(func, ast.Attribute)
            and func.attr == "error"
            and self.loggers.is_logger(func.value)
        ):
            if any(keyword.arg is None for keyword in call.keywords):
                return  # **kwargs may carry exc_info; cannot tell statically.
            for keyword in call.keywords:
                if keyword.arg == "exc_info" and not _is_falsy_constant(keyword.value):
                    return
            values: Iterable[ast.AST] = list(call.args) + [k.value for k in call.keywords if k.arg != "exc_info"]
            if any(_formats_exception(value, caught) for value in values):
                receiver = dotted_name(func.value) or "logger"
                self.add(
                    "LOGX002",
                    call,
                    f"{receiver}.error() inside an exception handler logs the exception message but not its traceback.",
                    f"Use {receiver}.exception(...) in the handler, or pass exc_info=True, so the traceback is recorded.",
                )


def check(source: ParsedSource, rules: Iterable[str] = ALL_RULES) -> List[Finding]:
    checker = _Checker(source, frozenset(rules) & ALL_RULES)
    checker.visit(source.tree, frozenset())
    return sorted(checker.findings, key=lambda f: (f.line, f.column, f.rule_id))
