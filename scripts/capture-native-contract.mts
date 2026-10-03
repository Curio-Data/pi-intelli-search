// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Explicit maintenance command. Normal tests never regenerate expectations.
import {
  captureOperation,
  capturePrompts,
  captureToolContracts,
  SCENARIOS,
  writeFixture,
} from "../test/helpers/native-contract.js";

if (process.argv.slice(2).join(" ") !== "--write") {
  console.error("Usage: node --import tsx scripts/capture-native-contract.mts --write");
  console.error("Replaces frozen compatibility fixtures. Review every diff before accepting.");
  process.exitCode = 2;
} else {
  await writeFixture("tools", captureToolContracts());
  await writeFixture("prompts", capturePrompts());
  for (const scenario of SCENARIOS) await writeFixture(scenario, await captureOperation(scenario));
  console.log("Captured native contracts. Review test/fixtures/native-contract/*.json.");
}
