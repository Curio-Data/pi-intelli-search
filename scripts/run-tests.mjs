// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Tests never discover operator settings or write scratch outside this checkout.
const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (!["native", "mcp", "smoke"].includes(mode)) throw new Error("Expected native, mcp or smoke");
const cwd = mode === "mcp" ? join(root, "packages/mcp") : root;
await mkdir(join(root, ".tmp"), { recursive: true });
const scratch = await mkdtemp(join(root, ".tmp/tests-"));
const home = join(scratch, "home");
const agent = join(scratch, "agent");
await mkdir(home);
await mkdir(agent);
const env = { ...process.env, HOME: home, TMPDIR: scratch, PI_CODING_AGENT_DIR: agent };
for (const key of Object.keys(env)) {
  if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete env[key];
}
try {
  const files =
    mode === "smoke"
      ? ["test/smoke.ts"]
      : (await readdir(join(cwd, "test")))
          .filter((name) => name.endsWith(".test.ts"))
          .sort()
          .map((name) => `test/${name}`);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", ...(mode === "smoke" ? [] : ["--test"]), ...files],
    { cwd, env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
