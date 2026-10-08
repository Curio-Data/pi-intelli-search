# Release Readiness

The [native manifest](../package.json) and [MCP manifest](../packages/mcp/package.json) identify a prepared, unpublished floor-modernisation candidate. Model Context Protocol (MCP) publication remains first; native staging waits for MCP registry availability and clean registry-pin verification. The completed provenance release below is historical evidence, not approval or verification of this candidate. [CHANGELOG.md](../CHANGELOG.md) records both package histories.

## Current Candidate

The candidate is integrated on `feat/pi-0.86-floor-modernization` (code `a52bd31`, documentation merged in `50fd58a`, catalogue-hint facade fix `3ddd9f7`, regenerated readmes `12adc1f`, review-findings fix commit on top). Both manifests advance together because the shared citation harvester and retry classifier change. Native peer floors require `Pi` >= 0.86.0; model dispatch uses only the registry facade. Citation harvesting combines the parsed provider-stream hook (`pi-ai` >= 0.99.0) with fetch-tee recovery for hosts whose `pi-ai` predates 0.99.0. Native tools declare MCP-parity permission hints and prefer strict JavaScript Object Notation (JSON) schema argument sampling where supported; research rendering uses the newer duration context when available. On the 0.86.x floor hosts `pi-ai` treated OpenAI-compatible endpoints as strict-capable by default (upstream correction in 0.87.0), so strict argument schemas can reach such an endpoint that does not support them; `compat.supportsStrictMode: false` on the model in `models.json` is the workaround and is recorded in the [changelog](../CHANGELOG.md).

The candidate plugin launchers pin the unpublished MCP manifest version. Keep those pins on the candidate branch until publication unless the owner explicitly approves a merge-before-publication exception. Fresh registry-pin installation of the candidate cannot pass before the pinned version is public. Do not weaken main's published-pin guard or treat previous-generation installation checks as candidate evidence. The completed cycle's earlier merge exception does not authorise this one.

### Candidate Gates

| Gate | State | Evidence or Required Action |
|---|---|---|
| Implementation | Prepared | Code `a52bd31`, facade-hint fix `3ddd9f7` and the review-findings commit on the candidate branch; manifests, lockfile, native default history and regenerated plugin pins agree |
| Deterministic Gates | Passed at the integrated tree | Build, native and standalone tests (605 total after the review fixes, canonical in the root README badge), native-contract type check, generated README/contents/plugin drift checks and dependency audit; run by an independent reviewer at `12adc1f` and rerun by the coordinator after the review fixes |
| Targeted Native Research | Passed on 2026-10-08 | Scenario 01 on `Pi` 1.1.0 and scenario 15 on a host-isolated pinned `Pi` 0.86.0; [Compatibility](COMPATIBILITY.md#current-candidate-verification) records scope and fallback-citation evidence. Live evidence predates the catalogue-hint fix; that fix touches only the error path |
| Documentation Integration | Done | Documentation merged (`50fd58a`), README contents and package READMEs regenerated; review-findings corrections applied on top |
| Independent Review | Passed on 2026-10-08 | Two reviewers (Pi/DeepSeek Flash and Claude Code/Opus 5.5) found no correctness regression; findings applied: catalogue-hint ranking, pi-ai 0.99.0 boundary correction, duration-format parity with tests, badge and handoff accuracy, strict-sampling floor caveat documented. Reports under gitignored `.tmp/agents/2026-10-08-017-modernization/reports/` |
| Fresh Installation | Pending for the candidate | Run both independent fresh-tarball gates against the integrated tree; earlier published-generation installs are separate evidence |
| Full Paced Live Suite | Not run for this candidate | Run `test/run-e2e-all.sh` before release, including scenario 15. Use the credential-isolation and pacing rules in `AGENTS.md`; a skipped mandatory scenario is missing evidence |
| Exact-Commit CI | Required before each release | Require a passing eligible push run on the exact release commit on `main` or a `release/` branch (the `feat/` branch carries no CI runs). Documentation, generation or release-preparation edits change that commit and require new CI |
| Publication and Approval | Not published; separate approval required | Obtain explicit MCP release permission, stage through the existing workflow and wait for maintainer approval on `npm`. Approval of the completed release does not authorise this candidate |
| Post-Publication MCP Gate | Pending | Verify registry availability, the intended dist-tag and clean-profile installation from the committed catalogues; record registry-pin evidence separately from local-tarball research |
| Native Release | Held | Stage only after the MCP post-publication gate passes and separate native release permission is granted |

The fresh merge agent must preserve the candidate/publication distinction through integration and release preparation. Do not create tags, publish releases or stage either package from this documentation handoff alone. Exact-commit CI is required after integration, not borrowed from implementation verification or the completed cycle. If an explicit merge-before-publication exception is granted, retain main's registry-pin guard and validate the exact merged tree through a matching `release/` branch, following the CI ordering caveat recorded below.

<a id="current-release"></a>
## Published Provenance Generation

Both packages from the provenance generation are published on `npm` at the existing `pi-v0.16.0` and `mcp-v0.16.0` release tags. The owner authorised staging on 2026-10-07 and approved both staged packages on 2026-10-08. MCP publication and clean registry-pin host verification preceded native staging. Native registry installation and its installed README pass verification. That release cycle is complete; its results do not establish the current candidate's gates.

The shared engine gives collation successful, non-empty extraction evidence only. Code renders one authoritative Source Assessment using the run's file identity, and validates references before report writes or rotation. Manual evidence is labelled caller-supplied; code examples and cross-links in extracted content remain content rather than additional fetched pages. Model-generated relevance and contribution ratings are removed. Reference consistency does not establish factual accuracy. The [provenance correction evidence](evidence/2026-10-07-provenance-correction.md) records implementation, review dispositions and limitations.

MCP server instructions, descriptions and generated host skills guide factual lookups to search and multi-page analysis to research. These instructions guide models rather than enforce their actions. The [routing review](evidence/2026-10-07-mcp-routing-review.md) records neutral-prompt evaluations, skill-loading checks and the controlled no-`Bash` evaluation boundary. Native tool descriptions are unchanged; the shared collation prompt, report prose and `searchSummary` description change intentionally.

Both manifests, the lockfile, native default history and plugin pins advanced together. The root README generates package READMEs, and shared guidance generates plugin skills. Do not hand-edit those derived files or recreate the published release tags.

<a id="verification-state"></a>
## Previous Verification State

| Gate | State | Evidence |
|---|---|---|
| Implementation Review | Passed | Opus 5.5 and native DeepSeek Flash confirmed no implementation blocker after corrections; dispositions in the provenance evidence |
| Builds and Deterministic Tests | Passed again on the merged candidate | Both builds, isolated native and MCP tests, native-contract types and generated-file gates; test total appears only in the root README badge |
| Packaging and Security | Passed again on the merged candidate | Both independent fresh-tarball installation gates, ShellCheck and full dependency audit; native fresh installation resolves pi-ai 1.1.0 |
| Release CI | Passed for both exact tagged commits | MCP tag commit `7a6bbb8`: [run 37695372137](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37695372137). Native tag commit `bac0015`: [main run 37744133105](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37744133105) and [release run 37744136529](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37744136529) pass, including the published-pin guard on main |
| Targeted Live Checks | Passed | Paced scenarios `01_main`, `05_collation_limits`, `11_mcp_stdio` and `13_claude_code_plugin`; native research and all Opus cases rerun after the final source corrections |
| Full Paced Live Suite | Passed on merged commit `5605a2a` | Complete paced runner on 2026-10-07: all mandatory scenarios passed, none failed or skipped; native DeepSeek Flash agent loop, Claude Sonnet 5.5 and the dedicated Codex profile |
| Registry Publication | Both Published | On 2026-10-08 the registry records MCP publication at 07:27:25 UTC and native at 07:41:48 UTC. At verification, both `latest` tags resolved to the existing provenance release tags; both published packages expose signed provenance attestations |
| Staging Approval | Granted by the owner on 2026-10-07 | Both package releases authorised; native retains the MCP publication and registry-pin verification prerequisites. Approval of the staged tarballs on `npm` remains a separate maintainer action |
| MCP Staging | Completed on 2026-10-07 at 22:22 UTC | Tag `mcp-v0.16.0` targets `7a6bbb8`; [workflow 37695541215](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37695541215) staged with `latest` and signed provenance. Staging ID: `565b5093-62ac-49f0-8c5d-d59f3f602043` |
| Post-Publication Host Installation | Passed on 2026-10-08 | Both plugins installed from the committed marketplaces into clean profiles; registry-pulled CLI identity, instructions and tool listing verified. [Compatibility](COMPATIBILITY.md#published-0160-registry-pin-verification-2026-10-08) records scope and limits |
| Native Staging | Completed on 2026-10-08 at 07:37 UTC | Tag `pi-v0.16.0` targets `bac0015`; [workflow 37744380551](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37744380551) verified the published MCP pin and staged with `latest` and signed provenance. Staging ID: `8fbcc163-27e2-4f41-8645-7321eb272524` |
| Native Registry Verification | Passed on 2026-10-08 | `test/run-e2e-publish.sh` passes against the version at `pi-v0.16.0` with isolated home and agent directories. Published tarball SHA-1 matches registry metadata, and its README matches the tagged native derivation byte-for-byte |

Implementation logs and reviewer reports are under gitignored `.tmp/agents/provenance-fix/`; release gate logs are under `.tmp/release-016/`. Tracked evidence pages contain the conclusions so the handoff does not depend on that scratch surviving. The first native fresh-install attempt failed because the advertised upstream pi-ai 1.1.0 tarball returned 404; the unmodified gate passed after a paced retry with that same peer version. [Compatibility](COMPATIBILITY.md#provenance-generation-verification) records that generation's local-tarball and registry-pin checks separately.

## Release from Main

This section records the completed provenance cycle's merge procedure. The owner directed: update documentation, commit and push, merge to `main`, then hand release work to a fresh agent (2026-10-07). That was an explicit exception to holding unpublished catalogue pins off `main`, limited to that cycle. It changed merge timing only; MCP-first publication, exact-commit CI and separate approval gates remained mandatory. It is not a branch-switch instruction or approval for the current candidate.

Before MCP publication, fresh plugin installation from the default repository marketplaces could not resolve the prepared server pin. Main's `Require published catalog pins before merging to main` CI step failed for that reason. The unchanged guard now passes after publication, and clean-profile registry-pin checks pass. The local-tarball checks remain a separate evidence class.

The merged `main` commit is also validated through retained branch `release/0.16.0`. After pushing the merge to `main`, fast-forward and push that release branch to the same commit. Its CI push run validates the exact merged tree without the pre-publication availability check. Keep the branch until the release cycle closes. This permits the release agent to work from `main` and tag its exact validated commit.

The release workflow selects the newest eligible push CI run for the target commit, not any historical successful run. A newer failed main run can shadow an older green release run at the same commit. Push the matching release branch after the main push, and confirm that the newest eligible run is completed successfully. The target must still belong to the matching remote branch. If release-preparation edits change the commit before MCP publication, repeat this exact-commit validation rather than borrowing an earlier green run.

### Completed Release Checklist

1. Release work started from clean `main`. Both manifests, lockfile entries, native default history and generated plugin pins agree; publication was checked through the public registry rather than inferred from release notes.
2. The full paced live suite passed on merged commit `5605a2a`. Repeat it if executable candidate code changes. [_Kimi_](https://www.kimi.com) agent-loop quota failures were retained as failures during implementation. Native [_DeepSeek_](https://www.deepseek.com) Flash was used successfully instead; scenarios 1 and 11 consume `TEST_MODEL`, while other scenarios use `E2E_LOOP_MODEL_ID`. The pipeline models remain scenario-configured. Use the existing credential workflow in `AGENTS.md`; never copy operator OAuth credentials.
3. Both changelog headings and reference links were verified. Release-preparation edits were committed and pushed, and exact-commit CI passed before each tag. The retained release branch validated the pre-publication MCP commit without weakening main's registry-pin guard.
4. MCP staging and maintainer approval are complete. The existing [_GitHub_ Release](https://github.com/Curio-Data/pi-intelli-search/releases/tag/mcp-v0.16.0) targets `7a6bbb8`; do not recreate its tag or repeat publication. The maintainer approved the staged package on `npm`; the agent never approves staged packages.
5. MCP registry publication, the expected dist-tag, clean-profile plugin installation and the main CI rerun are verified. The [compatibility matrix](COMPATIBILITY.md#published-0160-registry-pin-verification-2026-10-08) records registry-pin evidence separately from local-tarball research.
6. Native staging and maintainer approval are complete. The existing `pi-v0.16.0` tag targets `bac0015`; do not recreate it or repeat staging. The workflow passed exact-commit CI, the published MCP pin gate, both fresh-install gates and the native derived-README publish hook. Public registry installation passes, and the published README matches that tag's native derivation.
7. Publication state, compatibility evidence and changelog dates record the observed results. The repository-only pending-publication notice is removed from the root README, and its derived READMEs are regenerated. No bootstrap publish or trusted-publisher reconfiguration was needed.

The completed full suite used this loop-model selection:

```bash
TEST_MODEL=deepseek/deepseek-flash \
E2E_LOOP_MODEL_ID=deepseek/deepseek-flash \
TMPDIR="$PWD/.tmp" \
  ./test/run-e2e-all.sh
```

This command completed successfully on the merged candidate on 2026-10-07. It consumes live quota. Scenarios 13 and 14 require the existing private token and dedicated login described in `AGENTS.md`; a skipped mandatory scenario is missing evidence, not a pass.

## Previous Publication

The previous stable `0.15.0` generation is fully published (2026-10-07). MCP was staged through CI and approved at 15:47 Coordinated Universal Time (UTC); native followed after registry-pin verification, with signed provenance. The full paced live suite completed on the merged tree before those releases. [The compatibility record](COMPATIBILITY.md#published-0150-registry-pin-verification-2026-10-07) records clean-profile installation of the published MCP pin. Those results establish the previous generation only.

The first MCP alpha required a manual bootstrap because npm cannot bind a trusted publisher to a package that does not exist. The working package-specific bindings were then established with the npm CLI. A prior UI-created binding failed with `E401`; the verified CLI setup and npm-major pin are recorded in `AGENTS.md`. Neither bootstrap nor a trust change should be repeated as part of this release.

## Historical Finding Dispositions

The following corrections shipped in the previous stable generation; they are not new candidate changes or evidence of current release approval.

| Finding | Correction | Evidence |
|---|---|---|
| R1 / F2: MCP answer lost on structured-content hosts | Return complete text in both result representations | Protocol equality assertions and model-visible host checks |
| R2: damaged native model configuration overwritten | Preserve invalid files and overrides; lock and atomically merge valid files | Malformed-file, concurrent-start and symlink tests |
| R3: extraction dependency advisories | Patched extraction dependencies and external XML parser | Executable dependency-source regressions and audit |
| R4: incorrect related-history selection | Share the last-20 candidate window between prompt and parser | Large-history regression |
| R5: partial-result cache paths | Allocate source identity once for physical files and references | Mixed, optional-page and reordered-page tests |
| R6: obsolete refresh artefacts | Archive completed refreshes; preserve prior output on degraded refresh | Repeated-query and concurrent-writer tests |
| R7 / F3 / F15: configuration failure and ambiguous errors | Serve repairable file errors; retain strict workspace checks | CLI and protocol repair-in-place tests |
| R8: incomplete acceptance checks | Isolate host state and reject degraded or absent artefacts | E2E-helper regressions and the previous paced suite |
| F1, F4, F10, F16: installation and evidence gaps | Catalogues, setup guidance and explicit evidence classes | Generated checks and compatibility matrix |
| F5, F6, F7, F8, F9, F12, F13: host guidance | Selection, diagnostics, secrets and actual invocation checks | Generated guidance and host scenarios |
| F11: generator discoverability | Non-mutating help and a linked generator reference | Generator tests |
| F14: unresolvable related report | Return each exact report path | Cache and native-fixture regressions |

The `F` series is recorded in [the historical Phase 6 checkpoint](plans/mcp-intelli-search/POST-PHASE-6.md). The `R` series comes from the 2026-10-06 release review. Its initial suite was interrupted and failed scenario 5; later correction and the completed pre-publication suite closed that evidence gap. Do not reuse the initial interrupted-run claims or the old branch instructions for the current candidate.

## Shared Safety Constraints

A completed same-day repeat attempts to archive prior artefacts to numbered siblings before replacing the canonical cache. Rotation is best-effort and can leave a partial archive or fall back to in-place replacement. A degraded refresh preserves prior successful output; important reports still require a separate retained copy. [Architecture](ARCHITECTURE.md) documents the implementation and lock boundaries.

Page extraction uses patched [_Defuddle_](https://github.com/kepano/defuddle) and a Mathematical Markup Language (MathML) converter that loads its Extensible Markup Language (XML) parser externally. [Dependency-source tests](../test/dependency-security.test.ts) verify executable imports and conversion, not just lockfile entries. Run the full audit again for the release candidate.

A completed sidecar or passing unit test does not establish that a host model received the answer. The credentialed Claude scenario checks model-visible text. Local-tarball research, registry installation and full registry-pin research are distinct evidence classes; retain those distinctions in publication notes.
