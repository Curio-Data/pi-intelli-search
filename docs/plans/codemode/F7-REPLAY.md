# Suggestion Replay Amendment

Amendment revision: `F7-1`, incorporated by specification `P0-3-F7`, C30/T30. Acceptance is recorded separately in [Status](STATUS.md) and `acceptance.json`. The [owner decision](OWNER-DELIVERY-DECISIONS.md#f7-replay-amendment) approves this scope, not implementation or a study. The original `P0-2` bundle remains reachable at `842c56fc539451c84b2cd8793a3265810a998058`; its acceptance evidence is preserved in `history/P0-2/`.

## Scope

Permit only generated cache path/Coordinated Universal Time (UTC) value binding and recorded suggestion-candidate membership/order replay. Shared operation/store/policy/result interfaces, production suggestion policy, corpus inputs/partitions, actual clocks, random identifiers, accounting, native standalone policy and release boundaries remain unchanged. Existing model/fetch fixture formats and generic binding restrictions remain valid; use a new versioned suggestion-view artefact rather than reinterpret historical fixture bytes. The active native method is [METHOD-F7-1.md](../../benchmarks/codemode/METHOD-F7-1.md), selected by `method-authority-F7-1.json` without rewriting the original corpus manifest.

Query, source, code and arbitrary prompt text stay exact. A change outside the two permitted generated leaves or the declared read-view projection is a miss. No wildcard, fuzzy match, live fallback, disabled suggestion stage, fixed clock/run ID or silent serialisation of parallel workflows is permitted.

## Block Identity

Before capture, freeze the forced workflow, exact supported arguments, schedule, logical operation nodes and occurrence order, including all report-producing operations. Each operation has a distinct bounded logical node. Repeated identical operations require explicit submission identity; ambiguous association invalidates the block rather than guessing from completion order. Pin the initial workspace and cache/index tree bytes and freeze the same initial state before each replay. Baseline candidates retain exact paths, times and query metadata.

Observe real allocation and successful publication through a restricted native-only injection, declared in [NATIVE-API.ts](NATIVE-API.ts). Bind a generated run to its logical operation using the operation-start/submission witness and allocation notification, cross-checking exact query and reservation. Publication notification is a dependency witness, not reader verification: only the real verified candidate reader establishes eligibility. An unavailable allocation/publication cannot be replaced by a fabricated report.

## Recorded Candidate Read Views

A read view is the ordered array returned by the real `RunStore.candidates()` for one logical operation/read occurrence, captured before judge formatting, including empty arrays. Recording calls the unmodified reader and returns that exact array. Record query, namespace, compatibility key, start time, report path and available admission sequence for every entry, together with its baseline identity or block-local logical producer. Preserve the raw initial state and real record-side read order. Record all allocated, failed and committed block producers separately.

Replay uses the native controller only at the candidate-read boundary. It may await recorded prerequisite publications, then call the actual verified reader again and select/reorder unique candidate references from that read. The native adapter validates reference membership and uniqueness against the most recent completed read; objects manufactured or changed by the controller reject. Expose immutable candidate records. No writer, lease, ledger, clock, random generator, filesystem bypass or model call is supplied to the controller. Default production installs no controller.

The benchmark controller must establish all of the following before returning a view:

1. Every required block producer has the recorded exact query/occurrence ownership and a successful current publication. Every selected candidate has passed the actual marker/journal/file-hash reader; current path/time values agree with its real allocation and candidate metadata.
2. Every selected baseline entry agrees exactly with the frozen baseline. Every selected block-local entry agrees with its recorded semantic identity and current generated binding. No missing required candidate or duplicate identity is permitted.
3. Differences in visible candidates are limited to declared block-local producers that were not visible at the recorded read instant. Those may be excluded only to reproduce that recorded instant. Unexpected baseline additions/removals/metadata changes and undeclared producers reject. The projection and exclusions are recorded, never hidden as the production reader's output.
4. Selected membership and order equal the frozen logical read view, not whichever array happens to arrive during replay. In particular, do not sort by current UTC or current admission order to obtain a different numbered prompt. The prompt and response parser use this identical selected array.

The recorded view may be narrower than the current live read because a declared sibling committed earlier in replay. It may never be enlarged by an unverified object. If a required candidate is absent because the existing window/grouping hides it, because baseline entries are displaced, or because publication/indexing failed, invalidate the block. Do not bypass the window, synthesise missing baseline entries, change grouping or turn a miss into a smaller successful view. Such limitations remain explicit harness-validity failures, not quality scores or zero charges.

## Dependency Ownership

Record a graph from each candidate read to its required prior block publications. Validate producer existence, unique identities and acyclicity before replay. Run the frozen serial or parallel workflow as declared; only candidate-read visibility waits are permitted. No inference permit or cache lock may be held during a wait. A finite prespecified block budget bounds these waits, alongside operation/block cancellation; expiry invalidates the block and aborts dependent work. Wait listeners, rereads and callbacks are operation-owned and settled before return or runtime replacement. Never detach work to satisfy the budget.

Replay timing includes visibility waits and the projection's instrumentation overhead. Preserve them separately; this read-view technique reproduces response/control/data/accounting flow, not production scheduling or latency. Native transport replay continues to use wall time, distinct from injected-clock deadline experiments. A projection cannot establish speed-up, quality, savings or power.

## Typed Generated-Value Binding

Keep actual dispatched requests unchanged. Before both suggestion-node derivation and request hashing, build one validated benchmark-only representation from the actual message and the selected view:

1. Reproduce the entire expected suggestion message with the existing formatter, exact current query and verified selected candidates. Require byte equality with the actual `userMessage`. Build segment boundaries while formatting; never locate leaves by searching for a captured value or applying a regular expression.
2. Preserve all literal segments exactly, including candidate query strings, delimiters, numbering and any path/time-looking strings authored in query/source/code. For each selected block-local candidate only, represent its generated directory slug and `startedUtc` as typed binding tokens named by logical producer and leaf kind. Tokens are structured values outside the literal-string domain, so authored token-like text cannot collide with them.
3. Derive each bound value from the current verified candidate and its actual allocation. Baseline path/time leaves remain literal. Store original request bytes and the full captured binding map beside the canonical representation. Hash the view, representation, original request and binding metadata in the versioned artefact; load-time validation must reconstruct/check these relationships before serving fixtures.
4. Include the amendment version and ordered logical view identity in the canonical request representation. Preserve every other model request field exactly. Use this same representation for content-derived node resolution and occurrence/request hashing; a hash-only fix leaving node derivation unchanged is invalid.

The generic `RequestBinding` mechanism still forbids binding a whole `userMessage`, `systemPrompt`, URL or source/code string. This is a specialised suggestion formatter representation, not a general permission to rewrite strings. Original raw requests stay auditable. Replaying a stored response never mutates that response to repair source citations or paths.

## Integrity and Failure

A separate `F7-1` suggestion-view artefact binds the workflow/schedule, initial tree digest, producer ownership, each read occurrence/view/dependencies, raw requests, binding maps, canonical representations and referenced transport fixture digests. Whole-file integrity is frozen before replay. Missing, ambiguous, unused-required, foreign, reordered or corrupt entries invalidate the block. Keep failures and unknown costs in append-only observations. A caught supplementary suggestion error must still mark the external replay block invalid and stop it; useful operation output alone does not grant replay validity.

The binding replay condition is unchanged:

> a transport-replay implementation must never invoke `options.fetch` or any network primitive. It must replay citations only through recorded `onProviderStreamEvent` chunks, or through a declared non-network tee seam if floor-host replay is ever required.

Private literal-key pipeline authentication and separately identified main authentication remain required. Auth resolution/refresh, model/page/catalogue transports and auxiliary citation paths stay guarded. No floor-host tee replay is introduced by this amendment.

## Acceptance Proofs

T30 requires positive actual-wrapper/real-Codemode multi-research replay with serial and genuinely overlapping parallel operations, suggestions active, fresh random runs and wall UTC. Exercise three research calls with the frozen development workflow shape, repeated identical calls, empty and nonempty views, baseline plus sibling candidates, current-query exclusion and recorded candidate order that differs from replay arrival order. Corpus development qualification is not a held-out outcome or a study.

Negative proofs cover generated-value corruption, raw query/source/code changes (including text equal to a generated value), node/hash mismatch, unexpected membership, changed order, missing/duplicate/ambiguous producer ownership, invalid dependency graphs, window loss, altered baseline/index, candidate/marker/file corruption, tampered view artefacts, deadline/operation/runtime cancellation during visibility waits and a caught suggestion miss. Prove no callback/reader/writer/permit remains after settlement and no miss reaches pipeline network. Re-run one-research, loader isolation, usage fidelity and native non-activation regressions. Preserve the original two-research failure as historical evidence; do not rewrite it into a pass.

Fresh independent exact-revision technical review and coordinator acceptance in machine-verifiable metadata precede implementation. This specification acceptance is not M3 acceptance. Exact integrated M3 review/acknowledgement precedes its mandatory native live regression. M4–M6, T31 recording conditions, other live scenarios, studies and both separately gated releases remain open.
