# Benchmark Libraries (P3)

Synthetic-only recorder, replay, observer, parser and paired-statistics libraries for the Codemode benchmark programme. These implement the frozen P0-2 declarations in `docs/plans/codemode/API.ts`; `contracts.ts` mirrors the benchmark-only types and carries compile-time assignability proofs against that frozen file. Nothing here performs paid inference, and no library may invoke a network primitive during replay.

## Modules

| Module | Role |
|---|---|
| `contracts.ts` | Mirrored benchmark types plus assignability proofs against the frozen `API.ts` |
| `canonical.ts` | Sorted-key canonical JSON, sha256 helpers, declared binding-map normalisation |
| `replay-store.ts` | `ReplayStore` with occurrence-exact keys, fail-closed misses, fixture file load/save/verify and the capture-side `FixtureRecorder` |
| `transport-replay.ts` | Model transport replay at the frozen `RegistryStreamSimple` seam and page transport replay below the real `FetchClient` |
| `observer.ts` | Read-only `before_provider_request` observer with payload sanitisation and tool-catalogue hashing |
| `usage-parser.ts` | `parseUsageEvents` canonical assistant/tool populations from JSON/RPC session event streams |
| `statistics.ts` | `estimatePairedQueries` and seeded query-clustered `bootstrapPairedQueries` |
| `run-observation.ts` | Append-only immutable `RunObservation` manifests |
| `testing.ts` | Isolated scratch, synthetic record builders and the network guard used by tests |

## Binding Replay Condition

The binding condition N1, quoted verbatim from the handoff:

> a transport-replay implementation must never invoke `options.fetch` or any network primitive. It must replay citations only through recorded `onProviderStreamEvent` chunks, or through a declared non-network tee seam if floor-host replay is ever required.

Both transport helpers accept the real registry argument for signature compatibility and never dereference it. A fixture miss throws `ReplayMissError` and invalidates the block; there is no live fallback path in this directory. Citation replay is delivered only through the supplied `onProviderStreamEvent` hook using recorded chunks.

## Fixture Files

`fixtures/synthetic-codemode-dev-model.json` and `fixtures/synthetic-codemode-dev-fetch.json` are committed synthetic fixtures for one forced-workflow scenario (`synthetic-codemode-dev`), including a retry occurrence (error then success), a never-consumed suggestion fixture (skipped, not missed) and dual page-variant fetches. Load them with `loadReplayStore(path)`; every load verifies `contentSha256`, key request hashes and key uniqueness, and fails closed on any defect.

## Semantics Pinned by These Libraries

The frozen API declares signatures; the following behaviours are implementation contracts the coordinator inherits when wiring:

- A replay **miss** is signalled by a thrown `ReplayMissError` with reason `not-found`, `request-mismatch`, `already-consumed` or `invalid-file`. `assertValid()` throws once any miss is recorded; `unconsumed()` lists fixtures the policy never reached, which callers label skipped, not missed.
- One fixture occurrence is one transport attempt: each helper invocation consumes the next occurrence for its exact request hash, so retries replay distinct recorded responses in submission order.
- Request identity is the sha256 of sorted-key canonical JSON after replacing only declared binding paths with placeholder markers; string contents are never rewritten.
- `RequestObserver.complete` is true exactly when every captured record is durably flushed.
- `parseUsageEvents` counts assistant messages once from `message_end` events and pipeline accounting once per `tool_execution_end` id (structuredContent, or legacy `details.intelli`); `turn_end`, `agent_end` and nested-parent aggregates never enter any sum. The pi-ai `usage` field on tool results is tool-execution overhead, not pipeline accounting, and is not parsed into either population.
- `appendRunObservation` appends one canonical JSON line per observation and never rewrites prior lines; failed, aborted and rerun records are retained.

## Checks

```bash
node_modules/.bin/tsc -p scripts/benchmarks/tsconfig.json   # nonemitting type check incl. assignability proofs
node --import tsx --test test/benchmark-*.test.ts           # isolated synthetic tests (no network, no paid calls)
```

Integration gates (transport-replay inside the real native policy, Codemode bridge, loader isolation, credential-free zero-network proof and any paid run) are coordinator-owned and are not claimed here.
