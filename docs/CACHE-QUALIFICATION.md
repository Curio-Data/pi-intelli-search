# Cache Qualification

This is engineering qualification of the run store and standalone cache scan on one host, not a performance promise, a study or release acceptance. The full `scripts/qualify-cache-growth.mts` profile exercises production bounds with synthetic data and no provider calls. [Cache and Recovery](CACHE.md) describes operator responses; [Persistence Format](plans/codemode/PERSISTENCE-FORMAT.md) defines the record invariants.

## Source and Evidence

The coordinator run on 23 October 2026 uses [*Linux*](https://kernel.org) x86-64, [*Node.js*](https://nodejs.org) 24.19.0 and local encrypted btrfs. Its retained evidence is `.tmp/m4-growth/qualification/20261023123426-P4131111/`: `environment.json` has Secure Hash Algorithm 256 (SHA-256) digest `b0995a46dd94ae0ea3f3d2cbbe0d131fb874650299df23f895f11969976ca269`; `summary.json` has SHA-256 `176161048c49548aa1ee454098a9494eb33df1938fa4a09853d5876a0dbaa27c`. The environment record pins actual harness, source and lockfile bytes, including uncommitted inputs. These ignored artefacts exist in the retained worktree, not a clean clone. Full-profile datasets remain available alongside the raw observations.

The earlier support run and its failed harness iterations are preserved separately. Corrections concerned the harness's restored synthetic journal, candidate-window expectations and eager runtime scan, not lowered production bounds or a reset of real history. The coordinator rerun completes the full profile without failures.

## Growth Observations

Each row builds a fresh population from one run through the stated count. Medians summarise all calls in that build, not a single call at its final history size. Elapsed values include the build's work and are measured in milliseconds; filesystem cache state and host load are uncontrolled.

| Runs | Total Build | Allocation Median | Commit Median | Index-Update Median | Candidate Read |
|---:|---:|---:|---:|---:|---:|
| 4 | 50.4 | 4.3 | 3.5 | 2.0 | 4.4 |
| 64 | 854.3 | 9.5 | 2.2 | 1.5 | 12.7 |
| 256 | 8,303.3 | 25.6 | 2.4 | 2.6 | 16.8 |
| 1,024 | 112,478.1 | 96.9 | 2.4 | 7.7 | 35.0 |

Allocation validates the existing journal and run identities on every admission. Index publication reads and replaces the whole secondary index. These source behaviours explain why retained history adds work, but this one-host table does not establish a general growth law or a service-level latency bound.

## Size and Scan Boundaries

The structural-boundary fixture produces a committed marker of exactly 16,777,216 bytes with a 16,776,007-byte escape-free query. One additional query byte refuses publication with `MARKER_TOO_LARGE`; the uncommitted directory remains and its sequence is not reused. This is the boundary for that fixture's particular inventory and marker envelope, not a universal maximum query size. Allocation checks the query alone, while publication checks the complete marker. Adapter input bounds can reject a query earlier.

The index-budget population uses queries of 15,727,431 bytes. Its last accepted index contains two smaller marker-probe entries and eight near-limit entries: 128,968,866 bytes against the production 134,217,728-byte ceiling. Further committed reports remain valid while index publication refuses `INDEX_OVERSIZED` and preserves the previous valid index. A candidate read at that boundary takes 988.9 milliseconds on this host. The journal remains only 6,522 bytes, demonstrating that a few large queries exhaust the index budget well before the journal ceiling.

An already oversized index is a different case: the reader withdraws new-format suggestions and still serves valid legacy candidates. Every explicit rebuild attempt first preserves the existing index, even when the rebuilt index then exceeds the ceiling. Repeated refused attempts therefore add another full index copy each time; do not retry them as a recovery loop.

The physical scan includes the cache root. Exactly 100,000 total entries pass; one additional entry fails. The accepted scan takes 1,060.1 milliseconds on this host. Both runtime construction and a later operation fail with `WORKSPACE` at the over-limit population, before the denied transport receives any catalogue or inference call. The populated tree includes legacy, staging, committed, uncommitted and orphan entries; no replacement scanner is used.

## Isolation and Recovery Proofs

- Repeated corrupt-index reads preserve the corrupt bytes and rebuild candidates only in memory. A later real writer preserves a corrupt copy and repairs the secondary index. A valid-but-incomplete index is not corruption and does not self-heal; an explicit `rebuildRunIndex()` under the stable lock restores its catalogue.
- Independent processes run the old writer module from tag `pi-v0.19.0`, exact commit `17fccb388d2016fe46aab91521711197522e502a`, and the current writer on one cache parent. Their metadata stays isolated by namespace. Mixed readers resolve both formats without changing legacy files. This is a writer-module process test, not a session through an installed older host.
- A partial journal tail, missing journal and broken chain refuse publication without changing retained history or reusing numbering. A second process holding the stable lock blocks secondary rebuilding; rebuilding after release preserves the old index and reports, rather than deletes, an orphan directory.
- Both explicit offline choices in the operator guide are exercised: leave the old cache in place and select a new `cacheDir`, or rename the complete stopped cache within the same filesystem before creating a fresh cache at the original path. The preserved namespace remains byte-identical and its lock inode survives. New namespaces have distinct identities and begin at sequence one; neither procedure repairs or continues the old allocation history.

Byte witnesses exclude only `writer.owner.json`, the per-acquisition operational diagnostic. They include journal, reservation, report, marker, index, orphan and other retained bytes. No individual lock-file replacement, automatic history reset, retention feature or inference is part of these drills.

## Reproduction and Limits

Run from a source checkout with development dependencies and the pinned old-writer tag available. The default profile is a small deterministic check; it is not the full qualification.

```bash
node --import tsx scripts/qualify-cache-growth.mts
node --import tsx scripts/qualify-cache-growth.mts \
  --profile full
```

The first command prints the plan without executing it. The full command creates fresh evidence below `.tmp/m4-growth/`, retains its datasets and records exact input hashes. It refuses an existing evidence directory rather than overwriting a prior run. Child completion includes standard-stream closure before logs are finalised.

The measurements do not verify *macOS*, *Windows*, network or overlay storage, power-loss durability, hostile concurrent filesystem replacement, slow or unresponsive filesystems, live providers or long-term retained histories. Public packages expose no journal-repair or index-rebuild command. The internal source-checkout rebuild was qualified here; it does not invent a supported end-user deep-import interface. Unknown allocation history still requires explicit operator investigation, not reconstruction from the index.
