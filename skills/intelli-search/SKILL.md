---
name: intelli-search
description: "Research the web for current information. Use for docs, APIs, best practices, library updates, or questions requiring up-to-date web sources. Provides search, per-page extraction, collation, and a persistent .search/ cache for follow-up."
---

# Intelli Search

## When to Use Which Tool

### Quick Factual Question: Use `intelli_search`

For a fast answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task: Use `intelli_research`

Always provide a `focusPrompt`. The extraction large language model (LLM) needs specific guidance; without it, extraction produces generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

### Other Parameters

- `maxUrls`: `3` for quick targeted research, `10` (default) for broad research, `16` for exhaustive research. The setting caps this at `maxUrls` (default 20). Requests above the cap are silently clamped.
- `domains`: Guide search toward given sources, for example `domains=["react.dev", "github.com"]`. This adds a `site:` filter and, with the web search tool enabled, an engine domain filter. It is guidance, not a hard boundary: returned URLs (uniform resource locators) are not checked against a local allowlist before fetching.

### Further Examples

#### Example: Infrastructure and Sysadmin Detail

```
User: "How do I set up podman rootless with systemd?"

intelli_research(
  query="podman rootless systemd unit configuration",
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: Debugging a Specific Problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: Comparing Options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API Reference

An application programming interface (API) reference task needs exact signatures and options.

```
User: "How do I use the Defuddle `npm` package?"

intelli_research(
  query="defuddle npm content extraction usage",
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### When Search Results Mix Source Types

The pipeline automatically adapts extraction to source type:
- **Official Docs or API Reference:** Preserves exact signatures, types, version annotations.
- **Blog Posts or Tutorials:** Captures practical patterns, gotchas, real-world examples.
- **Forums (Reddit, Discourse, StackOverflow):** Captures the problem, accepted solution, caveats. Discards tangents.

The collation instruction tells the LLM to flag contradictions and prefer sources in this order:

1. Official documentation
2. API reference
3. Tutorials
4. Blog posts
5. Forum threads

The instruction also retains useful practical examples and forum fixes; source priority is an instruction, not a guarantee of model compliance.

### Complex Multi-Angle Research: Use Manual Orchestration

For a different focus per URL (for example, comparing alternatives side-by-side), orchestrate step by step instead of using `intelli_research`:

1. `intelli_search(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (`intelli-search` does not provide one), or with available shell or Hypertext Transfer Protocol (HTTP) tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

## Using the Result

The `intelli_research` result contains a concise deduplicated summary. Use it directly. Read cache files only when the summary is insufficient for the task.

The tool output also includes a **📚 Related cached searches** section when semantically similar previous searches exist in the configured cache (`.search/` by default). These are discovered by an LLM judge that compares the current query against the cache index. The related searches are:
- **Supplementary:** The live search always runs. Cached results are offered as additional context.
- **Incomplete Live Results:** Read a previous `report.md` to cross-reference.
- **Prior Evidence:** If live results appear incorrect, point to previous research on the same topic.

Only reach into the cache when:
- The user asks about a specific source that needs re-examination.
- A complete code example is needed that was truncated in the summary.
- The summary seems contradictory and the original source is needed.
- The live results are insufficient and a related cached search may help.

## Follow Up from Cache

The cache defaults to `.search/<date>-<slug>-<hash>/`; native `cacheDir` settings can change its root. Use the path returned in `details.cachePath`. A completed repeat on the same Coordinated Universal Time (UTC) date attempts to archive prior artefacts to a numbered sibling (`<cachePath>.1/`, then `.2` and so on). Archive failure is logged and can lead to in-place replacement; interrupted rotation can leave a partial archive. A degraded repeat preserves prior successful output. Copy important reports elsewhere before repeating a query.

The following are path examples for `read`, not shell commands. List the directory first and choose an exact filename; `read` does not expand shell globs.

| Need | Path Relative to Returned Cache Entry |
|------|---------|
| Quick refresher on one source | `extractions/<exact-file>.md` |
| Full original page content | `sources/<exact-file>.md` |
| Collated overview | `report.md` |
| Per-stage outcomes (v0.11.0+) | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; `intelli-search` provides no standalone fetch tool |

## How It Works

The pipeline executes the tool-selection decisions above inside one operation.

`intelli_research` runs a 5-stage pipeline inside a single tool call:

1. **Search:** a search-grounded model (default [_Perplexity Sonar_](https://docs.perplexity.ai)) returns a synthesised answer with prose links, merged with recognised provider-supplied `url_citation` annotations recovered from the response body. Harvesting is best-effort and does not establish every source consulted. Harvested citations join the candidate URL list before page selection and the `maxUrls` cap; not every discovered source is fetched.
2. **Fetch:** Each page is fetched and cleaned to Markdown via [_Defuddle_](https://github.com/kepano/defuddle) (strips nav, ads, sidebars).
3. **Extract:** A configurable LLM (default [_MiniMax_](https://minimax.io) M3 via [_OpenRouter_](https://openrouter.ai)) pulls out only the content relevant to the query. A 50K-char page becomes ≈3-5K chars of focused extraction. Extraction adapts to source type: official docs preserve exact API signatures, blog posts capture practical patterns, forums capture accepted solutions.
4. **Collate:** Another LLM call deduplicates across extractions and produces one concise summary. The model is instructed to flag conflicts and use the source order above.
5. **Cache Suggest:** An LLM judge finds semantically related previous searches in the configured cache and surfaces them as a supplementary `📚 Related cached searches` table.

The agent receives the synthesis plus source and cache appendices, with brief `Stage X/5` progress text during execution. `collationMaxTokens` bounds synthesis output, not the appended material; the result has no fixed token length. Citation settlement, supplementary downloads and the cache judge can add latency. The judge is awaited under configured timeout/retry policy; failure is logged without discarding completed research, while cancellation still propagates.

<a id="why-extract-before-collate"></a>
### Extraction Before Collation

Per-page extraction bounds collation input and keeps context use and cost manageable across model choices. As an illustration, eight fetched pages multiplied by ≈50K chars each equals ≈400K chars; compressing each independently gives the collation model ≈32K chars total. Eight pages illustrates the design, not the ten-page default.

This is also why `focusPrompt` matters. It tells the extraction LLM what to keep from each 50K-char page. Without guidance, it extracts generically and the collation has less signal to work with.

## When Not to Search

- Writing or editing code already in the project.
- General programming concepts already understood with sufficient confidence.
- Refactoring or debugging with full context available.
