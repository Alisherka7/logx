#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { checkCommand } from "./commands/check.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { AGENT_IDS, type AgentId } from "./install/skill.js";
import { LogxError } from "./shared/errors.js";
import { packageVersion } from "./shared/paths.js";

/** Exit code for operational failures and usage errors. */
const EXIT_FAILURE = 2;

function buildProgram(setExit: (code: number) => void): Command {
  const program = new Command();
  program
    .name("logx")
    .description(
      "Inspect and improve backend logging. Deterministic checks for Python (standard-library logging),\n" +
        "project logging conventions, and skills for coding agents. Runs locally; never imports your code.",
    )
    .version(packageVersion, "-V, --version", "print the LogX version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError("(run `logx --help` for usage)")
    .exitOverride()
    .addHelpText(
      "after",
      `
Examples:
  logx init                         create .logx/config.json and LOGGING.md here
  logx check                        scan Python files in the current project
  logx check app/api/users.py       scan one module
  logx check . --json               machine-readable report (single JSON object)
  logx install --agent claude       install the skill into .claude/skills/logx/
  logx install --agent cursor --dry-run
  logx doctor                       diagnose Python, configuration and skill setup

Exit codes for \`check\`: 0 no findings, 1 findings, 2 operational failure or incomplete scan.`,
    );

  program
    .command("init")
    .description("initialize LogX in a repository (never overwrites existing files)")
    .argument("[path]", "repository root", ".")
    .action((path: string) => setExit(initCommand(path)));

  program
    .command("install")
    .description("install the LogX skill for a coding agent at project scope")
    .addOption(
      new Option("--agent <agent>", "target agent").choices(AGENT_IDS).makeOptionMandatory(),
    )
    .option("--dry-run", "show what would change without writing files")
    .argument(
      "[path]",
      "project root (default: nearest directory with .logx/, else the current directory)",
    )
    .action((path: string | undefined, options: { agent: AgentId; dryRun?: boolean }) =>
      setExit(installCommand(path, options)),
    );

  program
    .command("check")
    .description("scan Python files for logging issues without importing or executing them")
    .argument("[path]", "project directory or Python file", ".")
    .option("--json", "write one JSON report object to stdout")
    .action(async (path: string, options: { json?: boolean }) =>
      setExit(await checkCommand(path, options)),
    );

  program
    .command("doctor")
    .description("check Node/Python, analyzer, configuration and installed skills")
    .argument(
      "[path]",
      "project root (default: nearest directory with .logx/, else the current directory)",
    )
    .action(async (path: string | undefined) => setExit(await doctorCommand(path)));

  return program;
}

async function main(argv: string[]): Promise<number> {
  let exitCode = 0;
  const program = buildProgram((code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version are reported as "errors" by exitOverride; they are successes.
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.help"
      ) {
        return 0;
      }
      return EXIT_FAILURE; // Commander already printed the usage error.
    }
    if (error instanceof LogxError) {
      process.stderr.write(`logx: error: ${error.message}\n`);
      if (error.fix) process.stderr.write(`fix: ${error.fix}\n`);
      return EXIT_FAILURE;
    }
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`logx: unexpected error: ${detail}\n`);
    return EXIT_FAILURE;
  }
}

main(process.argv).then((code) => {
  process.exitCode = code;
});
