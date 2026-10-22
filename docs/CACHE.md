# Cache and Recovery

This guide describes the run cache that the registered `intelli_research` and `intelli_collate` tools write in both packages, how a reader decides that a saved run is valid, and the non-destructive operator responses to persistence diagnostics. It covers the native `Pi` extension and the standalone Model Context Protocol (MCP) server. The [README Cache Structure](../README.md#cache-structure) summarises the layout; [Architecture](ARCHITECTURE.md#cache-structure) explains the design.

Every procedure here preserves existing reports, allocation history and incomplete runs. No step deletes a run, edits the allocation journal or removes the lock file. The packages provide no automatic retention, compaction or history reset.

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

The run directory name is a display label followed by a nonce of 32 hexadecimal characters. The label is the Coordinated Universal Time (UTC) date of the run plus up to five lowercase query words; it identifies nothing. Exclusive directory creation, not the label or nonce, makes each directory belong to one operation. A repeated query on the same day creates a new directory: nothing is rotated, archived to a numbered sibling or replaced.

Research writes every file shown above that applies to the run. Manual collation writes the same structure without documentation downloads, late files or telemetry; caller-supplied full pages appear under `sources/`. The tool result and the report's Source Assessment table give the exact path of every file, so a reader never needs to guess a filename.

## Valid Runs

A run is valid only when `committed.json` exists and agrees with the journal, `reservation.json` and every file it lists, including each file's length and Secure Hash Algorithm 256 (SHA-256) digest. The marker is written last, by an atomic rename, after every listed file has been written and synced. A directory without a valid marker is not a report, however complete it looks, and no tool advertises or suggests it.

Accounting has its own marker. `accounting.committed.json` verifies `accounting.json`; a failure to write either leaves the committed report valid.

`index.json` is a secondary catalogue used only to choose related-search candidates. It never decides whether a run is valid, and every suggested run is verified against its marker first.

## What a Result Reports

A completed answer is returned even when it cannot be saved. The result text then ends with `Persistence unavailable (<code>): <message>`, and `details.cachePath` is empty. When the report is saved, the text names its `report.md` path and `details.cachePath` names the run directory.

Degraded research (`no-links`, `fetch-failed`, `extraction-failed`) publishes no report and returns an empty `details.cachePath`. The run directory reserved at admission remains with its `reservation.json` and, unless telemetry is disabled, a `meta.json` describing the failed attempt. The result does not name that directory. Its full data reports persistence as `not-requested`, which describes the unpublished report rather than the reservation.

Related-search suggestions run on degraded outcomes as well as completed ones, so a degraded run can make one extra suggestion model call. The suggestion window holds at most 20 candidates. It considers valid current runs and legacy reports, excludes the current query's date and query key, and never rewrites a legacy index or directory.

## Concurrent Writers

All writers on the same cache share `writer.lock`. The lock is held by the operating-system kernel through an open file description, so a crashed or killed process releases it automatically. The file's existence, age or `writer.owner.json` content does not show that a lock is held, and no stale-lock cleanup step exists.

A writer waits up to 2,000 milliseconds for the lock. Under heavy parallel load this wait can expire; the answer is then returned without a saved report and the diagnostic is `LOCK_BUSY`. Network, model and page work never run under the lock.

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
| `LOCK_IO`, `JOURNAL_IO`, `NAMESPACE_IO`, `RESERVATION_IO`, `RUN_DIR_IO`, `PUBLICATION_IO` | A filesystem operation failed | Check permissions, free space and the named path |
| `JOURNAL_DAMAGED`, `JOURNAL_MISSING`, `NAMESPACE_MISSING`, `NAMESPACE_INVALID`, `RUNS_INVALID`, `JOURNAL_HISTORY_CONFLICT` | Allocation history is damaged or unknown. No run can be saved until it is resolved | Follow [Damaged Allocation History](#damaged-allocation-history) |
| `UNJOURNALLED_RUN` | `runs/` contains an entry with no journal record | When the message names a stray file or link, confirm it is not run evidence, then move it out of `runs/` to a location outside the cache. When it names a directory with content, follow [Damaged Allocation History](#damaged-allocation-history) |
| `JOURNAL_CEILING` | The journal exceeds its 67,108,864-byte safety ceiling | Follow [Offline Archival](#offline-archival) |
| `INDEX_OVERSIZED` | The index exceeds its ceiling; it was left untouched | Current-format suggestions are withdrawn; legacy suggestions remain. Follow [Offline Archival](#offline-archival) |
| `INDEX_REBUILT` | A corrupt index was copied to `index.corrupt-<time>-<nonce>.json` and rewritten from valid runs | No action. Retain the preserved copy |
| `INDEX_CORRUPT` | A reader found a corrupt index and rebuilt candidates in memory only | No action. The next saved research rebuilds the file and preserves the corrupt copy |
| `INDEX_UNAVAILABLE`, `INDEX_IO`, `INDEX_QUERY_MISMATCH` | The report was saved but the index was not updated | The report remains valid at its path. A run missing from an otherwise valid index is not offered as a related search; no packaged command rebuilds the index |
| `QUERY_TOO_LARGE` | The encoded query exceeds the 16 MiB structural file limit | Shorten the query. No run directory was allocated |
| `MARKER_TOO_LARGE` | The report marker, including its file inventory, exceeds the same limit | Shorten the query or reduce `maxUrls`. The uncommitted directory remains as an incomplete run |
| `ACCOUNTING_TOO_LARGE`, `INVALID_ACCOUNTING` | Accounting could not be saved | The report stays valid and the returned usage is unaffected |
| `RUN_ID_COLLISIONS` | Exclusive directory creation collided 16 times | Report it as a defect; ordinary random identifiers do not collide |
| `STAGING_UNAVAILABLE` | Private page staging could not be created | Check permissions and free space below `<cacheDir>/.staging/` |

## Damaged Allocation History

The journal is the authority for admission order. A partial final line, broken checksum chain, missing journal or missing namespace identity makes publication unavailable, and the packages never repair it automatically. Answers continue to be returned without saved reports.

1. Stop every process that uses the cache: `Pi` sessions with the extension loaded and every MCP server configured with the same workspace and `cacheDir`.
2. Confirm with the lock check in [Concurrent Writers](#concurrent-writers) that no process holds the lock.
3. Preserve the whole cache directory unchanged. Do not edit or truncate `allocations.ndjson`, delete or rename `writer.lock`, move individual run directories, or recreate `namespace.json`.
4. Restore service with one of the two choices in [Offline Archival](#offline-archival). Either choice starts a new namespace and keeps the damaged one intact for inspection.

This release has no packaged command that validates or repairs a journal.

## Incomplete Runs

A run directory without `committed.json` is an incomplete run. It comes from a degraded outcome, a cancellation before publication, a process crash, a size limit or a filesystem failure. Readers ignore it, and it does not block later runs. It can hold telemetry, accepted pages or partial files that explain what happened, so it is evidence and stays in place.

The following read-only loop lists them from the workspace directory:

```bash
for run in .search/.intelli-v1/runs/*/; do
  [ -f "${run}committed.json" ] || echo "${run}"
done
```

A directory in this list can belong to a run still in progress. Stop every process that uses the cache before drawing conclusions from it. Incomplete runs are retained by [Offline Archival](#offline-archival) with everything else; they are not deleted individually.

Interrupted page staging can leave a directory below `.staging/`. Staging holds working copies, not run evidence. After stopping every process that uses the cache, inspect the logged path and remove an abandoned staging directory if it is no longer needed.

## Growth

Nothing removes old runs. Every research run adds a directory holding its structural files, one extraction per used page, one full page per accepted page and any documentation downloads. Disk use therefore grows with every run, including degraded and incomplete runs. Growth rates and scan durations have not been measured.

The MCP server inspects every entry below `cacheDir`, including legacy directories, the namespace and staging, when its runtime starts and twice per operation. At 100,000 inspected entries the runtime fails to start, or an operation fails with a `WORKSPACE` error before any inference; it does not weaken the scan, delete files or archive anything to continue. Queued requests wait behind each scan, so a large cache also lengthens queueing. The following command approximates the scanned entry count from the workspace directory:

```bash
find .search | wc -l
```

The native extension has no equivalent entry limit, but the same directories accumulate. The allocation journal has a 67,108,864-byte safety ceiling and the index has a ceiling derived from it.

## Offline Archival

Archival keeps every file and moves the active cache out of the way so that the next run starts a new namespace. Runs in the archived directory are no longer offered as related searches, and their recorded paths no longer resolve until the directory is restored. Choose one of two routes after stopping every process that uses the cache:

- **New Cache Directory:** set `cacheDir` to a new directory (the native `pi-intelli-search` namespace or the MCP `tuning` object) and restart the processes. The old directory stays where it is. The MCP scan covers only the configured `cacheDir`, so the old directory no longer counts towards its limit.
- **Archive and Replace:** rename the whole cache directory on the same encrypted filesystem, for example `.search` to `.search-archive-2026-10-22`, then move that renamed directory as one unit to encrypted offline storage. The next research run creates a fresh `.search`.

Keep the archive on encrypted storage: it holds full queries, fetched page content and local telemetry, which can include confidential information. Archive the cache directory as a whole. Splitting `.intelli-v1` from its runs, or moving individual runs, breaks the agreement between journal, markers and index that readers verify.

## Verification Scope

The lock, journal, marker and index protocol has deterministic tests and one live native research regression on *Linux* x86-64 with *Node.js* 24 on local encrypted btrfs. The behaviour on *macOS*, *Windows*, network, overlay or remotely shared filesystems has not been verified. Crash recovery on slow or unresponsive storage, long-term growth and these recovery procedures as a whole have not been exercised end to end. The path, link and identity checks reject pre-existing escapes; they do not protect against another process with write access deliberately replacing files during a run.
