// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// src/annotations.ts — Harvest url_citation annotations from provider responses
//
// Search-grounded models (the Perplexity Sonar family, and any model using
// OpenRouter's openrouter:web_search server tool) return a machine-readable
// citation list on the assistant message:
//
//   annotations: [{ type: "url_citation", url_citation: { url, title, ... } }]
//
// These are the sources the model actually consulted — typically many more
// than the links it writes into the prose (observed: 20 annotations vs 3
// markdown links from perplexity/sonar).
//
// pi-ai's chat-completions adapter reassembles only text, thinking, and
// tool-call blocks from the stream; annotations are dropped before the
// AssistantMessage reaches extension code. Rather than fork the adapter, we
// pass a wrapped fetch (ProviderRequestOptions.fetch, threaded into the SDK
// client) that tees the HTTP body: the SDK consumes the original stream, and
// a clone is read in the background to parse citations out of the raw
// SSE/JSON. Failures are swallowed everywhere — the main pipeline must never
// depend on this side channel.

import type { FetchFunction } from "@earendil-works/pi-ai";

/** One harvested citation: a URL plus whatever title the provider supplied. */
export interface HarvestedCitation {
  url: string;
  title?: string;
}

/** Out-param filled by the fetch wrapper while the SDK reads the real body. */
export interface AnnotationSink {
  citations: HarvestedCitation[];
}

export function createAnnotationSink(): AnnotationSink {
  return { citations: [] };
}

/** Append a citation unless an identical URL is already present. */
function pushCitation(sink: AnnotationSink, citation: HarvestedCitation): void {
  if (!/^https?:\/\//.test(citation.url)) return; // tolerate provider quirks
  if (sink.citations.some((c) => c.url === citation.url)) return;
  sink.citations.push(citation);
}

interface UrlCitationAnnotation {
  type?: string;
  url_citation?: { url?: unknown; title?: unknown };
}

/**
 * Extract citations from one parsed SSE chunk or non-streaming response.
 * Handles both shapes:
 * - streaming: choices[].delta.annotations[]
 * - non-streaming: choices[].message.annotations[]
 */
function citationsFromChunk(parsed: unknown): HarvestedCitation[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return [];
  const out: HarvestedCitation[] = [];
  for (const choice of choices) {
    if (typeof choice !== "object" || choice === null) continue;
    const holder = choice as { delta?: { annotations?: unknown }; message?: { annotations?: unknown } };
    const annotationLists = [holder.delta?.annotations, holder.message?.annotations];
    for (const list of annotationLists) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const ann = entry as UrlCitationAnnotation;
        if (ann?.type !== "url_citation" && !ann?.url_citation) continue;
        const url = ann.url_citation?.url;
        if (typeof url !== "string" || url.length === 0) continue;
        if (!/^https?:\/\//.test(url)) continue; // ftp:, data:, provider quirks
        const title = ann.url_citation?.title;
        out.push(typeof title === "string" && title.length > 0 ? { url, title } : { url });
      }
    }
  }
  return out;
}

/**
 * Parse citations from a raw HTTP response body. Accepts both SSE
 * (`data: {json}` lines, `data: [DONE]` terminator, `:`-prefixed comments)
 * and plain JSON (non-streaming responses). Junk lines are ignored; a body
 * that is not valid SSE or JSON yields zero citations rather than an error.
 */
export function parseCitations(bodyText: string): HarvestedCitation[] {
  const out: HarvestedCitation[] = [];
  const seen = new Set<string>();
  const add = (list: HarvestedCitation[]) => {
    for (const c of list) {
      if (!seen.has(c.url)) {
        seen.add(c.url);
        out.push(c);
      }
    }
  };

  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{")) {
    // Plain JSON body (non-streaming call path).
    try {
      add(citationsFromChunk(JSON.parse(trimmed)));
    } catch {
      /* not JSON: nothing to harvest */
    }
    return out;
  }

  // SSE body: parse each `data:` line independently. A single malformed
  // line (keep-alive comment, truncated write) must not discard the rest.
  for (const line of bodyText.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("data:")) continue;
    const payload = trimmedLine.slice(5).trim();
    if (payload.length === 0 || payload === "[DONE]") continue;
    try {
      add(citationsFromChunk(JSON.parse(payload)));
    } catch {
      /* skip malformed chunk */
    }
  }
  return out;
}

/**
 * Wrap a fetch function so every successful response body is teed: the SDK
 * consumes the original Response unchanged, while a clone is read in the
 * background and any url_citation annotations land in `sink`. The wrapper
 * never mutates the response, never throws from the background read, and
 * propagates baseFetch errors untouched so retry semantics are preserved.
 */
export function wrapFetchForAnnotations(baseFetch: FetchFunction, sink: AnnotationSink): FetchFunction {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    try {
      if (response.ok && response.body) {
        // clone() tees the stream: both readers receive all chunks. Must be
        // called before the SDK touches response.body — it is, synchronously
        // here, before the response is returned.
        const tee = response.clone();
        void tee
          .text()
          .then((bodyText) => {
            for (const citation of parseCitations(bodyText)) pushCitation(sink, citation);
          })
          .catch(() => {
            /* aborted or failed stream: the main path owns the error */
          });
      }
    } catch {
      /* clone() failed (never consumed body, but be safe): side channel only */
    }
    return response;
  };
}

/**
 * Merge text-scraped URLs with harvested annotation citations for the fetch
 * stage. Text links come first (their markdown titles are what the search
 * model chose to name them), then annotation-only URLs. Duplicates by exact
 * URL string are dropped. The returned title falls back to the URL itself so
 * downstream FetchedPage entries always carry a displayable title.
 */
export function mergeCitations(
  textUrls: Array<{ url: string; title: string }>,
  sink: AnnotationSink,
): Array<{ url: string; title: string }> {
  const merged: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  for (const { url, title } of textUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    merged.push({ url, title });
  }
  for (const { url, title } of sink.citations) {
    if (seen.has(url)) continue;
    seen.add(url);
    merged.push({ url, title: title && title.length > 0 ? title : url });
  }
  return merged;
}
