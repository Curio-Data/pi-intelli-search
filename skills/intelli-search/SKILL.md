---
name: intelli-search
description: "Research the web for current information. Use when you need docs, APIs, best practices, library updates, or any question requiring up-to-date web sources. Provides search, per-page extraction, collation, and a persistent .search/ cache for follow-up."
---

# Intelli Search

## How it works

`intelli_research` runs a 4-stage pipeline inside a single tool call:

1. **Search** — Perplexity Sonar returns a synthesised answer + source URLs
2. **Fetch** — grabs each page, cleans HTML to markdown via Defuddle (strips nav, ads, sidebars)
3. **Extract** — for each page, an LLM (MiniMax M2.7) pulls out only the content relevant to the query. A 50K-char page becomes ~3-5K chars of focused extraction. The extraction adapts to source type — official docs preserve exact API signatures, blog posts capture practical patterns, forums capture accepted solutions.
4. **Collate** — another LLM call deduplicates across extractions and produces one concise summary. When sources conflict, official docs win.

The agent (you) receives only the final summary — typically 1-2K tokens. The full pipeline is hidden inside the tool so your context stays clean.

### Why extract before collate?

Eight fetched pages × ~50K chars each = ~400K chars. That's too large for a single LLM context window. Extracting per-page first compresses each independently, then the collation model sees ~32K chars total — comfortable for synthesis and deduplication.

This is also why `focusPrompt` matters: it tells the extraction LLM what to keep from each 50K-char page. Without guidance, it extracts generically and the collation has less signal to work with.

## When to use which tool

### Quick factual question → `intelli_search`

When you need a fast answer with sources but no deep analysis:

```
intelli_search(query="TypeScript 5.8 release date")
```

### Deep research for a coding task → `intelli_research`

**Always provide a `focusPrompt`.** The extraction LLM needs to know what to extract. Without it, you get generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: learning a new feature

```
User: "How do runes work in Svelte 5?"

intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

#### Example: infrastructure / sysadmin detail

```
User: "How do I set up podman rootless with systemd?"

intelli_research(
  query="podman rootless systemd unit configuration",
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: debugging a specific problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: comparing options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API reference

```
User: "How do I use the Defuddle npm package?"

intelli_research(
  query="defuddle npm content extraction usage",
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### Other parameters

- `maxUrls` — `3` for quick targeted research, `8` (default) for broad, `12` for exhaustive
- `domains` — restrict to trusted sources: `domains=["react.dev", "github.com"]`

### When search results mix source types

The pipeline automatically adapts extraction to source type:
- **Official docs / API reference** — preserves exact signatures, types, version annotations
- **Blog posts / tutorials** — captures practical patterns, gotchas, real-world examples
- **Forums (Reddit, Discourse, StackOverflow)** — captures the problem, accepted solution, caveats; discards tangents

When collating, the LLM resolves conflicts using source priority: official docs > API reference > tutorial > blog post > forum thread. It flags contradictions explicitly.

### Complex multi-angle research → manual orchestration

When you need **different focus per URL** (e.g. comparing alternatives side-by-side), orchestrate step by step instead of using `intelli_research`:

1. `intelli_search(query)` — discover URLs
2. `web_fetch` / `batch_web_fetch` — fetch specific pages
3. `intelli_extract(url, title, content, query, focusPrompt)` — give each URL a different focus
4. `intelli_collate(extractions, query)` — deduplicate and cache

Example: researching "KV vs Durable Objects" — extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"` and Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

## Using the result

**The intelli_research tool result already contains a concise deduplicated summary. Use it directly — do NOT read cache files unless the summary is insufficient for the task.**

Only reach into the cache when:
- The user asks about a specific source you need to re-examine
- You need a complete code example that was truncated in the summary
- Something in the summary seems contradictory and you need the original

## Follow-up from cache

The cache lives at `.search/<date>-<slug>/`. The tool output includes the path.

| Need | Command |
|------|---------|
| Quick refresher on one source | `read .search/<slug>/extractions/01-*.md` |
| Full original page content | `read .search/<slug>/sources/01-*.md` |
| Collated overview | `read .search/<slug>/report.md` |
| Re-fetch a single URL fresh | `web_fetch(url, format="markdown")` |

## When NOT to search

- Writing or editing code already in the project
- General programming concepts you're confident about
- Refactoring or debugging with full context available
