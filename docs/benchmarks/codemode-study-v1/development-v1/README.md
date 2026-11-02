# Development Observations

Codemode used more uncached main-model input in both pairs of this single-task development check. This establishes that the driver can record a negative result; it does not estimate a general Codemode effect. The pilot, independent measured series and answer-quality scoring are not complete.

## Scope

The task asks what [_TypeScript_](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html) `satisfies` checks and how it differs from a type assertion. One off/on pair used the same recorded pipeline responses; a separate pair chose tools without prescribed tool names. Both ran on `Pi` 1.4.0 with subscription `openai-codex/gpt-6.1-sol`, build `68303cc`. Pipeline models, source allowances and execution settings were matched within each pair. Both pairs ran on before off under the recorded seed; there is no order-balanced replication here.

The successful fixture capture is setup, not a comparative cell. An earlier capture on `44d614e` failed when collation exhausted its reasoning/output allowance, followed by an incorrect allocation witness. It remains in [earlier-failure.json](earlier-failure.json), and its charge remains in the programme ledger. The corrected capture explicitly names that predecessor. The profile correction preceded every comparative observation.

## Recorded Input

Counts are provider-reported tokens summed over the task's actual main requests. Uncached input follows the prespecified rule: total input minus reported cache-read and cache-write components. No absent component is treated as zero.

| Population | Input Measure | Off | On | On Relative to Off |
|---|---|---:|---:|---:|
| Controlled Replay | Uncached, Primary Endpoint | 3,563 | 5,958 | +67.2% |
| Controlled Replay | Total, Secondary Endpoint | 4,715 | 9,670 | +105.1% |
| Unforced Live | Uncached, Primary Endpoint | 13,481 | 17,117 | +27.0% |
| Unforced Live | Total, Secondary Endpoint | 36,905 | 33,117 | −10.3% |

The live total-input reduction is not a positive primary result: uncached input increased. The measures are reported together rather than selecting the favourable one. The [derived tables](derived/effects.csv) retain missing tasks and unavailable intervals. Only one of the four development tasks has comparative observations, with one pair per population; there is no inferential interval or primary-study claim.

## Observed Routing

In controlled replay, off called `intelli_research` directly; on called the same operation through one script. Both consumed the same complete recording, with no live pipeline inference during replay. Their pipeline accounting reproduces captured usage and cost values as fixture data; the new-cash field is zero, so those reproduced values are not added to spending again.

In the live pair, on used two scripts and three page fetches, without pipeline model inference. Off used three searches and two page fetches. These are observations of unforced routing under equal allowances, not matched realised work. They must not be pooled with controlled replay or interpreted as an isolated compression effect. Recorded durations are retained in [routing.json](routing.json); no speed claim follows from this one pair.

[Final visible answers](answers.json) are preserved verbatim. They have not been independently scored, so this check makes no claim of equal accuracy, coverage or usefulness. The domain parameter was a search hint rather than an enforced source filter: the captured pipeline returned off-domain material too. Both controlled arms received that same recording; the report does not claim that all captured sources were official documentation.

## Spend

[spend.json](spend.json) records USD 0.05983844 in new provider-reported pipeline charges, including the failed capture. Historical reported charges and retained holds bring programme accounting exposure to USD 2.105823226, leaving USD 27.894176774 under the existing ceiling. Exposure includes holds; it is not a claim about actual account debits. Subscription usage is separate from cash. A live on-arm pipeline charge of zero corresponds to no pipeline model attempts, not a missing charge filled with zero.

## Metadata Correction

The original observer read tool declarations only from a top-level `tools` array. These Responses requests carried them in an `additional_tools` item under `input`, so the recorded catalogue digest incorrectly represented an empty array. [metadata-corrections.json](metadata-corrections.json) preserves the original and corrected digests; [tool-catalogues.json](tool-catalogues.json) supplies the observed declarations. The shared dataset uses the corrected field and marks it observed. This correction was computed offline from retained requests. Original request files, observation rows and run manifests were not rewritten, and no model call was repeated. Token counts, costs, outcomes and comparative estimates are unchanged.

## Reproduction

From the repository root, with its development dependencies installed, regenerate the numerical outputs without model calls:

```bash
mkdir -p .tmp/development-v1-reproduction
TMPDIR="$PWD/.tmp/development-v1-reproduction" \
  node --import tsx scripts/benchmarks/study-analysis.ts \
  docs/benchmarks/codemode-study-v1/development-v1/dataset.json \
  .tmp/development-v1-reproduction
```

The generated `analysis.json` and `effects.csv` must match [derived/](derived/) byte for byte. The output directory is disposable scratch, not cited evidence.

The bundle includes the task, normalised observations, per-request reported token components, visible answers, routing, spend and provenance digests. [omissions.json](omissions.json) lists the redactions and their consequences. Local host paths, account headers, provider identifiers, raw message histories and full fetched pages are not shared here. The bundle reproduces the numerical analysis, not private request/hash correlation or source-backed quality scoring. Full private evidence remains under `evidence/benchmarks/codemode-development-20261102/` and `evidence/benchmarks/codemode-development-20261102-r2/` in the retained worktree.

## Next Work

Exercise the remaining development workflows with real main-model inference, complete the pilot and independent quality scoring, then freeze and collect the measured series. This development bundle is not the publication package required to complete the research branch.
