# Deadline and Contention Method

Method revision: `P0-1`. Status: unexecuted exploratory method with later confirmation gate. Read the [common recording/judging/budget rules](../README.md), [corpus manifest](../corpus/manifest.json) and contract C04–C16 before running. This method makes no latency, quality or optimal-default claim.

## Population and Controls

Use only the deadline corpus. Development inputs may tune a candidate; pilot inputs assess variance, cost and instrumentation; held-out inputs validate the selected policy without further tuning. Confirmation reserve is untouched by execution until an independently prespecified series. All use the same query/focus/domain/source identities and explicit effective page cap within a paired block.

Controls are A0 old direct barrier execution, R1 barrier execution, R1 streaming with deadline disabled and explicitly specified enabled candidate policies. The first separates baseline regression from the scheduling change; the disabled control separates streaming from evidence cutoff. Keep model settings, per-run bounds and runtime aggregate limits fixed while varying the named policy. Report any supported setting needed for a control rather than silently comparing different resources.

## Development and Replay

Capture source/model responses only after tranche approval and complete observer/fixture proofs. Complete replay fixes search, each physical page response, extraction, collation and suggestions, including retry/error/usage/cancellation observations. A model-response sequence not reached because a policy cancels a page is labelled skipped, not silently charged or called a miss; a newly requested missing response invalidates the block.

Use an injected scheduler for deterministic comparison and a resource-aware discrete-event model that includes physical fetch slots, model reserve/slots, runtime start spacing, per-run concurrency, queue delay, retries/backoff, correlated stalls, success/failure/empty evidence, minimum evidence, collation, late drain, discovery and suggestions. Measure the model against recorded traces before using it to narrow policies. Synthetic sweeps are labelled synthetic and cannot validate a production default.

Select candidate parameter sets from development observations, freeze them before held-out execution and retain a disabled control. Enabled numbers are always explicit under C03; there is no implicit tuned deadline. Do not optimise against held-out answers or report the historical worked proposal arithmetic as an oracle.

## Measurements

Record page-phase entry, first quorum/success, median cohort, computed adaptive/ceiling times, actual freeze cause, evidence count/minimum status, every page state, summary-ready, return, all-work-settled and abort-to-settled duration. Report queue/pacing/transport/backoff time separately. A page-phase improvement alone is not a whole-tool latency benefit.

Exercise isolated and paired concurrent research operations, including every page-eligible model slot held by late attempts when collation arrives. Record grant order and actual active counts; weighted fairness cannot preempt a held permit. Verify the reserved critical slot, not merely a preferred queue order. Never exempt late work from the hard cap.

The prespecified cancellation target remains C06, with actual native/MCP transport and file cleanup included. Injected signal-honouring stubs cannot pass that live gate. An uncooperative dependency is a failure, not permission to detach it.

## Quality and Later Decision

Use both calibrated blinded judges and source-supported rubric coverage. Distinguish report-used evidence from late retained files; late files do not repair the answer's evidence score. Report evidence loss, critical unsupported claims, unknown cost and technical failures alongside latency, not only successful fast cases.

The pilot forecasts cost and query-level precision before wider validation. Proposed default changes require recorded held-out support and owner acceptance. Confirmatory latency/quality claims require D6's independent margins/design decision. If budget or missingness prevents the matrix from completing, record unfinished cells and retain the accepted unmeasured fallback without a comparative claim.
