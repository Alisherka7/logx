import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LogxError, errorMessage } from "../shared/errors.js";

export const MANIFEST_FILE = ".logx/installed.json";
const MANIFEST_SCHEMA_VERSION = 1;

export interface AgentInstallRecord {
  /** LogX version that last wrote these files. */
  version: string;
  /** Project-relative POSIX path -> "sha256:<hex>" of the content LogX installed. */
  files: Record<string, string>;
}

export interface Manifest {
  schemaVersion: number;
  installs: Record<string, AgentInstallRecord>;
}

const emptyManifest = (): Manifest => ({ schemaVersion: MANIFEST_SCHEMA_VERSION, installs: {} });

function isValid(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<Manifest>;
  if (
    m.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    typeof m.installs !== "object" ||
    m.installs === null
  ) {
    return false;
  }
  return Object.values(m.installs).every(
    (record) =>
      typeof record === "object" &&
      record !== null &&
      typeof record.version === "string" &&
      typeof record.files === "object" &&
      record.files !== null &&
      Object.values(record.files).every((hash) => typeof hash === "string"),
  );
}

export function readManifest(projectRoot: string): Manifest {
  const file = join(projectRoot, MANIFEST_FILE);
  if (!existsSync(file)) return emptyManifest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new LogxError(
      `Cannot read ${MANIFEST_FILE}: ${errorMessage(error)}`,
      `Restore the file from version control. If it is lost, delete it; LogX will then treat existing skill files as unowned and report them as conflicts.`,
    );
  }
  if (!isValid(parsed)) {
    throw new LogxError(
      `${MANIFEST_FILE} has an unexpected format.`,
      `Restore it from version control, or delete it and resolve the reported conflicts manually.`,
    );
  }
  return parsed;
}

export function writeManifest(projectRoot: string, manifest: Manifest): void {
  const file = join(projectRoot, MANIFEST_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const sorted: Manifest = { schemaVersion: manifest.schemaVersion, installs: {} };
  for (const agent of Object.keys(manifest.installs).sort()) {
    const record = manifest.installs[agent]!;
    sorted.installs[agent] = {
      version: record.version,
      files: Object.fromEntries(Object.entries(record.files).sort(([a], [b]) => (a < b ? -1 : 1))),
    };
  }
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
