// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Compile-only. Runtime P1 exports must satisfy the frozen seam and specification types.
import type {
  AdmissionErrorConstructor, AttemptLedgerFactory, ExecutionCoordinatorFactory,
} from "../../src/core/contracts.js";
import type * as Specification from "../../docs/plans/codemode/API.js";
import { AdmissionError, createExecutionCoordinator } from "../../src/core/execution-coordinator.js";
import { createAttemptLedger } from "../../src/core/usage.js";

const coordinatorFactory: ExecutionCoordinatorFactory = createExecutionCoordinator;
const ledgerFactory: AttemptLedgerFactory = createAttemptLedger;
const errorConstructor: AdmissionErrorConstructor = AdmissionError;
const specCoordinator: typeof Specification.createExecutionCoordinator = createExecutionCoordinator;
const specLedger: typeof Specification.createAttemptLedger = createAttemptLedger;
const specError: Specification.AdmissionError = new AdmissionError("BUSY");
const implementationError: AdmissionError = specError as AdmissionError;
void [coordinatorFactory, ledgerFactory, errorConstructor, specCoordinator, specLedger, implementationError];
// @ts-expect-error Admission codes are closed.
new AdmissionError("RETRY");
