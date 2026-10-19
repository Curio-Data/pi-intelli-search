# Persistence Format

The `intelli-v1` library format uses the versioned schemas in `test/fixtures/run-store-v1/`, generated from `src/core/run-format.ts`. These schemas describe individual records. A reader accepts a record only when it also satisfies the byte limits, semantic checks and cross-file invariants below. Schema validation alone does not establish a verified report or complete accounting.

This document records the implementation of [C21–C27](CONTRACT.md#persistence). It does not amend the frozen P0-2 interfaces or claim that persistence is installed in registered operations. [Development](DEVELOPMENT.md) records integration status.

## Records

| Schema | File | Meaning |
|---|---|---|
| `namespace@1` | `namespace.json` | Namespace identity and creation time |
| `allocation@1` | Each line of `allocations.ndjson` | Durable admission identity, sequence and checksum chain |
| `reservation@1` | `runs/<runId>/reservation.json` | Owned reservation agreeing with one admission |
| `committed@1` | `runs/<runId>/committed.json` | Successful report identity and hashed file inventory |
| `run@1` | `runs/<runId>/run.json` | Report-time source states, evidence snapshot and provenance |
| `accounting@1` | `runs/<runId>/accounting.json` | Settled attempt records and accounting summary |
| `accounting-committed@1` | `runs/<runId>/accounting.committed.json` | Independent hash marker for accounting |
| `index@1` | `index.json` | Secondary, rebuildable catalogue of committed runs |
| `writer-owner@1` | `writer.owner.json` | Diagnostic metadata, never ownership authority |

Each schema identifier has the prefix `intelli-v1/`. All records have `schemaVersion: 1`. The permanent regular file `writer.lock` has no record schema; kernel ownership, not its content or age, decides the lock.

## Encoding and Limits

Writers encode sorted-key JavaScript Object Notation (JSON), without whitespace, as UTF-8 followed by one newline. Journal hashes cover canonical parsed content excluding the current `hash` field. Marker and file digests cover exact stored bytes, including any newline. Readers accept non-canonical JSON encodings; the runtime parser's last-key-wins interpretation also applies to duplicate keys. External validation must use the library readers rather than infer identities with a different duplicate-key policy. The format does not require canonical journal bytes.

The implementation constants in `src/core/run-format.ts` own the byte limits. `JOURNAL_RECORD_MAX_BYTES` includes the newline, `JOURNAL_MAX_BYTES` bounds the whole journal, `STRUCTURAL_MAX_BYTES` bounds structural files other than the index, and `INDEX_MAX_BYTES` bounds the secondary index. `OWNER_MAX_BYTES` separately bounds owner diagnostics. Writers check the encoded report marker, accounting body and accounting marker before publishing them; readers apply the same structural ceiling. These are accepted-content limits, not whole-process memory guarantees.

Allocation rejects malformed Unicode and a query whose encoded JSON representation alone exceeds the structural ceiling. A smaller query can still make the complete marker exceed the ceiling once its inventory is included. In that case publication returns `MARKER_TOO_LARGE`, preserves the uncommitted directory and publishes no marker. Later allocations remain available and do not reuse its sequence. Oversized accounting returns `ACCOUNTING_TOO_LARGE` without publishing an accounting body or marker; the committed report and returned usage remain useful. The defensive accounting-marker check returns `ACCOUNTING_MARKER_TOO_LARGE`.

## Identity and Visibility

The following checks supplement the per-record schemas:

- Namespace identifiers agree across the journal, reservation, committed marker, accounting and index. Run identifiers agree with the containing directory and journal record.
- Journal sequences are contiguous safe integers from one. Each record's previous hash agrees with its predecessor, starting from `ZERO_HASH`. Run identifiers are unique. Writer validation rejects a partial tail; readers ignore only an unterminated tail, which cannot precede a valid publication.
- Reservation sequence, operation identifier, compatibility key, start time and allocation hash agree with the journal. A journalled admission without a published report is an allowed gap, not reusable numbering.
- The committed marker agrees with the reservation and journal. Its compatibility key derives from exact query text and the literal Coordinated Universal Time (UTC) date. Timestamps must preserve their calendar and whole-second fields when parsed; impossible days and `24:00:00` are rejected. Fractional precision up to the schema's limit is retained in provenance, while time comparisons use the runtime's millisecond precision.
- `report.md`, `query.txt` and `run.json` appear exactly once with their structural kinds. The report is nonempty. `query.txt` contains exactly the allocated query's UTF-8 bytes, not a lossy decoded equivalent.
- Every inventory path is unique, relative and traversal-free. Reserved root filenames are `reservation.json`, `committed.json`, `accounting.json` and `accounting.committed.json`; paths ending in `.tmp` are also rejected. Intermediate components are real directories and the final component is a regular file. Byte lengths and digests match the stored files. These checks reject existing links, not concurrent hostile filesystem mutation.
- `nonEvidence` lists late artefacts separately. Its paths cannot duplicate evidence or structural paths. A valid report marker, not the apparent completeness of a directory or optional telemetry, establishes reader visibility.
- The accounting marker names exactly `accounting.json`, whose byte length and digest it verifies. Both accounting records identify the already verified report manifest. Accounting failure cannot invalidate or rewrite that report.
- The index names the namespace and contains unique run identifiers in strictly ascending admission order. Each compatibility key derives from its entry's exact query and UTC date. Corrupt input triggers an in-memory rebuild from verified committed runs without rewriting the file. Oversized input instead withdraws new-format suggestions without rebuilding or rewriting; valid legacy candidates remain eligible.
- A suggested index entry's query, admission sequence, compatibility key and start time agree with the verified marker; its manifest digest matches the marker bytes. Entries reached by candidate verification are rejected on a marker mismatch without rewriting the index. The next verified admission for a key remains eligible. An invalid new entry cannot suppress valid legacy evidence. The index never restores allocation numbering.

The real writer and reader regression in `test/core-run-schema-regressions.test.ts` exercises all published record schemas, canonical output, a reserved gap, late non-evidence and accounting. The example fixture remains a deterministic constructed namespace, not a capture of production execution.

## Accounting Body Validation

The pre-integration `accounting@1` schema now uses the shared `AttemptRecord` and `AccountingSummary` schemas in `src/core/accounting-schema.ts`. Unknown properties are rejected at every level. Attempt counters are safe integers; token and cost observations are finite non-negative numbers, retaining the ledger's numeric semantics rather than imposing integer token counts. Operation, call and optional page identifiers also pass the coordinator's control-character and encoded-byte checks.

The writer validates before creating `accounting.json`; invalid bodies return `INVALID_ACCOUNTING`, publish no accounting marker and leave the committed report intact. The reader validates after checking the accounting marker and exact body bytes. Both reconstruct the settled attempt ledger, reject duplicate attempt identities, mixed or foreign operation ownership and settlement before start, then compare every derived summary field. Persist `records()` and `summary()` from the same settled ledger without sorting, filtering or merging the records: floating-point sums retain attempt insertion order. The missing-token mask is a set: its order is immaterial, but duplicates, omissions and invented fields reject. Allocate with the coordinator lease ID so reservation and accounting identifiers share the coordinator's stricter bounds. Attempt ownership must agree with the run's reservation. Call `verifyAccounting()` strictly after successful report/journal verification; its re-read of the reservation does not replace that verification.

This validation preserves unobserved token fields as absent, explicit observed zeros and provider-reported/catalogue cost separation. For zero attempts, `createAttemptLedger().summary()` returns zero token totals, an empty missing-token mask and `costComplete: true`: no dispatched work is missing. With dispatched attempts, absent observations remain unknown. `parentDelivery` is an external observation with a validated enum, not an independently verified delivery claim. Ledger consistency does not establish that provider usage was captured correctly or that every dispatched attempt reached the supplied ledger. The shared schema types are mutually assignable with the frozen accounting interfaces under the CI native-contract type check.

The schema fixture was deliberately regenerated for this pre-integration refinement. The constructed example's missing-token mask now lists every unobserved token field, and its independent accounting marker hashes the corrected bytes. The envelope, report marker, journal, namespace and P0-2 bundle are unchanged. `test/core-run-accounting.test.ts` covers writer refusal, hash-valid reader tampering, unchanged report visibility, schema/type parity and settled-ledger round trips. Independent acceptance of this refinement is recorded separately in [Development](DEVELOPMENT.md).

## Report Manifest Body

The pipeline-owned `run@1` schema is defined in `src/core/run-manifest-schema.ts` and published as `run.schema.json` beside the other wire schemas. It refines the previously opaque `run.json` before registered adapter integration. Its identity is `intelli-v1/run`, with `schemaVersion: 1`. Unknown properties reject at every object level. The report marker and journal remain the authority for query, start time, operation identifier and namespace/run identity; the body does not duplicate those fields.

| Field | Meaning |
|---|---|
| `operation` | `intelli_research` or `intelli_collate`, the two report-producing operations |
| `sources` | Complete candidate-order inventory after page work settles, with stable `S1`, `S2`, … identifiers and terminal states |
| `evidenceSourceIds` | The immutable collation snapshot, exactly the `used` sources in candidate order |
| `documents` | Completed research documentation downloads, with their URLs and relative stored paths; these are not additional collation evidence |
| `suppliedPages` | Manual collation full pages not attached to an extraction, with caller labels and relative stored paths; these are not additional collation evidence |
| `provenance` | Exact domain filters, optional extraction focus and selected model identities; no credentials, endpoints or arbitrary configuration objects |

Each source records `id`, `url`, `title`, terminal `state` and `input`. Optional fields are `sourceType`, `truncated`, `diagnostic`, `extractionPath` and `fullPagePath`. No raw `content` or inline `extraction` is allowed. `input: network` identifies research candidates; it does not assert a successful fetch. `input: supplied` identifies manual collation inputs and makes no operation-side network claim. Models record only `provider` and `model`; research requires search, extract and collate identities. Manual collation selects only the collate model and rejects search, extract and suggest identities. Manual collation has no documentation discovery, and research has no supplied-page records. The optional research suggest identity records configuration, not an assertion that a suggestion call ran. Final attempts and usage remain in independently published accounting, after suggestions settle.

Only `used`, `late`, `empty`, `fetch-failed`, `extract-failed` and `cancelled` are persisted research source states. Supplied collation sources are restricted to `used`, `empty` and `extract-failed`; they cannot assert operation-side fetch, cancellation or late-page work. Every `used` source names an `extraction` artefact; every `late` source names a `late` artefact in the marker's `nonEvidence` inventory. Other states name no successful extraction. An optional `fullPagePath` names a `source` artefact. For a late success the format retains only the extraction, never the raw page; failed fetches have no accepted page. A cancelled or empty extraction can retain a page accepted before cancellation or extraction. Documentation and unpaired supplied-page paths also name `source` artefacts. Every source, extraction and late file belongs to exactly one source, documentation or supplied-page record. Paths are safe run-relative names, never future display or absolute paths.

Network source URLs and documentation URLs must parse as HTTP(S), contain no embedded user information, and be separately unique by exact string. Their stored spelling is not canonicalised; equivalent spellings can remain distinct. Supplied labels preserve the existing string-valued input surface, including empty/non-URL labels and repetitions. Their stable `S<n>` IDs identify sources, not their labels. Parsed supplied URLs also reject embedded user information. Unpaired supplied pages remain stored without inventing extraction evidence or network activity. This body support does not relax the operation's separate duplicate-evidence checks. None of these checks detects secrets in URL query strings, unparseable labels, domain filters, focus, titles or diagnostics.

Extraction files cannot have zero bytes. This is not the trimmed-nonempty evidence test: the producer must apply that test before assigning `used`. These checks do not establish factual grounding or truthful producer labels.

`runManifestError()` applies the same field/state/inventory rules before publication and during verified reading. Writer refusal returns `INVALID_ARTIFACTS` without publishing a marker. Inline invalid manifests reject before artefact writes; an empty staged extraction is detected after its bytes are copied and leaves the directory uncommitted. The body shares `STRUCTURAL_MAX_BYTES`; exact-limit and one-byte-over regressions cover writer/reader agreement. Readers validate the same bytes whose length and hash are checked, alongside the existing journal, reservation and complete file inventory checks. A valid hash alone cannot admit an invalid body.

The report body is a post-page-drain, pre-suggestion snapshot, not a final returned result. It deliberately omits final accounting, suggestion results and all-work-settled timing. Pipeline integration must construct it only after late page/discovery work settles, preserve the exact frozen evidence array of trimmed-nonempty extractions, and map relative paths to advertised display paths only after successful commit. Before assigning candidate IDs, filter or redact URLs containing embedded user information consistently with deduplication/clamping; a rejected fetch URL must not carry credentials into a failed-source record or withdraw persistence for otherwise valid evidence. Registered operations still use legacy persistence; these body checks do not prove that future producers construct the manifest correctly.

## Remaining Integration Gates

Result mapping must carry `INVALID_ARTIFACTS` and `INVALID_ACCOUNTING` alongside size/input and report/accounting durability diagnostics into useful operation results. Capture fidelity and full [acceptance-map rows T16 and T17](ACCEPTANCE.md#requirement-map) remain open; the body checks alone do not pass them. Later schema changes require deliberate fixture regeneration and review.

A failed diagnostic-owner rename can leave a private temporary file. It is not run evidence and does not control ownership. No automatic cleanup of historical or orphan evidence is introduced here.

Installed adapter execution, native-floor support, platform durability, process cancellation, whole-parent containment and growth measurement remain separate acceptance gates. This format note is not the P4b operator recovery or archival procedure, and does not remove existing archive promises before replacement behaviour is integrated and proved.
