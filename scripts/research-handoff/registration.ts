// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Benchmark-only registration for the fixed-source research-handoff study
// (Track A). Registers ONE tool named intelli_research whose model-visible
// contract (name, description, schema, guidance, annotations, constrained
// sampling, renderers, progress) is the native tool's, executed with per-run
// immutable frozen inputs. No production source is edited and no shared test
// hook (`__harness`) is mutated during execution; only the deterministic
// native-parity test touches the original hooks, in isolation, and restores
// them (PROTOCOL.md, Benchmark registration).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { intelliResearchTool } from "../../src/tools/intelli-research.js";
import { research, MissingModelsError } from "../../src/core/operations/research.js";
import type { ModelClient, ModelBinding } from "../../src/core/contracts.js";
import {
  createNativeOperationContext,
  nativeResult,
  nativeProgress,
} from "../../src/native-operation-context.js";
import { describeModelCatalog } from "../../src/native-model-client.js";
import type { callLlm } from "../../src/llm.js";
import type { OnUpdate } from "../../src/host-types.js";
import {
  loadFrozenInputs,
  assertSettingsMatchFrozen,
  assertParamsMatchFrozen,
  createFrozenModelClient,
  createFrozenFetchPages,
  createForbidLlmsFull,
  createInputControlLatch,
  sha256Hex,
  FrozenIntegrityError,
} from "./common-inputs.js";
import type { Journal } from "./contracts.js";

export interface BenchmarkRegistrationOptions {
  /** Absolute path to the frozen-inputs JSON, outside run workspaces. */
  frozenPath: string;
  /** Coordinator-bound corpus digest; the reloaded corpus must match it (F11). */
  expectedDigest: string;
  /** Recorder-supplied per-run sink; every adapter event lands here. */
  journal: Journal;
  /**
   * Optional callLlm delegate for the downstream (extract/collate) model
   * calls. Default: the real native callLlm. Deterministic tests inject a
   * synthetic delegate here; the delegate parameter mirrors the native
   * context seam rather than mutating any global.
   */
  callLlmDelegate?: typeof callLlm;
}

/**
 * Build the benchmark research tool. Static contract fields come from the
 * native tool by reference (spread), so the declaration the model sees is
 * provably identical to the product's. No `outputSchema` is declared, so a
 * Codemode script's `tools.intelli_research(...)` resolves to the tool's text
 * output: the unchanged-text return contract.
 */
export function createBenchmarkResearchTool(options: BenchmarkRegistrationOptions): typeof intelliResearchTool {
  // One chargeable research invocation per session. Measured runs use one
  // process per conversation, so process-local equals conversation-local.
  // The check-and-set is synchronous, before any await.
  let admitted = false;

  return {
    ...intelliResearchTool,
    async execute(
      _toolCallId: string,
      params: Parameters<typeof intelliResearchTool.execute>[1],
      signal: Parameters<typeof intelliResearchTool.execute>[2],
      onUpdate: OnUpdate | undefined,
      ctx: Parameters<typeof intelliResearchTool.execute>[4],
    ): ReturnType<typeof intelliResearchTool.execute> {
      if (admitted) {
        options.journal.record({
          kind: "admission-rejected",
          data: { reason: "one chargeable research invocation per conversation" },
        });
        throw new Error(
          "intelli_research was already invoked once in this conversation; additional invocations are rejected by the fixed-source protocol.",
        );
      }
      admitted = true;
      options.journal.record({ kind: "research-admitted", data: {} });
      // Set when the post-research input-control raise below has already
      // journaled its own event, so the catch does not double-journal.
      let inputControlRaised = false;

      try {
        const frozen = await loadFrozenInputs({ path: options.frozenPath });

        // Digest binding (F11): the corpus actually loaded must match the
        // digest the coordinator bound to this batch. A replaced, re-digested
        // file is rejected here, before admission-dependent work, and the
        // served digest is journaled as evidence.
        if (frozen.digest !== options.expectedDigest) {
          options.journal.record({
            kind: "corpus-digest-mismatch",
            data: {
              expectedDigest: options.expectedDigest,
              servedDigest: frozen.digest,
            },
          });
          throw new FrozenIntegrityError("digest", [
            `loaded corpus digest ${frozen.digest} does not match the coordinator-bound expectedDigest ${options.expectedDigest}`,
          ]);
        }
        options.journal.record({
          kind: "corpus-bound",
          data: { expectedDigest: options.expectedDigest, servedDigest: frozen.digest },
        });

        // Shared per-execution input-control latch: after the first input
        // deviation, no later model request reaches the live delegate (F2).
        const latch = createInputControlLatch();

        // The real native context: real settings discovery from the isolated
        // agent dir, real workspace paths, real identity, live downstream
        // dispatch through the delegate (default: real callLlm).
        const context = await createNativeOperationContext(ctx, signal, options.callLlmDelegate);

        assertSettingsMatchFrozen({ frozen, settings: context.settings });
        assertParamsMatchFrozen({ frozen, params });

        const models = createFrozenModelClient({ delegate: context.models, frozen, journal: options.journal, latch });
        const ui = ctx.ui as {
          setWorkingIndicator?(opts?: { frames?: string[]; intervalMs?: number }): void;
        } | undefined;
        let started = false;
        const wrappedModels: ModelClient = {
          ...models,
          async preflight(bindings: readonly ModelBinding[]) {
            const missing = await models.preflight(bindings);
            if (!missing.length) {
              ui?.setWorkingIndicator?.({ frames: ["🔍", "🌐", "📄", "✨"], intervalMs: 400 });
              started = true;
            }
            return missing;
          },
        };

        try {
          const result = await research(
            params,
            {
              ...context,
              models: wrappedModels,
              onProgress: (details) => onUpdate?.(nativeProgress(details)),
            },
            {
              fetchPages: createFrozenFetchPages({ frozen, journal: options.journal, latch }),
              downloadLlmsFullToCache: createForbidLlmsFull({ journal: options.journal, latch }),
            },
          );
          // Actual-result evidence for the recorder: outcome, result-text
          // hash and the pipeline details, alongside the hash evidence
          // journaled at each model boundary by the adapters.
          options.journal.record({
            kind: "research-result",
            data: {
              outcome: result.outcome,
              textSha256: sha256Hex(result.text),
              details: result.details,
            },
          });
          // Latched failure surfaces even when the baseline core swallowed
          // the deviation as a per-page error, a failed suggestion judge or a
          // documentation download (F2): the run must not return success.
          if (latch.failed) {
            options.journal.record({
              kind: "input-control-failed",
              data: { deviations: [...latch.deviations], outcome: result.outcome },
            });
            inputControlRaised = true;
            throw new FrozenIntegrityError("structure", [
              `input control failed during execution (deviations: ${latch.deviations.map((d) => JSON.stringify(d)).join(", ")}); the core returned ${JSON.stringify(result.outcome)}, but the run is nonconforming`,
            ]);
          }
          return nativeResult(result);
        } finally {
          if (started) ui?.setWorkingIndicator?.();
        }
      } catch (err) {
        if (err instanceof FrozenIntegrityError) {
          // Digest-binding and post-research input-control failures journal
          // their own specific events at the raise site; do not add a
          // second, vaguer event for them.
          if (err.kind === "digest") {
            throw new Error(`Fixed-source input control failed (digest binding): ${err.message}`);
          }
          if (inputControlRaised) {
            throw err;
          }
          // Specific, non-spend deviations keep their own kinds
          // (settings-mismatch / params-mismatch / frozen-inputs-invalid);
          // settleInputIntegrity() counts them as deviations.
          const kind =
            err.kind === "settings"
              ? "settings-mismatch"
              : err.kind === "params"
                ? "params-mismatch"
                : "frozen-inputs-invalid";
          options.journal.record({ kind, data: { problems: err.problems } });
          throw new Error(`Fixed-source input control failed (${err.kind}): ${err.message}`);
        }
        if (err instanceof MissingModelsError) {
          // Same actionable mapping as the native wrapper, including the
          // catalogue near-miss hints.
          const lines = err.bindings.map((m) => {
            const hint = describeModelCatalog(ctx, m.config.provider, m.config.model);
            return `  ${m.role}: ${m.config.provider}/${m.config.model}${hint ? `\n${hint}` : ""}`;
          });
          throw new Error(
            `Configured model(s) not found in Pi's model registry:\n${lines.join("\n")}\n` +
              `Check your settings.json for typos or missing provider configuration. ` +
              `Run /login to add API keys, or /model to see available models.`,
          );
        }
        options.journal.record({
          kind: "research-error",
          data: { message: String((err as Error)?.message ?? err).slice(0, 300) },
        });
        throw err;
      }
    },
  };
}

/**
 * Extension factory for the pinned host. Supply as an unnamed inline
 * extension factory to `DefaultResourceLoader` (SDK sessions) or load the
 * equivalent file via `-e`; it registers exactly one tool, `intelli_research`.
 */
export function createBenchmarkResearchExtension(
  options: BenchmarkRegistrationOptions,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool(createBenchmarkResearchTool(options));
  };
}

// Re-exported so integrators can assert contract identity against the native
// tool without importing the source module separately.
export { intelliResearchTool };
