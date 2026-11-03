import { existsSync } from "node:fs";
import { join } from "node:path";
import { describePythonFailure, discoverPython, MIN_PYTHON } from "../analyzer/python.js";
import { runAnalyzer } from "../analyzer/run.js";
import { CONFIG_FILE } from "../config/defaults.js";
import { loadConfig } from "../config/load.js";
import { AGENT_IDS, AGENTS, inspectInstall } from "../install/skill.js";
import { LogxError, errorMessage } from "../shared/errors.js";
import { packageVersion, resources } from "../shared/paths.js";
import { resolveProjectRoot } from "./project.js";

type Status = "ok" | "warn" | "fail";
interface Check {
  status: Status;
  title: string;
  detail?: string;
  fix?: string;
}

const MIN_NODE: readonly [number, number, number] = [22, 12, 0];

function nodeCheck(): Check {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  const [rMajor, rMinor, rPatch] = MIN_NODE;
  const ok =
    major > rMajor ||
    (major === rMajor && (minor > rMinor || (minor === rMinor && patch >= rPatch)));
  return ok
    ? { status: "ok", title: `Node.js ${process.versions.node}` }
    : {
        status: "fail",
        title: `Node.js ${process.versions.node} is older than the required ${MIN_NODE.join(".")}`,
        fix: "Install a supported Node.js LTS release (22, 24 or 26).",
      };
}

function resourcesCheck(): Check {
  const missing = [
    join(resources.skillDir, "SKILL.md"),
    resources.loggingTemplate,
    resources.analyzerEntry,
  ].filter((file) => !existsSync(file));
  return missing.length === 0
    ? { status: "ok", title: "Bundled skill, templates and analyzer present" }
    : {
        status: "fail",
        title: "LogX installation is incomplete",
        detail: `missing: ${missing.join(", ")}`,
        fix: "Reinstall LogX (from the source checkout: npm run build, then reinstall the package).",
      };
}

export async function doctorCommand(pathArg: string | undefined): Promise<number> {
  const root = resolveProjectRoot(pathArg);
  const checks: Check[] = [nodeCheck(), resourcesCheck()];

  // Configuration (also tells us which Python to use).
  let configuredPython: string | null = null;
  try {
    const loaded = loadConfig(root);
    configuredPython = loaded.config.python;
    checks.push(
      loaded.source === "file"
        ? { status: "ok", title: `Configuration valid (${CONFIG_FILE})` }
        : {
            status: "warn",
            title: `No ${CONFIG_FILE}; logx check will use defaults`,
            fix: "Run `logx init` to create a configuration you can customize (optional).",
          },
    );
  } catch (error) {
    if (!(error instanceof LogxError)) throw error;
    const check: Check = {
      status: "fail",
      title: "Configuration is invalid",
      detail: error.message,
    };
    if (error.fix) check.fix = error.fix;
    checks.push(check);
  }

  // Python and analyzer.
  const discovery = await discoverPython(configuredPython);
  if (!discovery.ok) {
    const { message, fix } = describePythonFailure(discovery);
    checks.push({
      status: "fail",
      title: `Python >= ${MIN_PYTHON.join(".")} not available`,
      detail: message,
      fix,
    });
  } else {
    checks.push({
      status: "ok",
      title: `Python ${discovery.python.version} (${discovery.python.label})`,
    });
    const selfTest = await runAnalyzer(
      discovery.python,
      root,
      [],
      ["LOGX001", "LOGX002", "LOGX003"],
    );
    checks.push(
      selfTest.ok
        ? { status: "ok", title: "Analyzer self-test passed" }
        : {
            status: "fail",
            title: "Analyzer self-test failed",
            detail: selfTest.error.message,
            ...(selfTest.error.fix ? { fix: selfTest.error.fix } : {}),
          },
    );
  }

  checks.push(
    existsSync(join(root, "LOGGING.md"))
      ? { status: "ok", title: "LOGGING.md present" }
      : {
          status: "warn",
          title: "No LOGGING.md conventions file",
          fix: "Run `logx init` to create one (optional).",
        },
  );

  // Installed skills.
  for (const agent of AGENT_IDS) {
    const { label, skillDir } = AGENTS[agent];
    try {
      const { state, plan } = inspectInstall(root, agent);
      const conflictPaths = plan.actions.filter((a) => a.kind === "conflict").map((a) => a.path);
      const reinstall = `logx install --agent ${agent}`;
      const byState: Record<typeof state, Check> = {
        "not-installed": {
          status: "warn",
          title: `${label} skill not installed`,
          fix: `Run \`${reinstall}\` if you use ${label} (optional).`,
        },
        current: { status: "ok", title: `${label} skill installed and current (${skillDir})` },
        outdated: {
          status: "warn",
          title: `${label} skill is outdated or incomplete`,
          fix: `Run \`${reinstall}\` to update it.`,
        },
        modified: {
          status: "warn",
          title: `${label} skill was modified locally`,
          detail: conflictPaths.join(", ") || undefined,
          fix: `Keep your edits, or move them aside and run \`${reinstall}\` to restore the bundled version.`,
        },
        conflict: {
          status: "warn",
          title: `${label} skill location contains files not installed by LogX`,
          detail: conflictPaths.join(", "),
          fix: `Move or delete ${skillDir}/ and run \`${reinstall}\`.`,
        },
      };
      checks.push(byState[state]);
    } catch (error) {
      checks.push({
        status: "fail",
        title: `Cannot inspect ${label} skill`,
        detail: errorMessage(error),
        ...(error instanceof LogxError && error.fix ? { fix: error.fix } : {}),
      });
    }
  }

  const marks: Record<Status, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[fail]" };
  const out = [`LogX ${packageVersion} doctor: ${root}`, ""];
  for (const check of checks) {
    out.push(`${marks[check.status]} ${check.title}`);
    if (check.detail) out.push(...check.detail.split("\n").map((line) => `         ${line}`));
    if (check.fix) out.push(`         fix: ${check.fix}`);
  }
  const blockers = checks.filter((c) => c.status === "fail").length;
  const optional = checks.filter((c) => c.status === "warn").length;
  out.push(
    "",
    blockers > 0
      ? `${blockers} blocker(s) must be fixed before \`logx check\` can run reliably; ${optional} optional item(s).`
      : `No blockers. ${optional} optional item(s).`,
  );
  process.stdout.write(`${out.join("\n")}\n`);
  return blockers > 0 ? 1 : 0;
}
