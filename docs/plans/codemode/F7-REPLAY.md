# Suggestion Replay Amendment

Amendment revision: `F7-1`, incorporated by specification `P0-3-F7`, C30/T30. Acceptance is recorded separately in [Status](STATUS.md) and `acceptance.json`. The [owner decision](OWNER-DELIVERY-DECISIONS.md#f7-replay-amendment) approves this scope, not implementation or a study. The original `P0-2` bundle remains reachable at `842c56fc539451c84b2cd8793a3265810a998058`; its acceptance evidence is preserved in `history/P0-2/`.

## Scope

Permit only generated cache path/Coordinated Universal Time (UTC) value binding and recorded suggestion-candidate membership/order replay. Shared operation/store/policy/result interfaces, production suggestion policy, corpus inputs/partitions, actual clocks, random identifiers, accounting, native standalone policy and release boundaries remain unchanged. Existing model/fetch fixture formats and generic binding restrictions remain valid; use a new versioned suggestion-view artefact rather than reinterpret historical fixture bytes. The active native method is [METHOD-F7-1.md](../../benchmarks/codemode/METHOD-F7-1.md), selected by `method-authority-F7-1.json` without rewriting the original corpus manifest.

Query, source, code and arbitrary prompt text stay exact. A change outside the two permitted generated leaves or the declared read-view projection is a miss. No wildcard, fuzzy match, live fallback, disabled suggestion stage, fixed clock/run ID or silent serialisation of parallel workflows is permitted.

## Block Identity

Before capture, freeze the forced workflow, exact supported arguments, schedule, logical operation nodes and occurrence order, including all report-producing operations. Each report-producing operation has a distinct bounded logical node. Bind ownership by exact query uniqueness among simultaneously active report-producing operations. Serial repeated research queries use a frozen occurrence order, with the preceding operation settled before the next starts. Overlapping identical research or collation queries in one block are unsupported under F7-1 and invalidate it. T30's repeated identical calls cover model-request occurrences and serial repeated research; they do not claim parallel identical-research association. Ambiguous association invalidates the block rather than guessing from completion order. Pin the initial workspace and cache/index tree bytes and freeze the same initial state before each replay. Baseline candidates retain exact paths, times and query metadata.

Observe real allocation and successful publication through a restricted native-only injection, declared in [NATIVE-API.ts](NATIVE-API.ts). Bind a generated run to its logical operation by its exact unique query or serial occurrence and allocation notification, cross-checking the reservation. The `indexed` notification fires only after the real `updateIndex` resolves `"updated"`, not after `commit` alone. It is a dependency witness, not reader verification: only the real verified candidate reader establishes eligibility. Record successful commit separately from index visibility. An unavailable allocation, commit or index invalidates dependent reads immediately through the `unavailable` notification. Native operation failure before that notification is observable through the actual host's settled tool-result/error event; the harness must correlate that event to the unique query or serial submission and invalidate dependent reads. Neither an unavailable producer nor a missing event is replaced by a fabricated report; the finite block budget remains the fail-closed backstop.

## Recorded Candidate Read Views

A read view is the ordered array returned by the real `RunStore.candidates()` for one logical operation/read occurrence, captured before judge formatting, including empty arrays. Recording calls the unmodified reader and returns that exact array. Record query, namespace, compatibility key, start time, report path and available admission sequence for every entry, together with its baseline identity or block-local logical producer. Preserve the raw initial state and real record-side read order. Record all allocated, failed, committed and index-visible block producers separately, using the notifications and settled host events above. A synchronous notification exception must mark the external replay block invalid; the native adapter contains that exception, poisons subsequent controller reads and preserves the store write's actual outcome. No callback error may roll back a committed report or turn an unavailable index into success. Snapshot every nested controller function identity at factory capture, before registration or any await, and reject unknown or non-function members.

Replay uses the native controller only at the candidate-read boundary. It may await recorded prerequisite publications, then call the actual verified reader again and select/reorder unique candidate references from that read. The native adapter validates reference membership and uniqueness against the most recent completed read; objects manufactured or changed by the controller reject. Expose immutable candidate records. No writer, lease, ledger, clock, random generator, filesystem bypass or model call is supplied to the controller. Default production installs no controller.

The benchmark controller must establish all of the following before returning a view:

1. Every required block producer has the recorded exact query/occurrence ownership and a successful current publication. Every selected candidate has passed the actual verified reader for its namespace; new-format candidates require marker, journal and file-hash verification, while legacy candidates retain their accepted legacy verification; current path/time values agree with its real allocation and candidate metadata.
2. Every selected baseline entry agrees exactly with the frozen baseline. Every selected block-local entry agrees with its recorded semantic identity and current generated binding. No missing required candidate or duplicate identity is permitted.
3. Differences in visible candidates are limited to declared block-local producers that were not visible at the recorded read instant. Those may be excluded only to reproduce that recorded instant. Unexpected baseline additions/removals/metadata changes and undeclared producers reject. The projection and exclusions are recorded, never hidden as the production reader's output.
4. Selected membership and order equal the frozen logical read view, not whichever array happens to arrive during replay. In particular, do not sort by current UTC or current admission order to obtain a different numbered prompt. The prompt and response parser use this identical selected array.

The recorded view may be narrower than the current live read because a declared sibling committed earlier in replay. It may never be enlarged by an unverified object. If a required candidate is absent because the existing window/grouping hides it, because baseline entries are displaced, or because publication/indexing failed, invalidate the block. Do not bypass the window, synthesise missing baseline entries, change grouping or turn a miss into a smaller successful view. Such limitations remain explicit harness-validity failures, not quality scores or zero charges.

## Dependency Ownership

Record a graph from each candidate read to its required prior block publications. Validate producer existence, unique identities and acyclicity before replay. Run the frozen serial or parallel workflow as declared; only candidate-read visibility waits are permitted. No inference permit or cache lock may be held during a wait. A finite prespecified block budget bounds these waits and fits within the enclosing script budget. Operation cancellation, block cancellation or expiry of any enclosing budget invalidates the block and aborts dependent work. Wait listeners, rereads and callbacks are operation-owned and settled before return or runtime replacement. Never detach work to satisfy the budget.

UTC-date grouping and current-query exclusion remain real reader behaviour. A date-dependent baseline membership change or a block crossing UTC midnight invalidates the block if it prevents the frozen view from being verified; never bind compatibility keys or change dates to repair it. Prespecify schedules that avoid midnight crossings and preserve any invalidation/rerun reason in append-only records.

Replay timing includes visibility waits and the projection's instrumentation overhead. Preserve them separately; this read-view technique reproduces response/control/data/accounting flow, not production scheduling or latency. Native transport replay continues to use wall time, distinct from injected-clock deadline experiments. A projection cannot establish speed-up, quality, savings or power.

## Typed Generated-Value Binding

Keep actual dispatched requests unchanged. Before both suggestion-node derivation and request hashing, build one validated benchmark-only representation from the actual message and the selected view:

1. Use a benchmark-side segment builder that mirrors the existing formatter template at the registered `src/core/research-result.ts` `suggestions()` call site. Its rendering must equal both `formatIndexForJudge(index, "")` with the exact current query prefix and the complete actual `userMessage`, byte for byte. Production formatter code is unchanged. Build segment boundaries in that builder; never locate leaves by searching for a captured value or applying a regular expression.
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

T30 requires positive actual-wrapper/real-Codemode multi-research replay with serial and genuinely overlapping parallel operations, suggestions active, fresh random runs and wall UTC. Exercise three research calls with the frozen development workflow shape, repeated identical model-request occurrences, serial repeated research, empty and nonempty views, baseline plus sibling candidates, current-query exclusion and recorded candidate order that differs from replay arrival order. Parallel report producers require unique exact queries, as defined above. Corpus development qualification is not a held-out outcome or a study.

Negative proofs cover each independent invalidation condition:

- Corrupt generated values, raw query/source/code changes (including text equal to a generated value), or inconsistent node and request-hash representations.
- Unexpected membership, changed recorded order, missing or duplicate producer ownership, ambiguous association, or overlapping identical report-producing queries.
- Invalid dependency graphs, failed producer notifications, premature index-visibility signalling, window loss, or an altered baseline or index.
- Candidate, marker or file corruption; tampered view artefacts; or notification exceptions that were caught without invalidating the block.
- Deadline, operation or runtime cancellation during visibility waits, or a suggestion miss caught by supplementary-stage error handling. Prove no callback/reader/writer/permit remains after settlement and no miss reaches pipeline network. Re-run one-research, loader isolation, usage fidelity and native non-activation regressions. Preserve the original two-research failure as historical evidence; do not rewrite it into a pass.

Fresh independent exact-revision technical review and coordinator acceptance in machine-verifiable metadata precede implementation. This specification acceptance is not M3 acceptance. Exact integrated M3 review/acknowledgement precedes its mandatory native live regression. M4–M6, T31 recording conditions, other live scenarios, studies and both separately gated releases remain open.
