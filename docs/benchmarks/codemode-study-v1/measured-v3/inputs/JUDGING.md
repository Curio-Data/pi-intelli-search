# Blinded Quality Judging

Revision: `judging-v5`. This procedure applies the standard corpus rubric to captured answers while hiding arm and run identities. Evidence composition can reveal routing differences because it records what the run's operations retrieved. Human sanity-check labels do not establish judge reliability. Disagreements remain study results.

## Packet Preparation

Prepare packets after the series inventory is complete:

```bash
node --import tsx scripts/benchmarks/study-quality.ts \
  prepare evidence/benchmarks/<series-id> pilot
```

The command requires a committed preparer, refuses an existing packet directory, and atomically publishes immutable, self-contained packets under `quality-v1/packets/`, a private `assignments.json` mapping and a hash manifest. Missing declared cells stay explicit in the manifest. Each available pair contains the exact neutral task turns, source and answer constraints, full rubric, frozen judge prompt, two answers labelled A and B, and each answer's captured evidence. Follow-up answers retain turn boundaries.

A private random seed controls packet identifiers and balanced A/B assignment. Order reverses between repeats of a task and balances within each workflow and population. Judges receive one packet in an isolated working directory outside the repository checkout. They do not receive the private mapping, raw series inventory, other judge's output or coordinator analysis.

Each packet gets one fresh session per prescribed judge: `claude-opus-5-5[1m]` through Claude Code and `openai-codex/gpt-6.1-sol` in a separate fresh session. This bounds context carry-over between packets and repeats. The coordinator runs each judge non-interactively with all tools disabled, low reasoning and a neutral system prompt, passes the packet on stdin and uses an isolated directory outside the repository checkout. `Pi` also disables extensions, skills, prompt templates, context files, MCP and session persistence. Claude Code disables user, project and local setting sources, tools, slash commands, MCP configuration and session persistence outside the checkout. Judges receive no writable access to the series. `STUDY_JUDGE_ISOLATION_ROOT` can select another host's isolation directory.

## Evidence Rules

Pages and extractions retain source state and truncation markers. Candidate and failed source records remain visible without being treated as fetched content. Saved reports and research or collation syntheses are labelled as derived material, not independent primary evidence.

A search summary is a discovery lead. A material claim supported only by a search summary has provenance at most 2. A retrieved page or extraction can corroborate the claim instead. Judges assess only support in the captured evidence, not correctness from outside knowledge.

## Scores

Score every candidate independently on `coverage`, `provenance`, `limitations` and `usefulness`, plus overall. All scores are integers from 0 to 4:

| Score | Meaning |
|---:|---|
| 4 | The answer satisfies the criterion; any omission is minor and does not mislead. |
| 3 | The answer is useful with limited omissions or imprecision that do not undermine its central claims. |
| 2 | The answer has material omissions, unsupported claims or uncertainty handling, but retains useful supported content. |
| 1 | The answer misses central requirements or contains severe unsupported material, with little usable content. |
| 0 | The answer is unusable, absent or centrally contradicts the captured evidence. |

The first three criteria are critical. An overall score of 0 is required when any critical criterion is 0. The overall score is at most one point above the lowest critical criterion score. It is a holistic judgement, not an arithmetic mean.

Each score needs a concise rationale tied to the answer and evidence. `evidenceQuotes` contains exact short quotations copied from that candidate's answer or evidence, or an empty array. Do not infer which system produced an answer, reward verbosity or select a preferred arm. Empty and failed answers remain scoreable. Their scores stay visible in diagnostics, while the prespecified primary missing-data rule remains unchanged.

## Witnessed Dry Runs

Run one non-scoring dry run per harness before the first real session. Use a new durable evidence directory for each attempt:

```bash
node --import tsx scripts/benchmarks/study-judge.ts \
  dry-run 1 evidence/agents/<run>/dry-runs/claude
node --import tsx scripts/benchmarks/study-judge.ts \
  dry-run 2 evidence/agents/<run>/dry-runs/pi
```

The dry run uses the full frozen prompt and rubric with approximately 165 KB of evidence. It checks input delivery, disabled-tool configuration, score rules and the actual reported model. Claude Code must also report a 1,000,000-token context window. It produces no judge score. Retain its receipt before proceeding.

## Output

Run one packet per process:

```bash
node --import tsx scripts/benchmarks/study-judge.ts \
  run evidence/benchmarks/<series-id> 1 Q-packet-identifier
node --import tsx scripts/benchmarks/study-judge.ts \
  run evidence/benchmarks/<series-id> 2 Q-packet-identifier
```

Add `--calibration` for a calibration case. The coordinator allocates a unique session identifier, writes `quality-v1/judge-<n>/<packet-id>.json`, and retains raw standard output, standard error, launch arguments, reported models and hashes under `quality-v1/attempts/`. Judge 1 uses `claude-opus-5-5[1m]`; judge 2 uses `openai-codex/gpt-6.1-sol`. No automatic retry occurs. Model, context, packet and score validation all run before finalisation, so an invalid or crashed attempt remains without a final score file. One separately reviewed fresh attempt is permitted, for at most two retained attempts per packet and judge. A repeat of a scored packet refuses before inference.

Check remaining packets and attempt counts without starting a session:

```bash
node --import tsx scripts/benchmarks/study-judge.ts \
  status evidence/benchmarks/<series-id>
```

Each final file covers both candidates exactly once:

```json
{
  "judgeId": "openai-codex/gpt-6.1-sol",
  "model": "openai-codex/gpt-6.1-sol",
  "session": "fresh-session-for-this-packet",
  "packetId": "Q-packet-identifier",
  "A": {
    "overall": 3,
    "coverage": 3,
    "provenance": 4,
    "limitations": 3,
    "usefulness": 4,
    "rationale": "Concise evidence-backed rationale.",
    "evidenceQuotes": ["Short exact supporting quotation."]
  },
  "B": {
    "overall": 2,
    "coverage": 2,
    "provenance": 3,
    "limitations": 2,
    "usefulness": 3,
    "rationale": "Concise evidence-backed rationale.",
    "evidenceQuotes": []
  }
}
```

## Judge and Human Sanity Checks

After preparing the study packets, prepare the four synthetic calibration cases:

```bash
node --import tsx scripts/benchmarks/study-quality.ts \
  prepare-calibration evidence/benchmarks/<series-id>
```

Each judge uses one fresh session per calibration case and returns `preference` as A, B or tie with a rationale and exact evidence quotations. Files follow the same per-judge directory pattern under `quality-v1/calibration/`. The exporter maps blinded labels back to the original answers, compares them with the owner verdicts and retains inter-judge and judge-human disagreements.

All four owner verdicts favour original answer A, and the owner criticised these cases as trivial. They provide only a weak sanity check of prompt following and label mapping. They do not validate judge reliability or establish answer-quality preservation.

## Export

Run the ordinary offline analysis after the judge files are present:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series <series-id> --analyse pilot
```

The exporter verifies packet, assignment and observation hashes, complete packet coverage, actual reported model identities, the Claude context window, source and harness provenance, per-packet session uniqueness, score ranges and critical-score rules. Quotation checks use decoded answer and evidence text with normalised whitespace. Unmatched quotations are flagged and retained rather than forcing a judge rerun. Judge-file hashes and retained provenance enter the dataset. Validate explicitly with `node --import tsx scripts/benchmarks/study-quality.ts validate evidence/benchmarks/<series-id>` when diagnosing an export failure. It then adds per-criterion scores, judge-disagreement records and a labelled sensitivity estimate that includes scored failed runs to a new dataset snapshot. The sensitivity estimate never repairs or replaces an unavailable primary cell. It never modifies `observations.ndjson` or run manifests. One complete judge can be exported diagnostically while the other remains unavailable. An empty or partial judge directory fails rather than shrinking the scored population.

Quality metrics remain hidden unless the recorded human sanity-check labels match the calibration hash and either the exact corpus hash or a valid `corpus-revision-binding.json`. A revision binding records a blob-level comparison showing that the standard rubric and all in-scope task material are unchanged, admits only `reserve` to `measured-series` partition moves, re-reads and re-hashes the reviewed corpus from Git history, verifies at least two quality-packet manifests covering both corpus revisions, and cites the owner-approved carry-over. The export records `design.humanCalibrationReason` and, for a revision binding, `design.calibrationBindingSha256`; the publication report exposes the same basis. Those labels are a visibility gate, not evidence of judge validity. Pilot and development quality results are diagnostic. Measured-series claims additionally require the post-pilot freeze, complete-population rules, provenance records and disagreement inspection.
