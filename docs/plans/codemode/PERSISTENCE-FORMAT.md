# Persistence Format

The `intelli-v1` library format uses the versioned schemas in `test/fixtures/run-store-v1/`, generated from `src/core/run-format.ts`. These schemas describe individual records. Acceptance also requires the byte limits, semantic checks and cross-file invariants below. Schema validation alone does not establish a verified report or complete accounting.

This document records the implementation of [C21–C27](CONTRACT.md#persistence). It does not amend the frozen P0-2 interfaces or claim that persistence is installed in registered operations. [Development](DEVELOPMENT.md) records integration status.

## Records

| Schema | File | Meaning |
|---|---|---|
| `namespace@1` | `namespace.json` | Namespace identity and creation time |
| `allocation@1` | Each line of `allocations.ndjson` | Durable admission identity, sequence and checksum chain |
| `reservation@1` | `runs/<runId>/reservation.json` | Owned reservation agreeing with one admission |
| `committed@1` | `runs/<runId>/committed.json` | Successful report identity and hashed file inventory |
| `accounting@1` | `runs/<runId>/accounting.json` | Settled attempt records and accounting summary |
| `accounting-committed@1` | `runs/<runId>/accounting.committed.json` | Independent hash marker for accounting |
| `index@1` | `index.json` | Secondary, rebuildable catalogue of committed runs |
| `writer-owner@1` | `writer.owner.json` | Diagnostic metadata, never ownership authority |

Each schema identifier has the prefix `intelli-v1/`. All records have `schemaVersion: 1`. The permanent regular file `writer.lock` has no record schema; kernel ownership, not its content or age, decides the lock.

## Encoding and Limits

Writers encode sorted-key JavaScript Object Notation (JSON), without whitespace, as UTF-8 followed by one newline. Journal hashes cover canonical parsed content excluding the current `hash` field. Marker and file digests cover exact stored bytes, including any newline. Readers accept non-canonical JSON encodings; the runtime parser's last-key-wins interpretation also applies to duplicate keys. External validation must use the library readers rather than infer identities with a different duplicate-key policy. This review does not introduce a stricter journal-encoding requirement.

The implementation constants in `src/core/run-format.ts` own the byte limits. `JOURNAL_RECORD_MAX_BYTES` includes the newline, `JOURNAL_MAX_BYTES` bounds the whole journal, `STRUCTURAL_MAX_BYTES` bounds structural files other than the index, and `INDEX_MAX_BYTES` bounds the secondary index. `OWNER_MAX_BYTES` separately bounds owner diagnostics. Writers check the complete encoded report and accounting markers and accounting body before publishing them; readers apply the same structural ceiling. These are accepted-content limits, not whole-process memory guarantees.

Allocation rejects malformed Unicode and a query whose encoded JSON representation alone exceeds the structural ceiling. A smaller query can still make the complete marker exceed the ceiling once its inventory is included. In that case publication returns `MARKER_TOO_LARGE`, preserves the uncommitted directory and publishes no marker. Later allocations remain available and do not reuse its sequence. Oversized accounting returns `ACCOUNTING_TOO_LARGE` without publishing an accounting body or marker; the committed report and returned usage remain useful. The defensive accounting-marker check returns `ACCOUNTING_MARKER_TOO_LARGE`.

## Identity and Visibility

The following checks supplement the per-record schemas:

- Namespace identifiers agree across the journal, reservation, committed marker, accounting and index. Run identifiers agree with the containing directory and journal record.
- Journal sequences are contiguous safe integers from one. Each record's previous hash agrees with its predecessor, starting from `ZERO_HASH`. Run identifiers are unique. Writer validation rejects a partial tail; readers ignore only an unterminated tail, which cannot precede a valid publication.
- Reservation sequence, operation identifier, compatibility key, start time and allocation hash agree with the journal. A journalled admission without a published report is an allowed gap, not reusable numbering.
- The committed marker agrees with the reservation and journal. Its compatibility key derives from exact query text and the literal Coordinated Universal Time (UTC) date. Timestamps must preserve their calendar and whole-second fields when parsed; impossible days and `24:00:00` are rejected. Fractional precision up to the schema's limit is retained in provenance, while time comparisons use the runtime's millisecond precision.
- `report.md`, `query.txt` and `run.json` appear exactly once with their structural kinds. The report is nonempty. `query.txt` contains exactly the allocated query's UTF-8 bytes, not a lossy decoded equivalent.
- Every inventory path is unique, relative, traversal-free and outside reserved structural names and temporary suffixes. Intermediate components are real directories and the final component is a regular file. Byte lengths and digests match the stored files. These checks reject existing links, not concurrent hostile filesystem mutation.
- `nonEvidence` lists late artefacts separately. Its paths cannot duplicate evidence or structural paths. A valid report marker, not the apparent completeness of a directory or optional telemetry, establishes reader visibility.
- The accounting marker names exactly `accounting.json`, whose byte length and digest it verifies. Both accounting records identify the already verified report manifest. Accounting failure cannot invalidate or rewrite that report.
- A suggested index entry's query, admission sequence, compatibility key and start time agree with the verified marker; its manifest digest matches the marker bytes. Mismatched entries are rejected without rewriting the index. The next verified admission for a key remains eligible. An invalid new entry cannot suppress valid legacy evidence. The index never restores allocation numbering.

The real writer and reader regression in `test/core-run-schema-regressions.test.ts` exercises all published record schemas, canonical output, a reserved gap, late non-evidence and accounting. The example fixture remains a deterministic constructed namespace, not a capture of production execution.

## Body Validation and Remaining Gates

The persistence library treats `run.json` as a UTF-8 JSON object and hashes its bytes. It does not yet prescribe a field-level schema for source state or provenance. The `accounting@1` schema constrains its envelope but treats attempt items and the summary as opaque objects. The typed writer accepts `AttemptRecord` and `AccountingSummary`; the file reader does not independently prove those shapes, completeness masks or ledger arithmetic.

Before pipeline integration, validate these bodies against the shared result/accounting shapes and define the pipeline-owned `run.json` contract. A hash-valid accounting file is not by itself a trusted accounting observation. This remains an integration gate, not a schema-review pass for T16/T17 or final accounting fidelity. Later schema changes require deliberate fixture regeneration and review.

A failed diagnostic-owner rename can leave a private temporary file. It is not run evidence and does not control ownership. No automatic cleanup of historical or orphan evidence is introduced here.

Installed adapter execution, native-floor support, platform durability, process cancellation, whole-parent containment and growth measurement remain separate acceptance gates. This format note is not the P4b operator recovery or archival procedure, and does not remove existing archive promises before replacement behaviour is integrated and proved.
