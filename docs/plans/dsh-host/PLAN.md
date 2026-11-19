# DeepSeek Harness Phase 2 Implementation Plan

## Purpose

Build, verify, document and publish `@curio-data/dsh-intelli-search`, a generated DeepSeek Harness (`dsh`) bundle that launches the existing standalone Model Context Protocol (MCP) server and registers the shared research skill. A fresh agent can execute this plan without prior conversation context.

Read in this order:

1. `HANDOVER.md` beside this plan for entry checks and prohibitions.
2. `docs/proposals/dsh-host-support-proposal.md` § Resume Here, whose corrections govern the older proposal text (`:7-51`).

All proposal paths and line citations in this plan name `docs/proposals/dsh-host-support-proposal.md` on `explore/dsh-host`, not the main-checkout copy, which predates Phase 1 and has no Resume Here. The line numbers were taken at `56d8392` (439 lines); the later commit that moved this plan onto the branch changed only proposal line 48 in place, so no cited line moved.
3. This plan.
4. The Phase 1 evidence at `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md`.
5. `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md` and `.plan/RELEASE-READINESS.md` before release work.

## Scope and Non-Goals

Phase 2 covers the generated bundle, shared guidance, deterministic and live-host tests, release plumbing, documentation, evidence and publication. The adapter spike is already committed; do not reimplement proposal § 7.

Do not:

- create a native dsh extension, a second pipeline, a dsh search-provider replacement, a settings card or a separate repository;
- change `src/`, the native extension, cache format or shared engine for this feature;
- claim an official community catalogue, YAML pull-request submission or mandatory `dsh-plugin` topic;
- widen the tested host range without evidence, or claim Windows verification;
- add dsh execution to the existing Node.js 22 CI job;
- publish, create a GitHub Release, approve an npm staging, merge to `main` or use credentials without the explicit owner stop points below.

These boundaries follow the proposal's non-goals and the corrections in Resume Here (`docs/proposals/dsh-host-support-proposal.md:19-29`, `:433-439`).

## Fixed Decisions

The owner adopted D1 to D6 on 2026-11-19 (`docs/proposals/dsh-host-support-proposal.md:31-44`). Treat them as constraints, not open questions.

| Decision | Fixed Choice | Code Consequence |
|---|---|---|
| D1 | Server name `intelli` | The dsh patch uses `serverName: intelli`; generated guidance uses `mcp__intelli__intelli_search`, `mcp__intelli__intelli_extract`, `mcp__intelli__intelli_collate` and `mcp__intelli__intelli_research`. Do not change the other hosts' `intelli_search` server names. |
| D2 | One shared per-user configuration | Keep the committed `hostPaths()` behaviour: `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search`. `--host dsh` uses it and the current launch directory; explicit `--config` and `--workspace` remain overrides. |
| D3 | Publish `@curio-data/dsh-intelli-search` with its own tag | Add the `dsh-vX.Y.Z` release route and publish from `plugins/dsh`. The one-time first-publication bootstrap in OPS still applies before trusted publishing can work. |
| D4 | Workspace is the launch directory | Preserve the committed home/filesystem-root guard. Document that a later directory change does not move the cache; a bridge-row `cwd` override is available for a fixed root. |
| D5 | Reproduce credentialed evidence first | Do not write a dsh compatibility row from the contributor's report. Run the separate opt-in credentialed verification with owner-supplied DeepSeek and OpenRouter keys, then record only observed capabilities. |
| D6 | Build in this repository | Extend `scripts/generate-plugin-bundles.mjs`, `guidance/` and the existing drift gate. Do not create a second generator or repository. |

## Starting State and Evidence

**Observed on 2026-11-19:** the worktree is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host`, branch `explore/dsh-host`, HEAD `56d8392258343f0ef7b35c5ae2730513d6368b5d` and clean at planning time. A later commit moved this plan from the gitignored `.plan/dsh-host/` into `docs/plans/dsh-host/` on the branch and pushed it to `origin/explore/dsh-host`; this records state, not approval for another push.

| Commit | Existing Content |
|---|---|
| `0529c95` | Adapter spike: `--host dsh`, shared per-user paths, launch-directory workspace, help and diagnostics, with unit tests. Phase 1 recorded passing `build:all`, `test:all` and audit. |
| `5f2160c` | Proposal now records Phase 1 results and the initial owner decisions. |
| `56d8392` | Proposal's Owner Decisions table records all six recommendations adopted on 2026-11-19. |

The branch has no `plugins/dsh/`, `guidance/setup-dsh.md`, scenario 18, dsh release tag handling or dsh compatibility row. **Observed:** those absences were checked against the tree. The generated Claude Code and Codex bundles already come from one generator and guidance source (`scripts/generate-plugin-bundles.mjs:84-167`; `README.md:1425`).

Host evidence is version-specific:

- **Observed in Phase 1:** registry `latest` was `dsh` `0.2.2-rc.1`; `next` was `0.2.2-rc.5`. Recheck registry tags before release, without silently moving the evidence base.
- **Observed in Phase 1:** dsh requires Node.js `>=24.9.0`; the existing CI job selects Node.js 22 (`.github/workflows/ci.yml:24-30`).
- **Observed in Phase 1:** a hand-inserted bridge row started the standalone server and exposed all four `mcp__intelli__*` tools. A scratch runtime skill registration loaded after frontmatter removal.
- **Observed in Phase 1:** tools were absent in an immediate independent probe and present after discovery settled. Scenario 18 must poll with a deadline, not use a fixed sleep.
- **Stated by the installed host documentation and recorded in Phase 1:** the bridge ships but no default row mounts it; the default call timeout is 60 seconds; startup/discovery have a separate 60-second protocol default; `failOnStartupError: false` can leave a running host with no tools.
- **Observed in Phase 1:** project skills outrank runtime skill registration, but user skills do not. Do not promise user-level same-name overrides.
- **Stated by the installed host documentation and recorded in Phase 1:** inherited environment outranks the launch directory's `.env`, which outranks `$DSH_HOME/.env`; all accepted layers are materialised at launch. The MCP child still needs the explicit environment expression because credential-shaped ambient names are scrubbed.
- **Stated by the tagged host guide and recorded in Phase 1:** custom discovery indexes are JSON documents with `format: 1`; there is no official index or catalogue submission queue.
- **Unknown:** model-backed tool use, real credential use, real research, real-session cache placement, unattended approval, first-run `npx` latency and behaviour on `next` remain unverified.

## Environment and Isolation

Run repository commands from the worktree. Keep scratch under its `.tmp/`; never use `/tmp` for repository-derived content. Do not read or write `~/.dsh`, `~/.pi`, `~/.claude`, `~/.codex` or `~/.agents` for this work.

Select a runtime satisfying both the repository and host:

```bash
cd /srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host
fnm use 24.19.0
node --version
```

**Observed on 2026-11-19:** `fnm` 1.39.0 and Node.js 24.19.0 are installed on this host. Expected `node --version`: `v24.19.0`. Another installed version is acceptable only if it is `>=24.9.0`; record the actual version.

Install or reuse the pinned host in scratch:

```bash
mkdir -p .tmp/dsh/{home,agents,npm-cache,prefix,workspace,xdg}
DSH_HOME="$PWD/.tmp/dsh/home" \
DSH_AGENTS_HOME="$PWD/.tmp/dsh/agents" \
npm_config_cache="$PWD/.tmp/dsh/npm-cache" \
npm install --prefix "$PWD/.tmp/dsh/prefix" @deepseek-ai/dsh@0.2.2-rc.1

export DSH_HOME="$PWD/.tmp/dsh/home"
export DSH_AGENTS_HOME="$PWD/.tmp/dsh/agents"
export XDG_CONFIG_HOME="$PWD/.tmp/dsh/xdg"
export DSH_BIN="$PWD/.tmp/dsh/prefix/node_modules/.bin/dsh"
"$DSH_BIN" --version
```

Expected host version: `0.2.2-rc.1`. `XDG_CONFIG_HOME` keeps the adapter's shared configuration in scratch. Do not put `DSH_*` or `XDG_*` assignments in a `.env` file. **Stated:** `@deepseek-ai/dsh-app-boot@0.2.2-rc.1` README § Profiles rejects bootstrap variables from those files.

`dsh plugin` forwards package operations to pnpm (**Observed** in Phase 1: `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md:35`, Host Facts, Install). **Observed on 2026-11-19:** `pnpm` is absent from this host's PATH. Before scenario 18, either provide pnpm on PATH or install an isolated copy:

```bash
npm install --prefix "$PWD/.tmp/dsh/pnpm" pnpm
export PATH="$PWD/.tmp/dsh/pnpm/node_modules/.bin:$PATH"
pnpm --version
```

Record the pnpm version in the run evidence. Do not install dsh or pnpm globally.

## Execution Rules

- Each implementation step is one commit unless a review correction needs a follow-up commit.
- Before every commit, inspect `git status --short` and the actual diff. Use the repository's configured identity and add no co-author lines, following the global house rule (`/home/miah0x41/.pi/agent/AGENTS.md:290-299`).
- Run gates in this worktree only. Do not run shared builds or suites in the main checkout.
- `npm run build:all` and `npm run test:all` are the aggregate deterministic gates (`package.json:36-51`). `npm run check:plugins` is the bidirectional generated-file gate (`scripts/generate-plugin-bundles.mjs:320-369`).
- Run `npm audit --audit-level=low` after dependency or packaging changes and before release. The repository's broader per-change rules also name build, tests, scenario 01 and audit (`AGENTS.md:665-672`); do not run scenario 01 during credential-free steps because it makes provider calls.
- A new E2E script must run to completion before commit and pass ShellCheck with zero findings (`AGENTS.md:655-663`). Scenario 18 needs no model key; its dummy credential is not a provider credential.
- Promote evidence worth keeping out of `.tmp/` before citing it. Use main-checkout `evidence/` paths named below, never a scratch citation (`AGENTS.md:723-735`).

## Review and Approval Gates

- An independent reviewer using a model other than the implementer's reviews the final code and test diff. Review corrections return to the owning step.
- A fresh Claude Code Opus 5.5 session reviews every user-facing prose change. This includes source guidance, generated bundle text, locales, README, compatibility, architecture, script guidance and changelog prose.
- A Builder does not spawn reviewers or create worktrees. Report the step review-ready to the coordinator and stop until the review is assigned and findings are returned.
- Stop for the owner before credentialed Steps 5 and 6 live runs, the first-package bootstrap, every GitHub Release, every npm staging approval, and merge to `main`. These actions are not covered by implementation approval.

## Step 1: Generate the Complete dsh Bundle

### Files

Change:

- `scripts/generate-plugin-bundles.mjs`
- `test/plugin-bundles.test.ts`

Create source inputs:

- `guidance/setup-dsh.md`
- `scripts/templates/dsh/index.js`
- `scripts/templates/dsh/icon.svg`
- `scripts/templates/dsh/README.md`

Generate, never hand-edit:

- `plugins/dsh/package.json`
- `plugins/dsh/cordis.patch.yml`
- `plugins/dsh/index.js`
- `plugins/dsh/skills/intelli-search/SKILL.md`
- `plugins/dsh/locale/en.json`
- `plugins/dsh/locale/zh.json`
- `plugins/dsh/icon.svg`
- `plugins/dsh/README.md`
- `plugins/dsh/LICENSE`

### Implementation

Follow proposal §§ 8 and 9 as corrected by Resume Here and D1 to D6.

1. Extend `launcherFor()` without changing existing launcher bytes. Registry dsh mode returns `npx -y --package @curio-data/mcp-intelli-search@<exact-mcp-version> mcp-intelli-search --host dsh`. Tarball dsh mode returns `node <absolute-dsh-vendor>/node_modules/@curio-data/mcp-intelli-search/dist/cli.js --host dsh`.
2. Keep the existing `--codex-vendor-dir` interface unchanged. Pass the tarball `--output` into `generateFiles()` and derive the dsh vendor directory as `<output>/plugins/dsh/vendor`; allow an internal explicit override for direct tests. This avoids changing scenarios 12 to 14, whose current generator calls are at `test/e2e/12_plugin_bundles.sh:115-117`, `test/e2e/13_claude_code_plugin.sh:121-123` and `test/e2e/14_codex_plugin.sh:159-161`.
3. Add a dsh `renderSkill()` mapping: prefix `mcp__intelli__`, host label `DeepSeek Harness`, and cache hint ``Use the `read` tool, this host's file-reading capability.`` Leave `guidance/research-guide.md` unchanged; its host-specific tool tokens and setup/cache placeholders already cover the differences (`guidance/research-guide.md:1-12`, `:192`, `:231`). The current guide has no `{{HOST}}` occurrence to replace.
4. Add every `plugins/dsh` output to `generateFiles()` and add `plugins/dsh` to `GENERATED_ROOTS`. The drift gate must detect missing, different and unexpected files. Update the fake-root test setup to copy the new templates, `guidance/`, MCP metadata and the root `LICENSE` (`test/plugin-bundles.test.ts:323-343`).
5. Emit a package manifest with:
   - `name: @curio-data/dsh-intelli-search`, the exact MCP version, `type: module`, Apache-2.0 licence and repository directory `plugins/dsh`;
   - `dsh.manifestVersion: 1` and `dsh.bundle.patch: ./cordis.patch.yml`;
   - exports for `.`, `./locale/*.json` and `./icon`;
   - a `files` allowlist covering every generated payload and `LICENSE`;
   - in tarball mode only, `vendor/**` in that allowlist so a local dsh package installation retains the vendored server; registry mode must omit it;
   - `engines.node: >=24.9.0` and initially exact `engines.dsh: 0.2.2-rc.1`, because no broader range has evidence. Widen it only after a recorded check.
6. Emit `cordis.patch.yml` with two inserted rows:
   - `mcp-intelli-search` using `@deepseek-ai/dsh-mcp-client`, `serverName: intelli`, stdio, the selected launcher, `OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''`, `toolCallTimeoutMs: 600000` and `failOnStartupError: false`;
   - `intelli-search-skill` using `@curio-data/dsh-intelli-search`.
7. Implement the registrar template with no host import or package dependency. Read the sibling skill through `import.meta.url`; parse only the generator's frontmatter shape; require `name` and nonempty `description`; carry optional `whenToUse`; strip the complete frontmatter block; call `ctx.skills.register()` with `source: "bundled"`, the instruction `path`, frontmatter-free `content`, and a directory `resourceBase`. Export `apply(ctx)` as the Cordis object-plugin entry point, alongside `name` and `inject = ["skills"]`. Do not claim to parse arbitrary YAML.
8. Generate English and Chinese locale `meta.title` and `meta.description`. Supply original, distinct SVG artwork below the host's 256 KiB manifest-icon limit. Copy the root `LICENSE` verbatim. Do not copy the root `NOTICE`: its listed runtime dependencies are not bundled in this package (`NOTICE:1-41`).
9. Write `guidance/setup-dsh.md` and the bundle README with installation, credential precedence, restart requirement, launch-directory cache semantics, all four tool names, missing-tool diagnostics, call-versus-startup timeout distinction, verification, removal and evidence limits. State that the managed model-settings credential does not provision the MCP child. Do not say `$DSH_HOME/.env` is the only source or that user skills override the runtime skill.
10. Do not add a repository marketplace entry: dsh installs the npm bundle directly, unlike the existing repository-catalogue hosts.

### Deterministic Tests

Extend `test/plugin-bundles.test.ts` to assert:

- the exact three-host generated file set, including no stray dsh files;
- exact registry and tarball dsh launchers, exact MCP pin and derived vendor path;
- dsh manifest fields, version, exports, files, licence, Node floor and exact tested dsh version, including `vendor/**` only in tarball mode;
- both patch rows and every required bridge value, including the literal environment expression;
- all four dsh-qualified skill tool names and no unreplaced tokens;
- no credentials, checkout paths or `../../src` in generated output;
- Claude Code and Codex outputs remain byte-identical to their pre-change contents;
- missing dsh tarball path fails in a direct `launcherFor()` test;
- drift detection reports a missing, changed or unexpected dsh file.

For registrar contract tests, write a generated tree to the test runner's isolated scratch, import the generated registrar with a mock `ctx.skills.register()`, and assert the captured registration's name, description, optional metadata, source, path, resource base and frontmatter-free content. Mutate isolated fixtures to prove missing name, empty description and malformed frontmatter fail. Do not read the operator's agent directory.

Run `(cd plugins/dsh && npm pack --dry-run --json --ignore-scripts)` in a test and assert the exact required package contents, including `LICENSE`, with no vendor tree, scratch, secret or test fixture. The dsh directory is not an npm workspace; the root workspace list contains only `packages/mcp` (`package.json:25-27`), so run the command in the dsh directory rather than using `--workspace`.

### Gates and Acceptance

```bash
npm run generate:plugins
npm run check:plugins
npm run build:all
npm run test:all
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm audit --audit-level=low
(cd plugins/dsh && npm pack --dry-run --json --ignore-scripts)
if rg -n '\x{2014}' --glob '*.md' --glob '!AGENTS.md' .; then exit 1; fi
git diff --check
```

Accept only when all commands exit `0`, all generated files exist, the pack inventory is exact, and existing host outputs are unchanged. Obtain a fresh Opus 5.5 prose review of the guidance, locales and bundle README before commit. Commit as `Generate DeepSeek Harness host bundle`.

## Step 2: Add and Execute Credential-Free Scenario 18

### Files

Create:

- `test/e2e/18_dsh_plugin.sh`
- `test/e2e/dsh/inspect.mjs`
- `test/e2e/dsh/credential-launcher.mjs`

Change:

- `test/run-e2e-all.sh`
- `test/run-e2e-parallel.sh`

### Implementation

Model isolation and local-tarball generation on scenarios 12 and 14, and dummy credential delivery on scenario 12 only (`test/e2e/12_plugin_bundles.sh:48-139`, `:191-266`; `test/e2e/14_codex_plugin.sh:112-164`). Scenario 14's dedicated Codex login is real, not a dummy pattern. Resume Here explicitly makes scenario 18 credential-free and replaces disable/enable with removal/reinstallation (`docs/proposals/dsh-host-support-proposal.md:27`, `:46-51`).

1. Start with `set -euo pipefail`, logging under `.e2e-logs/`, scratch under the worktree's `.tmp/`, and cleanup that retains failures without retaining any real credential. Honour `E2E_SKIP_BUILD=1` as scenarios 12 and 14 do: use the suite's prebuilt output and pack with `--ignore-scripts`, avoiding a rebuild while another scenario loads it (`test/e2e/12_plugin_bundles.sh:97-105`; `test/e2e/14_codex_plugin.sh:146-153`).
2. Require `node`, `npm`, `jq`, `rg`, `pnpm` and a host selected by `DSH_BIN` or PATH. Match scenario 12's failure classes: exit `1` for missing basic tools; exit `77` with the exact prerequisite for missing dsh, missing pnpm or a Node runtime below `24.9.0`. Record host, Node and pnpm versions.
3. Isolate `HOME`, `DSH_HOME`, `DSH_AGENTS_HOME`, `XDG_CONFIG_HOME`, npm/pnpm caches and the project workspace. Assert their canonical paths remain under scenario scratch. Never copy or inspect an operator login. Unset `DEEPSEEK_API_KEY` and other inherited provider credentials so the headless host cannot make an accidental model call; its expected missing-key failure occurs after the inspection probe.
4. Build and pack MCP once, generate tarball-mode bundles into `<scratch-output>`, and install the MCP tarball into `<scratch-output>/plugins/dsh/vendor`, never the tracked `plugins/dsh/`. Create the profile explicitly with `"$DSH_BIN" --profile <name> --from-default-profile headless --dump-config`, then install the local dsh bundle with `"$DSH_BIN" plugin --profile <name> add <local-path>`.
5. Run `--dump-config` and assert both bundle rows. Run the vendored CLI with `--host dsh --check-config` from the project and assert the built-in dsh-defaults message. Repeat from scratch home and filesystem root and assert nonzero status plus the dsh workspace diagnostic.
6. Mount the inspector through the scenario-owned profile user layer `$DSH_HOME/profiles/<name>/cordis.patch.yml`, not by adding it to the generated bundle. Append an `- insert:` row with `id: intelli-inspector` and `name: <absolute-path-to-test/e2e/dsh/inspect.mjs>`. **Observed in Phase 1:** an absolute local-module name works in this row. Use `--dump-config` to prove that row is composed. The inspector polls `ctx.tools.definitions()` until the four exact names appear or a bounded deadline expires, then checks the `intelli-search` catalogue entry and `ctx.skills.get()` body, path and resource base. Write only bounded results and diagnostics to scratch. Poll because Phase 1 observed the independent-probe startup race.
7. For dummy delivery only, target the existing `mcp-intelli-search` id in that same profile user layer with a non-`insert` patch, assert the module name, and restate the complete bridge config with `command`/`args` launching `credential-launcher.mjs` and then the real vendored CLI. **Stated by the installed app-boot documentation:** an id-targeted user patch replaces the whole config rather than deep-merging it. Do not insert a second row with `serverName: intelli`. Before running the credential case, use `--dump-config` to prove exactly one composed bridge row remains and its effective command is the wrapper. This dump is the implementer's first confirmation of replacement semantics; a duplicate or unchanged command fails the run. The wrapper records only whether the expected dummy arrived, adjusts `process.argv`, and imports the real CLI. Put the invented dummy in isolated `$DSH_HOME/.env` with user-only permissions; never print or log it. Do not call a provider. A `--patch <path>` overlay is available but is not the scenario's chosen mechanism.
8. Verify no-key startup still exposes the tools. Separately configure a user-only dummy credential file, supply an empty environment value and assert `--check-config` accepts the configuration. Existing `resolveCredential()` unit tests own selection semantics; this credential-free scenario must not claim a live file fallback. Step 5 verifies that fallback with an authorised real call.
9. Before removal, delete the credential override from the profile user layer and verify with `--dump-config` that only the original bundle bridge row and the inspector remain. Keep the inspector row across removal and reinstallation; package removal does not own or remove the user layer. Remove `@curio-data/dsh-intelli-search`, dump the profile to prove the bundle rows are gone, and start a fresh host process to assert the bundle's four tools and skill are absent while the inspector remains mounted. Reinstall, verify both bundle rows in the dump, and assert tools and skill return. Do not describe this as a UI disable/enable test or count the inspector as bundle output.
10. Add scenario 18 to both runner arrays after scenario 17. Keep it out of the Node.js 22 CI job. **Observed:** `run-e2e-all.sh` exits `1` when any scenario is skipped (`test/run-e2e-all.sh:143-156`, `:213-222`), and `run-e2e-parallel.sh` propagates any nonzero scenario status into its final failure (`test/run-e2e-parallel.sh:131-145`, `:150-172`). Consequently the full suite requires the pinned host and isolated pnpm prepared per Environment and Isolation, with `DSH_BIN` and the pnpm `PATH` exported before either runner starts; otherwise scenario 18 exits `77` and the suite fails. Scenario 18 itself makes no provider calls.

### Gates and Acceptance

With `DSH_BIN` and the isolated pnpm directory already exported as described in Environment and Isolation:

```bash
shellcheck test/e2e/18_dsh_plugin.sh test/run-e2e-all.sh test/run-e2e-parallel.sh
./test/e2e/18_dsh_plugin.sh
npm run build:all
npm run test:all
git diff --check
```

Accept only when ShellCheck is clean and scenario 18 exits `0` after exercising installation, exact tool registration, skill loading, dummy delivery, both workspace guards, removal and reinstallation. An absent-host exit `77` does not qualify the script for commit. Commit as `Add DeepSeek Harness plugin host verification`.

## Step 3: Add Third-Package Release Plumbing

### Files

Change:

- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `scripts/generate-native-changelog.mjs`
- `test/native-changelog.test.ts`
- `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md`
- `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md`

Create:

- `test/dsh-release.test.ts`

### Implementation

Read OPS §§ Release Policy, Versioning Scheme, Releasing Both Packages Together, Releasing the MCP Package and npm Trusted Publisher before editing (`/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md:38-140`).

1. **Change the native changelog generator before any dsh changelog section exists.** In `scripts/generate-native-changelog.mjs`, add `DSH_HEADING = /^\[dsh-/` beside `MCP_HEADING` and return `null` from `classifyHeading()` for dsh sections (`scripts/generate-native-changelog.mjs:55-97`). Update the derivation comment and intro to say dsh sections remain canonical-changelog-only. Keep `VERSION_SHORTCUT` unchanged and forbid native-to-dsh shortcut references in the changelog convention; native sections must use a full dsh release URL if such a link is needed.
2. In `test/native-changelog.test.ts`, assert `classifyHeading("[dsh-0.24.1] - 2026-11-30") === null`. Add a dsh section to the derivation fixture and prove `derive()` succeeds while emitting native sections only and no dsh body. This is required because the current fail-closed branch otherwise throws on the new heading.
3. In `release.yml`, add `dsh-v(.+)` selection for package `@curio-data/dsh-intelli-search`, directory `plugins/dsh` and the tag version. Update the unrecognised-tag diagnostic. Reuse manifest-version validation, dist-tag derivation, deterministic gates and staged publishing.
4. Add a dsh-only guard before staging: `npm view @curio-data/mcp-intelli-search@<tag-version> version` must return exactly that version. A dsh bundle must never stage while its exact launcher pin is unavailable.
5. Add a dsh pack-inventory check to CI and release verification. Keep the host itself out of Node.js 22 CI. Add the dsh package to the main/PR published-pin guard once the generated bundle exists: both the MCP version and same-version dsh package must resolve before merge to `main`. Record in OPS that this guard removes the early-merge allowance for any dsh-carrying branch until the first dsh version is public; the general feature-branch exception no longer applies to that branch.
6. In OPS, document the dsh version rule, tag, changelog prefix, staging guard, registry-pin verification and owner approval. Extend “two packages” wording where it would otherwise exclude the bundle. Beside the full-suite release gate, require the pinned dsh host and isolated pnpm from Environment and Isolation, with `DSH_BIN` and the pnpm `PATH` exported before either runner starts.
7. Preserve the existing coupled native/MCP rule. For a core release, create MCP and native releases back to back as OPS already permits, then wait for MCP publication before creating the dsh release. For an MCP/dsh-only release, publish and verify MCP first, then dsh. The native package does not wait for dsh because it never launches that bundle.
8. Record the first-publication exception explicitly: npm cannot bind a trusted publisher for a package that does not yet exist. For a stable first dsh version, the maintainer runs the following from the release tree, with no `--tag alpha`:

   ```bash
   cd plugins/dsh
   npm publish --access public
   npm trust github @curio-data/dsh-intelli-search \
     --file release.yml --repo Curio-Data/pi-intelli-search --allow-stage-publish
   ```

   **Stated by OPS:** a brand-new package's first publish sets `latest` even with an explicit tag, so the stable command deliberately supplies no dist-tag. D3's `dsh-vX.Y.Z` route applies to subsequent staged releases. If the owner requires the first release to use that tag, stop and revise OPS rather than attempting an unbound workflow publish.
9. Update Release Readiness's upcoming-work section with the dsh release dependency and stop points, without disturbing completed-release history.
10. Add deterministic workflow contract tests in `test/dsh-release.test.ts`. Read the tracked workflows and generated manifests; assert the `dsh-v` selection, package directory, exact-version check, MCP-before-dsh guard, dsh pack check, main/PR publication guard and dsh/MCP version equality. These tests pin the release contract but do not prove GitHub Actions execution.

### Gates and Acceptance

```bash
yq eval '.' .github/workflows/release.yml >/dev/null
yq eval '.' .github/workflows/ci.yml >/dev/null
npm run generate:changelog
npm run check:changelog
npm run check:plugins
npm run test:all
git diff --check
```

Accept only when the workflows parse, dsh sections are excluded without throwing, the dsh selection and guard are explicit, the MCP-before-dsh dependency is unambiguous, and OPS includes the stable manual bootstrap. No GitHub run is available until an authorised push; label workflow execution **Unknown** until then. Commit as `Add DeepSeek Harness package release route`.

## Step 4: Document the Host and Versioning Contract

### Files

Change hand-written sources:

- `README.md`
- `docs/ARCHITECTURE.md`
- `scripts/README.md`
- `AGENTS.md`
- `CHANGELOG.md`

Regenerate, never hand-edit:

- `packages/mcp/README.md`
- `pi.README.md`
- `mcp.README.md`
- generated contents in `README.md`

Do not write the dsh compatibility row in this step; D5 evidence comes first.

### Implementation

1. In README's route table, add the dsh npm bundle. Rename `Two Packages, One Engine` to `Three Packages, One Engine` so the heading remains true, add dsh to the following install-branches sentence (`README.md:72`), and let the contents generator update its link.
2. Add `#### DeepSeek Harness` after Codex and before Generic MCP Host. Cover exact installation, environment-layer credential setup and restart, inherited/project/home precedence, shared per-user configuration, launch-directory workspace and guard, tool names, ten-minute call timeout, separate startup timeout, verification, removal and missing-tool failure. Use the corrected Resume Here text rather than proposal § 11.1's “only credential source” wording.
3. In MCP Prerequisites, distinguish generic/MCP Node.js 22 support from the dsh host's Node.js `>=24.9.0` floor. Do not imply the standalone package itself now requires Node.js 24.
4. Update MCP Server Compatibility to name the dsh route without claiming research evidence before Step 5. Link the matrix for its later exact evidence class.
5. Update the Development host-plugin paragraph and Documentation skill links for the third bundle. In Downloads, name the native and MCP series explicitly instead of saying “both packages” as though no other package exists; adding a dsh chart series is deferred, not required.
6. In `docs/ARCHITECTURE.md` § Standalone Adapter and § Host Plugins, name all three hosts, the npm dsh route, the registrar and the dsh tool prefix. Update the source-tree plugin description (`docs/ARCHITECTURE.md:157-171`, `docs/ARCHITECTURE.md:217`). Make no pipeline change.
7. In `scripts/README.md`, name dsh in the generator purpose, document the derived dsh tarball vendor path, list generated files, and describe scenario 18 with its credential-free boundary (`scripts/README.md:83-101`, `:126-161`). Do not document scenario 19 as complete before Step 5 creates and proves it; Step 5 owns that final description.
8. In `AGENTS.md`, update Source Structure, Development Commands, E2E tables and runner ranges. Replace the two-package versioning text with the rule below and add dsh changelog conventions. Update the standalone boundary sentence that currently says Codex alone supplies host paths (`AGENTS.md:547`). In the documentation declaration's guidance row, make `guidance/setup-dsh.md` explicit and name the installed dsh bridge, boot and skill documentation at `0.2.2-rc.1` as the correctness source for host-specific facts. Clarify that the dsh bundle README is intentionally generated from `scripts/templates/dsh/README.md`, not derived by `generate-package-readmes.mjs`; add that template to Rule 12's hand-edited-source examples.
9. Add the user-visible feature to `CHANGELOG.md` under `Unreleased`, including the host-specific tool naming. Do not create a release version or date during feature work (`/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md:23-36`).
10. Run `npm run generate:toc` and `npm run generate:readmes`; never edit derived README files directly (`AGENTS.md:193-195`).

### Versioning Rule to Record

- The dsh manifest always mirrors `packages/mcp/package.json` through the generator.
- A dsh-only, generator, guidance or MCP-adapter change bumps the MCP patch and gives dsh the same patch version. Native does not bump.
- A `src/core/` change bumps native and MCP minor versions; dsh also receives that exact MCP version and is republished because its launcher pin changes.
- A native-only change leaves MCP and dsh unchanged.
- A root documentation change does not independently bump dsh unless the generated dsh payload changes.
- Use tags and changelog prefixes `pi-v`/`[pi-]`, `mcp-v`/`[mcp-]` and `dsh-v`/`[dsh-]`. `PI_CHANGELOG.md` remains native-only (`AGENTS.md:216-234`). Native sections must not use `[dsh-X.Y.Z]` shortcut references; use a full `https://github.com/Curio-Data/pi-intelli-search/releases/tag/dsh-vX.Y.Z` link when needed.

### Gates and Acceptance

```bash
npm run generate:toc
npm run generate:readmes
npm run check:toc
npm run check:readmes
npm run check:plugins
npm run check:changelog
npm run test:all
if rg -n '\x{2014}' --glob '*.md' --glob '!AGENTS.md' .; then exit 1; fi
git diff --check
```

Accept only when generated files are clean and no prose claims unverified inference, an official catalogue, user-skill precedence or a wider host range. Obtain a fresh Opus 5.5 prose review of every user-facing change and resolve its findings before commit. Commit as `Document DeepSeek Harness host support`.

## Step 5: Reproduce Credentialed Evidence and Record Compatibility

This step is **live and spends quota**. Stop until the owner explicitly supplies or authorises both credentials and the run.

### Files

Create:

- `test/e2e/19_dsh_credentialed.sh`

Change after a successful run:

- `docs/COMPATIBILITY.md`
- `scripts/README.md` with scenario 19's final credential and spend contract
- `README.md` only if its dsh installation section needs a precise evidence link or correction
- `CHANGELOG.md` only if the observed result changes a user-visible claim

Create durable evidence:

- `/srv/secure/repos/CURIO/pi-intelli-search/evidence/<UTC-date>-dsh-host/credentialed/`
- `/srv/secure/repos/CURIO/pi-intelli-search/evidence/<UTC-date>-dsh-host/verification-receipt.md`

### Owner Inputs and Credential Safety

The owner provides a DeepSeek key for the host model and an OpenRouter key for all pipeline roles. Supply them through the owner-controlled environment or the repository's gitignored, mode-600 `.env`; scenario 19 must parse only `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` through `test/e2e/env.sh`, never source the file.

Do not copy `~/.dsh`, `.credentials.yaml`, `~/.pi/agent/auth.json`, any OAuth file or any operator credential profile. Do not print either key. Use fresh isolated `DSH_HOME`, `DSH_AGENTS_HOME`, `HOME` and XDG paths. For the environment-layer case, write only the OpenRouter key to isolated `$DSH_HOME/.env` with mode `600`, unset the ambient OpenRouter variable before launching dsh, and exclude that file from retained evidence. For the fallback case, pass the key to the vendored `mcp-intelli-search setup` over standard input with isolated XDG configuration, then use an empty environment value. Remove real-key scratch during approved cleanup; retain only sanitised evidence.

### Live Assertions

1. Record dsh, Node, pnpm, bundle and MCP versions. Install the local-tarball bundle into a fresh headless profile.
2. Run one real headless `intelli_search` through `mcp__intelli__intelli_search`; assert a completed model-backed tool event, non-error result and sourced answer. Inspect the first actual JSON event stream before finalising event selectors. Unknown event shapes must not be guessed into a pass condition.
3. Run one real `mcp__intelli__intelli_research` with `maxUrls: 3` and a narrow official-source query. Assert a completed non-error tool call, source inventory and `[S1]` to `[S3]` references when three pages succeed. If fewer pages succeed, record the degraded outcome rather than manufacturing three references.
4. Require a completed `mcp` sidecar and report under the project used as the launch directory. If the run also exercises a bridge-row `cwd` override, record that as the override case rather than presenting it as default launch-directory behaviour.
5. Repeat a quick search with empty environment and the configured credential file to reproduce the contributor's fallback claim. Record provider status and outcome without retaining the key.
6. Record whether the headless run needed approval. Do not infer unattended approval from a completed call without recording the profile's permission mode and approval policy.
7. Retain sanitised event summaries, completed sidecars, version metadata, commands and SHA-256 checksums in the dated evidence folder. Inspect every artefact for credentials before promotion. Do not cite scratch.
8. Only after these observations, add `### DeepSeek Harness Evidence and Limits` and a Host Plugins row in `docs/COMPATIBILITY.md`. Separate credential-free local-tarball, credentialed local-tarball, registry-pin and first-run latency evidence. State Linux-only scope and exact host `0.2.2-rc.1`; do not write a support range. Record the `intelli` tool-naming difference and skill-precedence limitation.
9. Update `scripts/README.md` with the now-final scenario 19 purpose, required owner inputs, real inference and spend, isolation and evidence destination. Do not leave it marked as planned.

### Gates and Acceptance

```bash
shellcheck test/e2e/19_dsh_credentialed.sh
./test/e2e/19_dsh_credentialed.sh
npm run build:all
npm run test:all
npm run check:readmes
npm run check:plugins
npm audit --audit-level=low
git diff --check
```

Accept only when scenario 19 exits `0`, the evidence receipt names every assertion and limitation, and no retained file contains a credential. Obtain independent code review of the scenario and fresh Opus 5.5 prose review of compatibility prose. Commit the scenario and resulting documentation as `Verify DeepSeek Harness research and record evidence`.

## Step 6: Integrated Review and Release Preparation

1. Confirm the branch contains only intended changes and review the complete diff from the named base. Run `git diff --check`, `npm run build:all`, `npm run test:all`, native-contract types, all generated checks, ShellCheck, audit and both independent install gates:

   ```bash
   npm run build:all
   npm run test:all
   node_modules/.bin/tsc -p test/tsconfig.native-contract.json
   npm run check:toc
   npm run check:plugins
   npm run check:readmes
   npm run check:changelog
   git ls-files -z '*.sh' | xargs -0 shellcheck
   npm audit --audit-level=low
   npm run test:mcp:install
   ./test/run-e2e-publish-local.sh
   ```

2. Run scenario 18 again on the final integrated tree. Before either full-suite runner, prepare the pinned dsh host and isolated pnpm per Environment and Isolation and export `DSH_BIN` and the pnpm `PATH`; both runners fail the suite when scenario 18 skips. Run the full live suite before release only with owner authorisation and credentials, following `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md`; it spends provider quota. Scenario 19 remains a separately reported opt-in run, not an unannounced addition to every suite invocation.
3. Obtain an independent code review on a model other than the implementer's. Cover the generator, registrar, both host scenarios, release guard and all diffs. The reviewer must have a fresh context and write findings under `evidence/agents/<run>/reports/`.
4. Obtain a fresh Claude Code Opus 5.5 prose review for the complete set of user-facing changes, including generated bundle text, README, compatibility, architecture, scripts guide and changelog. Resolve correctness findings first, then clarity, then concision. Re-review fixes.
5. Recheck dsh registry `latest` and `next`. If either changed, record the fact. Do not move the tested version or broaden `engines.dsh` without repeating the relevant host checks. A separate audit of a newer host is a new evidence task.
6. Prepare a release branch only when the owner is ready to include this feature. Under the current two-manifest base, a dsh/MCP-only change with no other work implies MCP and dsh patch `0.24.1`, with native unchanged. This is an **Inferred** example, not a fixed release number. If other work or a core change joins the cycle, recalculate under OPS and ask the owner before combining releases.
7. On the release branch, update MCP's manifest, run `npm install --package-lock-only`, regenerate plugin pins and dsh's matching manifest, write dated `[mcp-X.Y.Z]` and `[dsh-X.Y.Z]` sections and reference links, and add native release content only when native is released. Regenerate `PI_CHANGELOG.md` only for a native release and confirm dsh sections never enter it.
8. Require exact-commit CI on the final release branch. Package contents and documentation must be final before staging. Any change restarts the relevant reviews and gates.

Stop before any GitHub Release or npm action. The owner must explicitly approve the exact packages and versions.

## Step 7: Publish, Verify Registry Installation and Merge

All actions here need the owner approvals named in OPS. Never approve a staged package on the maintainer's behalf.

1. **First dsh package only:** follow Step 3's manual bootstrap after the matching MCP package is public. The maintainer performs the manual publish and trusted-publisher binding. Record the bootstrap exception; do not create an unworkable first dsh workflow release.
2. **Subsequent dsh releases:** create the MCP GitHub Release first and let `release.yml` stage it. The owner approves on npm. Verify `npm view @curio-data/mcp-intelli-search@X.Y.Z version` returns the exact pin. Only then create `dsh-vX.Y.Z`; the owner approves that staging separately.
3. **Core cycle:** follow the existing back-to-back MCP/native release rule, then wait for MCP publication before dsh. Native does not wait for dsh.
4. Verify the public dsh tarball's version, integrity and contents. From a clean isolated dsh profile and fresh npm/pnpm caches, run `dsh plugin --profile <name> add @curio-data/dsh-intelli-search@X.Y.Z`. Assert the exact registry-pinned launcher, four tools, loadable skill, `--check-config`, removal and reinstallation. Record first-run `npx` startup duration and whether the separate 60-second startup/discovery deadline was met; do not infer this from local-tarball tests.
5. Store registry evidence under `evidence/<UTC-date>-dsh-host/registry/` and update `docs/COMPATIBILITY.md` with registry-pin facts separately from local-tarball and credentialed research.
6. After every required package is public and the main/PR pin guard can pass, obtain owner approval for merge to `main`. Merge the release branch, wait for exact-commit main CI, and delete the release branch only under the approved release workflow.
7. Update `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md` with the completed release and leave no instruction to repeat staging or publication.

## Optional Step 8: Publish a Custom JSON Index

Defer this step; it is not required for npm installation or Phase 2 completion.

If the owner later requests Discover integration, publish a UTF-8 JSON document with `format: 1`, the exact package version, actual registry `publishTimestamp`, an npm source, and an evidence-bounded `engines.dsh`. Host it at a stable HTTPS URL without redirects and with any referenced icons. Operators add that URL through the experimental Custom plugin indexes interface. Validate installation from the index into a clean profile and retain that as separate evidence.

Do not open a YAML catalogue pull request, require a GitHub topic, or use `install-verified`/`security-audited` as attestations. Any new hosting or GitHub change needs owner approval.

## Risk Register

| Risk | Guard and Owning Step |
|---|---|
| Call timeout confused with startup timeout | Set `toolCallTimeoutMs: 600000`; document the separate 60-second startup/discovery default; measure first-run registry startup in Step 7 (Steps 1, 4 and 7). |
| `failOnStartupError: false` hides a failed server | Scenario 18 fails unless exact tools and skill appear; docs distinguish a running host from a connected server (Steps 1, 2 and 4). |
| Preview host drift | Pin evidence and initial `engines.dsh` to `0.2.2-rc.1`; recheck tags before release; never infer rc.5 support (Steps 1, 6 and 7). |
| Skill precedence misstated | Test runtime registration; document project-only override precedence and no user-level override promise (Steps 1 and 4). |
| Node floor breaks CI | Keep dsh execution out of Node.js 22 CI; select Node `>=24.9.0` for host tests (environment and Step 2). |
| First-run `npx` exceeds startup deadline | Local-tarball evidence makes no registry-latency claim; measure clean-cache registry installation in Step 7. |
| Credential leakage | Scenario 18 uses only a dummy; scenario 19 uses isolated owner-supplied inputs, parsed not sourced, with sanitised retained evidence (Steps 2 and 5). |
| Bundle release precedes its MCP pin | Release workflow and OPS require the exact MCP registry version before dsh staging (Steps 3 and 7). |
| First dsh trusted publish fails | Stop for the documented manual bootstrap and trusted-publisher binding; do not experiment with the owner's registry account (Steps 3 and 7). |
| Existing hosts change accidentally | Byte-identical generator assertions and existing scenario suites guard Claude Code and Codex output (Steps 1 and 6). |
| False evidence from an unrun script | Scenario 18 must exit `0` before commit; scenario 19 records only real event streams and completed sidecars (Steps 2 and 5). |

## Definition of Done

Phase 2 is complete only when:

- the committed adapter spike remains intact with unchanged Codex behaviour;
- the complete dsh bundle is generated from shared guidance and the exact MCP version;
- generator, registrar and package-content tests pass, with bidirectional drift detection;
- scenario 18 passed on the real pinned host and is ShellCheck-clean;
- scenario 19 reproduced credentialed search, research and credential fallback before the compatibility row was written;
- compatibility evidence names exact versions and classes without citing contributor runs as owner reproduction;
- all documentation, generated outputs, release plumbing and OPS agree;
- independent code review and fresh Opus 5.5 prose review pass on the final change set;
- exact-commit CI and all required deterministic/live gates pass;
- required packages are publicly installed at matching versions, including a clean dsh registry-pin installation;
- the owner approved every credential spend, GitHub Release, npm staging and merge;
- the release branch merged only after its pins resolved, and durable evidence contains no credentials.

Explicitly deferred: a custom JSON index, third-party catalogue submissions, GitHub topic changes, a dsh download-chart series, support claims for other host versions or operating systems, a native dsh extension, and any change to the research engine.

## Progress Checklist

Update this checklist after each step with the commit hash and evidence path. Do not mark a step complete on an unrun or skipped check.

- [ ] Entry checks passed; actual Node and dsh versions recorded, with pnpm recorded as absent or its isolated version recorded after installation.
- [ ] Step 1 complete: generator, bundle, deterministic tests and prose review.
- [ ] Step 2 complete: scenario 18 executed successfully, not skipped.
- [ ] Step 3 complete: third-package workflow, CI guard and OPS reviewed.
- [ ] Step 4 complete: documentation regenerated and prose-reviewed.
- [ ] Step 5 complete: owner-authorised credentialed evidence reproduced and compatibility recorded.
- [ ] Step 6 complete: integrated reviews and release-candidate gates passed.
- [ ] Step 7 complete: owner-approved publication, registry verification and merge finished.
- [ ] Optional Step 8 decision recorded; no catalogue work performed by default.

## Revision Log

Applied against the 2026-11-19 plan review on branch `explore/dsh-host` at `56d8392`.

| Finding | Resolution |
|---|---|
| F-01, Blocking | Step 3 now changes `scripts/generate-native-changelog.mjs` before any dsh heading exists, excludes `[dsh-*]` explicitly, tests classification and derivation in `test/native-changelog.test.ts`, and forbids native-to-dsh shortcut references unless a full URL is used. Step 6 retains the test-backed native-only assertion. |
| F-02, Major | Read First and every proposal citation now identify the absolute worktree proposal at `56d8392`; the handover warns that main's copy has no Resume Here. |
| F-03, Major | Step 2 names the profile user-layer file, local-module inspector `insert` row, same-id whole-config credential override, mandatory `--dump-config` checks, and exact override/inspector sequencing across removal and reinstall. |
| F-04, Major | Steps 2, 3 and 6 now state that both runners fail on a scenario-18 skip and require the pinned host, isolated pnpm, `DSH_BIN` and pnpm `PATH` before the OPS full-suite gate. |
| F-05 | Corrected pnpm, global commit-rule, workspace, Node.js, guidance-token, scenario and NOTICE citations; bootstrap-variable rejection now cites the installed app-boot documentation rather than Phase 1. |
| F-06 | Step 1's fake-root setup includes root `LICENSE`, and the registrar explicitly exports Cordis `apply(ctx)`. |
| F-07 | Step 2 distinguishes basic-tool failures from host/runtime skips, qualifies the vendor path as scratch, removes the tautological gate assignment, and requires `E2E_SKIP_BUILD` handling. |
| F-08 | Step 3 gives the stable first-publish command without `--tag alpha` and records that the dsh pin guard removes early merge for dsh-carrying branches. |
| F-09 | Scenario 19 documentation moved to Step 5; the guidance declaration update is definite; README's install-branches sentence is included; AGENTS.md must record the separately generated dsh README template convention. |
| F-10 | Starting State and handover record the existing origin branch at the same commit without granting push approval; the entry checklist allows pnpm to be absent initially. |
| F-11 | Steps 1 and 4 add a local U+2014 Markdown gate matching the CI prohibition. |
| Review clarification | Step 4 explicitly names `scripts/templates/dsh/README.md` as the hand-edited source for the independently generated dsh catalogue README, outside the native/MCP README derivation path. |
