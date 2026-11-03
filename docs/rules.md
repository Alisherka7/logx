# Rules

The rule reference ships with the agent skill so that agents and humans read the same text:
[skills/logx/references/rules.md](../skills/logx/references/rules.md).

| ID      | Severity | Detects                                                                                                     |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| LOGX001 | info     | direct `print(...)` call                                                                                    |
| LOGX002 | warning  | stdlib logger `.error(...)` in an `except ... as e` block that logs `str(e)` or `f"{e}"` without `exc_info` |
| LOGX003 | warning  | exception handler whose body is only `pass`                                                                 |
