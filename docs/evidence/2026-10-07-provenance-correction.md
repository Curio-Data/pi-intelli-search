# Provenance Correction

The owner required implementation of the provenance error found in the [MCP routing review](2026-10-07-mcp-routing-review.md), rather than deferral because it predated that branch. The correction lives in shared core and reaches both the native `Pi` extension and Model Context Protocol (MCP) server. Package versions are defined by the two manifests; prepared release entries are in [the changelog](../../CHANGELOG.md). No package is published by this work.

## Implementation

Collation receives a JavaScript Object Notation (JSON) evidence message containing the query and successful, non-empty extractions, each with a source ID. The search summary and cache paths do not enter that message. The model returns synthesis only; code renders the Source Assessment inventory and file references using the `SourceIdentity` that cache writes use. Operation reports contain one inventory. The low-level report writer retains its legacy index for callers that supply raw text without an inventory.

Research evidence is labelled fetched and extracted. Manual collation evidence is labelled caller-supplied, and absent optional full pages are marked `Not cached`. Empty research extractions count as failures. Manual collation rejects an empty evidence set or duplicate extraction URLs before a paid call. The optional `searchSummary` parameter remains accepted; its description now states that it is not synthesis evidence.

Validation checks source IDs, including grouped references, against the evidence set. Prose URLs must occur in a supplied extraction or identify an evidence page; fragments and trailing-slash variations are accepted, but different hosts, schemes and query parameters are not silently merged. Extracted cross-links remain content, not additional fetched sources. Code examples are data. Numbered cache references and model-generated source inventories are rejected before rotation, documentation downloads or cache writes, preserving prior successful output.

The deterministic inventory replaces model-generated relevance and unique-contribution ratings. Reference consistency is not factual accuracy or claim-level grounding: a valid source ID does not prove that its source supports a claim, and URLs in code are examples rather than evidence declarations. Validation failures throw an actionable error; they are not automatically retried and do not commit a fresh report or extraction set. A rerun repeats the operation's paid stages. The safeguards do not promise complete detection of every possible natural-language attribution error.

## Independent Review

Claude Code with Opus 5.5 and `Pi` with native DeepSeek Flash independently examined the frozen candidate. Both confirmed that the original search-citation/source-inventory defect was corrected. Their first reviews found an over-strict validator that rejected ordinary inline endpoints and code examples. The coordinator reproduced the cases and corrected the validation boundary rather than normalising distinct pages into one fetched source.

| Finding | Disposition |
|---|---|
| Developer URLs and code examples rejected | Preserve inline, fenced and indented code; allow cross-links present in extracted content without adding inventory rows |
| Grouped source IDs escape validation | Validate each ID inside the reserved citation grammar, without treating product names such as `[Amazon S3]` or link labels as citations |
| URLs containing parentheses misparsed | Preserve balanced parentheses in URL paths |
| Duplicate report inventories | Operations suppress the legacy index after rendering Source Assessment |
| `searchSummary` description implies synthesis use | Disclose its compatibility-only role; regenerate the frozen tool description |
| Collation telemetry includes deterministic table | Keep `collate.summaryChars` measuring model synthesis, excluding generated inventory |
| Empty failed-source section | List failed extractions, including manual inputs, and align report counts with extraction outcomes |
| Current release guidance points only at prior evidence | Add the current candidate and preserve the previous publication record as history |

The native-contract fixture changes are intentional: prompt text, evidence-only model input, deterministic inventory, report-reading hint and failed-source presentation change. Callable parameters, model defaults and degraded-result fixtures remain unchanged. The maintenance capture regenerated the fixtures; the source and fixture diffs were reviewed, not silently accepted as a refactor.

## Verification

Verification logs and independent reports are retained under the gitignored `.tmp/agents/provenance-fix/`. The initial live attempt hit the Kimi agent-loop weekly quota; it is not a passing pipeline run. The subsequent verification selects native DeepSeek Flash as the agent-loop model while preserving each scenario's pipeline model configuration.

The corrected candidate passes both builds, isolated native and MCP tests, native-contract type checking, generated-file checks, ShellCheck, dependency audit and both independent fresh-tarball installation gates. The test total is maintained in the root README badge. Live scenarios `01_main`, `05_collation_limits`, `11_mcp_stdio` and `13_claude_code_plugin` pass sequentially with provider pacing. This includes default native research, a tight collation output budget, MCP research through `Pi`, and all four Opus routing cases. The first passing corrected Opus run performed two successful research calls in the comparison; both produced completed sidecars and bounded evidence inventories. The final closure rerun passed native research and all four Opus cases again, with one comparison research call. The smaller review findings were also corrected: leading indented code retains its indentation, citation groups accept `and`, and blocked manual evidence is not labelled server-fetched. Both reviewers' final reports state that no implementation blocker remains. Exact-candidate continuous integration (CI) passed for implementation commit `fd0c26d` ([run 37679997280](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37679997280)). The subsequent release verification completed the full paced suite on merged commit `5605a2a` on 2026-10-07, with every mandatory scenario passing and none failed or skipped. Both builds, deterministic tests, generated-file checks, audit, ShellCheck and independent tarball gates passed again. Native fresh installation resolved pi-ai 1.1.0 after a transient upstream tarball 404. [Release Readiness](../RELEASE-READINESS.md#verification-state) records these gates; logs are under gitignored `.tmp/release-016/`. Neither the prior stable release's live suite nor a local tarball install establishes that the unpublished registry pin works. Require fresh exact-commit CI for any later release-preparation edits.

## Release Boundary

Both manifests advance together because shared core changes. The owner subsequently directed a merge to `main` before publication and a fresh-agent release from there (2026-10-07). This overrides the initial release-branch-only merge timing, not the publication gates. The [active handoff](../RELEASE-READINESS.md#release-from-main) explains the temporary unpublished marketplace pin and exact-commit CI validation through the retained release branch. The owner authorised staging of both packages on 2026-10-07. Stage MCP first, wait for the maintainer's separate approval on `npm`, verify clean registry-pin installations, then stage native. The routing work and provenance correction belong to this single core generation; there is no separate MCP-only routing patch.
