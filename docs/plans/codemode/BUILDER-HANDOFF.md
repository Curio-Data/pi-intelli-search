# Builder Handoff

This is an acceptance handoff for specification `P0-2`, reviewed at `842c56fc539451c84b2cd8793a3265810a998058`. It does not commission an agent, create a worktree or begin P1. Read [STATUS.md](STATUS.md), `acceptance.json`, [CONTRACT.md](CONTRACT.md) and [ACCEPTANCE.md](ACCEPTANCE.md). The coordinator must first land the matching central type/injection seam descendant; builders then use that descendant carrying the accepted specification.

## Base and Review Integrity

Run `npm run check:codemode-plan` at each builder base. It verifies the final independent report, unchanged frozen bundle and the reviewed commit. Keep that commit reachable when landing the branch: use a history-preserving merge, not a squash/rebase that loses the reviewed object. If an approved landing route rewrites history, coordinate a new exact-commit review/acceptance record before claiming the gate still passes. Do not silently rewrite the report or accepted hash.

Changes to frozen contract/API/checker/corpus/method files require a new specification revision, deliberate manifest regeneration, independent exact-revision review and updated acceptance metadata. Ordinary implementation files and later versioned experiment inputs do not rewrite the P0 bundle. Package script/CI changes follow normal review; they are not themselves frozen specification files.

## Binding Replay Condition

The final independent report, N1, requires:

> a transport-replay implementation must never invoke `options.fetch` or any network primitive. It must replay citations only through recorded `onProviderStreamEvent` chunks, or through a declared non-network tee seam if floor-host replay is ever required.

Quote this condition verbatim into both P3 and coordinator replay briefs. The `options.fetch` supplied by native citation recovery wraps a real network transport; calling it to replay stored frames is not replay. Current native replay targets the host with the provider-event hook. Floor-host fetch-tee recovery remains a separate real compatibility gate; adding floor replay would first require a non-network seam and reviewed scope.

T30's credential-free scripted-main integration proof asserts zero `globalThis.fetch` and zero `wreq` network invocations. In a later replay with the real subscription main, only the explicitly identified main-provider requests are allowed; all pipeline model/page/catalogue network remains forbidden. Do not accidentally block intended main inference or exempt a pipeline request from this guard. A fixture miss invalidates/stops its block; it never opens a live fallback.

## Library Brief Conditions

### P1 Coordinator and Ledger

Own only the assigned libraries/tests. Do not edit central schemas/settings/research wiring. Quote C09–C16 and T09–T16. A model permit's signal reflects its ticket/operation cancellation and runtime close, not page cutoff; active extraction survives cutoff. Only page-fetch permits receive the sticky cutoff abort. Use the authoritative services clock/signal/ledger and deterministic jitter source. No duplicated policy, release-before-backoff violation or abandoned pacing reservation is permitted.

### P2 Run Store and Index

Quote C21–C28 and T21–T28. Each acquisition opens a new dedicated descriptor referring to the same permanent path/inode. Do not share/cache one locked open file description between operations; that defeats same-process conflict detection. Never unlink, rename or truncate the lockfile. Put optional owner diagnostics in a separate bounded atomically written `writer.owner.json`, under the critical section; stale diagnostics are not a held lock and are never used for ownership decisions.

Pin/audit the selected native dependency and its transitives, including the addon resolver and platform assets/legal files. Keep it external in the standalone bundle because prebuild lookup is module-relative. Lazy-load failure is a persistence diagnostic, not server/extension import failure. Complete production installs, native floor and claimed-platform gates before R1; the local primitive probe is not those passes.

Deliver reviewed versioned namespace/reservation/journal/report-marker/accounting-marker/index schemas before R1 integration. Preserve the journal high-water bound and all history; never reset a damaged namespace. Commit outcome and abort linearisation use the frozen union. The existing MCP scan cap fails closed before inference; do not bypass it or implement automatic deletion/retention. Deferred research-history policy/testing is not this library's job.

### P3 Recorder and Analysis

Quote the binding N1 condition above, C29–C32, T29–T32 and the exact corpus/method hashes. Transport replay exercises the real policy and ledger; unit whole-client replacements are not complete replay. Retain repeated-call occurrence identity, sanitised actual requests, all failed/incomplete runs and unknown charges.

Deterministic deadline/contention comparisons use injected-clock core contexts. Replay through actual native wrappers uses real host time and recorded response delays because the native transport seam does not inject a clock. Record these as separate populations; do not call native wall-time replay a virtual-clock experiment. Full native wrapper/bridge replay still verifies response/control/data/accounting flow, not deterministic transport timing. No signature repair is deferred into R2.

## Coordinator and Later Gates

The coordinator owns central type/schema/config/adapter seams, shared research wiring, native generation lifetime and final integration. Keep full native data distinct from compact MCP projection. R1 must pass the temporary R2 wrapper/widget/manual-workflow dry run without a later core/MCP fix. Exact paid tranches, human-checked calibration, independent confirmatory design, live/install/security gates and final code/evidence reviews remain open at their assigned stages.

Use the owner-approved pre-configured encrypted worktrees and supported overrides. Provision tooling by artefact type; no installation through the primary checkout's shared dependency symlink. No credential copies, paid main/judge fallback, live shared-key parallel drivers or package publication is authorised by this handoff.
