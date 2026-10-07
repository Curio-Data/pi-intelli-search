// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Type } from "typebox";

const extractionSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  extraction: Type.String(),
  sourceType: Type.String(),
  status: Type.String(),
});
const fullPageSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  content: Type.String(),
});

export const searchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these domains" })),
});

export const extractSchema = Type.Object({
  url: Type.String({ description: "URL of the page to extract from" }),
  title: Type.String({ description: "Page title" }),
  content: Type.String({ description: "Full page content in markdown" }),
  query: Type.String({ description: "The original search query" }),
  focusPrompt: Type.Optional(
    Type.String({ description: "Optional focus guidance for extraction" }),
  ),
});

export const collateSchema = Type.Object({
  extractions: Type.Array(extractionSchema, {
    description: "Array of per-page extraction results from intelli_extract",
  }),
  query: Type.String({ description: "The original search query" }),
  searchSummary: Type.Optional(
    Type.String({
      description: "Summary from the initial search step; accepted for compatibility, not used as synthesis evidence",
    }),
  ),
  fullPages: Type.Optional(
    Type.Array(fullPageSchema, {
      description: "Full page content for caching (not sent to LLM)",
    }),
  ),
});

export const researchSchema = Type.Object({
  query: Type.String({ description: "What to research" }),
  maxUrls: Type.Optional(
    Type.Number({ description: "Max URLs to fetch (default: 8, capped by settings.maxUrls)" }),
  ),
  domains: Type.Optional(
    Type.Array(Type.String(), { description: "Restrict search to these domains" }),
  ),
  focusPrompt: Type.Optional(Type.String({ description: "Focus guidance for all extractions" })),
});
