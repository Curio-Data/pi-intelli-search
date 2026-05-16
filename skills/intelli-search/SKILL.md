---
name: intelli-search
description: "Research the web for current information. Use when you need docs, APIs, best practices, library updates, or any question requiring up-to-date web sources. Provides search, per-page extraction, collation, and a persistent .search/ cache for follow-up."
---

# Intelli Search

## When to Use Which Tool

### Quick Factual Question: Use `intelli_search`

When you need a fast answer with sources but no deep analysis:

```
intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task: Use `intelli_research`

**Always provide a `focusPrompt`.** The extraction LLM needs to know what to extract. Without it, you get generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

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

```
User: "How do I use the Defuddle `npm` package?"

intelli_research(
  query="defuddle npm content extraction usage",
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### Other Parameters

- `maxUrls`: `3` for quick targeted research, `8` (default) for broad research, `12` for exhaustive research.
- `domains`: Restrict to trusted sources, for example `domains=["react.dev", "github.com"]`.

### When Search Results Mix Source Types

The pipeline automatically adapts extraction to source type:
- **Official docs or API reference:** Preserves exact signatures, types, version annotations.
- **Blog posts or tutorials:** Captures practical patterns, gotchas, real-world examples.
- **Forums (Reddit, Discourse, StackOverflow):** Captures the problem, accepted solution, caveats. Discards tangents.

When collating, the LLM resolves conflicts using source priority: official docs take priority over API reference, which takes priority over tutorials, which take priority over blog posts, which take priority over forum threads. It flags contradictions explicitly.

### Complex Multi-Angle Research: Use Manual Orchestration

When you need **different focus per URL** (for example, comparing alternatives side-by-side), orchestrate step by step instead of using `intelli_research`:

1. `intelli_search(query)` to discover URLs.
2. `web_fetch` or `batch_web_fetch` to fetch specific pages.
3. `intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

## Using the Result

**The `intelli_research` tool result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.**

The tool output also includes a **📚 Related cached searches** section when semantically similar previous searches exist in `.search/`. These are discovered by an LLM judge that compares the current query against the cache index. The related searches are:
- **Supplementary:** The live search always runs. Cached results are offered as additional context.
- **Useful when live results are incomplete:** You can read a previous `report.md` to cross-reference.
- **Helpful for the user:** If the live results seem wrong, you can point the user to previous research on the same topic.

Only reach into the cache when:
- The user asks about a specific source you need to re-examine.
- You need a complete code example that was truncated in the summary.
- Something in the summary seems contradictory and you need the original.
- The live results are insufficient and a related cached search may help.

## Follow Up from Cache

The cache lives at `.search/<date>-<slug>/`. The tool output includes the path.

| Need | Command |
|------|---------|
| Quick refresher on one source | `read .search/<slug>/extractions/01-*.md` |
| Full original page content | `read .search/<slug>/sources/01-*.md` |
| Collated overview | `read .search/<slug>/report.md` |
| Re-fetch a single URL fresh | `web_fetch(url, format="Markdown")` |

## How It Works

Reference material for the curious. The decision logic above is what matters in practice.

`intelli_research` runs a 5-stage pipeline inside a single tool call:

1. **Search:** [_Perplexity Sonar_](https://docs.perplexity.ai) returns a synthesised answer with source URLs.
2. **Fetch:** Each page is fetched and cleaned to Markdown via [_Defuddle_](https://github.com/kepano/defuddle) (strips nav, ads, sidebars).
3. **Extract:** A configurable LLM (default _MiniMax_ M2.7 via OpenRouter) pulls out only the content relevant to the query. A 50K-char page becomes ≈3-5K chars of focused extraction. Extraction adapts to source type: official docs preserve exact API signatures, blog posts capture practical patterns, forums capture accepted solutions.
4. **Collate:** Another LLM call deduplicates across extractions and produces one concise summary. When sources conflict, official docs win.
5. **Cache suggest:** An LLM judge finds semantically related previous searches in `.search/` and surfaces them as a supplementary `📚 Related cached searches` table.

The agent (you) receives only the final summary, 1-2K tokens. The full pipeline is hidden inside the tool so your context stays clean.

### Why Extract Before Collate?

Eight fetched pages multiplied by ≈50K chars each equals ≈400K chars. That exceeds a single LLM context window. Extracting per-page first compresses each independently. The collation model then sees ≈32K chars total, which is comfortable for synthesis and deduplication.

This is also why `focusPrompt` matters. It tells the extraction LLM what to keep from each 50K-char page. Without guidance, it extracts generically and the collation has less signal to work with.

## When Not to Search

- Writing or editing code already in the project.
- General programming concepts you are confident about.
- Refactoring or debugging with full context available.
