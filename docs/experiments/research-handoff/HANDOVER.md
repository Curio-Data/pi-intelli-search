# Research Handoff

Ready for a new lead agent to prepare and implement the bounded experiment. This is not a claim that its runner exists or that paid collection is ready. The owner agreed the new direction and approved `Pi` 1.5.0 for both arms on 4 November 2026.

## Read First

1. [Brief](BRIEF.md): objectives, baseline, shared-source control, measurements, model roles, budget and collection conditions.
2. [Feasibility](FEASIBILITY.md): inspected source seams, new synthetic core proof and untested host boundaries.
3. The branch's `AGENTS.md`: repository rules and experiment-specific validation.

These tracked files are the current handover. The earlier ignored `data-agent.md` packet under `evidence/agents/20261104T090145Z-research-handoff/briefs/` predates the host decision and new-branch instruction; it is historical, not a launch brief. No previous study protocol, result or fixture is needed to understand this assignment.

## Create the Implementation Branch

The recipient is the incoming lead agent and owns the coordinator role described in the brief. The planning agent is not a standing approval dependency. The incoming lead may create the one implementation worktree below; a delegated builder must instead receive a provisioned checkout and must not create branches or spawn agents.

| Item | Value |
|---|---|
| Repository | `/srv/secure/repos/CURIO/pi-intelli-search` |
| Planning Branch | `study/research-handoff` |
| Planning Worktree | `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff` |
| New Implementation Branch | `study/research-handoff-runner` |
| New Worktree | `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner` |
| Product Baseline Commit | `d2ec50611ede2f5d46c062b7e568b13203015c22` |

At handover preparation, the implementation branch and worktree did not exist. Recheck before creation; do not reset, overwrite or remove either if another agent has since created it. If the branch or path exists, inspect its ownership and state and ask the owner before altering it.

1. Inspect the planning branch and working tree. Resolve its current committed tip, record the full commit identifier, and confirm it contains this file, the approved host pin and both companion documents. Do not use the earlier planning commit `e80e849`, which lacks this update. A dirty planning tree requires clarification rather than silently omitting changes.
2. When inside Herdr, load `curio-herdr` before worktree setup and use one workspace for the new worktree. Follow its branch provisioning rules. Keep all repository content and scratch on the encrypted drive.
3. Create the named implementation branch and sibling worktree from that recorded tip. Do not switch or edit the planning checkout, branch from the former experimental branch, or branch directly from `main`. Verify the new checkout's starting commit and that its storage is on the encrypted mount.
4. Provision dependencies from the new checkout's lockfile. The planning worktree has no dependencies or copied ignored data. Do not copy credentials, `.env`, `.e2e-auth/`, old `.search/`, old evidence or mutable state from another checkout. Create new task-owned scratch and evidence directories as needed. No development server or port is required for this command-line study.
5. Verify the actual loaded `Pi` 1.5.0 release and dependency identities from the explicit host path in the brief. Installing repository peers does not establish which host runs the sessions. Do not upgrade the global installation or silently select its moving launcher.

The synthetic feasibility proof is local ignored evidence in the planning worktree. Its absence from the new worktree is expected, not a missing experimental input. The feasibility note already states the proof's limits. Implement new deterministic checks against the source; do not copy a prior study's evidence to make the new checkout runnable.

## First Assignment

Deliver one bounded implementation candidate, not another broad study design. Record the concrete protocol and implementation choices before coding, as required by the brief. The incoming lead owns plan acceptance within the agreed scope; escalate changes to the research question, prescribed models, host, spending ceiling or validity-affecting unresolved choices to the owner.

The candidate must demonstrate:

- An isolated common-input adapter that serves one fresh search capture and frozen page bytes to the unchanged baseline core in both arms.
- A direct baseline call and a Codemode handoff through the actual pinned host, initially exercised with new synthetic dependencies and no live inference.
- A recorder and offline analysis that attribute main-thread traffic and count real model resumptions rather than progress or nested tool events.
- Tests for equal source inputs, preserved baseline output, real saved reports, usage reconciliation, missing records and failure retention.

Choose the first fresh query, useful-answer criteria, candidate return contract, catalogue and paired order before measured data. The proposed initial schedule remains ten repetitions per arm of one query. Do not silently change a single self-contained research call into an unforced tool-routing experiment or a manual baseline.

The baseline already performs internal research work without asking the main model to supervise each stage. Equal interruption counts or increased Codemode overhead are legitimate outcomes. Do not require a positive result.

## Before Paid Collection

The incoming lead accepts the frozen protocol and costed schedule only after the bounded implementation and accounting checks pass. Obtain an independent technical check of the measurement boundary. Reconcile the existing financial ledger identified in the brief, including prior charges, holds and active reservations; retain the standing USD 30 ceiling. A new branch provides no fresh allowance.

Do not run live calls while the protocol, source controls, accounting or available budget remain unresolved. Once the bounded batch is accepted within the existing authority, do not introduce per-call approval requests. Retain failed and nonconforming runs; a diagnostic retry is a new observation, not a replacement.

No prior study data, query set, fixture, judge calibration, analysis rule, experimental runtime or execution script may be imported. Reading the old financial ledger for budget continuity is the sole narrow historical-data exception. A source-control baseline is not prior experimental data.

## Completion and Report

Keep the protocol and analysis documentation under `docs/experiments/research-handoff/`. Keep new raw evidence under `evidence/benchmarks/research-handoff/<new-series-id>/`, and append-only agent reports under `evidence/agents/<new-run-id>/reports/`. Record the new run identity and report location at assignment start. None of these durable records belongs only in scratch.

For the implementation checkpoint, report the branch and commit, exact host/model identities, code changes, tests actually run, proven input equality, request-observer coverage, remaining limitations and collection readiness. A synthetic pass does not establish measured savings. If collection subsequently proceeds, deliver the full retained run inventory, token attribution, resumption counts, answer adequacy, spend and offline reproduction commands.

No package publication, version bump or main merge is authorised. Preserve the planning branch and old evidence. Report unresolved choices plainly rather than importing assumptions from the former study.

## Suggested Starting Prompt

> Read `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff/docs/experiments/research-handoff/HANDOVER.md` and its two companion documents. Act as the incoming lead for the fresh research-handoff experiment. Create the separate implementation branch and worktree from the committed planning tip as instructed. Use the owner-approved `Pi` 1.5.0 host and retained model roles. Deliver the bounded adapter, main-thread measurement path and deterministic actual-host checks before any paid collection. Do not reuse the previous study's scientific material or reconstruct its protocol. Preserve the existing budget obligations and report what is proven versus still untested.
