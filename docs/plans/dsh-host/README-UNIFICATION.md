# DeepSeek Harness README Unification Plan

**Status:** Released. This plan records the implementation and its historical gates. For the published baseline and subsequent work, start at the [development handover](HANDOVER.md#resume-here). No cleanup is authorised.

**Planning review commit (does not contain this plan):** `0028e94213a4d29fee0bfd92a88d845e71e86360`

**Plan commit:** the newest commit that changed this file on `main` (`git log -1 --format=%H -- docs/plans/dsh-host/README-UNIFICATION.md`); record it in the first integration-branch commit and in each agent brief

**Audience:** the coordinator and fresh implementation agents

**Design basis:** [orchestrator decision](../../../evidence/agents/2026-11-22-dsh-readme-completeness/reports/orchestrator.md), with the independent [Astra](../../../evidence/agents/2026-11-22-dsh-readme-completeness/reports/astra.md) and [Opus](../../../evidence/agents/2026-11-22-dsh-readme-completeness/reports/opus.md) reviews
**Plan reviews:** three Claude Code Opus 5.5 rounds, ending in [READY](../../../evidence/agents/2026-11-22-dsh-readme-unification-plan/reports/plan-review-r3.md), with all blocking and material findings incorporated below

The evidence links in this plan are host-local and gitignored. A fresh clone has the tracked sources and release records but not those review artefacts.

## Objective

Give a reader who encounters only the [_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) npm page or in-harness bundle page everything needed to install, configure, operate, upgrade, troubleshoot and remove `@curio-data/dsh-intelli-search`. Make the root `README.md` the canonical source for shared operator instructions and derive the dsh package README through the same codified approach as the native and Model Context Protocol (MCP) package READMEs.

The goal is complete host-specific coverage, not section-for-section parity with the upstream README. Correct factual defects in the root, MCP and compatibility documentation in the same programme so the generated pages do not continue to contradict one another.

## Fixed Design for This Plan

The review selected an **opt-in `dsh` audience** in `scripts/generate-package-readmes.mjs`.

- Untagged root content is excluded only when deriving `dsh`.
- Visible `packages:mcp,dsh` blocks reach the root, MCP and dsh views.
- Hidden `packages:dsh hidden` blocks supply package-only framing without changing the root view.
- The root DeepSeek Harness section is the canonical shared setup source.
- `scripts/generate-plugin-bundles.mjs` remains the only writer of `plugins/dsh/README.md` in registry and tarball modes.
- `PACKAGES` gains `dsh: ["dsh.README.md"]` only. It never names `plugins/dsh/README.md`, so the preview and shipped output have separate drift gates but one derivation source.
- No generator reads a generated README as its input.
- `scripts/templates/dsh/README.md` is retired after generated coverage is equivalent. The other dsh templates remain hand-edited sources.
- Every dsh README link, including contents and same-page anchor links, is absolute because the in-harness detail page leaves relative links as text.
- Operational documentation uses a generator-owned `mcp-v<version>` ref for release-matched instructions. Evidence and history use `blob/main`: `docs/COMPATIBILITY.md` and `CHANGELOG.md` receive post-publication updates that cannot exist at the release tag.
- Version and host metadata are generator inputs, not new hand-maintained copies.
- Native pipeline code, configuration behaviour and package runtime contracts do not change.

Implementation and delivery to `main` are complete under the owner's D2 approval. For this cycle, that decision defers Stage 5 steps 3 to 6 and the Stage 6 release sequence: version numbers, tags, staging and publication wait for the owner's separate release decision after reviewing `main`. The current evidence and remaining unverified host behaviour are recorded in `docs/COMPATIBILITY.md`.

## Requirement-to-Acceptance Map

| Requirement | Implementation Result | Acceptance Evidence |
|---|---|---|
| Complete configuration discovery | Local defaults, path, strict schema, all roles, complete JSON example, tuning links and restart/reload rules | Example parsed through `parseConfig`; partial configuration rejected; CLI host-path check; generated-page assertions |
| Runnable credential setup | Hidden-prompt standard-input pipeline using a non-exported variable, exact server pin in the dsh page, `Setup complete.` check and preserved custom credential paths | ShellCheck as a syntax gate plus dummy-credential execution in an isolated host; no secret in logs |
| Complete lifecycle | Profile identification, command-line interface (CLI) and Web installation, upgrade, restart and removal, with removal not described as data erasure | Credential-free installation/removal checks; documented upgrade route verified or narrowed to the installed host's documented Web route |
| Correct public evidence | Local, pre-bootstrap and public by-name evidence classes stated separately; matrix includes the public result | Negative controls reject the stale registry sentence and hand-frozen pre-evidence links |
| In-harness readability | Standalone title, correctly nested headings, absolute contents and reference links, no repository-relative dependency | Link assertions on generated and packed README; optional rendered host check recorded separately if performed |
| Operational recovery | Configuration check, tool/workspace/provider diagnostics, two timeout clocks and concrete workload reductions | Exact commands run credential-free; prose review checks symptom-cause-remedy flow |
| Cost, cache and privacy awareness | Local charge notice, cache map, privacy warning and telemetry-versus-cache distinction | Generated-page contract and fresh Opus review |
| One canonical documentation source | Opt-in dsh derivation, shared root blocks, one bundle writer and retired independent README template | Selection, ownership and drift tests in both output modes; preview equals registry output byte-for-byte |
| Current MCP and root guidance | Actual dsh installation command in MCP view; stale compatibility text and frozen links corrected | Generated MCP preview assertions and link validation |
| Coherent maintenance rules | `AGENTS.md`, `scripts/README.md` and root Development text name the same owners and command order | Documentation review and drift gates |

## Content Contract

### Local to the dsh Page

1. Identity, four tools, quick search versus research and batch capability.
2. Prerequisites: dsh range, Node.js floor, pnpm or `pnpmCommand`, `node` and `npx`, first-launch network access, billed OpenRouter account and Linux x86-64 verification boundary.
3. Profile selection, CLI and Web installation, upgrade, restart and removal.
4. Environment and credential-file routes, including environment precedence, custom `apiKeyFile` preservation and a safe standard-input procedure. The procedure uses a non-exported variable such as `key`, requires non-terminal standard input, checks `Setup complete.` and does not overwrite `OPENROUTER_API_KEY`.
5. Workspace selection, fixed-root override consequences and home/root rejection.
6. Zero-configuration defaults, per-user path, a complete strict configuration example, required roles, `defaultUrls` with `maxUrls`, validation and restart/reload behaviour.
7. A credential-free `--check-config` command and both success forms: `Configuration is valid.` for a file and `Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).` for built-ins. Run it from the project directory, then give a labelled inference request. A quick search does not establish full-pipeline success.
8. Bridge and model-call timeout interaction, retry impact and smaller-work remedies.
9. Missing-tool, configuration, workspace and provider troubleshooting written for a human operator. Agent-only substitution rules stay in the skill.
10. A charge notice, compact cache map, privacy warning and telemetry-versus-cache distinction.
11. Accurate evidence classes and the bundle-versus-server licence and NOTICE distinction.
12. Absolute links to configuration, tuning, usage, cost, troubleshooting, cache, privacy, compatibility, changelog and the dsh skill.

The configuration and lifecycle text must preserve these runtime facts:

- With no per-user file in `--host dsh` mode, built-in defaults remain for the process lifetime. Creating the file later requires a restart to select it.
- An existing but invalid per-user file is reread on later calls until it loads. A missing explicitly selected file follows the same lazy path. Every successful load remains fixed for the process lifetime.
- In host mode without `--config`, a loaded file without `apiKeyFile` receives the default credential-path injection. A complete example need not contain `apiKeyFile`.
- Only an absolute X Desktop Group (XDG) configuration home, supplied through `XDG_CONFIG_HOME`, is honoured; a relative value falls back to `$HOME/.config`.
- When no explicit `--workspace` is given, the home and filesystem-root guards reject `--check-config` as well as tool calls.
- `parseConfig` is asynchronous and requires an existing workspace directory.

### Linked Rather Than Duplicated

- Full model constraints, configuration keys and tuning ranges.
- Detailed tool parameters, independent and expansion batches, focused extraction and usage examples.
- Evidence, provenance, output-budget and collation-budget rules.
- Full troubleshooting, cache, same-day refresh and telemetry semantics.
- Pipeline architecture, changelog and agent-facing guidance.

### Deliberately Excluded

- Native `Pi` installation, settings, model registration and migration.
- Claude Code, Codex and generic MCP registration.
- Native configuration recipes, benchmarks and launch material.
- Direct-engine development, contributor and publication procedures.
- Downloads, provenance, sponsor and development-model material.
- A second full tuning table or every upstream recipe.

### Executable Example Rules

- Bash fences contain no angle-bracket placeholders. Set a literal example variable such as `profile=web` in the same fence and quote `"$profile"` at each use.
- A deterministic test rejects unquoted `<[a-z-]+>` placeholders in dsh Bash fences. ShellCheck remains a syntax gate, not proof that a command is runnable or safe.
- JSON fences contain complete valid documents unless explicitly labelled as fragments to merge into an existing file.
- Every version in a generated dsh command comes from the MCP manifest, never a new manual literal. Registry and tarball modes write identical README bytes; substituting a candidate tarball for that registry specification is a separate, recorded verification step in Stage 4A.

## Generator Contract

Freeze these details in Stage 0 before commissioning builders.

1. **Derivation API.** One exported entry point reads canonical `README.md`, validates it and returns a package view. `generateAll()` and the plugin generator both use it. The dsh preview and registry-mode bundle are byte-identical and both carry the standard generated-file header comment; the test suite asserts that contract rather than leaving the header to an integration-time decision.
2. **Contents and source order.** Place dsh-only hidden blocks within the root DeepSeek Harness section so derivation preserves the intended reading order. A `{{DSH_CONTENTS}}` token in a hidden block becomes a `## Contents` heading and TOC markers after block selection. The generator then creates the dsh contents list. Hidden source never contains literal TOC comment markers, because `-->` is forbidden inside hidden blocks; the same prohibition applies to prose and examples in those blocks.
3. **Headings.** Do not add a global heading-level rewrite. Give the shared `#### DeepSeek Harness` heading to MCP and a corresponding `##` heading to dsh through audience-specific blocks. Give every other shared heading an explicitly reviewed level in each view. Preserve root anchors and add aliases before renames. Hidden blocks do not reserve root anchors or enter the root contents list, so duplicate headings can receive different suffixes in different views; validate every link against the relevant derived view rather than copying an anchor suffix by hand.
4. **Absolute anchors.** For dsh only, rewrite same-page `#anchor` links, including contents entries, to the release-matched absolute `plugins/dsh/README.md#anchor` URL. Do not assume bare anchors work in the in-harness renderer. Validate those links against the anchors of the derived dsh text held in memory, never against `plugins/dsh/README.md` on disk, which may be stale or absent during derivation.
5. **Anchor ownership.** Dsh-only headings must not accidentally capture a shared link intended for the full reference. Tests check intended destinations, not only anchor existence.
6. **Link validation.** Candidate validation resolves every selected base, target file and Markdown anchor, including `docs/COMPATIBILITY.md`, `CHANGELOG.md` and the dsh skill. Track A adds `scripts/check-dsh-readme-links.mjs`; the coordinator runs it against candidate content before tagging and against local Git objects at `mcp-v<version>` after tagging, retaining both receipts without a network dependency. The committed-bytes check runs only after `generate:plugins`, while self-anchor validation during derivation uses the in-memory rule above. Evidence and history links must target anchors already on `main`; the candidate checker resolves those anchors against `origin/main` Git objects, avoiding a publication-to-merge window in which a new anchor does not resolve. No workflow change is required unless the coordinator later chooses automation.
7. **Metadata.** Track A creates `scripts/dsh-host-metadata.mjs`. It owns the dsh engine range, Node.js floor and tested-host list. MCP version comes from `packages/mcp/package.json`. The old plugin-generator constants remain temporarily in Stage 1; Track E removes them in Stage 2 and asserts manifest equality with the module.
8. **Tokens.** Freeze `{{MCP_VERSION}}`, `{{DSH_ENGINES_RANGE}}`, `{{DSH_NODE_ENGINES_RANGE}}`, `{{DSH_REFERENCE_VERSION}}` for host-specific statements tied to the rc.1 reference host, `{{DSH_TESTED_VERSIONS}}` for the rendered list of every tested host, and `{{DSH_CONTENTS}}`, plus the token-replacement helper for absolute anchors. Tokens are confined to hidden dsh blocks and agent guidance. Visible root prose uses readable literals checked against metadata.
9. **Substitution order.** In `renderSkill`, replace `{{SETUP}}` before metadata tokens so tokens inside the setup fragment are substituted, then perform the existing unreplaced-token failure. In package derivation, select blocks, substitute metadata, insert contents, rewrite links, then validate. No root, native, MCP, dsh or skill view may contain `{{`.
10. **Publish swap.** Generated native input during `prepublishOnly` is rejected with the existing restore instruction. Bundle generation never consumes that swapped root.
11. **README-reading tests.** Stage 0 names `test/package-readmes.test.ts`, `test/plugin-bundles.test.ts`, `test/config-recipes.test.ts`, `packages/mcp/test/config.test.ts` and `packages/mcp/test/cli.test.ts`. A test file not allocated in a wave is frozen in that wave. The track whose change breaks it names the failure in its report, and the next allocated owner or the coordinator repairs it. Track branches may show generated-output drift before integration because builders do not regenerate coordinator-owned outputs; integrated gates run only after all required merges.

## Implementation Stages

### Stage 0: Baseline and Contracts

**Owner:** coordinator only.

1. Start from the `main` commit that contains this plan; find it with `git log -1 --format=%H -- docs/plans/dsh-host/README-UNIFICATION.md`. If the file is not yet committed, stop and obtain owner approval for that documentation-only commit before commissioning any agent. Otherwise cut `feature/dsh-readme-unification` from the resulting commit and record the commit in the first integration-branch commit and each agent brief. Every cold entry point then reaches the plan and no uncommitted plan files remain in the main checkout.
2. Confirm `.plan/RELEASE-READINESS.md` names this programme and `.plan/dsh-host/README.md` points at this plan, with released 0.25.0 material marked historical. Both were updated in the original checkout on 22 November 2026; recreate equivalent host-local guidance in any other checkout. Create the integration worktree under `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/` and verify it is on the encrypted device.
3. Load the `curio-herdr` skill. Terms in this plan such as `worktree-provision`, roster slot and orchestrator exclusion take their meanings from that skill. Run its full preflight and `roster-check`.
4. Create only the worktrees needed for the active wave. Provision each with `worktree-provision`; prove the toolchain works rather than treating a `node_modules` symlink as sufficient.
5. Write the generator contract and wave ownership into every brief. Builders do not spawn agents, create additional worktrees, edit the plan board or merge their own branches.

**Exit:** contracts and file ownership are written; each worktree passes provisioning and a toolchain smoke check; no product change is required.

### Stage 1: Parallel Contract Implementation and Verification Preparation

Run at most three tracks plus the coordinator. Each implementation track receives its own herdr workspace and worktree. Reports and briefs go directly to the main checkout's `evidence/agents/<run>/`.

| Track | Suggested Agent Role | Exclusive Files | Deliverable |
|---|---|---|---|
| A: package derivation | Builder, primary roster slot | `scripts/generate-package-readmes.mjs`, `scripts/dsh-host-metadata.mjs`, `scripts/check-dsh-readme-links.mjs`, `test/package-readmes.test.ts` | Opt-in dsh derivation, contents and heading support, split ref handling, metadata substitution, preview generation, link checker and unit tests |
| B: host verification | Builder or Deep Researcher, separate roster slot | New dsh-specific verification helpers and a proposed new scenario file only; no runner edits | Credential-free helpers for documented setup, profile and lifecycle commands, with ShellCheck and an execution report |
| C: independent contract review | Reviewer, read-only | No tracked edits | Adversarial review of selection, hidden blocks, publish-swap behaviour, links, metadata ownership and acceptance coverage |

The coordinator reconciles Track C before merging Track A. Track B does not change `test/e2e/18_dsh_plugin.sh`, either suite runner or shared E2E helpers in this wave.

**Parallelism value:** generator mechanics and isolated host-command helpers are independent, while the reviewer challenges the design without waiting for implementation.

**Exit:** Track A's focused tests pass in its worktree; Track B's new scripts pass ShellCheck and have run to completion if they are to be committed; Track C's findings are reconciled. The coordinator merges the reviewed contract changes into integration.

### Stage 2A: Canonical Content

Track D works alone in this stage so the later bundle and validation tracks receive real content.

**Exclusive files:** `README.md`, `guidance/setup-dsh.md`, `docs/COMPATIBILITY.md`, `test/package-readmes.test.ts`, `test/config-recipes.test.ts`.

Deliverables:

- Split the root DeepSeek Harness section from surrounding MCP-only material and mark it `mcp,dsh`.
- Include the actual installation command in the MCP view.
- Correct the stale hidden registry claim and compatibility matrix.
- Restore source-relative links where the generator should route them; remove hand-frozen pre-evidence links. The legitimate `pi.README.md` change from the hand-frozen DeepSeek Harness link in the install-branches paragraph is expected.
- Add the safe setup pipeline to root and agent guidance without starting Codex or exposing a key.
- Supply the complete dsh-only content contract and audience-specific heading levels.
- Keep agent-only instructions in the skill and write symptom-cause-remedy guidance for human readers.
- Update every root-reading test owned by this track. Preserve public anchors, adding aliases before renames.

Track D does not regenerate coordinator-owned outputs. Its report names any expected drift for integration.

### Stage 2B: Parallel Bundle and Document Validation

After Track D merges, reset Tracks E and F to that integration commit.

| Track | Exclusive Files | Deliverable |
|---|---|---|
| E: bundle generation | `scripts/generate-plugin-bundles.mjs`, `test/plugin-bundles.test.ts`, retirement of `scripts/templates/dsh/README.md` | Single bundle writer in both modes, dsh derivation, metadata migration and semantic tests against the real content |
| F: document validation | New focused test files, or `packages/mcp/test/config.test.ts` and `packages/mcp/test/cli.test.ts` by prior allocation | Parse the documented configuration, validate command examples and test runtime defaults and host-path behaviour |

Track E removes the old `DSH_TESTED_VERSION` and engine literals, imports the shared metadata module and tests manifest equality. It also asserts that `dsh.README.md` and registry-mode `plugins/dsh/README.md` are byte-identical.

The coordinator owns `AGENTS.md`, `scripts/README.md`, `test/e2e/18_dsh_plugin.sh`, both E2E runners, `package.json` and every generated output. These files are not assigned to parallel builders. If Track B produced a new scenario, the coordinator registers it in both runners at this point and runs it to completion before committing the integration; an unregistered scenario is not a completed deliverable.

Coordinator documentation amendments include:

- `AGENTS.md` Rule 12 and Source Structure, including `dsh.README.md`, the metadata module and the retirement of the independent README template.
- The Local Declaration: the dsh README's host claims use the installed `@deepseek-ai/dsh-mcp-client`, `dsh-app-boot`, `dsh-launch-environment`, `dsh`, plugin-manager and UI documentation at `0.2.2-rc.1` and `0.2.2-rc.5`; implementation claims use the code and manifests.
- `scripts/README.md` and the root Development paragraph, including the two generation commands and their order.

**Exit:** Tracks E and F report focused checks and exact diffs. The coordinator merges both, resolves integration-only files and only then regenerates and runs shared gates.

### Stage 3: Integrated Deterministic Candidate

**Owner:** coordinator; no parallel gate runs.

1. Run `npm run generate:toc`, `npm run generate:readmes` and `npm run generate:plugins`; inspect the actual diff.
2. Verify:
   - `dsh.README.md` and registry-mode `plugins/dsh/README.md` are byte-identical and contain only absolute links;
   - `packages/mcp/README.md` contains the dsh installation command and current evidence;
   - the expected `pi.README.md` link correction is present, with no unrelated drift in `mcp.README.md`, `PI_CHANGELOG.md` or plugin catalogues;
   - no token, package directive, native-only section or stale registry negative survives;
   - registry and tarball generation both start from pristine canonical source and produce identical intended README bytes. Any tarball substitution in a documented command is confined to the recorded Stage 4A verification procedure.
3. Extract every dsh README Bash fence, reject unquoted placeholders and pass the fences to `shellcheck --shell=bash`. Parse every JSON example; run the complete configuration through `parseConfig` with a temporary workspace and assert all roles, budgets and untouched defaults. Exercise the CLI `--host dsh --check-config` path with an isolated absolute `XDG_CONFIG_HOME`.
4. Run the single controlled deterministic lane, writing temporary pack output under `.tmp/`:

```bash
export TMPDIR="$PWD/.tmp/deterministic"
mkdir -p "$TMPDIR"
git ls-files -z '*.sh' | xargs -0 shellcheck
npm run build:all
npm run test:all
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm run check:toc
npm run check:readmes
npm run check:plugins
npm run check:changelog
npm run test:mcp:install
./test/run-e2e-publish-local.sh
npm audit --audit-level=low
git diff --check
```

Also run the CI em-dash check across Markdown, the dsh `npm pack --dry-run --json --ignore-scripts` inventory assertion and the native tarball check for `PI_CHANGELOG.md`.

5. Update the README badge only if the test count changes, then regenerate affected outputs.

**Exit:** one integrated commit passes every deterministic gate. No independent green run in a builder worktree substitutes for this result.

### Stage 4: Host Verification and Independent Reviews

Stage 4A and 4B may run concurrently only after the integrated tree is frozen for review. No agent edits that tree while checks run.

#### Stage 4A: Credential-Free Host Checks

Use isolated `HOME`, `DSH_HOME`, `DSH_AGENTS_HOME`, XDG directories, npm/pnpm caches and project directories under the integration worktree's `.tmp/`. Use no operator credential or profile. Prepare isolated rc.1 and rc.5 hosts using [Environment and Isolation](PLAN.md#environment-and-isolation): replace its historical worktree path with the integration worktree and install rc.5 into a second prefix with its own `DSH_BIN`.

- Run scenario 18 on `0.2.2-rc.1` and `0.2.2-rc.5` with Node.js `>=24.9.0` and isolated pnpm.
- Before publication, substitute the candidate tarball path for the package specification in the documented standard-input command and record that substitution. Execute with a dummy key. Only Stage 6 verifies the exact registry command.
- Verify documented CLI installation into the profile named by the instructions, four tools, installed skill, `--check-config`, removal and reinstallation.
- Verify a custom absolute XDG path is honoured by the launched server and that a home/root workspace still fails closed.
- Test the documented upgrade command with two locally produced bundle versions, or omit that command and document only the installed host's Web **Versions** and **Update** route. Do not describe an inferred command as tested.
- The coordinator decides whether to commission a Web UI check. If commissioned, inspect the bundle detail document, **Add plugin**, **Versions** and **Update** on the supported Web profile. Otherwise record those routes as taken from installed host documentation, not observed in the UI.
- Retain only redacted, credential-free receipts in `evidence/`; never cite scratch paths in tracked documentation.

Do not run scenario 19 merely because documentation changed. It has separate spend approval and earlier evidence does not need repeating for this programme.

#### Stage 4B: Independent Reviews

- **Code reviewer:** inspect the entire integrated source and test diff, especially selection semantics, link refs, publish-swap behaviour, generator ownership and both output modes.
- **Fresh Claude Code Opus 5.5 Prose Reviewer:** read every affected source and generated page, including root, native and MCP previews, dsh README, skill, compatibility, maintenance guidance and changelog. Apply the repository's correctness, clarity and concision priorities.
- **Optional host-documentation reviewer:** compare every profile, Web, upgrade and environment claim with the installed dsh documentation at the stated versions. This can be the code reviewer if the brief covers that source explicitly.

Herdr is useful here because code, prose and host checks are independent read-only assignments with distinct reports. They must not run full shared test suites concurrently with Stage 4A.

**Exit:** all findings are reconciled in the integration tree. Material prose or generator changes receive targeted follow-up review and repeat the affected deterministic and host checks.

### Stage 5: Required Live Gates and Release Preparation

Obtain explicit owner approval for live provider spend before running either gate in this stage. Record the approved scope and do not retry failed paid calls outside it.

1. Run the repository-required live scenario after changes:

```bash
./test/e2e/01_main.sh
```

2. Before publication, run the complete suite from the integrated release candidate with `DSH_BIN` and isolated pnpm available:

```bash
./test/run-e2e-all.sh
```

Use sequential mode if provider pressure requires it. Do not treat a scenario skip as a pass.

3. The coordinator adds `## [Unreleased]` if absent and writes user-visible entries there during feature work. The release contains MCP and dsh entries only, never a native entry for this work. Date the sections only during release preparation.
4. On `release/<version>`, apply the versioning rule:
   - MCP patch bump;
   - dsh at the exact same version;
   - no native version bump solely for this work;
   - if no intervening release occurs, the next patch from `0.25.0` is `0.25.1`, not a preselected commitment.
5. Run `npm install --package-lock-only`, regenerate every derived file and require exact-commit release-branch CI.
6. Confirm the final tagged tree contains final documentation and changelog bytes. Post-publication evidence goes only to `docs/COMPATIBILITY.md`, `evidence/` and release notes.

### Stage 6: Publication and Post-Publication Verification

These steps require explicit owner approval at each stated stop point.

1. Create the MCP GitHub Release and obtain maintainer approval of its staged package.
2. Confirm the exact MCP version is public.
3. Create the matching dsh GitHub Release and obtain maintainer approval. Use the established `dsh-v*` route; do not repeat the first-publication bootstrap.
4. From clean profiles and fresh caches, verify:
   - public dsh installation by name;
   - exact MCP launcher pin and `--check-config`;
   - four tools and installed skill;
   - the exact documented registry setup command with an approved dummy or test credential, never an operator key;
   - the documented upgrade path from the previous public dsh version where feasible;
   - removal and reinstallation;
   - packed README bytes and link targets against `mcp-v<version>` using `scripts/check-dsh-readme-links.mjs`;
   - first-run `npx` startup time against the separate 60-second discovery deadline.
5. Record public results separately from local-tarball and credentialed historical evidence in `docs/COMPATIBILITY.md` and durable `evidence/`. Evidence links in the published README continue to follow `main`, so these later records become reachable without another package release.
6. Merge to `main` only after both public pins resolve and the final checks pass. Require main CI on the merge commit.

No native GitHub Release is created solely for this programme.

## Herdr Allocation and Merge Order

| Wave | Concurrent Agents | Merge or Collection Order |
|---|---|---|
| Planning reviews complete | Astra and Opus independent README reviews | Orchestrator decision recorded |
| Plan review complete | Fresh Opus plan reviewer | Blocking and material amendments incorporated |
| Stage 1 | A derivation builder, B verification builder, C read-only contract reviewer | C findings reconciled; A then B merged by coordinator |
| Stage 2A | D content builder | D merged before content-dependent tests begin |
| Stage 2B | E bundle builder, F validation builder | E and F merged, then coordinator-owned integration files |
| Stage 4 | Credential-free host checks, code review, Opus prose review | Collect all; coordinator applies and re-verifies corrections |
| Release | No parallel publication tracks | MCP, then dsh, then registry evidence, then `main` |

Use one workspace per worktree and one tab per agent. Review agents working in the shared checkout receive separate tabs. Brief every agent at spawn with an absolute report path and `STATUS: COMPLETE` contract. Check actual model provenance after each run. Select builder and code-review models through the then-current roster and orchestrator exclusion; the prose reviewer is always a fresh Claude Code Opus 5.5 agent.

## File Ownership Summary

### Coordinator-Only

- Integration and release branches, merges and version state.
- `AGENTS.md`, `scripts/README.md`, `CHANGELOG.md`, `package.json`, lockfile and `.plan/` content.
- E2E runners and shared helpers.
- `.github/workflows/*` if release-link validation is later automated.
- Every generated file: `pi.README.md`, `mcp.README.md`, `dsh.README.md`, `packages/mcp/README.md`, `PI_CHANGELOG.md`, plugin bundles and marketplaces.
- Final evidence promotion, publication records and any approved cleanup.

### Suitable for Parallel Ownership

- `scripts/generate-package-readmes.mjs`, `scripts/dsh-host-metadata.mjs`, `scripts/check-dsh-readme-links.mjs` and `test/package-readmes.test.ts` in Stage 1.
- `README.md`, `guidance/setup-dsh.md`, `docs/COMPATIBILITY.md`, `test/package-readmes.test.ts` and `test/config-recipes.test.ts` in Stage 2A.
- `scripts/generate-plugin-bundles.mjs` and `test/plugin-bundles.test.ts` in Stage 2B.
- New focused validation files or explicitly allocated MCP test files.
- New host-verification helpers before runner integration.

No two tracks own the same file in one wave. Ownership of `test/package-readmes.test.ts` passes explicitly from Track A to Track D after Stage 1 merges.

## Evidence and Retention

- Keep briefs and reports in `evidence/agents/<run>/{briefs,reports}`.
- Keep live work in each worktree's `.tmp/`; never write repository content to `/tmp`.
- Promote credential-free verification receipts and checksums to a dated `evidence/` directory before citing them.
- Do not copy operator credentials, raw sessions or unredacted startup logs into evidence.
- Do not delete worktrees, scratch, prior evidence or branches automatically. Retirement requires an inventory and explicit owner approval, with retained material promoted first.

## Completion Criteria

The implementation checkpoint met criteria 2 to 4. The [publication record](../../COMPATIBILITY.md#published-readme-patches-2026-11-23) and [current handover](HANDOVER.md#resume-here) close criteria 5 and 6. For criterion 1, the tagged links and public tarball bytes passed verification; visual rendering and navigation in npm and the harness UI were not tested.

The programme is complete only when:

1. The dsh page satisfies the content contract and every link works in its npm and in-harness contexts.
2. Root, MCP, dsh and compatibility text agree, with evidence classes kept distinct.
3. One canonical source and one writer per output are covered by deterministic drift and semantic tests.
4. Integrated deterministic gates, credential-free dsh host checks, required live gates and independent code and prose reviews pass on the same candidate.
5. Matching MCP and dsh releases are publicly verified, followed by a green merge to `main`.
6. Durable evidence and a current handover identify the released state and any remaining unverified host behaviour.
