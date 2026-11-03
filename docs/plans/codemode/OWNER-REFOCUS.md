# Research-First Owner Decisions

Decision date: 2 November 2026. This record supersedes the release-first sequence and security-investigation continuation for `feat/codemode-research`. It does not change an earlier test result or accept a failed monitor. The [Research Plan](RESEARCH-PLAN.md) applies these decisions; [Resume](RESUME.md) is the fresh-session entrypoint.

## Required Outcome

The owner stated:

> We need the code, we need the research data, we need it in sufficiently reproducible to be able to publish.

The owner also stated the intended use:

> I want experimental data so that we can publish that as part of promoting this package and why it's a superior fit for a lot of users.

The branch must deliver a fair Codemode-off/on comparison, correctly recorded metadata, retained observations, reproducible analysis and a publication-ready report. Code, synthetic tests and a pilot alone are not completion. The reporting rule for this study is to retain and analyse neutral, negative and inconclusive outcomes as well as benefits. Promotional claims must follow the data; the owner decides how to use the completed findings, and no favourable promotional result is promised.

## Decisions

### Research Before Integration

The proposed primary comparison was Codemode off and on on the same build, with equivalent tasks and source budgets. Script-only mode was secondary; separate deadline/query-expansion studies and package publication were removed as prerequisites. The owner answered:

> D1) yes, we will finish the research first. If it provides noticeable benefits, then consider integrating into the main package.

Develop the experimental integration on this branch. Neither merge to the main package nor package publication is authorised. A later integration decision depends on the measured usefulness, not just technical feasibility.

### One Current Host

The proposed study uses one pinned current `Pi` version and removes old-version compatibility testing from this branch's completion requirements. The owner answered:

> D2) agreed. If we agree to incorporate, we can do an impact statement on older versions including using feature gates or retiring the compatability layer.

The coordinator selects the installed `Pi` 1.4.0 as the study host. Record the actual loaded host and dependency identities before measurement; the repository's development peers are not proof of the runtime version. This selection changes no package peer requirement. Older-version impact, feature gates and compatibility-layer retirement belong to the later integration decision.

### Prescribed Models

The question offered keeping the prescribed models or evaluating several main models. The owner answered:

> D3) Agreed

This continuation retains the existing selection rather than introducing a multi-model study:

| Role | Provider and Model |
|---|---|
| Main Agent in Both Arms | `openai-codex/gpt-6.1-sol`, subscription |
| Search | `openrouter/perplexity/sonar` |
| Extract, Collate and Suggest | `openrouter/minimax/minimax-m3` |
| Independent Quality Judges | Subscription `claude-opus-5-5[1m]` through Claude Code; `openai-codex/gpt-6.1-sol` in a separate fresh session |

Record actual model identities, including the routed provider when available. Do not silently substitute a model or make a cross-model generality claim. One judge shares the main model's identity; preserve separate judge results and disagreement.

### Estimate the Effect

The question contrasted retaining the 50% saving hypothesis with estimating gains and losses without that numerical hurdle. The owner answered:

> D4) It makes no difference to the experiment other than focusing the study

Keep 50% as a stated hypothesis where its metric is measurable, not as a condition for completing the research. Freeze measurable endpoints, analysis and claim thresholds before the corresponding comparison data. Do not choose a more favourable metric or sample after inspecting the final results. A failure to establish 50% savings can still be a completed and useful study.

### Spend and Reporting

The question asked whether to replace the existing approximately US$30 envelope. The owner answered:

> D5) Keep the same ceiling. I suspect we will be well under. It's good practice however to try anf track the spend and report it with the other metrics.

Use a hard ceiling of 30 United States dollars (USD), not a target or a fresh allowance per batch. Track spend, incomplete charge information and conservative pending exposure; report them with the results. Before new paid work, conservatively count all known OpenRouter charges and retained unknown-charge exposure from this branch's programme against that ceiling, showing study and engineering expense separately. Deduplicate original invocation identities across carried receipts; do not add whole historical tranche ceilings, count copied ledger rows twice or reset old records. Do not assume the entire ceiling remains available. Subscription usage is reported separately from cash spend. Research execution within the remaining ceiling follows the recorded protocol and readiness checks; do not request repeated approval for each routine call. An increase needs owner approval.

## Work Stopped or Deferred

The owner explicitly stopped exploring security implications and required a return to the research question. No new egress-monitor generation, adversarial networking investigation, private old-host repair or security-isolation framework is commissioned. Preserve previous findings as history. An encountered security question is reported plainly to the owner for a version or risk decision, not expanded into a new workstream.

Separate deadline and query-expansion studies, broader platform qualification, package release preparation and a polished interactive progress display are not prerequisites for the core comparison. Keep the existing engine capabilities equal between arms. Preserve ordinary credential care, bounded calls, cancellation, spend accounting and scientific validity checks; stopping the security work does not authorise exposing credentials or inventing observations.

## Measured-Series Decisions, 3 November 2026

After reviewing the scored pilot and the proposed measured-series freeze, the owner made four further decisions before capture:

- **D1:** Settled answers with operation failures count as valid observations in their arm. Incomplete usage, changed catalogues, replay misses, unfinished responses and interruptions remain technical missingness.
- **D2:** Manual replay is reported separately from the replay primary analysis. Off-arm copy mismatches remain reliability findings rather than being hidden or repaired by live fallback.
- **D3:** Include all eight reserve tasks for a 20-task measured population. Exposure labels remain unchanged.
- **D4:** Accept a live population dominated by branch-only fetch for now, with claims restricted accordingly. The owner will make a final integration judgement after assessment.
- **D1 (capture):** Permit one failed-capture rerun with a new identity and recorded reason. Its replay cells can use the recaptured fixture while the failed capture remains retained.
- **D2 (budgets):** A budget-limited tool call with a settled answer for every prompt counts as a valid task outcome. Provider, transport, catalogue, replay, usage and unfinished-response failures remain technical missingness.

These decisions revise the pre-capture protocol and schedule. They do not reopen historical runs, change prescribed models, increase the USD 30 ceiling or authorise package integration or publication.

## Authority and Preservation

This decision record and the Research Plan govern current scope, sequencing and completion. Earlier contract/API declarations retain their value as accepted implementation references; their release-first sequencing, old-host gates and earlier paid-canary order do not govern this research continuation. The frozen old method and corpus remain unchanged as historical inputs. New protocol and corpus revisions must identify what is retained, extended or superseded before capture; historical hashes and accepted results are never rewritten.

The exact owner exchange and the preceding questions are preserved in `evidence/codemode/20261102T133135Z-research-refocus/OWNER-EXCHANGE.json`. This tracked record carries the decisions for a clean checkout; the local evidence copy preserves their original session provenance. Existing stopped ledgers and historical live scenarios are not reopened by this approval.
