// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ModelCompletion, OperationContext, ResearchParams } from "../../src/core/contracts.js";
import type { ResearchSettings, FetchedPage } from "../../src/core/types.js";
import { research, type ResearchDependencies } from "../../src/core/operations/research.js";
import { SEARCH_SYSTEM_PROMPT } from "../../src/core/prompts.js";
import type { FrozenInputs, Journal } from "./contracts.js";
import { assembleFrozenInputs } from "./common-inputs.js";
import { SourceSelection, type SourceDerivation, type SourcePolicy } from "./source-selection.js";

class CaptureFinished extends Error {}
/** Executes the released search/selection code, then ends at the one fetch boundary.
 * The caller supplies financially guarded search transport and persists all journal events.
 * This function neither issues main inference nor starts extraction/collation.
 */
export async function captureCommonInputs(options: {
  params: ResearchParams;
  context: OperationContext;
  fetchPages: ResearchDependencies["fetchPages"];
  journal: Journal;
  meta: FrozenInputs["meta"];
  /** rh-v6 only: replaces the single fetch of the discovery list with the frozen bounded selection. */
  sourcePolicy?: SourcePolicy;
}): Promise<FrozenInputs> {
  let searchCalls = 0;
  let lastCompletion: ModelCompletion | undefined;
  let pages: FetchedPage[] | undefined;
  let fetchCalls = 0;
  let sourceDerivation: SourceDerivation | undefined;
  const models = {
    preflight: options.context.models.preflight.bind(options.context.models),
    complete: async (request: Parameters<OperationContext["models"]["complete"]>[0]) => {
      if (request.systemPrompt !== SEARCH_SYSTEM_PROMPT) throw new Error("Capture attempted a downstream stage");
      searchCalls++;
      options.journal.record({ kind: "capture-search-request", stage: "search", data: {
        model: request.model, systemPrompt: request.systemPrompt, userMessage: request.userMessage,
        maxTokens: request.maxTokens, logicalIndex: searchCalls,
      } });
      lastCompletion = await options.context.models.complete(request);
      options.journal.record({ kind: "capture-search-completion", stage: "search", data: {
        logicalIndex: searchCalls, completion: structuredClone(lastCompletion),
      } });
      return lastCompletion;
    },
  };
  const finished = new CaptureFinished();
  try {
    const result = await research(options.params, { ...options.context, models }, {
      fetchPages: async (urls, signal, settings) => {
        if (++fetchCalls !== 1) throw new Error("Capture attempted a second page acquisition");
        if (!options.sourcePolicy) {
          pages = await options.fetchPages(urls, signal, settings);
          options.journal.record({ kind: "capture-pages", data: { urls, pages } });
          throw finished;
        }
        // The core's request is the unchanged discovery list. Each policy step is one
        // single-URL acquisition through the same package fetch path and options.
        const selection = new SourceSelection(options.sourcePolicy, options.params, urls);
        for (let step = selection.next(); step; step = selection.next()) {
          const [page] = await options.fetchPages([step.url], signal, settings);
          options.journal.record({ kind: "capture-selection-fetch", data: { ...step, page: page ?? null } });
          selection.accept(page);
        }
        sourceDerivation = selection.result();
        pages = selection.selectedPages();
        options.journal.record({ kind: "capture-pages", data: { urls, derivedInventory: true, pages, stopReason: sourceDerivation.stopReason } });
        throw finished;
      },
      downloadLlmsFullToCache: async () => { throw new Error("Capture attempted documentation discovery"); },
    });
    throw new Error(`Common capture did not reach pages: ${result.outcome}`);
  } catch (error) {
    if (error !== finished) throw error;
  }
  if (!pages || !lastCompletion) throw new Error("Incomplete common capture");
  return assembleFrozenInputs({
    params: options.params, settings: options.context.settings as ResearchSettings,
    searchCompletion: lastCompletion, searchAttempts: searchCalls, pages, meta: options.meta,
    ...(sourceDerivation ? { sourceDerivation } : {}),
  });
}
