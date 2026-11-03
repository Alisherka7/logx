// Packaging smoke test: pack the built package, install the tarball into a fresh temp
// environment, and run the installed CLI against fixtures from an unrelated working directory.
// Usage: npm run smoke   (builds first)
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const work = realpathSync(mkdtempSync(join(tmpdir(), "logx smoke ")));
let failures = 0;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...options });
  if (result.error) throw result.error;
  return result;
}

// npm is a .cmd shim on Windows, which cannot be spawned without a shell (and shells split paths
// containing spaces), so run npm-cli.js with the current Node binary whenever it can be found.
const npmCli = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidate) => candidate && candidate.endsWith(".js") && existsSync(candidate));

function npm(args, cwd) {
  const result = npmCli
    ? run(process.execPath, [npmCli, ...args], { cwd })
    : run("npm", args, { cwd });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error(`npm ${args.join(" ")} failed`);
  }
  return result;
}

function expect(label, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(detail);
  }
}

try {
  if (!existsSync(join(repo, "dist", "cli.js")))
    throw new Error("dist/ missing; run npm run build first");

  // 1. Pack.
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  npm(["pack", "--pack-destination", packDir, "--silent"], repo);
  const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  expect("npm pack produced a tarball", Boolean(tarball));

  // 2. Install into a fresh prefix (no access to the source tree).
  const env = join(work, "install env");
  mkdirSync(env);
  writeFileSync(join(env, "package.json"), JSON.stringify({ name: "smoke-env", private: true }));
  npm(["install", "--no-audit", "--no-fund", "--silent", join(packDir, tarball)], env);
  const pkgDir = join(env, "node_modules", "logx-cli");
  const binShim = join(env, "node_modules", ".bin", isWindows ? "logx.cmd" : "logx");

  // 4. Bundled resources.
  for (const rel of [
    "skills/logx/SKILL.md",
    "skills/logx/references/rules.md",
    "templates/LOGGING.md",
    "python/logx_analyzer/__main__.py",
    "python/logx_analyzer/rules.py",
  ]) {
    expect(`package contains ${rel}`, existsSync(join(pkgDir, ...rel.split("/"))));
  }
  expect("package excludes python tests", !existsSync(join(pkgDir, "python", "tests")));
  expect("package excludes TypeScript sources", !existsSync(join(pkgDir, "src")));
  expect("bin shim installed", existsSync(binShim));

  // 3. Run from an unrelated cwd against a copied fixture.
  const elsewhere = join(work, "some other cwd");
  mkdirSync(elsewhere);
  const project = join(work, "fixture project");
  cpSync(join(repo, "tests", "fixtures", "fastapi-bad"), project, { recursive: true });
  const logx = (args, cwd = elsewhere) =>
    isWindows
      ? run(process.execPath, [join(pkgDir, "dist", "cli.js"), ...args], { cwd })
      : run(binShim, args, { cwd });

  const version = logx(["--version"]);
  expect(
    "logx --version",
    version.status === 0 && /^\d+\.\d+\.\d+/.test(version.stdout.trim()),
    version.stderr,
  );

  const check = logx(["check", project, "--json"]);
  let report = null;
  try {
    report = JSON.parse(check.stdout);
  } catch {
    // reported below
  }
  expect(
    "logx check --json exits 1 with valid JSON",
    check.status === 1 && report !== null,
    check.stdout + check.stderr,
  );
  const rules = new Set(report?.findings.map((f) => f.ruleId) ?? []);
  expect(
    "findings include LOGX001, LOGX002, LOGX003",
    ["LOGX001", "LOGX002", "LOGX003"].every((r) => rules.has(r)),
  );

  const init = logx(["init", project]);
  expect("logx init", init.status === 0, init.stderr);
  const install = logx(["install", "--agent", "claude"], project);
  expect(
    "logx install --agent claude",
    install.status === 0 && existsSync(join(project, ".claude", "skills", "logx", "SKILL.md")),
    install.stdout + install.stderr,
  );
  const doctor = logx(["doctor", project]);
  expect(
    "logx doctor reports no blockers",
    doctor.status === 0 && doctor.stdout.includes("Analyzer self-test passed"),
    doctor.stdout + doctor.stderr,
  );
  expect(
    "analyzer left no __pycache__ in the package",
    !existsSync(join(pkgDir, "python", "logx_analyzer", "__pycache__")),
  );
} catch (error) {
  failures++;
  console.error(error);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nSmoke test failed (${failures} problem(s)).`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
