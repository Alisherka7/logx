import { resources } from "../shared/paths.js";
import { runProcess } from "./process.js";

export const MIN_PYTHON: readonly [number, number] = [3, 10];

export interface PythonCommand {
  executable: string;
  /** Arguments that must precede everything else (e.g. `-3` for the Windows `py` launcher). */
  prefixArgs: string[];
  version: string;
  /** Human-readable label for messages, e.g. `python3` or `py -3`. */
  label: string;
}

export interface PythonProbe {
  label: string;
  outcome: "ok" | "not_found" | "too_old" | "failed";
  detail: string;
}

export type PythonDiscovery =
  | { ok: true; python: PythonCommand; probes: PythonProbe[] }
  | { ok: false; probes: PythonProbe[]; explicit: string | null };

const VERSION_SCRIPT = "import sys; print('%d.%d.%d' % sys.version_info[:3])";

async function probe(
  executable: string,
  prefixArgs: string[],
): Promise<PythonProbe & { version?: string }> {
  const label = [executable, ...prefixArgs].join(" ");
  const result = await runProcess(executable, {
    args: [...prefixArgs, "-I", "-c", VERSION_SCRIPT],
    cwd: resources.analyzerDir,
    timeoutMs: 10_000,
    maxStdoutBytes: 4096,
    maxStderrBytes: 16_384,
  });
  if (result.kind === "spawn_error") {
    return { label, outcome: "not_found", detail: result.error.code ?? result.error.message };
  }
  if (result.kind !== "exited" || result.code !== 0) {
    return {
      label,
      outcome: "failed",
      detail: result.kind === "exited" ? result.stderr.trim() : result.kind,
    };
  }
  const version = result.stdout.trim();
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1])) {
    return { label, outcome: "too_old", detail: version };
  }
  return { label, outcome: "ok", detail: version, version };
}

function candidates(): [string, string[]][] {
  return process.platform === "win32"
    ? [
        ["python", []],
        ["py", ["-3"]],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];
}

/**
 * Find a usable Python. An explicitly configured interpreter (config `python`, then the
 * LOGX_PYTHON environment variable) is used exclusively; otherwise PATH candidates are tried.
 * Python is never downloaded or installed.
 */
export async function discoverPython(configured: string | null): Promise<PythonDiscovery> {
  const explicit = configured ?? (process.env.LOGX_PYTHON?.trim() || null);
  const list: [string, string[]][] = explicit ? [[explicit, []]] : candidates();
  const probes: PythonProbe[] = [];
  for (const [executable, prefixArgs] of list) {
    const result = await probe(executable, prefixArgs);
    probes.push({ label: result.label, outcome: result.outcome, detail: result.detail });
    if (result.outcome === "ok" && result.version) {
      return {
        ok: true,
        python: { executable, prefixArgs, version: result.version, label: result.label },
        probes,
      };
    }
  }
  return { ok: false, probes, explicit };
}

export function describePythonFailure(discovery: Extract<PythonDiscovery, { ok: false }>): {
  message: string;
  fix: string;
} {
  const tried = discovery.probes.map(
    (p) => `${p.label} (${p.outcome.replace("_", " ")}: ${p.detail || "-"})`,
  );
  const min = MIN_PYTHON.join(".");
  if (discovery.explicit) {
    return {
      message: `Configured Python "${discovery.explicit}" is not usable: ${tried.join("; ")}.`,
      fix: `Point "python" in .logx/config.json (or LOGX_PYTHON) at a Python >= ${min} executable, or remove the setting to auto-detect.`,
    };
  }
  return {
    message: `No Python >= ${min} found on PATH. Tried: ${tried.join("; ")}.`,
    fix: `Install Python ${min}+ (https://www.python.org/downloads/) and make sure it is on PATH, or set "python" in .logx/config.json. LogX never downloads Python.`,
  };
}
