# Host-Native Search Evidence

This record supports the [host-native search comparison](../COMPARISON.md#host-native-web-search). It preserves selected evidence from one [_Claude Code_](https://code.claude.com/docs) session on 2026-10-06, rather than relying on the model's final assessment. It is not a benchmark or current plugin-submission guidance.

## Provenance

The session identifier is `822c8657-da4f-409c-b930-1e5b1b16efd7`. Its local transcript is the correspondingly named `.jsonl` file under `~/.claude/projects/-srv-secure-repos-CURIO-pi-intelli-search/`. The research cache was under `scratchpad/research/.search/` in that session's scratch directory. This document preserves the relevant counts, source identifiers and excerpts; it does not distribute the full transcript or cache.

| Evidence | Recorded Value | What It Establishes |
|---|---|---|
| Session Metadata | `version: 2.1.290`; assistant model `claude-opus-5-5` | The version and model recorded by the active session |
| Installed Command Check | `claude --version` returned `2.1.291 (Claude Code)` at `08:14:20.579Z` | The installed command's version, not necessarily the active session's version |
| Native Host Check | `pi --version` returned `1.0.4` | The native host available to the session |
| Pipeline Telemetry | `extensionVersion: 0.14.0` in both `meta.json` files | The native extension version used by the research calls |
| Pipeline Models | Search: `openrouter/perplexity/sonar`; extract and collate: `openrouter/minimax/minimax-m3` | The configured models recorded for both runs |

The original comparison reported the installed command's version as the session version. These two observations are now kept separate. No inference about the cause of the difference is required.

## Native Research Runs

The session launched two sequential `pi -p` processes, each instructed to call `intelli_research` once with `maxUrls` set to 6. The command also supplied a different query and extraction focus for each directory.

The queries refer to the Model Context Protocol (MCP) and a command-line interface (CLI). The first query was:

> How to publish a Claude Code plugin with an MCP server to the official Anthropic plugin marketplace/directory in 2026: submission process, requirements, review, claude-plugins-official, community marketplaces

The second query was:

> How to publish an OpenAI Codex CLI plugin with an MCP server to the official Codex plugin directory in 2026: submission process, requirements, review, marketplace.json, .codex-plugin/plugin.json

The first focus requested submission steps, eligibility, review, manifests, versioning and updates, preferring official documentation. The second requested submission steps, eligibility, review, manifest fields and repository-marketplace installation compared with official-directory installation, also preferring official documentation.

### Cache Records

The two cache directory names identify the original `report.md`, `query.txt`, `meta.json`, `sources/` and `extractions/` artefacts:

- Anthropic: `2026-10-06-how-to-publish-a-claude-8f3e2f`
- OpenAI: `2026-10-06-how-to-publish-an-openai-79936e`

| Telemetry Field | Anthropic Run | OpenAI Run |
|---|---|---|
| `timestamp` | `2026-10-06T08:08:13.316Z` | `2026-10-06T08:11:37.052Z` |
| `outcome` | `completed` | `completed` |
| `stages.fetch.requested` | 6 | 6 |
| `stages.fetch.succeeded` | 6 | 6 |
| `stages.fetch.failed` | 0 | 0 |
| `stages.extract.succeeded` | 6 | 6 |
| `stages.cacheSuggest.ran` | `false` | `true` |
| `stages.cacheSuggest.surfaced` | 0 | 1 |

The second run's cache suggestion named the first run. It was not independent prior research. The fetch counts describe requested source uniform resource locators (URLs), not twelve distinct documents: the OpenAI run included both the Markdown and Hypertext Markup Language (HTML) forms of the submission page.

### Source Selection

The Anthropic report's source index lists, in order:

1. <https://claude.com/docs/plugins/submit>
2. <https://claude.com/docs/plugins/pre-submission-checklist>
3. <https://claude.com/docs/plugins/quickstart>
4. <https://claude.com/blog/build-plugins-for-claude>
5. <https://claude.com/docs/directory/publish>
6. <https://github.com/anthropics/claude-plugins-official/blob/main/README.md>

The OpenAI report's source index lists, in order:

1. <https://developers.openai.com/plugins/deploy/submission.md>
2. <https://developers.openai.com/plugins/deploy/submission>
3. <https://developers.openai.com/plugins/build/plugins>
4. <https://developers.openai.com/plugins>
5. <https://developers.openai.com/plugins/guides/submit-claude-plugin>
6. <https://developers.openai.com/codex/plugins?install-scope=global>

The first set includes a vendor blog and marketplace README, not only documentation pages. The reports establish what the pipeline returned, not the correctness of every statement in those reports.

## Built-In Tool Calls

The transcript contains three `WebSearch` and seven `WebFetch` calls. The original model-written assessment reported four searches and six fetches; that count was incorrect. Times below are in Coordinated Universal Time (UTC) on 2026-10-06 and identify the assistant's tool-call records.

| Time | Tool | Query or Requested URL |
|---|---|---|
| `08:08:07.789Z` | `WebSearch` | `submit Claude Code plugin to official Anthropic plugin marketplace directory 2026` |
| `08:08:08.328Z` | `WebSearch` | `OpenAI Codex plugins directory submit plugin publish 2026` |
| `08:08:19.096Z` | `WebFetch` | `https://code.claude.com/docs/en/plugin-marketplaces` |
| `08:08:20.620Z` | `WebFetch` | `https://developers.openai.com/codex/plugins/build` |
| `08:08:34.411Z` | `WebFetch` | `https://code.claude.com/docs/en/plugins/publish` |
| `08:08:35.018Z` | `WebSearch` | `developers.openai.com Codex plugin directory submission portal review requirements local MCP server` |
| `08:08:45.422Z` | `WebFetch` | `https://claude.com/docs/plugins/pre-submission-checklist` |
| `08:08:46.710Z` | `WebFetch` | `https://developers.openai.com/codex/submit-plugins.md` |
| `08:09:00.684Z` | `WebFetch` | `https://claude.com/docs/plugins/platform-support` |
| `08:09:09.083Z` | `WebFetch` | `https://claude.com/docs/plugins/submit` |

The first search returned secondary sources led by an _AI Weekly_ article. The second included official OpenAI help pages as well as secondary sources. The publishing-guide and platform-support fetches returned full documentation text, so the original description of every fetch as a small-model summary was unsupported.

## Submission Guidance

The Anthropic research report described `claude-plugins-official` as having its own submission form. This was supported by its captured source, not an invented link. The marketplace README, Section External Plugins, in `sources/06-github-com.md` stated:

> Third-party partners can submit plugins for inclusion in the marketplace. External plugins must meet quality and security standards for approval. To submit a new plugin, use the [plugin directory submission form](https://clau.de/plugin-directory-submission).

The separate [publishing guide](https://code.claude.com/docs/en/plugins/publish#submit-to-anthropics-directory), Section Submit to Anthropic's Directory, returned through `WebFetch` at `08:08:34.597Z`, stated:

> Anthropic's official marketplace, `claude-plugins-official`, doesn't take submissions through the directory portal. If you work with an Anthropic partner contact, ask them about an official-marketplace listing.

The passages give different guidance, but the second excludes the directory portal rather than explicitly retiring the separate form. The session did not establish whether the form remained valid. The comparison therefore records an unresolved discrepancy, not a confirmed pipeline error.

## Other Source Passages

### Local-Server Guidance

The captured [OpenAI migration guide](https://developers.openai.com/plugins/guides/submit-claude-plugin), in `sources/05-developers-openai-com.md` of the OpenAI cache, advised for a local MCP server, referring to Hypertext Transfer Protocol Secure (HTTPS):

> Deploy it to a public HTTPS URL. If you can't, reach out to your OpenAI contact for local MCP support.

The same capture, Section Complete the Submission Requirements, stated:

> Contact your OpenAI partner before submitting if the plugin's core value requires local execution, arbitrary access to files on the user's computer, hardware or application access, offline operation, or inbound channel messages. These cases may need product-specific review.

This supports describing local-server migration guidance with a partner-contact exception, not an unconditional prohibition on every local-server submission.

### Platform Support

The [platform-support page](https://claude.com/docs/plugins/platform-support#compare-component-support-by-app), returned through `WebFetch` at `08:09:01.032Z`, recorded this row under Section Compare Component Support by App:

> | Component | Chat | Cowork | Claude Code | Notes |
> | :- | :- | :- | :- | :- |
> | Local MCP server, a command the app starts, including `.mcpb` bundles | Ignored | Loads when the Cowork session runs on your computer | Loads | On the web, the plugin's **Connectors** tab marks it **Runs in each session** |

That page was absent from both pipeline source indexes. This establishes an additional source obtained through the built-in tools in this session, not an inherent difference in the tools' coverage.

### Unverified Launch Date

The first `WebSearch` result included this sentence:

> Anthropic's Claude Marketplace went live September 23, 2026 with more than 2,000 plugins and connectors, organized into three sections: connectors and plugins, agents and products, and service partners.

The returned source list began with [the AI Weekly article](https://aiweekly.co/alerts/anthropic-opens-claude-marketplace-with-2000-integrations), but the sentence did not carry an individual citation. The session did not verify the date. It remains an unverified search-result claim, not a demonstrated factual error.
