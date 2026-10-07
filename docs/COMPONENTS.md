# Third-Party Components

This document lists third-party software used by the native `pi-intelli-search` extension and standalone Model Context Protocol (MCP) package, along with their licences and provenance. Third-party runtime packages are consumed as dependencies, not copied into repository-owned source. The standalone build bundles only the shared engine and adapter source and leaves third-party packages external (`scripts/build-mcp.mjs`).

## Capability Map

The map distinguishes shared dependencies from native-only peers and MCP-only runtime dependencies. TLS means Transport Layer Security; HTTP means Hypertext Transfer Protocol; HTML means Hypertext Markup Language; DOM means Document Object Model; LLM means large language model; API means application programming interface; JSON means JavaScript Object Notation; TUI means terminal user interface; SDK means software development kit; stdio means standard input/output.

| Capability | Dependency | Boundary | Replacement Responsibility |
|---|---|---|---|
| Browser-grade TLS / HTTP fingerprinting for page fetching | Wreq-js | Shared | Preserve browser-signature fetching and native-asset installation checks. |
| HTML to Markdown content extraction | Defuddle | Shared | Preserve cleaned Markdown and dual-fetch quality comparison. |
| DOM for content extraction | Linkedom | Shared | Supply the document consumed by Defuddle in `src/core/fetch.ts`; verify conversion, metadata handling and fallback behaviour. Replacement effort has not been measured. |
| LLM dispatch and native authentication | Pi AI | Native-Only Peer | Native authentication uses `Pi`'s system; standalone inference has a separate adapter. |
| Extension API surface | Pi Coding Agent | Native-Only Peer | Preserve the native tool and event contract. |
| Tool-output progress rendering | Pi TUI | Native-Only Peer | Preserve native rendering. |
| JSON Schema and tool-input parameter typing | TypeBox | Shared: Native Peer, MCP Runtime | Preserve canonical tool schemas and both adapter contracts. |
| MCP serving over stdio | MCP Server SDK | MCP-Only Runtime | Preserve protocol registration, framing, progress and cancellation. |

## Runtime Dependencies

These packages are installed via `npm` and distributed with the extension.

### `wreq-js`

- **Repository:** https://github.com/sqdshguy/wreq-js
- **Author:** sqdshguy
- **Licence:** MIT
- **Usage:** Browser-grade TLS/HTTP fingerprinting for page fetching in `src/core/fetch.ts`. [_wreq-js_](https://github.com/sqdshguy/wreq-js) provides the shared fetch transport.

### `defuddle`

- **Repository:** https://github.com/kepano/defuddle
- **Author:** Kepano
- **Licence:** MIT
- **Usage:** [_Defuddle_](https://github.com/kepano/defuddle) extracts HTML content through `defuddle/node` in `src/core/fetch.ts`, stripping navigation, ads and sidebars to produce Markdown.

### `linkedom`

- **Repository:** https://github.com/WebReflection/linkedom
- **Author:** Andrea Giammarchi
- **Licence:** ISC
- **Usage:** [_Linkedom_](https://github.com/WebReflection/linkedom) supplies the `document` object consumed by Defuddle's Node.js mode in `src/core/fetch.ts`.

## Peer Dependencies

These packages are provided by the hosting `Pi` runtime and are not bundled with this extension.

### `typebox`

- **Repository:** https://github.com/sinclairzx81/typebox
- **Author:** Sinclair
- **Licence:** MIT
- **Usage:** [_TypeBox_](https://github.com/sinclairzx81/typebox) supplies JSON Schema and parameter type definitions for tool inputs. Migrated from `@sinclair/typebox` 0.34.x to `typebox` 1.x in v0.2.0 (required `Pi` >= 0.69.0 for the TypeBox migration).

### `@earendil-works/pi-ai`

- **Repository:** https://github.com/earendil-works/pi
- **Author:** Mario Zechner
- **Licence:** MIT
- **Usage:** Native LLM calls through `Pi`'s authentication system. Dispatch feature-detects the model-registry facade; the older supported path calls the provider directly. See [Native Models and Authentication](ARCHITECTURE.md#native-models-and-authentication) for the version boundary.
- **Request Hooks:** `ProviderRequestOptions.fetch` supplies a response-body tee for citation harvesting; `onPayload` injects the web search server tool. Re-check both on peer-dependency changes because upstream hook changes can fail silently. See [Native Citation Harvesting](ARCHITECTURE.md#native-citation-harvesting).
- **Historical Verification:** The 2026-09-22 integration update recorded verification against 0.87.0. The [compatibility matrix](COMPATIBILITY.md#native-pi-extension-curio-datapi-intelli-search) is canonical for subsequent verification, including the 1.0.0 record.

### `@earendil-works/pi-coding-agent`

- **Repository:** https://github.com/earendil-works/pi
- **Author:** Mario Zechner
- **Licence:** MIT
- **Usage:** Extension API types (`ExtensionAPI`, `ExtensionContext`, event types).

### `@earendil-works/pi-tui`

- **Repository:** https://github.com/earendil-works/pi
- **Author:** Mario Zechner
- **Licence:** MIT
- **Usage:** Tool-output progress rendering via `Text`. Supplied as a peer dependency by the hosting `Pi` runtime.

## Standalone Package

The `@curio-data/mcp-intelli-search` artefact shares the fetch dependencies above but declares `typebox` as a runtime dependency rather than a host peer. It neither installs nor imports `Pi` libraries. Third-party packages remain external to its bundle, preserving native fetch assets and their package-level licences.

### `@modelcontextprotocol/server`

- **Repository:** https://github.com/modelcontextprotocol/typescript-sdk
- **Author:** Anthropic, PBC and contributors
- **Licence:** Apache-2.0 (the MCP project is transitioning from MIT to Apache-2.0; the shipped `LICENSE` is the transition notice followed by the Apache-2.0 text, and the registry metadata declares Apache-2.0)
- **Usage:** Model Context Protocol serving over standard input/output (stdio): tool registration, input-schema validation, progress notifications, cancellation and transport framing. The software development kit (SDK) is declared only by the standalone package and never enters the native extension's runtime. The companion `@modelcontextprotocol/client` package (also Apache-2.0) is a development dependency used by the protocol test suite. Both are lockfile-pinned at 2.3.0.

[_esbuild_](https://esbuild.github.io/) bundles the internal engine and adapter source during development. Its [source repository](https://github.com/evanw/esbuild) is MIT-licensed. It is a root development dependency, not a standalone runtime dependency. The standalone inference adapter uses the built-in fetch transport against the [_OpenRouter_](https://openrouter.ai) API; no provider SDK is bundled.

<a id="license-compliance"></a>
## Licence Compliance

- Dependencies are MIT, ISC or Apache-2.0 licensed. All three are compatible with this project's Apache-2.0 licence.
- No dependency uses a copyleft licence (GPL, AGPL, etc.).
- No NOTICE files are distributed by any dependency requiring attribution preservation.

## Original Code

All source code in `src/` is original work by Ashraf Miah, Curio Data Pro Ltd. No code has been derived from other `Pi` extensions, published `Pi` packages, or third-party projects.
