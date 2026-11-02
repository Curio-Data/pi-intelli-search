# Calibration Review Instructions

For the owner or an owner-designated human. This is the human-check step the [Research Plan](../../plans/codemode/RESEARCH-PLAN.md) requires before judge calibration and before final-series scoring. Budget approximately one hour: 10 to 15 minutes per case.

## What Is Being Reviewed

[calibration.json](calibration.json) holds four cases, one per workflow type (`single`, `breadth`, `manual`, `followup`). Each case contains synthetic sources, a question, two candidate answers, a proposed preference and a rationale. Every source and answer in the packet is synthetic calibration material composed on 2 November 2026; none is a live research result, and the packet is disjoint from every measured-population question. The proposed preferences are **unapproved until this review records usable decisions**.

## Procedure

For each case, in this order:

1. Read only the synthetic sources. Confirm they are self-contained and contain no external reference needing lookup.
2. Answer the question from the sources before reading either candidate answer.
3. Compare both candidate answers against the independently formed answer and the rubric dimensions the case focuses on.
4. Record a verdict. The acceptable verdict strings are:
   - `A` or `B`: the named answer is preferred; a usable label.
   - `tie`: both answers are equally acceptable; a usable label.
   - `unscorable`: the sources are ambiguous or the question is unfair. This completes the review of the case but supplies **no usable label**.
5. If a verdict differs from the proposed preference, write one sentence of reasoning.
6. Note any rubric wording that made the decision difficult; that wording is a protocol-revision candidate before scoring.

Reviewing the cases in file order is acceptable; each case is independent.

## Recording the Decision

Write the decisions to `evidence/benchmarks/codemode-study-v1/calibration/decisions.json` using the template below. The template starts with `null` verdicts and is **not** an approval record; only the completed human decisions constitute one.

```json
{
  "schemaVersion": 1,
  "reviewedUtc": null,
  "reviewer": null,
  "reviewedInputs": {
    "calibrationJsonSha256": null,
    "corpusJsonSha256": null
  },
  "decisions": [
    {
      "id": "CAL-01",
      "verdict": null,
      "matchesProposal": null,
      "note": null
    },
    {
      "id": "CAL-02",
      "verdict": null,
      "matchesProposal": null,
      "note": null
    },
    {
      "id": "CAL-03",
      "verdict": null,
      "matchesProposal": null,
      "note": null
    },
    {
      "id": "CAL-04",
      "verdict": null,
      "matchesProposal": null,
      "note": null
    }
  ],
  "rubricWordingIssues": []
}
```

Fill `reviewedUtc` with the review time, `reviewer` with a name or role designation, and both hashes with the SHA-256 of the reviewed `calibration.json` and `corpus.json`.

## Completion Versus Approval

Review completion and approval for calibration are distinct:

- **Completion** means every case has an explicit recorded verdict (`A`, `B`, `tie` or `unscorable`), with reviewer, date and input hashes.
- **Approval for calibration** requires a usable verdict (`A`, `B` or `tie`) for every one of the four case IDs. An `unscorable` verdict supplies no gold preference: before judge calibration runs against the packet, that case must be either revised under a new versioned calibration revision and re-reviewed, or explicitly excluded by a recorded decision in the decisions file.

A file's existence alone is neither completion nor approval. Until approval exists, every proposed label remains unapproved and judge calibration must not proceed against this packet.

## Disagreement Handling

A human verdict that contradicts the proposed preference relabels the case; the proposal is not defended. If the disagreement exposes rubric ambiguity rather than a wrong proposal, record it under `rubricWordingIssues`; a rubric change after this point requires a protocol revision before final-series scoring, per the protocol's change control.

## What This Review Does Not Do

This review does not approve the study, authorise paid runs, calibrate the judges (that follows, using these labels), or score any measured-series answer. It checks four synthetic labels and the rubric's fitness for judging.
