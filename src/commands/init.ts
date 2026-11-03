import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { statKind } from "../analyzer/files.js";
import { CONFIG_FILE, defaultConfig } from "../config/defaults.js";
import { describeHints, detectStack, type StackHints } from "../config/detect.js";
import { loadConfig } from "../config/load.js";
import { LogxError } from "../shared/errors.js";
import { resources } from "../shared/paths.js";

const LOGGING_FILE = "LOGGING.md";

function stackSection(hints: StackHints): string {
  const found = describeHints(hints);
  const lines: string[] = [];
  if (found.length === 0) {
    lines.push(
      hints.filesRead.length > 0
        ? `- No FastAPI, uvicorn, structlog, or loguru dependency found in: ${hints.filesRead.join(", ")}.`
        : "- No Python dependency files found (pyproject.toml, requirements*.txt, setup.cfg, ...).",
    );
  } else {
    for (const line of found) lines.push(`- ${line}`);
  }
  const frameworks = (["structlog", "loguru"] as const).filter((p) => hints.packages[p]);
  if (frameworks.length > 0) {
    lines.push(
      `- The project appears to use ${frameworks.join(" and ")}. Keep using it; LogX's checks only`,
      "  recognize standard-library `logging` calls, so findings about logger calls may be incomplete.",
    );
  } else {
    lines.push("- Assumed logging framework: Python standard-library `logging`.");
  }
  return lines.join("\n");
}

type FileStatus = "created" | "exists";

function writeIfAbsent(path: string, content: string): FileStatus {
  if (existsSync(path)) return "exists";
  writeFileSync(path, content, { flag: "wx" });
  return "created";
}

export function initCommand(pathArg: string | undefined): number {
  const root = resolve(pathArg ?? ".");
  if (statKind(root) !== "directory") {
    throw new LogxError(
      `Not a directory: ${root}`,
      "Pass the repository root directory, or omit the path to use the current directory.",
    );
  }

  const hints = detectStack(root);
  mkdirSync(join(root, ".logx"), { recursive: true });
  const configStatus = writeIfAbsent(
    join(root, CONFIG_FILE),
    `${JSON.stringify(defaultConfig(), null, 2)}\n`,
  );
  const template = readFileSync(resources.loggingTemplate, "utf8");
  const loggingStatus = writeIfAbsent(
    join(root, LOGGING_FILE),
    template.replace("{{DETECTED_STACK}}", stackSection(hints)),
  );

  const out: string[] = [`Initializing LogX in ${root}`, ""];
  const describe = (file: string, status: FileStatus): string =>
    status === "created" ? `  created   ${file}` : `  exists    ${file} (left unchanged)`;
  out.push(describe(CONFIG_FILE, configStatus), describe(LOGGING_FILE, loggingStatus), "");

  if (configStatus === "exists") {
    try {
      loadConfig(root);
    } catch (error) {
      if (!(error instanceof LogxError)) throw error;
      out.push(
        `Warning: the existing ${CONFIG_FILE} is invalid and was not modified:`,
        error.message,
      );
      if (error.fix) out.push(`  fix: ${error.fix}`);
      out.push("");
    }
  }

  const found = describeHints(hints);
  out.push("Stack hints (from dependency files only; not proof):");
  if (found.length > 0) for (const line of found) out.push(`  - ${line}`);
  else out.push("  - no FastAPI/uvicorn/structlog/loguru dependency found");
  if (!hints.pythonFilesPresent)
    out.push("  - no .py files found; LogX currently analyzes Python only");
  out.push(
    "",
    "LOGGING.md contains proposed conventions only; no application code was changed.",
    "Next steps:",
    "  logx check                     scan Python files",
    "  logx install --agent claude    install the LogX skill (or --agent cursor)",
    "  logx doctor                    verify the setup",
  );
  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}
