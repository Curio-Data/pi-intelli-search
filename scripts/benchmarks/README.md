# Benchmark Libraries (P3)

Benchmark recorder, replay, observer, parser and paired-statistics libraries for the Codemode benchmark programme. These implement the unchanged benchmark declarations from P0-2 in `docs/plans/codemode/API.ts`, with the accepted [F7-1 suggestion replay amendment](../../docs/plans/codemode/F7-REPLAY.md); `contracts.ts` mirrors the benchmark-only types and carries compile-time assignability proofs against that frozen file (mirrored types and the actual function implementations). The committed fixtures are synthetic and the libraries have been exercised only synthetically: no live or paid inference is part of this slice, and no library may invoke a network primitive during replay.

## Modules

| Module | Role |
|---|---|
| `contracts.ts` | Mirrored benchmark types plus assignability proofs against the frozen `API.ts` (type-level and implementation-level) |
| `canonical.ts` | Sorted-key canonical JavaScript Object Notation (JSON), sha256 helpers, declared binding-map normalisation |
| `replay-store.ts` | `ReplayStore` with occurrence-exact keys, fail-closed misses, whole-record fixture verification, file digest, and the capture-side `FixtureRecorder` |
| `transport-replay.ts` | One shared model transport replay instance at the frozen `RegistryStreamSimple` seam (resolver-derived node/role or explicit F7 preparation) and one shared page transport replay below the real `FetchClient` |
| `suggestion-replay.ts` | F7 recorder/replay sessions, verified candidate read views, typed generated-value identity and replay completeness |
| `observer.ts` | Read-only `before_provider_request` observer with payload sanitisation and tool-catalogue hashing |
| `usage-parser.ts` | `parseUsageEvents` canonical assistant/tool populations from JSON and Remote Procedure Call (RPC) session event streams |
| `statistics.ts` | `estimatePairedQueries`, `primaryAvailable` and seeded query-clustered `bootstrapPairedQueries` |
| `run-observation.ts` | Append-only immutable `RunObservation` manifests |
| `testing.ts` | Isolated scratch, synthetic record builders, scenario resolvers and the network guard used by tests |

## Binding Replay Condition

The binding condition N1, quoted verbatim from the handoff:

> a transport-replay implementation must never invoke `options.fetch` or any network primitive. It must replay citations only through recorded `onProviderStreamEvent` chunks, or through a declared non-network tee seam if floor-host replay is ever required.

Both transport helpers accept the real registry argument for signature compatibility and never dereference it. A fixture miss or an ambiguous node derivation throws `ReplayMissError` and invalidates the store, including failures before lookup; `invalidations()` retains errors without an assignable fixture key. Call both stores' `assertValid()` before accepting a block; there is no live fallback path in this directory. Citation replay is delivered only through the supplied `onProviderStreamEvent` hook using recorded chunks, and recorded provider response metadata (status and headers, including `retry-after`) is replayed through the supplied `onResponse` hook.

## One Shared Instance Per Seam

The frozen `NativeTestInjection` accepts exactly one `registryStreamSimple` per loaded runtime, and its arguments carry no scope, call id, role or page id. `createModelTransportReplay` therefore serves every stage of a run through one instance: a caller-supplied deterministic resolver derives `{ operationNode, role }` from request content (the four pipeline roles use four distinct system prompts, Observed in `src/core/prompts.ts`; page identity lives in the user message), the derived role joins the request before hashing, and occurrence counters key by exact request hash. `createPageTransportReplay` does the same for every page/catalogue node.

Ambiguity invalidates the block and never guesses: construction fails when the fixture set holds identical request bytes under two different operation nodes, and a resolver that cannot identify a unique node/role (zero or multiple `uniqueMatch*Resolver` rules) stops replay with reason `ambiguous-node`.

## F7 Suggestion Read Views

Use `createSuggestionViewRecorder()` to record the real verified candidate array before judge formatting, together with exact workflow and schedule identity, initial workspace digest and actual producer notifications. Inject its `controller` through the native `suggestionReadView` seam. Report real host settlement with `reportHostWitness()` before reusing an identical query; publication or completion of a candidate read is not settlement. Declare collation producers explicitly: they can appear in another operation's view but perform no suggestion read themselves.

Record and replay model calls with the same `createSuggestionTransportPreparation()` result. It reconstructs the entire actual suggestion message byte for byte, then binds only block-generated directory slugs and Coordinated Universal Time (UTC) leaves in a typed canonical representation. Actual requests, baseline paths/times and query/source/code text stay unchanged. Generic whole-message bindings remain forbidden.

Finalise recording with `exportArtefact({ fixtureFiles })` after hashing the actual transport fixtures. `createSuggestionViewReplay()` receives that artefact, the actual fixture digests, pinned initial-tree/schedule identities and a finite visibility-wait budget that fits inside the enclosing script budget. The budget starts at the first required wait. Replay waits for required index-visible publications and selects only immutable references from the actual verified reader, in the recorded order. Missing/window-displaced candidates, unexpected baseline changes, failed dependencies and cancellation invalidate the block without live fallback.

Before accepting a replay block, call both transport stores' `assertValid()`, the session's `assertValid()` **and** `assertReplayComplete()`. Sticky-error validity alone cannot establish that every required producer, candidate read and judge request ran. Wire `onInvalid` to block cancellation even when the core catches supplementary suggestion errors. Preserve invalid and incomplete runs rather than treating them as zero usage or successful smaller views. Native wall-time replay and its visibility waits establish control/data/accounting fidelity, not production-latency benefit; launch-order perturbations are robustness-only and are not pooled with measurement runs.

## Fixture Files

`fixtures/synthetic-codemode-dev-model-v2.json` and `fixtures/synthetic-codemode-dev-fetch.json` are constructed synthetic fixtures for one forced-workflow scenario (`synthetic-codemode-dev`), including a retry occurrence (429 with `retry-after` metadata, then success), a suggestion fixture and dual page-variant fetches. Citation chunks use the real OpenRouter Completions wire shape that `src/core/annotations.ts` harvests. The original model fixture remains byte-preserved for integrity tests and an explicit refusal regression: it records uncached input without known cache subsets and treats an unobserved HTTP 429 as observed zero usage. Version 2 preserves unknown cache subsets and leaves that failed attempt unobserved. Neither fixture is a live capture.

Every load verifies, and fails closed on any defect: the whole-record digest `contentSha256` (canonical `{ response, error, usage, delayMs }`), per-record key request hashes, key uniqueness, integer occurrences, response-or-error presence, binding allowlists and structural shape. `fixtureFileSha256(file)` / `fixtureFileSha256FromPath(path)` return the verified whole-file canonical digest for `RunObservation.fixtureSha256`. Regenerate fixtures only through `createFixtureRecorder`; hand-edited JSON fails verification.

## Semantics Pinned by These Libraries

The frozen API declares signatures; the following behaviours are implementation contracts the coordinator inherits when wiring:

- A replay miss is signalled by a thrown `ReplayMissError` with reason `not-found`, `request-mismatch`, `already-consumed`, `out-of-order`, `ambiguous-node` or `invalid-file`. `assertValid()` throws once any miss is recorded; `unconsumed()` lists fixtures the policy never reached, which callers label skipped, not missed.
- Model replay qualifies each frozen usage observation through the actual `src/native-usage.ts` capture before execution. The derived observation must match field-for-field or construction fails closed. This benchmark-only runtime dependency single-sources native accounting semantics; it adds no package runtime export. Recorded events are delivered on success, error and transport-rejection paths. Known provider-response usage can be re-encoded through the usage-event channel without inventing fields; only recorded chunks replay citations. `error.kind: "throw"` represents transport rejection, not a resolved provider error.
- One fixture occurrence is one transport attempt: each helper invocation consumes the next occurrence for its exact request hash, in order. Serving occurrence k before k-1 is consumed is an `out-of-order` miss.
- A model abort during the recorded delay resolves an AssistantMessage with `stopReason: "aborted"` exactly like the live stream (Observed in the shared pi-ai 1.1.0 `api/openai-completions.js`), so the real policy exercises its live branch. The occurrence counts as consumed-but-not-delivered: started-then-cancelled is never a skipped or missed response.
- Request identity is the sha256 of sorted-key canonical JSON after replacing only declared binding paths with placeholder markers; string contents are never rewritten. Bindings whose paths target the frozen request fields themselves (`userMessage`, `systemPrompt`, `url`, and siblings) are rejected at load: they would wildcard the content the fixture must freeze exactly.
- Because the frozen `ModelFixtureRequest` and `FetchFixtureRequest` shapes consist entirely of those protected fields, generic `RequestBinding` cannot apply to a model or fetch request. Only the separately versioned F7 suggestion representation above binds verified generated slug/UTC leaves; it does not relax generic binding restrictions. A replay block must therefore start from a fixed, recorded cache index and workspace state: for example the cache-suggest user message embeds the formatted index of previous searches, which varies with workspace history and will miss its fixture otherwise. Record that state with the block.
- `RequestObserver.complete` is true exactly when every captured record is durably flushed. Flushes are serialised; concurrent calls never duplicate a batch.
- Sanitisation fidelity limits: sensitive header-like keys are dropped anywhere; strings of at least 256 characters drawn from the base64 alphabet are replaced by byte-size markers (in object values and array elements), so exposure size accounting stays exact while content inspection of such fields is lost. Quotation analysis inside base64-looking fields needs a per-field allowlist.
- Assistant dedupe identity: canonical bytes of the whole finalised message; ids from `responseId` else `provider/model@timestamp` with `#n` collision suffixes. Replay timestamps are wall-clock, so replayed transcripts are not byte-reproducible.
- The pipeline tool population is intelli executions only: the five known intelli tool names, their `mcp__<server>__intelli_*` registrations, shortened MCP names with explicit host `details.tool` identity, or any tool whose result carries an explicit intelli identity marker (full `schemaVersion` plus a known `operation` from FullData, the compact `meta` pair, or the legacy `details.intelli` pair). `Pi`'s Model Context Protocol (MCP) client places the whole `CallToolResult` in `structuredContent`, so the parser also recognises the data one level deeper. A known MCP intelli execution with a missing marker is retained as missing, never silently excluded. Compact summaries expose no token components: all canonical token fields are marked missing, and absent or invalid required attempt-coverage fields make the observation missing. Shape resemblance alone never admits a foreign tool. `bash`, `read`, `edit`, the `codemode` tool itself and other extensions never enter the pipeline population or the `missing` list; `missing` means an expected observation is absent. The pi-ai `usage` field on tool results is tool-execution overhead, not pipeline accounting, and is parsed into neither population.
- All-zero assistant SDK usage is ambiguous without wire-presence evidence and is recorded as missing, not a zero-token H1 observation. An observer can append `mainUsageEvidence(message, observed)` after checking actual wire usage presence; the sidecar hashes the unchanged canonical message, and conflicting evidence fails closed to missing. This optional witness is not inferred from SDK zeros.
- `tokensFromWireUsage` omits fields absent from its input object. Canonical assistant messages, however, carry SDK-normalised usage with zero placeholders; per-field absence cannot be recovered from those values alone. The all-zero guard is message-level only. Before recording H1 (the uncached-main-input saving endpoint), the observer must supply actual wire-presence evidence and qualify partial-field missingness on the selected main host/provider. The current library does not emit that evidence for real sessions. Explicit wire-observed zeros remain values, not missing charges.
- `effectivePayloadPatch` is recorded as the effect of `onPayload({})`; a future patch that inspects the real provider payload skeleton would record differently from what it sends.
- Statistics: duplicate or non-integer population entries are rejected; seeds must be integers in the 32-bit unsigned range so the echoed seed is the seed used. Queries with partial repeats contribute complete-case pairs while also being listed in `missingQueries`. `primaryAvailable(estimate, population, metric)` gates the prespecified primary claim for the metric analysed: an incomplete population (any missing cell, any expected query absent from the pairs, any partial-repeat query) blocks both metrics, while nonpositive query means (`undefinedRatioQueries`) block only the `log-ratio` primary, so a complete population with a zero query mean keeps its primary difference interval with zero-valued pairs retained. `bootstrapPairedQueries` applies the same metric-aware guard with its own metric and returns null bounds when the guard fails unless the caller passes `diagnostic: true` to label a complete-case interval; without a `population` the interval is always complete-case use.
- `appendRunObservation` appends one canonical JSON line per observation and never rewrites prior lines; a `runId` already present in the file is rejected, `failed`/`aborted` records require `error` text, and `rerunOf` requires `rerunReason`. The frozen type keeps `toolCatalogueSha256`/`promptSha256` as required strings, so a `not-started` run still names them; if that proves too strict the change belongs to a specification revision.

## Checks

```bash
mkdir -p .tmp
node_modules/.bin/tsc -p scripts/benchmarks/tsconfig.json   # nonemitting type check incl. assignability proofs
TMPDIR="$PWD/.tmp" node --import tsx --test test/benchmark-*.test.ts
# includes test/benchmark-types.test.ts, which invokes the TypeScript
# compiler on the config during npm test so the proofs cannot drift silently
```

Integration gates are coordinator-owned. [Development](../../docs/plans/codemode/DEVELOPMENT.md) records actual native policy/Codemode/loader qualification and its limits separately from these library semantics. Paid recording, field-level main usage, calibration, floor/platform and release gates are not established by library tests.
