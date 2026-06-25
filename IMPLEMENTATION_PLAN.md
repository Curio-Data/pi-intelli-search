# v0.11.0 Implementation Plan

Derived from `PROJECT_BRIEF.md`. Verified against current best practice via
`intelli_research` (telemetry schema design, local opt-out conventions). Every
decision below cites the code it touches and the best-practice source it
follows. The brief is the _what_ and _why_; this plan is the _how_ and _where_.

## Best-Practice Verification (research synthesis)

Two `intelli_research` passes informed this plan. Findings that changed or
confirmed the design:

1. **`disableTelemetry` (boolean, default `false`) is the established
   convention** for local opt-out across VS Code-ecosystem and `rust-analyzer`-
   style extensions. The brief's chosen name and default are correct. Confirmed.
2. **Schema versioning: separate `schemaVersion` from product version.** Research
   recommends an explicit, independent schema-version field so consumers can
   branch on payload shape without parsing the product semver. The brief's
   schema has only `extensionVersion`. **Plan adds `schemaVersion: 1`** as the
   first field. `extensionVersion` (package semver) is retained for diagnosis.
3. **Additive-only evolution.** Future schema changes add optional fields only;
   never rename or remove. `schemaVersion` bumps only on a breaking change.
4. **Atomic writes (temp file then rename).** Research recommends write-to-temp-
   then-rename to avoid partial files. No write in the current codebase is
   atomic (verified: `rg rename` returns nothing). **Plan uses an atomic write
   for `meta.json`** since it is the one file whose corruption would make the
   whole sidecar unreadable. The existing cache writes (`report.md`,
   `extractions/`, `.index.json`) stay non-atomic to match current behaviour
   and scope; only the new file gets the stronger guarantee.
5. **Flat-ish structure preferred.** Research suggests flat over deeply nested.
   The brief's `stages.<stage>.<field>` nesting is two levels, which is
   acceptable and matches how the analysis script already reads it. Kept as-is.
6. **No PII; core function never gated.** Research: local analysis must never be
   blocked by `disableTelemetry`, and no PII is collected. The sidecar records
   only counts, model identifiers, slugs, and timings. No query text is
   duplicated beyond what `query.txt` already stores (the sidecar carries the
   query for self-contained readability, matching the brief). The pipeline
   result is never gated on sidecar success.

Sources (per research synthesis): OpenTelemetry schema-vision roadmap,
Jupyter Telemetry schema docs, Honeycomb OpenTelemetry sidecar practices, VS
Code telemetry extension-author guidance, `rust-analyzer` setting convention.

## Architecture Decisions

### Decision A: new module `src/telemetry.ts`

A single module owns the schema, the builder, and the atomic writer. Keeping it
out of `cache.ts` (which owns the user-facing cache layout) keeps the
telemetry concern isolated and testable. `cache.ts` is about persistence the
agent reads; `telemetry.ts` is about diagnostics the operator reads.

### Decision B: telemetry is built in the orchestrator, written by the module

The orchestrator already computes every metric the sidecar needs (it filters
`pages`, counts `urls`, tracks `searchAttempts`, catches cache-suggest
matches). The plan adds a `TelemetryBuilder` accumulator object that each
stage updates in place, then hands to `writeTelemetry()` once at the end. No
second pass, no re-derivation.

### Decision C: `schemaVersion` decoupled from `extensionVersion`

| Field | Source | Purpose |
|---|---|---|
| `schemaVersion` | literal `1` in `telemetry.ts` | Payload shape. Bump only on breaking schema change. |
| `extensionVersion` | read from `package.json` at runtime | Which release wrote the file. Diagnostic only. |

### Decision D: read `extensionVersion` from `package.json`, not the hardcoded constant

`src/index.ts` line 17 hardcodes `CURRENT_VERSION = "0.10.0"`, which is already
stale (the tree is at `0.11.0`). Reusing it would record a wrong version in
every sidecar. `telemetry.ts` reads the version from `package.json` once at
module load and caches it. This also future-proofs against the hardcoded
constant drifting again. (Fixing `index.ts`'s stale constant is a separate,
pre-existing issue noted but not in scope for this plan unless requested.)

## Phased Implementation

### Phase 0: Schema definition (`src/telemetry.ts`)

Create the module with the schema as a TypeScript interface and a builder.

```typescript
// Canonical payload shape. Additive-only evolution: new fields optional.
export interface TelemetryMeta {
  schemaVersion: 1;
  extensionVersion: string;
  query: string;
  timestamp: string;             // ISO 8601, mirrors query.txt/report.md
  durationMs: number;
  stages: {
    search: {
      model: string;             // "provider/model"
      linksReturned: number;
      retryFired: boolean;       // true if searchRetryAttempts > 1 iteration ran
      attempts: number;          // iterations actually executed
    };
    fetch: {
      requested: number;
      succeeded: number;
      failed: number;
      winners: Record<string, number>;  // { "defuddle": n, "markdown": n }
      // winners requires a per-page variant record from fetch.ts (see Phase 3)
    };
    extract: {
      model: string;
      succeeded: number;
      failed: number;
      totalInputChars: number;
      totalOutputChars: number;
    };
    collate: {
      model: string;
      summaryChars: number;
    };
    cacheSuggest: {
      ran: boolean;
      surfaced: number;          // count of related entries returned
      slugs: string[];
    };
  };
}
```

`TelemetryBuilder` is a mutable accumulator:

```typescript
export class TelemetryBuilder {
  private start = Date.now();
  readonly meta: TelemetryMeta;  // built up stage by stage
  constructor(extensionVersion: string, query: string) { /* ... */ }
  recordSearch(...) { ... }
  recordFetch(...) { ... }
  recordExtract(...) { ... }
  recordCollate(...) { ... }
  recordCacheSuggest(...) { ... }
  finalize(): TelemetryMeta { this.meta.durationMs = Date.now() - this.start; return this.meta; }
}
```

### Phase 1: settings and types

Files: `src/types.ts`, `src/settings.ts`.

1. `types.ts`: add `disableTelemetry: boolean;` to `ResearchSettings` (place it
   next to `disableLlmsFullDiscovery`).
2. `settings.ts`:
   - Add `disableTelemetry: false` to `DEFAULT_SETTINGS`.
   - Add nested-namespace read: `if (ns.disableTelemetry != null) overrides.disableTelemetry = ns.disableTelemetry as boolean;`
   - Add flat-key fallback: `if (parsed.intelliDisableTelemetry != null && overrides.disableTelemetry == null) overrides.disableTelemetry = parsed.intelliDisableTelemetry as boolean;`
   - No migration needed (new key; absent means default `false`).

### Phase 2: atomic writer (`src/telemetry.ts`)

```typescript
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export async function writeTelemetry(
  cachePath: string,
  meta: TelemetryMeta,
): Promise<void> {
  const target = join(cachePath, "meta.json");
  const tmp = join(cachePath, `.meta.json.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf-8");
  await rename(tmp, target);   // atomic on same filesystem (POSIX rename(2))
}
```

`rename(2)` is atomic when source and destination are on the same filesystem,
which holds here (both under `cachePath`). A crash mid-write leaves a `.tmp`
file, never a partial `meta.json`.

### Phase 3: orchestrator hooks (`src/tools/intelli-research.ts`)

Hook points map exactly to existing stage boundaries. Each receives the
`TelemetryBuilder` instance.

| Stage | Location (current code) | Hook |
|---|---|---|
| construct | top of `execute()`, after `loadSettings` | `const tel = new TelemetryBuilder(VERSION, params.query);` (only if `!settings.disableTelemetry`) |
| search | after the search-retry loop (lines around the `for` loop, after `urls` is final) | `tel.recordSearch({ model, linksReturned: urls.length, retryFired: attempt>1, attempts })` |
| fetch | after `fetchPages` returns | `tel.recordFetch({ requested, succeeded, failed, winners })` |
| extract | after `mapWithConcurrency` resolves | `tel.recordExtract({ model, succeeded, failed, totalInputChars, totalOutputChars })` |
| collate | after `collation` string returns | `tel.recordCollate({ model, summaryChars: collation.length })` |
| cacheSuggest | after the `try/catch` around the judge | `tel.recordCacheSuggest({ ran, surfaced: matches.length, slugs })` |
| write | end of `executePipeline`, before the final `return` | `if (!settings.disableTelemetry) { try { await writeTelemetry(cachePath, tel.finalize()); } catch (e) { console.error(...) } }` |

**Fetch winners require no new signal (verified).** Inspected `src/fetch.ts`:
`compareAndPick()` already stamps `source: "defuddle"` or `source: "markdown"`
on every returned `FetchedPage` (lines 100 and 102), and `FetchedPage.source?`
already exists in `src/types.ts`. The orchestrator computes `winners` by
tallying `successPages.map((p) => p.source)` on the array it already has. No
change to `fetch.ts` is required. The original Option 1/Option 2 split below is
resolved in favour of Option 1 with zero fetch-layer work; the text is retained
for traceability.

- **Option 1 (verified feasible, chosen):** tally `page.source` in the
  orchestrator. No `fetch.ts` edit.
- **Option 2 (rejected):** defer `winners`. Not needed; Option 1 is trivial.

### Phase 4: version sourcing

In `telemetry.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let cachedVersion: string | null = null;
async function getExtensionVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");  // dist/ -> repo root
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    cachedVersion = pkg.version;
  } catch {
    cachedVersion = "unknown";   // never throw on version read
  }
  return cachedVersion;
}
```

The builder accepts the version asynchronously (constructor becomes an async
factory `TelemetryBuilder.create()`, or the version is set via
`setExtensionVersion()` before `finalize()`). Chosen: async factory, because
the version is constant for the process and reads once.

### Phase 5: tests

Follow the filesystem-isolation pattern in `AGENTS.md` (Principle 1) and the
existing `test/cache.test.ts` style.

New file `test/telemetry.test.ts`:

1. **`writeTelemetry` writes expected keys.** Isolated temp dir, build a
   `TelemetryMeta`, call `writeTelemetry(dir, meta)`, read back `meta.json`,
   assert `schemaVersion === 1`, `stages.fetch.succeeded`, etc.
2. **Atomic write leaves no `.tmp` on success.** After a successful write,
   `readdir(dir)` contains `meta.json` and no `.meta.json.*.tmp`.
3. **`disableTelemetry: true` suppresses the file.** This is a settings-level
   test (belongs alongside the orchestrator behaviour). Use the working-
   directory isolation pattern: `process.chdir(mkdtemp(...))`, write
   `.pi/settings.json` with `disableTelemetry: true`, call the orchestrator
   path that writes the sidecar (or unit-test the gating check directly if the
   full orchestrator is too heavy). Assert no `meta.json` is created.
4. **`extensionVersion` reads from `package.json`.** Mock or stub the file
   read; assert the builder records the version string. Falls back to
   `"unknown"` when unreadable.

Existing tests: `test/settings.test.ts` gains a case asserting
`disableTelemetry` reads from both nested and flat keys (mirrors the
`disableLlmsFullDiscovery` tests already there).

### Phase 6: documentation register

Work through the **Affected Documents** table in `PROJECT_BRIEF.md` row by row.
Order matters for review diff size:

1. `README.md` (Cache Structure tree, Settings Reference row, Pipeline note).
2. `docs/ARCHITECTURE.md` (Cache Structure, new Telemetry Sidecar subsection).
3. `skills/intelli-search/SKILL.md` (How It Works list).
4. `AGENTS.md` (Source Structure, Architecture > Cache).
5. `scripts/README.md` (confirm section 9 field names match the implemented
   schema).
6. `CHANGELOG.md` (only after code + tests land; use the release-notes
   skeleton in the brief, fill the date).

Style rules to enforce on every doc edit (CI checks some):
- No U+2014 em-dashes (CI greps).
- No `--` in prose.
- Title Case headings.
- Backtick `Pi` and `intelli-search`.
- README images `width="800"`.

### Phase 7: verification gates

Run in order before considering the work complete (per `AGENTS.md`):

1. `npm run build` (tsc, strict).
2. `npm test` (unit suite, must include the new `test/telemetry.test.ts`).
3. `shellcheck scripts/analyze-sessions.sh` (unchanged, but re-confirm zero
   findings after any script tweak).
4. `bash scripts/analyze-sessions.sh` runs end to end; section 9 still reports
   "no sidecars" until a live run, then populates after one `intelli_research`.
5. One live `intelli_research` call in a scratch project; verify `meta.json`
   appears with all stage fields populated and `schemaVersion: 1`.
6. Optional E2E: extend `test/run-e2e.sh` to assert `meta.json` exists after
   the run. (This costs an LLM call; gate on whether the unit test is
   sufficient.)

## Sequencing and Effort

| Phase | Depends on | Risk | Size |
|---|---|---|---|
| 0 schema | nothing | low | S |
| 1 settings | 0 | low | S |
| 2 writer | 0 | low (atomic rename is standard) | S |
| 4 version | 0 | low | S |
| 3 hooks | 0, 2, 4 | low (fetch winner signal verified present) | M |
| 5 tests | 3 | low | M |
| 6 docs | 3 (for accurate field names) | low | M |
| 7 gates | 5, 6 | low | S |

Recommended commit sequence: (0+1+2+4) as one commit ("Add telemetry module,
settings, atomic writer"), then 3 ("Wire telemetry into pipeline stages"), then
5 ("Add telemetry tests"), then 6 split per document, then 7 as the final
verification before requesting release approval.

## Risks and Mitigations

- **`fetch.ts` winner signal needs surgery.** **Resolved:** `fetch.ts`
  already records `source` per page (verified). Phase 3 is low-risk. This risk
  is retained only as a note for traceability.
- **`completeSimple()` usage shape blocks future token accounting.** Already
  out of scope per the brief. The `schemaVersion: 1` design leaves room to add
  `tokens` fields additively in v0.12.0 without a breaking bump.
- **Hardcoded `CURRENT_VERSION` in `index.ts` is stale.** The plan routes
  around it (Decision D). Fixing it everywhere is a separate cleanup; flagged
  for the user, not silently expanded into.
- **Sidecar write fails on a read-only `cachePath`.** Caught and logged via
  `console.error`, matching the existing cache-suggest failure pattern. The
  pipeline result is unaffected.

## Out of Scope (restated from brief)

Token/cost accounting, cross-session cache-suggest follow-through tracking,
remote telemetry, and pipeline behaviour changes. The `disableTelemetry`
opt-out and the single `meta.json` sidecar are the only user-visible additions.
