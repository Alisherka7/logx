import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

from logx_analyzer.rules import check
from logx_analyzer.source import ParsedSource, SourceError, parse_bytes

ENTRY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logx_analyzer", "__main__.py")


def findings(code, rules=("LOGX001", "LOGX002", "LOGX003")):
    parsed = parse_bytes(textwrap.dedent(code).encode("utf-8"), "t.py")
    assert isinstance(parsed, ParsedSource), parsed
    return [(f.rule_id, f.line, f.column) for f in check(parsed, rules)]


def ids(code, rule):
    return [f for f in findings(code, (rule,)) if f[0] == rule]


class PrintRuleTest(unittest.TestCase):
    def test_flags_builtin_print(self):
        self.assertEqual(ids("print('hi')\n", "LOGX001"), [("LOGX001", 1, 1)])

    def test_flags_print_in_nested_code(self):
        code = """
        def handler():
            if True:
                print("x", flush=True)
        """
        self.assertEqual(ids(code, "LOGX001"), [("LOGX001", 4, 9)])

    def test_ignores_rich_print_import(self):
        self.assertEqual(ids("from rich import print\nprint('[bold]hi')\n", "LOGX001"), [])

    def test_ignores_locally_defined_print(self):
        self.assertEqual(ids("def print(*a):\n    pass\nprint(1)\n", "LOGX001"), [])

    def test_ignores_method_named_print(self):
        self.assertEqual(ids("console.print('x')\nreport.print()\n", "LOGX001"), [])

    def test_column_counts_characters_not_bytes(self):
        self.assertEqual(ids("x = 'héllo'; print(x)\n", "LOGX001"), [("LOGX001", 1, 14)])

    def test_disabled_rule_reports_nothing(self):
        self.assertEqual(findings("print(1)\n", ("LOGX002",)), [])


class ErrorWithoutTracebackTest(unittest.TestCase):
    def wrap(self, setup, call, name="exc"):
        return f"{setup}\ntry:\n    work()\nexcept Exception as {name}:\n    {call}\n"

    def test_flags_str_exc(self):
        code = self.wrap("import logging\nlogger = logging.getLogger(__name__)", "logger.error('failed: ' + str(exc))")
        self.assertEqual(ids(code, "LOGX002"), [("LOGX002", 6, 5)])

    def test_flags_fstring(self):
        code = self.wrap("import logging\nlog = logging.getLogger('app')", "log.error(f'failed: {exc}')")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_fstring_with_conversion(self):
        code = self.wrap("import logging\nlog = logging.getLogger('app')", "log.error(f'failed: {exc!r}')")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_str_exc_as_format_argument(self):
        code = self.wrap("import logging\nlog = logging.getLogger()", "log.error('failed: %s', str(exc))")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_aliased_module(self):
        code = self.wrap("import logging as lg\nlogger = lg.getLogger(__name__)", "logger.error(str(exc))")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_from_import_get_logger_alias(self):
        code = self.wrap("from logging import getLogger as gl\nlogger = gl(__name__)", "logger.error(str(exc))")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_root_logger_function(self):
        code = self.wrap("import logging", "logging.error(f'boom {exc}')")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_inline_get_logger(self):
        code = self.wrap("import logging", "logging.getLogger(__name__).error(str(exc))")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_self_logger_attribute(self):
        code = """
        import logging
        class Service:
            def __init__(self):
                self.logger = logging.getLogger(__name__)
            def run(self):
                try:
                    work()
                except OSError as err:
                    self.logger.error(f"run failed: {err}")
        """
        self.assertEqual(ids(code, "LOGX002"), [("LOGX002", 10, 13)])

    def test_flags_explicit_false_exc_info(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error(str(exc), exc_info=False)")
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_flags_logger_adapter(self):
        code = self.wrap(
            "import logging\nlogger = logging.LoggerAdapter(logging.getLogger(__name__), {})", "logger.error(str(exc))"
        )
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_outer_exception_visible_in_nested_handler(self):
        code = """
        import logging
        logger = logging.getLogger(__name__)
        try:
            a()
        except ValueError as outer:
            try:
                b()
            except KeyError:
                logger.error(f"{outer}")
        """
        self.assertEqual(len(ids(code, "LOGX002")), 1)

    def test_ignores_logger_exception(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.exception(f'failed: {exc}')")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_exc_info_true(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error(f'failed: {exc}', exc_info=True)")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_exc_info_exception_object(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error(str(exc), exc_info=exc)")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_kwargs_splat(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error(str(exc), **opts)")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_message_not_derived_from_exception(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error('payment failed')")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_other_levels(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.warning(str(exc))")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_unrecognized_receiver(self):
        # e.g. a structlog/loguru logger or an imported project logger: not recognized by design.
        code = self.wrap("from app.log import logger", "logger.error(str(exc))")
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_error_outside_handler(self):
        code = "import logging\nlogger = logging.getLogger()\nexc = Exception()\nlogger.error(str(exc))\n"
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_function_defined_inside_handler(self):
        code = self.wrap(
            "import logging\nlogger = logging.getLogger()",
            "callback = lambda: logger.error(str(exc))",
        )
        self.assertEqual(ids(code, "LOGX002"), [])

    def test_ignores_unrelated_variable_in_fstring(self):
        code = self.wrap("import logging\nlogger = logging.getLogger()", "logger.error(f'user {user_id} failed')")
        self.assertEqual(ids(code, "LOGX002"), [])


class SilentExceptTest(unittest.TestCase):
    def test_flags_pass_only_handler(self):
        self.assertEqual(ids("try:\n    x()\nexcept ValueError:\n    pass\n", "LOGX003"), [("LOGX003", 3, 1)])

    def test_flags_bare_except(self):
        self.assertEqual(len(ids("try:\n    x()\nexcept:\n    pass\n", "LOGX003")), 1)

    def test_flags_nested_handler_column(self):
        code = "def f():\n    try:\n        x()\n    except (KeyError, IndexError) as e:\n        pass\n"
        self.assertEqual(ids(code, "LOGX003"), [("LOGX003", 4, 5)])

    def test_ignores_handler_with_logging(self):
        code = "try:\n    x()\nexcept ValueError:\n    logger.debug('ignored', exc_info=True)\n"
        self.assertEqual(ids(code, "LOGX003"), [])

    def test_ignores_pass_with_other_statements(self):
        self.assertEqual(ids("try:\n    x()\nexcept ValueError:\n    cleanup()\n    pass\n", "LOGX003"), [])

    def test_ignores_ellipsis_body(self):
        self.assertEqual(ids("try:\n    x()\nexcept ValueError:\n    ...\n", "LOGX003"), [])

    @unittest.skipIf(sys.version_info < (3, 11), "except* requires Python 3.11")
    def test_flags_except_star(self):
        self.assertEqual(len(ids("try:\n    x()\nexcept* ValueError:\n    pass\n", "LOGX003")), 1)


class SourceTest(unittest.TestCase):
    def test_syntax_error_reported_with_location(self):
        result = parse_bytes(b"def broken(:\n    pass\n", "bad.py")
        self.assertIsInstance(result, SourceError)
        self.assertEqual(result.kind, "syntax_error")
        self.assertEqual(result.line, 1)

    def test_bom_and_crlf(self):
        parsed = parse_bytes("\ufeffx = 1\r\nprint('é')\r\n".encode("utf-8"), "t.py")
        self.assertEqual([(f.rule_id, f.line, f.column) for f in check(parsed)], [("LOGX001", 2, 1)])

    def test_latin1_encoding_cookie(self):
        data = "# -*- coding: latin-1 -*-\ns = 'é'; print(s)\n".encode("latin-1")
        parsed = parse_bytes(data, "t.py")
        self.assertEqual([(f.line, f.column) for f in check(parsed)], [(2, 10)])


class ProtocolTest(unittest.TestCase):
    def run_analyzer(self, request):
        proc = subprocess.run(
            [sys.executable, "-I", "-B", ENTRY],
            input=json.dumps(request).encode("utf-8"),
            capture_output=True,
            timeout=60,
        )
        return proc

    def test_round_trip_with_syntax_error_and_finding(self):
        with tempfile.TemporaryDirectory(prefix="logx proto ") as tmp:
            good = os.path.join(tmp, "good.py")
            bad = os.path.join(tmp, "bad.py")
            with open(good, "w", encoding="utf-8") as handle:
                handle.write("try:\n    x()\nexcept Exception:\n    pass\n")
            with open(bad, "w", encoding="utf-8") as handle:
                handle.write("def (\n")
            proc = self.run_analyzer(
                {
                    "protocolVersion": 1,
                    "root": tmp,
                    "files": [{"path": "bad.py", "absPath": bad}, {"path": "good.py", "absPath": good}],
                    "rules": ["LOGX001", "LOGX002", "LOGX003"],
                }
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        response = json.loads(proc.stdout)
        self.assertEqual(response["protocolVersion"], 1)
        self.assertEqual(response["filesAnalyzed"], 1)
        self.assertEqual([f["ruleId"] for f in response["findings"]], ["LOGX003"])
        self.assertEqual(response["errors"][0]["kind"], "syntax_error")
        self.assertEqual(response["errors"][0]["path"], "bad.py")

    def test_missing_file_is_read_error(self):
        proc = self.run_analyzer(
            {"protocolVersion": 1, "root": "/", "files": [{"path": "x.py", "absPath": "/nonexistent/x.py"}], "rules": []}
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout)["errors"][0]["kind"], "read_error")

    def test_invalid_request_exits_2(self):
        proc = self.run_analyzer({"protocolVersion": 99})
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(proc.stdout, b"")


if __name__ == "__main__":
    unittest.main()
