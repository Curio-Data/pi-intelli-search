# Native Compatibility Fixtures

## Purpose

These fixtures capture the native `Pi` interface before the shared-engine refactor. They were generated from production source at `7b7524af34cb0862a978aba2013e8eeb288e0f8a`; the planning commit `886bf7c` changes documentation only. Phase 0 does not modify production source or dependencies.

The fixture suite runs through `npm test`. The expected files are static JSON, meaning JavaScript Object Notation, read from disk. Tests never regenerate them or compute expected output from the same function under test.

## Coverage

| Fixture | Frozen Contract |
|---|---|
| `tools.json` | Registration order, event names, labels, descriptions, schemas, prompt guidance, execution mode and renderer presence |
| `prompts.json` | Every exported system prompt, verbatim |
| `search.json` | Standalone search, domain guidance, citation merge, source cap and native result details |
| `extract.json` | Standalone extraction, focus instruction, input truncation and inferred metadata |
| `collate.json` | Standalone collation with successful and blocked sources, native result details and cache files |
| `research.json` | Completed pipeline, annotation-only source, requested URL cap, progress, model requests, cache suggestions and all cache/telemetry files |
| `partial-research.json` | Completed research with a failed fetch, blocked-source report and stage counters |
| `no-links.json` | Degraded search text, details, progress and local metadata without a completed report |
| `fetch-failed.json` | All-fetches-failed result and metadata |
| `extraction-failed.json` | All-extractions-failed result, diagnostics and metadata |

Operation fixtures contain the returned result, captured model requests and fetch parameters, progress updates, working-indicator lifecycle, diagnostics and the complete `.search/` file inventory. Cache file values are exact text, including report formatting and serialized metadata. The model request records use the system-prompt export name; `prompts.json` independently freezes its exact text.

## Isolation

`test/helpers/native-contract.ts` creates a new gitignored `.tmp/native-contract-*` directory for every scenario. It redirects the agent directory, disables project trust and documentation-file discovery, and substitutes synthetic model responses and fetched pages. Citation collection still runs through the real wrapped-fetch and parsing path using an in-memory response. Unexpected fetch URLs fail rather than reaching the network.

The real native tool `execute()` methods and `callLlm()` run. The fake registry supplies the facade-shaped model transport; existing `test/llm.test.ts` separately covers legacy dispatch. No authentication file, live credential or provider account is required.

The clock is fixed at a synthetic instant, extraction concurrency is serialised for stable progress ordering, and release identity is the only normalized output field. Before replacing `extensionVersion` with `<PACKAGE_VERSION>`, the harness checks it against the root package manifest. Duration remains present and is asserted to be zero under the fixed clock. No general timestamp, path, content or counter scrubber is used.

Every scenario restores the process directory, agent-directory environment variable, fetch implementation, console handler, clock, settings caches and research fetch seam in `finally`. A repeatability test runs completed research twice from different temporary directories with a deliberately unusable inherited agent path. A mutation test changes real tool metadata and an executed result, proves the fixtures detect each change, then restores the original behaviour.

Run scenarios serially. The harness characterises the current implementation's global seams; it is not a model for the future concurrent server.

## Review and Regeneration

Run only the fixture suite with:

```bash
node --import tsx --test test/native-contract.test.ts
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
```

The explicit maintenance command replaces expected files:

```bash
node --import tsx scripts/capture-native-contract.mts --write
```

Do not run that command merely to make a refactor pass. First inspect the failing diff, classify it as a regression or an approved behaviour change, and document the reason. For a deliberate contract change, regenerate, review each fixture diff and run the complete test suite. Preserve the original baseline through version control.

The generator requires exactly `--write`; invoking it without that argument exits without replacing files. No update flag is supported by the normal test runner.

## Boundaries

The fixtures establish exact behaviour under synthetic inputs, not live response quality, real-host rendering, minimum-host compatibility or MCP interoperability. Live fetching and documentation downloads are not exercised here. Existing retry, settings-trust, migration, cache-lock, telemetry-disabled and rendering tests remain necessary.

The baseline records pre-extraction behaviour without declaring every behaviour desirable. For example, standalone collation does not emit the research telemetry sidecar and standalone model calls do not pass the full pipeline's retry configuration. Phase 1 corrects physical cache paths that previously depended on the process directory while preserving the display text captured here. Its workspace tests reuse these fixtures with a separate process directory. Changes to captured behaviour need an explicit decision and targeted tests rather than silent fixture replacement.
