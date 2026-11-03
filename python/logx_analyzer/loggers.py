from __future__ import annotations

import ast
from typing import Optional, Set


def dotted_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted_name(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


class LoggerIndex:
    def __init__(self, tree: ast.Module) -> None:
        self.logging_modules: Set[str] = set()
        self.get_logger_funcs: Set[str] = set()
        self.adapter_classes: Set[str] = set()
        self.logger_names: Set[str] = set()
        self._collect_imports(tree)
        self._collect_assignments(tree)

    def _collect_imports(self, tree: ast.Module) -> None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "logging":
                        self.logging_modules.add(alias.asname or "logging")
                    elif alias.name.startswith("logging.") and not alias.asname:
                        # `import logging.handlers` also binds `logging`.
                        self.logging_modules.add("logging")
            elif isinstance(node, ast.ImportFrom) and node.module == "logging" and node.level == 0:
                for alias in node.names:
                    if alias.name == "getLogger":
                        self.get_logger_funcs.add(alias.asname or alias.name)
                    elif alias.name == "LoggerAdapter":
                        self.adapter_classes.add(alias.asname or alias.name)

    def _creates_logger(self, value: ast.AST) -> bool:
        if not isinstance(value, ast.Call):
            return False
        func = value.func
        name = dotted_name(func)
        if name is None:
            return False
        if name in self.get_logger_funcs or name in self.adapter_classes:
            return True
        if isinstance(func, ast.Attribute) and dotted_name(func.value) in self.logging_modules:
            return func.attr in ("getLogger", "LoggerAdapter")
        return False

    def _collect_assignments(self, tree: ast.Module) -> None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and self._creates_logger(node.value):
                targets = node.targets
            elif isinstance(node, ast.AnnAssign) and node.value is not None and self._creates_logger(node.value):
                targets = [node.target]
            else:
                continue
            for target in targets:
                name = dotted_name(target)
                if name:
                    self.logger_names.add(name)

    def is_logger(self, node: ast.AST) -> bool:
        """True if `node` (the receiver of `.error`) is a recognized stdlib logger."""
        if self._creates_logger(node):
            return True
        name = dotted_name(node)
        return name is not None and (name in self.logger_names or name in self.logging_modules)
