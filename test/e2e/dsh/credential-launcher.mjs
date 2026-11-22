// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Scenario-18-only credential-delivery wrapper. The scenario restates the
// bridge row's whole config through the profile user patch layer with this
// module as the command: it records only whether the expected invented dummy
// arrived through the row's environment expression (never the value), then
// rewrites argv and imports the real vendored CLI. It makes no provider
// call; the dummy is an invented constant, not a credential.
//
// argv in: node <this-module> <marker-path> <real-cli> [cli args...]
// argv out: node <real-cli> [cli args...]

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXPECTED_DUMMY = "intelli-e2e-invented-dummy-key";

const [, , markerPath, realCli, ...rest] = process.argv;
if (!markerPath || !realCli) {
  throw new Error("credential-launcher requires <marker> <real-cli> [args...]");
}

writeFileSync(
  markerPath,
  `${JSON.stringify({ arrived: process.env.OPENROUTER_API_KEY === EXPECTED_DUMMY })}\n`,
);

process.argv = [process.argv[0], realCli, ...rest];
await import(pathToFileURL(realCli).href);
