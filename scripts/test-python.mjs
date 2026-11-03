// Run the analyzer's unittest suite with whichever Python is available.
// Honors LOGX_PYTHON; otherwise tries python3, python, then the Windows `py -3` launcher.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pythonDir = fileURLToPath(new URL("../python", import.meta.url));
const candidates = process.env.LOGX_PYTHON
  ? [[process.env.LOGX_PYTHON]]
  : process.platform === "win32"
    ? [["python"], ["py", "-3"], ["python3"]]
    : [["python3"], ["python"]];

for (const [exe, ...prefix] of candidates) {
  const probe = spawnSync(exe, [
    ...prefix,
    "-c",
    "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)",
  ]);
  if (probe.status !== 0) continue;
  const result = spawnSync(
    exe,
    [...prefix, "-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."],
    {
      cwd: pythonDir,
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}
console.error(
  "No Python >= 3.10 found (tried: " + candidates.map((c) => c.join(" ")).join(", ") + ").",
);
process.exit(1);
