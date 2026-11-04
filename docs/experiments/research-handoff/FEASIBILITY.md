# Fixed-Source Handoff Feasibility

Assessment date: 4 November 2026. Scope: source inspection of the baseline commit recorded in [the brief](BRIEF.md), installed `Pi` documentation and a new credential-free core probe. No previous study observations were used. No live model call or page-network request was made.

## Finding

The fixed-source comparison is feasible with a bounded benchmark adapter. The existing core accepts injected model and page-fetch dependencies, so both arms can consume the same freshly captured search response and page bytes without adding a public source-list parameter or replacing the research algorithm.

It is not an existing command-line mode. The public research tool does not accept a source manifest, the registered native wrapper does not expose immutable per-run injection, and the required main-thread token attribution and resumption analysis still need implementation and actual-host verification. This assessment establishes the core seams, not a ready-to-run experiment or a Codemode saving.

The baseline already makes one self-contained research call and returns a synthesis with cache references. Codemode cannot be credited with eliminating baseline main-model turns that do not exist. The first comparison must preserve that baseline and measure the additional effect of the Codemode invocation and return boundary.

## Source Findings

Paths and line ranges below refer to the baseline commit, not to the previous experimental branch.

| Requirement | Evidence | Finding |
|---|---|---|
| One self-contained baseline call | [`src/tools/intelli-research.ts`](../../../src/tools/intelli-research.ts), `execute`, lines 95–147; [`src/core/operations/research.ts`](../../../src/core/operations/research.ts), `executePipeline`, lines 149–324 | Observed in source: the wrapper invokes the core once. The core performs its own stages and assembles one final text result |
| Supply a common search response | [`src/core/contracts.ts`](../../../src/core/contracts.ts), `ModelClient` and `OperationContext`; [`research.ts`](../../../src/core/operations/research.ts), `runSearchStage`, lines 337–413 | Observed in source: `models.complete` returns text and citation annotations. A benchmark model-client decorator can return a frozen search completion while delegating extraction and collation to the normal client |
| Preserve selection semantics | [`research.ts`](../../../src/core/operations/research.ts), lines 382–383 | Observed in source: URLs from the full search text are merged with annotations and capped. Capture both channels and assert the resulting ordered list; do not use only links scraped from the displayed summary |
| Supply identical page content | [`research.ts`](../../../src/core/operations/research.ts), `ResearchDependencies`, lines 66–73, and `runFetchStage`, lines 423–457 | Observed in source and exercised by the probe: the per-run `fetchPages` dependency can serve frozen `FetchedPage` values to both arms |
| Write useful evidence links | [`research.ts`](../../../src/core/operations/research.ts), lines 275–323; [`src/core/messages.ts`](../../../src/core/messages.ts), `formatCacheAppendix` | Observed in source and exercised by the probe: the result contains the synthesis and saved report path. Necessary failure/truncation diagnostics are part of the existing response |
| Accept a supplied source list through the public tool | [`src/core/schemas.ts`](../../../src/core/schemas.ts), `researchSchema`; [`src/core/contracts.ts`](../../../src/core/contracts.ts), `ResearchParams` | Not supported. Parameters are query, source count, domains and focus, not URLs or a manifest. `domains` guides discovery; it does not freeze inputs |
| Keep search prose out of synthesis evidence | [`src/core/messages.ts`](../../../src/core/messages.ts), `buildCollationMessage` | Observed in source: collation uses extracted evidence, not the search summary. Preserve that boundary |
| Avoid extra sources and previous-cache effects | [`research.ts`](../../../src/core/operations/research.ts), `startLlmsFullDownloads` and `runCacheSuggestStage` | Observed in source: documentation discovery is optional; suggestion judging requires another indexed search. Use equal discovery settings and new workspaces |
| Inject dependencies through actual native registration | [`src/tools/intelli-research.ts`](../../../src/tools/intelli-research.ts), `__harness` and `execute`; [`src/native-operation-context.ts`](../../../src/native-operation-context.ts) | The wrapper has mutable test hooks, but no public immutable per-run factory. Prefer a small benchmark-only factory or registration adapter; do not patch globals across concurrent sessions |

The current baseline's result is text, not the previous experimental structured-result schema. A script calling this tool receives text. Do not write a candidate that assumes `r.summary`, `r.sources` or a newer cache schema exists here.

## Proposed Adapter

Keep the common-input control below the main-model boundary:

```text
Fresh Sonar capture + one page capture
                 |
        Immutable input manifest
           /               \
Baseline session        Codemode session
Direct research call    One script calling research
           \               /
      Same current research core
      Same frozen search/pages
      Live extraction + collation
      Separate .search outputs
```

The search adapter should match the expected query, search configuration and prompt, return a copy of the captured completion and reject unexpected discovery requests. The page adapter should assert the exact URL sequence and return copies of the frozen selected page objects. Assert extraction-input hashes at the actual extraction boundary, after normal truncation and message construction. Keep the fixture outside model-readable workspace paths.

Do not record a replayed search completion as a new paid provider attempt. Common capture charges belong to setup; downstream live extraction and collation charges belong to each execution. The baseline telemetry does not itself make this accounting distinction, so the benchmark must record it explicitly.

An isolated factory can preserve the registered tool's name, arguments, result rendering and progress behaviour while supplying these dependencies. Before measured collection, prove parity with the baseline wrapper under identical synthetic transports. Do not replace the baseline with manual tool orchestration. If an adapter requires production changes, retain default behaviour and review the exact delta rather than importing the former experimental runtime.

For a reduced candidate response, use an explicit and tested result projection. The simplest control returns the baseline text unchanged through Codemode. Extracting a summary from arbitrary Markdown by guessing a delimiter is not a validated projection. A structured result seam, if needed, is new scoped work and must preserve baseline text and diagnostics.

## Host Capabilities and Measurement

The installed `Pi` documentation was inspected at `/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/docs/`. This inspection was evidence about that installed version, not a host-selection decision. The owner subsequently approved the same version for both arms, as recorded in [the brief](BRIEF.md#retained-model-roles-and-budget).

- `codemode.md`, opening and Call Tools: scripts execute tool calls internally and return printed or returned values to the model. Tools without an output schema resolve to text. The `on` mode retains direct declarations; `only` changes their exposure. A concrete mode must be frozen for the candidate.
- `extensions.md`, Calling Other Tools: nested calls carry `parentToolCallId` and emit tool events but do not create ordinary nested tool-result transcript entries. Therefore tool-event counts are not main-model resumption counts.
- `extensions.md`, Before Provider Request and Provider Stream Event: request payload and parsed provider-event hooks support observation at the model boundary. The provider and transport determine coverage. Do not equate a hook invocation with a verified on-wire payload without checking the selected transport.
- `sdk.md`, Session Lifecycle and Subscribing to Events: sessions can be isolated; completed messages and settled-session events distinguish final records from streaming updates and automatic continuation. Software development kit sessions require explicit loading and activation of the Codemode extension.

These are documented capabilities. A new observer must prove coverage on the chosen host/model, correlate requests and usage, separate pipeline from main-model inference, and count post-tool model requests. A provider-supported whole-request token count is feasible; an exact semantic breakdown is not supplied by this interface. Component attribution needs a declared tokenizer/method and a residual or unknown category. Character matching alone is not a token-overhead measurement.

Read the chosen host's full relevant documentation and examples before implementing the host adapter. Do not assume repository development peers are the actual loaded host. No actual Codemode session or provider-usage observation was exercised in this assessment.

## New Core Probe

The credential-free probe used new synthetic inputs and the unmodified baseline core in two empty workspaces. It supplied the same frozen search result and two page bodies through the existing dependencies.

Observed:

- Both invocations completed and fetched the same ordered sources.
- Both produced identical hashes for the two extraction input messages.
- Both wrote readable `report.md` files and returned `.search/` report references.
- The raw-page sentinel strings were absent from the final result.
- Each invocation emitted seven progress events but returned one core result. This is not a measurement of main-model turns: no main-model session ran.
- No model or page-network call occurred; all model outputs in this probe were synthetic.

Durable local proof:

- [Probe source](../../../evidence/benchmarks/research-handoff-feasibility-20261104T090145Z/probe.mts)
- [Probe result](../../../evidence/benchmarks/research-handoff-feasibility-20261104T090145Z/result.json)
- [Recorded invocation and loader identity](../../../evidence/benchmarks/research-handoff-feasibility-20261104T090145Z/invocation.json)

The launch used `node` with the explicit `tsx@4.23.15` loader path and two probe arguments: the inspected baseline checkout and a newly allocated task-owned scratch root. The invocation record retains the original command shape and environment; the random scratch-directory suffix was not retained. It is not a command to overwrite the saved result.

The probe imported the baseline source from the existing `main` checkout and used its installed loader, with all mutable probe state in new task-owned scratch under this worktree. That scratch was removed after the result was retained. The local proof is gitignored and does not travel in a clone; the source findings above remain inspectable from the recorded baseline commit. No old study artefact was a probe input.

## Remaining Work

1. Build the isolated benchmark registration and frozen-input adapter, preserving the baseline's visible contract.
2. Define the candidate return contract and catalogue, then prove one-handoff execution on the actual host with synthetic dependencies.
3. Implement the new main-request observer, attribution and resumption analysis; test its accounting with known synthetic traces before live inference.
4. Freeze the first query, repeated-pair schedule, usefulness criteria, host/models, missing-data handling and costed plan.
5. Collect a fresh source capture and new paired executions after protocol acceptance.

No package redesign is required to establish fixed-input feasibility. Exact measured savings, single-handoff conformance on a live main model and the value of any reduced response remain unknown until those steps are completed.
