# Codemode P0-2 Amendment Review (cm-p0-opus-r2)

Reviewer: `claude-opus-5-5[1m]` through *Claude Code*, acting as an independent Reviewer under brief `.tmp/agents/codemode-p0-review/briefs/cm-p0-opus-r2.md`. Review date: 2026-10-18. This review follows my P0-1 review of `7fafa5275f4a38e236bf94a50069c50c29ca1eb2` (`.tmp/agents/codemode-p0-review/reports/cm-p0-opus.md`).

Reviewed commit: `842c56fc539451c84b2cd8793a3265810a998058` (`HEAD` of `feat/codemode-research` at review time; no tracked changes in the worktree, only the untracked `node_modules`). Observed.

Scope: the diff `7fafa52..842c56f` and the final committed content of every changed or added file. That covers CONTRACT, API, NATIVE-API, consumer, ACCEPTANCE, STATUS, LOCK-EVIDENCE, REVIEW-DISPOSITIONS, SPECIFICATION-SHA256SUMS, `acceptance.json`, the checker, `ci.yml`, `package.json`, the renamed `docs/benchmarks/METHOD.md`, the method files and the manifest. I also checked their immediate interactions with unchanged clauses and with current source. My P0-1 analysis of unchanged clauses still stands, except where noted below.

Claim tags: **Observed**, **Stated**, **Inferred**, **Assumed**, **Unknown**.

## Verdict

VERDICT: ACCEPT

I accept P0-2 at exact commit `842c56fc539451c84b2cd8793a3265810a998058` as the frozen contract, interface, corpus and method revision for briefing builders. Both P0-1 blockers are resolved in the committed text and signatures. M1 to M6 are addressed. I found no new blocker.

Four new findings (N1 to N4) and several low ones remain. None requires a signature change. N1 is a binding condition: it must be quoted into the P3 and coordinator replay briefs, because otherwise replay could make a live network call. The rest are wording or later-stage obligations.

This acceptance covers the contract freeze only. It does not cover runtime cancellation, publication crash safety, lock packaging or platform support, replay integration, the live suite or any benchmark. Those remain the assigned P1 to P8 gates, as STATUS, ACCEPTANCE and LOCK-EVIDENCE say themselves.

## Checks Performed

| Check | Result | Basis |
|---|---|---|
| `node scripts/check-codemode-plan.mjs` (plain) | Exit 0 | Observed; `.tmp/agents/codemode-p0-review/work/cm-p0-opus/check-r2.log` |
| `node scripts/check-codemode-plan.mjs --require-accepted` | Exit 1: `'pending'` is not `'accepted'` at `check-codemode-plan.mjs:113` | Observed; `check-r2-strict.log`. This failure is intended while acceptance is pending (STATUS, Acceptance Record). It also confirms the strict gate does not pass vacuously. |
| `node_modules/.bin/tsc -p docs/plans/codemode/tsconfig.json` | Exit 0, no diagnostics. This covers `NATIVE-API.ts` through the consumer, including both `@ts-expect-error` guards (an enabled deadline with missing numbers, and transport replay combined with `operations`). | Observed; `tsc-r2.log` |
| Coordinator gate logs (`.tmp/codemode-p0-evidence/gates-r2/`) | `exits.tsv` lists exit 0 for build-all, test-all, native-contract-types, toc, readmes, plugins, checker-syntax and audit. The test-all tail shows 46 pass and 0 fail. `plan.log` shows the checker passing. | Observed (logs read); Stated that they ran against this content. All were written between 15:31:00 and 15:31:29, and the commit time is 15:31:29. `exits.tsv` has no rows for `plan` and `api-types`, although their logs exist (see L4). I re-ran those two myself. |
| `fs-native-extensions` tarball integrity | The `sha512` of the retained `package.tgz` equals the integrity value in `registry.json` and in LOCK-EVIDENCE. | Observed (computed with `openssl dgst -sha512`) |
| Live registry | `npm view fs-native-extensions@1.5.1` (cache in my scratch, no credentials): the integrity matches, `latest` is `1.5.1`, and it was published 2026-08-31T05:36:49Z. | Observed, live source, 2026-10-18 |
| Distributed native source | Linux `fcntl(fd, F_OFD_SETLK, …)` with `l_len = 0` (whole file), `src/linux.c:22-35`. macOS `flock(… LOCK_EX \| LOCK_NB)`, `src/apple.c:15-18`. Windows `LockFileEx` with `LOCKFILE_FAIL_IMMEDIATELY` and length 0 mapped to `SIZE_MAX`, `src/win32.c:14-38`. Contention is normalised to `EAGAIN`, `src/shared.c:15`. `index.js` `tryLock()` returns false on `EAGAIN`. | Observed (retained extracted package) |
| Kernel primitive probe | `kernel-lock-result.json` reports all five checks true and `runtimeFeatureAcceptance: false`. The script opens `writer.lock` with `'a+'` (no truncation), uses separate descriptors and 8 cooperating worker processes appending to a journal, kills the holder with `SIGKILL`, and checks the inode is unchanged. | Observed (script and result read; not re-run) |
| Full build, suites, live E2E, installs, paid calls | Not run | Prohibited by the brief |

## Resolution of P0-1 Findings

| P0-1 Finding | Amendment Observed at `842c56f` | Assessment |
|---|---|---|
| B1: no per-page or discovery fetch cancellation | `FetchScope { pageId?, signal? }`; `acquireFetch(scope?)`; `Permit.signal`; `FetchClient.fetch(…, scope?)`; `discover(…, signal)`. `cutoffPages()` is now sticky and aborts only active page-fetch permit signals (API.ts:58-72, 37-42, 317-335). C09 states that the operation signal stays live for collation, commit and accounting, and that discovery has its own controller. `PageTransportRequest.signal` carries the permit signal to the transport. | **Resolved.** The interface now provides independent cancellation paths, and it does not abort active extraction. `wreq-js` accepts the per-request signal (`wreq-js.d.ts:274`, Observed in round 1). |
| B2: manual-only lock recovery and whole-namespace quarantine | C25 now selects `fs-native-extensions` 1.5.1 with nonblocking `tryLock`/`unlock` on a permanent regular file. Release is automatic on descriptor or process death, with no unlink, rename, truncation, age or PID fallback. Whole-namespace quarantine is forbidden. Journal repair is separate. The lazy-loaded binding falls back to non-persisted answers. Packaging, platform and floor gates are assigned before R1. | **Resolved.** The inconsistency is removed. The baseline's automatic crash recovery is restored without an eviction race. No owner acknowledgement is needed now, because the user-visible regression no longer exists. |
| M1: commit failure mode | `commit()` returns a committed or unavailable union. C22 sets the linearisation point: abort before the marker rename publishes nothing; abort after it keeps the committed run. | Resolved |
| M2: replay above the policy | `NATIVE-API.ts` adds a discriminated `NativeTestInjection` whose `transport-replay` mode requires `registryStreamSimple` and `pageTransport` and forbids `operations` and `transformContext` (enforced by the type guard). `RegistryStreamSimple` matches the current `__harness.registryStreamSimple` signature (`src/llm.ts:67-78`, Observed). | Resolved, subject to N1 |
| M3: duplicate authorities in `Context` | `Context` now omits `signal`, `now`, `random` and `onProgress`. C10 names the authoritative members of `services` and requires scope and ledger identity to be asserted. `PolicyHooks.random` is added. | Resolved |
| M4: undocumented acceptance mechanism | The acceptance artefacts are named in STATUS and ACCEPTANCE. The strict gate is in `package.json` (`check:codemode-plan`) and in CI with `fetch-depth: 0`. `SPECIFICATION-SHA256SUMS` hashes the bundle. The checker requires `VERDICT: ACCEPT`, the exact commit and `STATUS: COMPLETE` in `REVIEW.md`. | Resolved; see L3 |
| M5: cutoff stickiness | API.ts:62 comment, C09 and the `AdmissionError` `PAGE_CUTOFF` code | Resolved |
| M6: MCP scan cap | C28: an explicit fail-closed workspace error before inference; no bypass and no automatic deletion; tested at the boundary | Resolved as a declared limitation with a test obligation |
| L1, L2, L3, L4, L5, L6, L7 | Covered by reservation filename and hash canonicalisation; P2 schema deliverable; `minimum` reason with its mapping in C08 step 8; `PolicyHooks.random`; "once per policy invocation"; `tuning.execution`; stage and decision references in C02; TTL replaced; H1 population disclosed in `METHOD.md` | Resolved. MCP config currently has a `tuning` root (`packages/mcp/src/config.ts:252-264`, Observed), so `tuning.execution` fits the existing shape. |
| L8 housekeeping | Deferred to P4b | Acceptable |

## New Findings

### N1 Replay Through the Fetch-Tee Hook Could Make a Live Call (Medium, Binding Condition)

C30 says transport replay should "Replay recorded provider events/fetch-tee frames through the supplied citation hooks", and "misses … never fall back live". The `SimpleStreamOptions` that native `callLlm()` passes into `registryStreamSimple` contains two citation channels:

- `onProviderStreamEvent`, a pure callback.
- `fetch`, which is `wrapFetchForAnnotations(globalThis.fetch.bind(globalThis), annotations)` (`src/llm.ts`, the attempt body near line 200; Observed).

A replay transport that "replays fetch-tee frames" by calling `options.fetch` would therefore issue a real network request through `globalThis.fetch`. No signature in NATIVE-API.ts prevents it (Inferred). The replay host is `Pi` 1.3.0, where `onProviderStreamEvent` is available, so feeding recorded chunks only through that hook is sufficient. The fetch-tee fallback matters only on hosts older than `pi-ai` 0.99.

**Condition for the P3 and coordinator briefs:** a transport-replay implementation must never invoke `options.fetch` or any network primitive. It must replay citations only through recorded `onProviderStreamEvent` chunks, or through a declared non-network tee seam if floor-host replay is ever required. T30 should assert zero `globalThis.fetch` and zero `wreq` invocations during a replay block. No signature change is needed.

### N2 Lock Wording: "Same Stable Lock Inode/Handle" (Low)

C25 says "Open the same stable lock inode/handle for every acquisition", but also that each acquisition closes its descriptor in `finally`. A handle cannot be the same across acquisitions; the invariant is the same path and inode. Reword it as "the same path and inode" to avoid a builder caching one long-lived descriptor across operations. That would serialise all operations onto one open file description and defeat OFD conflict detection between in-process `RunStore` instances. This is Inferred from OFD semantics: locks taken twice through the same description do not conflict.

### N3 Location of Owner Metadata (Low)

C25 forbids truncating the lock path, yet allows owner metadata "written only while ownership is held" without saying where. If it is written into `writer.lock`, variable-length rewrites without truncation leave stale trailing bytes. On *Windows*, the whole-file `LockFileEx` range (`SIZE_MAX`) is a mandatory lock, so other processes cannot read the diagnostic while it is held (Inferred from `src/win32.c:14-38`; Windows is unverified, as the contract says). P2 should place metadata in a separate file inside the owned critical section, or write a fixed-size record.

### N4 Native Factory Has No Clock Injection (Low)

`createNativeExtension(injection?)` accepts transports but no `Clock`. Replay through native wrappers therefore runs on real time, with `FixtureRecord.delayMs` honoured in wall-clock terms. The deadline method's "injected scheduler for deterministic comparison" is then achievable only at the core `Context` level (`services.clock`), not through the native wrapper path (Inferred). The deadline method should state which population each comparison uses. Alternatively, the coordinator's seam descendant can add an optional clock to the unit mode. This is not needed for P1 or P2.

## Low Findings

- **L1 Transitive Pinning.** `fs-native-extensions` depends on `require-addon` `^1.1.0` and `which-runtime` `^1.2.0`, and the probe install also pulled in `bare-addon-resolve`, `bare-module-resolve` and `bare-semver` (Observed, `lock-dependency/probe/node_modules`). C25 pins the direct version only. The production lockfile pins and audits these during P2/R1. Add the transitives explicitly to the dependency and legal inventory. `require.addon('.', __filename)` resolves prebuilds relative to the module file, so the standalone esbuild bundle must keep the package external (Inferred from `binding.js`). C25's "external/asset/legal inventory" covers this.
- **L2 Model Permit Signal.** `Permit.signal` is defined by C09 for fetch permits only. State that a model permit's signal reflects ticket or operation cancellation and runtime close, and is never aborted by `cutoffPages()`.
- **L3 Acceptance Immutability.** With `--require-accepted` in CI, any later edit to a bundled file (CONTRACT, API, NATIVE-API, ACCEPTANCE, LOCK-EVIDENCE, consumer, checker, corpus, methods) fails CI until a new revision is reviewed and `acceptance.json` updated. That is intended. STATUS, however, documents only "new versioned files" for corpus and method expansions, not the amendment procedure for the contract itself. Two more points: CI resolves `reviewedCommit` from fetched history, so the branch must reach `main` by a merge commit, not a squash (the repository's recent history uses merge commits; Observed `git log --merges`). Also, `package.json`'s script and `ci.yml` are outside the hashed bundle.
- **L4 Gate Provenance.** `gates-r2/exits.tsv` omits the `plan` and `api-types` rows that the P0-1 table had. Their logs exist, and my re-runs passed. Record them for a complete evidence manifest.
- **L5 Research Page Retention.** This is in unchanged text that I did not raise in round 1. `FetchClient.fetch` returns `SourceRecord.content` in memory, and the `fetch` call takes no staging root, so spooling under C19 happens after return. Retention stays bounded by the per-run logical page limit and `fetchMaxChars`. C19 can be met as written; P4 should simply not assume `FetchClient` spools.
- **L6 Prose Density.** The new C09, C22 and C25 text continues the dense slash-chain style noted in round 1. The mechanics pass: no em dashes, no second person, title-case headings, no stale `README.md` method links (Observed with `rg`). Builders under pressure would benefit from splitting C25 into acquisition, release, failure and packaging sentences. This is not a gate.

## Verified Claims

| Claim | Location | Result | Basis |
|---|---|---|---|
| Linux uses OFD locks, so separate descriptors in one process conflict and closing an unrelated descriptor does not release | C25, LOCK-EVIDENCE | Source uses `F_OFD_SETLK`; the probe observed both behaviours | Observed (source and probe result) |
| The kernel releases the lock after `SIGKILL` with the inode unchanged | C25 | Probe observed | Observed (result file); not re-run; Linux x86-64, Node.js 24, encrypted btrfs only |
| The blocking wait API exists but is not used | C25 | `waitForLock` and `waitForLockSync` exist in `index.js`; the contract selects only `tryLock` with 25 ms polling | Observed |
| macOS and Windows behaviour | C25 | Source branches only | Unknown at runtime; correctly labelled unverified in C21 and LOCK-EVIDENCE |
| The replay seam matches the existing native transport double | NATIVE-API.ts:11-16; `src/llm.ts:67-78` | Same parameter and return shapes | Observed |
| Removing `signal`, `now` and `random` from `Context` | API.ts:403 | Compiles; the consumer uses `services` | Observed (tsc) |
| The native addon is a new class of dependency | C25 | It is not: `wreq-js` is already a native runtime dependency | Observed (`package.json` dependencies, round 1) |

## Owner-Scope Fidelity

The owner decisions are unchanged and are still reflected exactly (C03, C15, C18, C26, C27, C31, C32; compared in round 1, with the unchanged text re-read here). The amendment adds no history policy, cap, retention utility, paid call or release. The new runtime dependency is an engineering selection with production gates, not an owner policy question. It replaces a design that would have needed owner acknowledgement. Observed.

## Unexamined Areas

- Kernel-probe re-execution and probes on other platforms. Not run: the brief limits me to small probes, and the coordinator owns this evidence. Next step: P2 independent-process and crash tests, then R1 platform and tarball gates.
- Private checkpoint manifest coverage of the lock evidence. Stated by LOCK-EVIDENCE, not checked.
- `REVIEW-DISPOSITIONS.md` and `STATUS.md` are not in the hashed bundle. They are mutable acceptance records by design, and I reviewed them only for accuracy against the diff. They are accurate.

## Required Next Steps

1. Coordinator: record this report as `docs/plans/codemode/REVIEW.md`, and fill `acceptance.json` with `reviewedCommit` `842c56fc539451c84b2cd8793a3265810a998058`, the reviewer model, the report hash, the bundle hashes and the coordinator decision. Make that a later commit that changes no bundled file, then run `npm run check:codemode-plan` to exit 0.
2. Quote N1 as a binding condition in the P3 and coordinator replay briefs. Carry N2 and N3 into the P2 brief and N4 into the deadline-method owner's brief.
3. Land the type-only central seam descendant before commissioning builders, as C02 requires.

STATUS: COMPLETE
