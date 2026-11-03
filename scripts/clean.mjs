// Remove the build output so stale files never end up in the package.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

rmSync(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true, force: true });
