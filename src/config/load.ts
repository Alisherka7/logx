import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LogxError, errorMessage } from "../shared/errors.js";
import { CONFIG_FILE, defaultConfig, type LogxConfig } from "./defaults.js";
import { validateConfig } from "./schema.js";

export interface LoadedConfig {
  config: LogxConfig;
  source: "file" | "defaults";
  /** Absolute path of the config file, when one was loaded. */
  file: string | null;
}

/** Nearest directory at or above `start` containing `.logx/config.json`, or null. */
export function findProjectRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load and validate `<root>/.logx/config.json`; fall back to defaults when it is absent. */
export function loadConfig(root: string): LoadedConfig {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { config: defaultConfig(), source: "defaults", file: null };
  if (!statSync(file).isFile()) {
    throw new LogxError(`${CONFIG_FILE} is not a file.`, `Remove it and run \`logx init\`.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new LogxError(
      `Invalid configuration in ${file}: not valid JSON (${errorMessage(error)}).`,
      `Fix the JSON syntax, or delete the file and run \`logx init\` to recreate it.`,
    );
  }

  const result = validateConfig(parsed, defaultConfig());
  if (!result.ok) {
    const details = result.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
    throw new LogxError(
      `Invalid configuration in ${file}:\n${details}`,
      `Edit the listed settings (see "Configuration" in the LogX README), or delete the file and run \`logx init\`.`,
    );
  }
  return { config: result.config, source: "file", file };
}
