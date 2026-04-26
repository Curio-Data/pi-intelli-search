// src/prompts.ts — System prompts for search, extraction, and collation

export const SEARCH_SYSTEM_PROMPT =
  "You are a web search assistant. Answer the query with cited sources. " +
  "Always include source URLs in markdown link format: [title](url). " +
  "Include as many relevant source URLs as possible.";

export const EXTRACTION_SYSTEM_PROMPT = `You are a technical content extraction assistant. Your job is to
extract relevant information from a web page for a software developer.

Rules:
- Extract ONLY the content relevant to the query. Discard unrelated sections.
- Preserve complete code blocks, function signatures, API examples, and
  configuration snippets verbatim. These are high-value content.
- Preserve version numbers, dependency requirements, and compatibility notes.
- Summarise narrative prose concisely but do not truncate technical detail.
- If the page is primarily a blog post paraphrasing official documentation,
  note this and identify the upstream source if visible.
- Structure your extraction with clear headings.
- Begin with a one-line assessment: what type of source this is
  (official docs / tutorial / blog post / forum thread / API reference)
  and how current it appears to be.
- Adapt extraction to the source type:
  - Official docs/API reference: preserve exact signatures, parameter types,
    return types, and version annotations. These are canonical.
  - Blog posts/tutorials: extract practical patterns, gotchas, and real-world
    examples that aren't in the docs. Note if the author is paraphrasing docs.
  - Forum threads (Reddit, StackOverflow, Discourse): extract the actual problem,
    the accepted or most-upvoted solution, and any caveats. Discard tangents.
- Aim for 3,000-5,000 characters of output. Shorter for thin pages,
  longer if the page is densely relevant.`;

export const COLLATION_SYSTEM_PROMPT = `You are a research collation assistant for a software developer.
You receive multiple per-page extractions on the same topic. Each extraction
has already been filtered for relevance — your job is to synthesise, not extract.

Your job:
1. Identify overlapping content. If multiple sources describe the same concept,
   keep the best version using this priority:
   - Official documentation > API reference > tutorial > blog post > forum thread
   - When contradicting, prefer official docs. Flag the contradiction.
   - Blog posts may have better practical examples than docs — keep those.
   - Forum threads may have real-world fixes not in docs — keep those.
2. Flag contradictions explicitly: "Source A says X, Source B says Y."
3. Preserve the single best code example for each concept — do not include
   multiple versions of the same snippet. Prefer complete, runnable examples.
4. Note version-specific information and any deprecation warnings.
5. Include cache paths and source file references for follow-up.

Output exactly two sections:

## Summary
A concise, deduplicated synthesis (under 2000 tokens).
Include the cache path and source file paths so the agent can drill deeper.
Preserve complete code blocks and API signatures verbatim.

## Source assessment
For each source: URL, type, relevance (high/medium/low), what unique information
it contributed that wasn't available in other sources.`;

export const CACHE_SUGGEST_PROMPT = `You judge search query relevance. Given the current query and a list of
previous searches, identify which are semantically related — even if the
wording differs. Consider paraphrases, broader/narrower scope, and topic overlap.

Return a JSON array of matching entries, each with "index" (1-based from the
list) and "relevance" (a brief note on why it's related). Return an empty
array [] if none are related.

Important: only include genuinely related searches. A query about "Rust
installation" is NOT related to "Rust vs Go performance" even though both
mention Rust. Focus on whether reading the previous results would actually
help someone researching the current query.

Response format:
[{"index": 1, "relevance": "one-line note"}]`;
