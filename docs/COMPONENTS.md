# Third-Party Components

This document lists third-party software included or used by `pi-intelli-search`, along with their licenses and provenance. This project uses these libraries as dependencies via `npm`. No third-party source code has been copied or embedded directly.

## Capability Map

Each runtime dependency provides one specific capability. The table below shows what `pi-intelli-search` would lose if a dependency were removed, and how easily an alternative could be substituted.

| Capability | Dependency | Replaceable? |
|---|---|---|
| Browser-grade TLS / HTTP fingerprinting for page fetching | [`wreq-js`](https://github.com/sqdshguy/wreq-js) | Hard. Most Node HTTP clients lack realistic browser fingerprints (`chrome_145`), which many sites require to return clean content. |
| HTML to Markdown content extraction (strips nav, ads, sidebars) | [`defuddle`](https://github.com/kepano/defuddle) | Medium. Mozilla Readability is a fallback but produces less consistent Markdown; the dual-fetch quality scoring is calibrated against Defuddle's output. |
| DOM in Node.js (required by Defuddle) | [`linkedom`](https://github.com/WebReflection/linkedom) | Easy. `jsdom` is a heavier alternative; switching is a one-line change in `src/fetch.ts`. |
| LLM dispatch and `Pi`-native auth | [`@mariozechner/pi-ai`](https://github.com/mariozechner/pi) | No. `Pi`-bound by design; all auth flows route through `Pi`'s native system. |
| Extension API surface (`ExtensionAPI`, `ExtensionContext`, event types) | [`@mariozechner/pi-coding-agent`](https://github.com/mariozechner/pi) | No. `Pi`-bound by design. |
| JSON Schema and tool-input parameter typing | [`typebox`](https://github.com/sinclairzx81/typebox) | Hard. `Pi`'s extension contract is built around TypeBox 1.x; replacing it would require coordinated upstream changes. |

## Runtime Dependencies

These packages are installed via `npm` and distributed with the extension.

### wreq-js

- **Repository:** https://github.com/sqdshguy/wreq-js
- **Author:** sqdshguy
- **License:** MIT
- **Usage:** Browser-grade TLS/HTTP fingerprinting for page fetching. Used as a library dependency with no source code modifications.

### defuddle

- **Repository:** https://github.com/kepano/defuddle
- **Author:** Kepano
- **License:** MIT
- **Usage:** HTML content extraction (strips nav, ads, sidebars to produce clean Markdown). Used as a library dependency via its published Node.js API (`defuddle/node`). The API usage pattern in `src/fetch.ts` follows the usage example in the [defuddle README](https://github.com/kepano/defuddle). No source code modifications.

### linkedom

- **Repository:** https://github.com/WebReflection/linkedom
- **Author:** Andrea Giammarchi
- **License:** ISC
- **Usage:** Lightweight DOM implementation used to provide a `document` object for [defuddle](https://github.com/kepano/defuddle)'s Node.js mode. Used as a library dependency with no source code modifications.

## Peer Dependencies

These packages are provided by the hosting `Pi` runtime and are not bundled with this extension.

### typebox

- **Repository:** https://github.com/sinclairzx81/typebox
- **Author:** Sinclair
- **License:** MIT
- **Usage:** JSON Schema and parameter type definitions for tool inputs. Migrated from `@sinclair/typebox` 0.34.x to `typebox` 1.x in v0.2.0 (required `Pi` >= 0.69.0 for the TypeBox migration).

### @mariozechner/pi-ai

- **Repository:** https://github.com/mariozechner/pi
- **Author:** Mario Zechner
- **License:** Apache-2.0
- **Usage:** LLM calling via `Pi`'s auth system (`completeSimple()`).

### @mariozechner/pi-coding-agent

- **Repository:** https://github.com/mariozechner/pi
- **Author:** Mario Zechner
- **License:** Apache-2.0
- **Usage:** Extension API types (`ExtensionAPI`, `ExtensionContext`, event types).

## License Compliance

- All dependencies are MIT, ISC, or Apache-2.0 licensed. This is compatible with this project's Apache-2.0 license.
- No dependency uses a copyleft license (GPL, AGPL, etc.).
- No NOTICE files are distributed by any dependency requiring attribution preservation.
- No source code from these projects has been copied, modified, or embedded. All usage is via standard library API calls through `npm` dependencies.

## Original Code

All source code in `src/` is original work by Ashraf Miah, Curio Data Pro Ltd. No code has been derived from other `Pi` extensions, published `Pi` packages, or third-party projects.
