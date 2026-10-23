# Cache and Recovery

This guide describes the run cache that the registered `intelli_research` and `intelli_collate` tools write in both packages, how a reader decides that a saved run is valid, and the non-destructive operator responses to persistence diagnostics. It covers the native `Pi` extension and the standalone Model Context Protocol (MCP) server. The [README Cache Structure](../README.md#cache-structure) summarises the layout; [Architecture](ARCHITECTURE.md#cache-structure) explains the design.

Every procedure here preserves existing reports, allocation history and incomplete runs. No step deletes a run, edits the allocation journal or removes the lock file. The packages provide no automatic retention, compaction or history reset, and no packaged command that validates a journal or rebuilds the index. The procedures are derived from the source behaviour; they have not been exercised end to end as a recovery drill.

## Layout

Current tools write each run once, into its own new directory below `<cacheDir>/.intelli-v1/`. The default `cacheDir` is `.search`. Older releases wrote directly below `<cacheDir>/`; those legacy directories remain where they are and are only read.

```text
.search/
├── .intelli-v1/                     # Run namespace written by current tools
│   ├── namespace.json               # Namespace identity
│   ├── allocations.ndjson           # Append-only allocation journal
│   ├── writer.lock                  # Permanent lock file; never delete
│   ├── writer.owner.json            # Diagnostic owner record only
│   ├── index.json                   # Secondary suggestion index
│   └── runs/
│       └── 2026-10-22-d1-worker-api-limits-<nonce>/
│           ├── reservation.json     # Admission record
│           ├── committed.json       # Report marker
│           ├── report.md
│           ├── query.txt
│           ├── run.json             # Source states and provenance
│           ├── extractions/S1.md
│           ├── sources/P1.md
│           ├── sources/llms-full-D1.md
│           ├── late/S4.md           # Late extraction, not evidence
│           ├── accounting.json
│           ├── accounting.committed.json
│           └── meta.json            # Optional local telemetry
├── .staging/                        # Private page staging during runs
├── .index.json                      # Legacy index, read only
└── 2026-04-19-d1-worker-api-3f7a2c/ # Legacy run, read only
```

The run directory name is a display label followed by a nonce of 32 hexadecimal characters. The label is the Coordinated Universal Time (UTC) date of the run plus up to five lowercase query words; it is descriptive, not an ownership proof. Exclusive directory creation, not the label or nonce, makes each directory belong to one operation. A repeated query on the same day creates a new directory: nothing is rotated, archived to a numbered sibling or replaced.

When allocation succeeds, research reserves its directory before search; manual collation does so once its input passes validation. A saved research run holds every file shown above that applies to it. Manual collation writes the same structure without documentation downloads, late files or telemetry; caller-supplied full pages appear under `sources/`, numbered in input order.

The tool result and the report's Source Assessment table give the exact path of each extraction and each full page paired with a source. Research documentation downloads (`sources/llms-full-<id>.md`) and caller-supplied full pages whose URL matches no collated source are listed only in the run's `run.json`, under `documents` and `suppliedPages`. Read `run.json` only from a valid run, and take paths from it rather than guessing filenames.

## Valid Runs

A run is valid only when `committed.json` exists and agrees with the journal, `reservation.json` and every file it lists, including each file's length and Secure Hash Algorithm 256 (SHA-256) digest. The marker is written last, by an atomic rename, after every listed file has been written and synced. A directory without a valid marker is not a report, however complete it looks, and no tool advertises or suggests it.

Accounting has its own marker. `accounting.committed.json` verifies `accounting.json`, which is written at most once; a failure to write either leaves the committed report valid. `meta.json` is written after both markers and is not verified by either.

`index.json` is a secondary catalogue used only to choose related-search candidates. It never decides whether a run is valid, and every suggested run is verified against its marker first.

## What a Result Reports

A completed answer is returned even when it cannot be saved. The result text then ends with `Persistence unavailable (<code>): <message>`, and `details.cachePath` is empty. When the report is saved, the text names its `report.md` path and `details.cachePath` names the run directory.

Degraded research (`no-links`, `fetch-failed`, `extraction-failed`) publishes no report and returns an empty `details.cachePath`. When its allocation succeeded, the run directory reserved at the start remains with its `reservation.json` and, unless telemetry is disabled, a `meta.json` describing the failed attempt. The result does not name that directory. Its full data reports persistence as `not-requested`, which describes the unpublished report rather than the reservation. When allocation itself failed, the degraded result also ends with `Persistence unavailable (<code>): <message>`.

A cancelled call, a thrown failure and a collation whose model call fails return no saved report either. Any directory already reserved for them remains as an [incomplete run](#incomplete-runs).

Related-search suggestions run on degraded outcomes as well as completed ones, so a degraded run can make one extra suggestion model call. The suggestion window holds at most 20 candidates. It considers valid current runs and legacy reports, excludes the current query's date and query key, and never rewrites a legacy index or directory.

## Concurrent Writers

All current writers on the same cache share `writer.lock`. The lock is held by the operating-system kernel through an open file description, so a crashed or killed process releases it automatically. The file's existence, age or `writer.owner.json` content does not show that a lock is held, and no stale-lock cleanup step exists. The lock file is created once and then reused; deleting or replacing it would let two writers lock different files, and a writer that finds the file replaced reports `LOCK_INODE_CHANGED`.

A writer takes the lock briefly for allocation, publication, the index update and accounting, and waits up to 2,000 milliseconds for it. Parallel research calls in one native session, parallel MCP operations and separate processes on the same cache all contend for it. Under heavy parallel load the wait can expire with the diagnostic `LOCK_BUSY`. During allocation or publication, the answer is then returned without a saved report; during the index or accounting update, the report stays saved and the diagnostic says so. Network, model and page work never run under the lock.

On *Linux*, a held lock appears in `/proc/locks` against the lock file's inode. The following read-only check prints a line while any process holds the lock and prints nothing otherwise:

```bash
grep ":$(stat -c %i .search/.intelli-v1/writer.lock) " /proc/locks
```

The check matches the inode number only, not the device, so a line can also come from an unrelated file with the same inode number on another device. Open-file-description locks record no owning process: the process column reads `-1`, and `lslocks` cannot name the holder.

## Diagnostics and Responses

The diagnostic code appears in the result text and in host diagnostics. Each response below preserves the answer already returned and every existing file.

| Code | Meaning | Response |
|---|---|---|
| `LOCK_BUSY` | Another writer held the lock for 2,000 milliseconds | Repeat the research later only when a saved report is required; a repeat incurs provider charges again. If it persists with no research running, run the lock check above and stop the remaining processes that use this cache |
| `LOCK_UNSUPPORTED`, `DURABILITY_UNAVAILABLE` | The storage rejects the kernel lock or a required file or directory sync | Select a `cacheDir` on local storage. Network, overlay and remotely shared filesystems are unverified |
| `LOCK_BACKEND_UNAVAILABLE` | The native lock module could not load on this platform or installation | Persistence is unavailable until the installation provides the module; answers are still returned |
| `LOCK_NOT_REGULAR`, `LOCK_INODE_CHANGED` | `writer.lock` is not a regular file, or was replaced while a writer held it | Stop every process that uses the cache, then follow [Damaged Allocation History](#damaged-allocation-history). Do not delete or recreate the lock file |
| `LOCK_IO`, `JOURNAL_IO`, `NAMESPACE_IO`, `RESERVATION_IO`, `RUN_DIR_IO`, `PUBLICATION_IO`, `ALLOCATION_IO` | A filesystem operation failed | Check permissions, free space and the named path |
| `MARKER_DURABILITY_UNPROVEN` | The report was committed, but the directory sync after publication failed | The report is valid; its survival across power loss is not established |
| `JOURNAL_DAMAGED`, `JOURNAL_MISSING`, `NAMESPACE_MISSING`, `NAMESPACE_INVALID`, `RUNS_MISSING`, `RUNS_INVALID`, `RUN_IDENTITY_CONFLICT`, `JOURNAL_HISTORY_CONFLICT` | Allocation history is damaged or unknown. No run can be saved until it is resolved | Follow [Damaged Allocation History](#damaged-allocation-history) |
| `UNJOURNALLED_RUN` | `runs/` contains an entry with no journal record | When the message names a stray file or link, stop every process that uses the cache, confirm it is not run evidence, then move it unchanged to a location outside the cache, as the message directs. Never move a run directory. When the message names a directory with content, follow [Damaged Allocation History](#damaged-allocation-history) |
| `JOURNAL_CEILING`, `JOURNAL_RECORD_TOO_LARGE`, `SEQUENCE_EXHAUSTED` | The next allocation would exceed the journal's 67,108,864-byte safety ceiling, the per-record limit or the sequence range | Follow [Offline Archival](#offline-archival) |
| `INDEX_OVERSIZED` | The index exceeds its ceiling; it was left untouched | Current-format suggestions are withdrawn; legacy suggestions remain. Follow [Offline Archival](#offline-archival) |
| `INDEX_REBUILT` | A corrupt index was copied to `index.corrupt-<time>-<nonce>.json` and rewritten from valid runs | No action. Retain the preserved copy |
| `INDEX_CORRUPT` | A reader found a corrupt index and rebuilt candidates in memory only | No action. The next published research or collation run rebuilds the file and preserves the corrupt copy |
| `INDEX_UNAVAILABLE`, `INDEX_IO`, `INDEX_QUERY_MISMATCH` | The report was saved but the index was not updated | The report remains valid at its path. A run missing from an otherwise valid index is not offered as a related search, and later publications do not add it; no packaged command rebuilds the index. Do not edit or delete `index.json` to force a rebuild |
| `SUGGESTIONS_UNAVAILABLE`, `TELEMETRY_UNAVAILABLE`, `DISCOVERY_UNAVAILABLE` | Related-search suggestions, the telemetry sidecar or documentation discovery failed | No action for the cache. The answer and any saved report are unaffected |
| `QUERY_TOO_LARGE` | The encoded query exceeds the 16 MiB structural file limit | Shorten the query. No run directory was allocated |
| `MARKER_TOO_LARGE` | The report marker, including its file inventory, exceeds the same limit | Shorten the query or reduce `maxUrls`. The uncommitted directory remains as an incomplete run |
| `ACCOUNTING_TOO_LARGE`, `INVALID_ACCOUNTING` | Accounting could not be saved | The report stays valid and the returned usage is unaffected |
| `RUN_ID_COLLISIONS` | Exclusive directory creation collided 16 times | Report it as a defect; ordinary random identifiers do not collide |
| `STAGING_UNAVAILABLE` | Private page staging could not be created | Check permissions and free space below `<cacheDir>/.staging/` |

## Damaged Allocation History

The journal is the authority for admission order. A partial final line, broken checksum chain, missing journal, missing namespace identity, missing `runs/` directory or a run directory that disagrees with its journal record makes publication unavailable, and the packages never repair it automatically. Answers continue to be returned without saved reports.

1. Stop every process that uses the cache: `Pi` sessions with the extension loaded and every MCP server configured with the same workspace and `cacheDir`.
2. Confirm with the lock check in [Concurrent Writers](#concurrent-writers) that no process holds the lock.
3. Preserve the whole cache directory unchanged. Do not edit or truncate `allocations.ndjson`, delete, rename or recreate `writer.lock`, move individual run directories, recreate `namespace.json`, or edit or delete `index.json`.
4. If saved reports are needed before the damage is understood, direct new runs to a fresh namespace by one of the two routes in [Offline Archival](#offline-archival).

Neither route repairs the damaged namespace. Each starts a separate namespace that the operator has chosen explicitly, with its own journal beginning again at sequence 1, and leaves the damaged namespace intact for inspection. The packages never reuse or renumber the old history, and pointing `cacheDir` back at the damaged namespace does not repair it.

This release has no packaged command that validates or repairs a journal, and no procedure for returning unknown damaged allocation history to service is documented. For a sound journal with secondary-index damage or omissions, request a maintainer-assisted source-checkout rebuild: the internal `rebuildRunIndex()` routine takes the stable lock, validates the journal and committed records, preserves the old index and replaces only that secondary catalogue. [Cache Qualification](CACHE-QUALIFICATION.md#isolation-and-recovery-proofs) exercises that route and its refusals. It is not a supported end-user deep-import interface; do not delete or hand-edit an index to trigger repair.

## Incomplete Runs

A run directory without `committed.json` is an incomplete run. It comes from a degraded outcome, a cancellation or thrown failure after allocation, a process crash, a size limit or a filesystem failure. Readers ignore it, and it does not block later runs. It can hold telemetry, accepted pages or partial files that explain what happened, so it is evidence and stays in place.

The following read-only loop lists them from the workspace directory:

```bash
for run in .search/.intelli-v1/runs/*/; do
  [ -f "${run}committed.json" ] || echo "${run}"
done
```

A directory in this list can belong to a run still in progress. Stop every process that uses the cache before drawing conclusions from it. Incomplete runs are retained by [Offline Archival](#offline-archival) with everything else; they are not deleted individually.

Interrupted page staging can leave a directory below `.staging/`. Staging holds working copies, not committed reports, but after an interruption it can hold the only copy of pages that an incomplete run had fetched. Offline Archival keeps it with the rest of the cache. Removing an abandoned staging directory after stopping every process that uses the cache does not affect committed runs, but it discards those working copies.

## Growth

No automatic cleanup removes old runs. Each successful allocation adds a directory, including for a run that later degrades, fails or is cancelled; an allocation failure need not create a reservation. A saved run holds structural files, source and extraction files, and any documentation downloads. Parallel operations add to the same retained history. [Cache Qualification](CACHE-QUALIFICATION.md) records measured growth, near-limit query/index behaviour, the physical scan boundary and preservation drills on the verified host; these are not long-term or cross-platform performance promises.

The MCP server inspects every entry below `cacheDir`, including legacy directories, the namespace and staging, when its runtime starts and twice per operation. Beyond 100,000 inspected entries the runtime fails to start, or an operation fails with a `WORKSPACE` error before any inference; it does not weaken the scan, delete files or archive anything to continue. Each operation holds its admission slot during its scans, so a large cache also lengthens queueing. The following command approximates the scanned entry count from the workspace directory:

```bash
find .search | wc -l
```

The native extension has no equivalent entry limit, but the same directories accumulate. The allocation journal has a 67,108,864-byte safety ceiling and the index has a ceiling derived from it. A few near-limit queries can exhaust the index budget much earlier. A valid index left in place after a refused update remains usable but omits the newer run; an already oversized input instead withdraws new-format suggestions. Explicit rebuild attempts preserve a full copy before checking the rebuilt size, so repeated refused attempts consume additional disk space. Do not loop on rebuild failures.

## Offline Archival

Archival is performed offline, with every process that uses the cache stopped. It keeps every file and directs new runs to a fresh namespace, chosen explicitly by the operator. It is not a repair of the preserved namespace and does not continue its history. Runs in the preserved directory are no longer offered as related searches, and paths recorded in earlier answers stop resolving once that directory is renamed. Choose one of two routes after confirming with the lock check that no lock is held:

- **New Cache Directory:** set `cacheDir` to a new directory (the native `pi-intelli-search` namespace or the MCP `tuning` object) and restart the processes. The old directory, including its lock file, stays exactly where it is. The MCP scan covers only the configured `cacheDir`, so the old directory no longer counts towards its limit.
- **Rename in Place:** rename the whole cache directory within the same filesystem, for example `.search` to `.search-archive-2026-10-22`. A single rename keeps every file, including `writer.lock`, as the same file. The next research or collation run creates a fresh `.search`. The renamed directory stays inside the workspace; the MCP scan does not count it, because it is no longer below `cacheDir`.

Archive the cache directory as a whole. Splitting `.intelli-v1` from its runs, or moving individual runs, breaks the agreement between journal, markers and index that readers verify. Keep the archive on encrypted storage: it holds full queries, fetched page content and local telemetry, which can include confidential information.

Transfer to other storage is outside these procedures. A move across filesystems recreates every file, including `writer.lock`, rather than keeping it, and that route has not been verified. A copy made for safekeeping does not replace the preserved directory, and this guide documents no step for removing it.

## Verification Scope

The lock, journal, marker and index protocol has deterministic tests and the mandatory live native research regression on *Linux* x86-64 with *Node.js* 24 on local encrypted btrfs. The behaviour on *macOS*, *Windows*, network, overlay or remotely shared filesystems has not been verified. Physical growth, the scan boundary, mixed writer processes and the explicit offline choices have the bounded synthetic qualification recorded in [Cache Qualification](CACHE-QUALIFICATION.md). Power-loss recovery, slow or unresponsive storage and long-term retained histories remain unverified. The path, link and identity checks reject pre-existing escapes; they do not protect against another process with write access deliberately replacing files during a run.
