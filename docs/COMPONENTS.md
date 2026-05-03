# Third-Party Components

This document lists third-party software included or used by `pi-intelli-search`, along with their licenses and provenance. This project uses these libraries as dependencies via npm — no third-party source code has been copied or embedded directly.

## Runtime Dependencies

These packages are installed via npm and distributed with the extension.

### wreq-js

- **Repository**: https://github.com/sqdshguy/wreq-js
- **Author**: sqdshguy
- **License**: MIT
- **Usage**: Browser-grade TLS/HTTP fingerprinting for page fetching. Used as a library dependency — no source code modifications.

### defuddle

- **Repository**: https://github.com/kepano/defuddle
- **Author**: Kepano
- **License**: MIT
- **Usage**: HTML content extraction (strips nav, ads, sidebars to produce clean markdown). Used as a library dependency via its published Node.js API (`defuddle/node`). The API usage pattern in `src/fetch.ts` follows the usage example in the defuddle README. No source code modifications.

### linkedom

- **Repository**: https://github.com/WebReflection/linkedom
- **Author**: Andrea Giammarchi
- **License**: ISC
- **Usage**: Lightweight DOM implementation used to provide a `document` object for defuddle's Node.js mode. Used as a library dependency — no source code modifications.

## Peer Dependencies

These packages are provided by the hosting pi runtime and are not bundled with this extension.

### typebox

- **Repository**: https://github.com/sinclairzx81/typebox
- **Author**: Sinclair
- **License**: MIT
- **Usage**: JSON Schema / parameter type definitions for tool inputs. Migrated from `@sinclair/typebox` 0.34.x to `typebox` 1.x in v0.2.0 (pi ≥ 0.69.0 TypeBox migration).

### @mariozechner/pi-ai

- **Repository**: https://github.com/mariozechner/pi
- **Author**: Mario Zechner
- **License**: Apache-2.0
- **Usage**: LLM calling via pi's auth system (`completeSimple()`).

### @mariozechner/pi-coding-agent

- **Repository**: https://github.com/mariozechner/pi
- **Author**: Mario Zechner
- **License**: Apache-2.0
- **Usage**: Extension API types (`ExtensionAPI`, `ExtensionContext`, event types).

## License Compliance

- All dependencies are MIT, ISC, or Apache-2.0 licensed — compatible with this project's Apache-2.0 license.
- No dependency uses a copyleft license (GPL, AGPL, etc.).
- No NOTICE files are distributed by any dependency requiring attribution preservation.
- No source code from these projects has been copied, modified, or embedded. All usage is via standard library API calls through npm dependencies.

## Original Code

All source code in `src/` is original work by Ashraf Miah, Curio Data Pro Ltd. No code has been derived from other pi extensions, published pi packages, or third-party projects.
