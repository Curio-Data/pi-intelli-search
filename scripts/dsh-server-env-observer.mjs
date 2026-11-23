// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Bridge-row environment observer for scripts/verify-dsh-lifecycle.sh
// (docs/plans/dsh-host/README-UNIFICATION.md, Stage 1 Track B). The
// helper restates the bridge row's whole config through the profile user
// patch layer with this module as the command: it records which absolute
// XDG_CONFIG_HOME and HOME the launched MCP child actually sees, and
// whether the expected invented dummy key arrived through the row's
// environment expression (never the value), then rewrites argv and
// imports the real CLI. It makes no provider call; the dummy is an
// invented constant, not a credential.
//
// Combined with the CLI checks in scripts/verify-dsh-setup.sh (hostPaths
// honouring an absolute XDG_CONFIG_HOME), the marker proves the custom
// XDG path reaches the launched server.
//
// argv in: node <this-module> <marker-path> <real-cli> [cli args...]
// argv out: node <real-cli> [cli args...]

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXPECTED_DUMMY = "intelli-trackb-invented-dummy-key";

const [, , markerPath, realCli, ...rest] = process.argv;
if (!markerPath || !realCli) {
  throw new Error("dsh-server-env-observer requires <marker> <real-cli> [args...]");
}

writeFileSync(
  markerPath,
  `${JSON.stringify({
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    home: process.env.HOME ?? null,
    keyArrived: process.env.OPENROUTER_API_KEY === EXPECTED_DUMMY,
  })}\n`,
);

process.argv = [process.argv[0], realCli, ...rest];
await import(pathToFileURL(realCli).href);
