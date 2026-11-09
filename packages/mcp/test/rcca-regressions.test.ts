// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Regression tests from the 2026-11-06 research-failure RCCA (test/rcca/RCCA.md). They drive
// the standalone runtime with a scripted transport, so they run with the standalone suite.
import "../../../test/rcca/rcca-collate/probe.test.js";
import "../../../test/rcca/rcca-extract/probe.test.js";
import "../../../test/rcca/rcca-fetch/urls.probe.test.js";
import "../../../test/rcca/rcca-fetch/gate.probe.test.js";
import "../../../test/rcca/rcca-fetch/falsepos.probe.test.js";
