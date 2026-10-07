# Release Readiness

The prepared candidate combines shared-engine provenance corrections with search-first Model Context Protocol (MCP) routing. Package versions are defined by [the native manifest](../package.json) and [the MCP manifest](../packages/mcp/package.json); prepared notes are in [CHANGELOG.md](../CHANGELOG.md). Neither candidate package is published. The owner authorised staged releases for both packages on 2026-10-07. MCP stages first; native staging remains conditional on maintainer approval of MCP on `npm` and clean registry-pin host verification.

## Current Candidate

The shared engine gives collation successful, non-empty extraction evidence only. Code renders one authoritative Source Assessment using the run's file identity, and validates references before report writes or rotation. Manual evidence is labelled caller-supplied; code examples and cross-links in extracted content remain content rather than additional fetched pages. Model-generated relevance and contribution ratings are removed. Reference consistency does not establish factual accuracy. The [provenance correction evidence](evidence/2026-10-07-provenance-correction.md) records implementation, review dispositions and limitations.

MCP server instructions, descriptions and generated host skills guide factual lookups to search and multi-page analysis to research. These instructions guide models rather than enforce their actions. The [routing review](evidence/2026-10-07-mcp-routing-review.md) records neutral-prompt evaluations, skill-loading checks and the controlled no-`Bash` evaluation boundary. Native tool descriptions are unchanged; the shared collation prompt, report prose and `searchSummary` description change intentionally.

Both manifests, the lockfile, native default history and plugin pins advance together. The root README generates package READMEs, and shared guidance generates plugin skills. Do not hand-edit those derived files or bump the packages again unless the candidate changes scope.

## Verification State

| Gate | State | Evidence |
|---|---|---|
| Implementation Review | Passed | Opus 5.5 and native DeepSeek Flash confirmed no implementation blocker after corrections; dispositions in the provenance evidence |
| Builds and Deterministic Tests | Passed again on the merged candidate | Both builds, isolated native and MCP tests, native-contract types and generated-file gates; test total appears only in the root README badge |
| Packaging and Security | Passed again on the merged candidate | Both independent fresh-tarball installation gates, ShellCheck and full dependency audit; native fresh installation resolves pi-ai 1.1.0 |
| Implementation CI | Passed | Commit `fd0c26d`, [run 37679997280](https://github.com/Curio-Data/pi-intelli-search/actions/runs/37679997280); require exact-commit CI again for later edits |
| Targeted Live Checks | Passed | Paced scenarios `01_main`, `05_collation_limits`, `11_mcp_stdio` and `13_claude_code_plugin`; native research and all Opus cases rerun after the final source corrections |
| Full Paced Live Suite | Passed on merged commit `5605a2a` | Complete paced runner on 2026-10-07: all mandatory scenarios passed, none failed or skipped; native DeepSeek Flash agent loop, Claude Sonnet 5.5 and the dedicated Codex profile |
| Candidate Registry Pins | Not published | The prepared MCP version returned no registry match on 2026-10-07; both published `latest` tags still identify the previous stable generation |
| Staging Approval | Granted by the owner on 2026-10-07 | Both package releases authorised; native retains the MCP publication and registry-pin verification prerequisites. Approval of the staged tarballs on `npm` remains a separate maintainer action |
| Post-Publication Host Installation | Pending | Verify both clean-profile plugins against the exact published pin before native staging |

Implementation logs and reviewer reports are under gitignored `.tmp/agents/provenance-fix/`; release gate logs are under `.tmp/release-016/`. Tracked evidence pages contain the conclusions so the handoff does not depend on that scratch surviving. The first native fresh-install attempt failed because the advertised upstream pi-ai 1.1.0 tarball returned 404; the unmodified gate passed after a paced retry with that same peer version. [Compatibility](COMPATIBILITY.md#current-candidate-verification) distinguishes current local-tarball checks from historical registry-pin checks.

## Release from Main

The owner directed: update documentation, commit and push, merge to `main`, then hand release work to a fresh agent (2026-10-07). This is an explicit exception to the default policy of holding unpublished catalogue pins off `main`. It changes merge timing only; MCP-first publication, exact-commit CI and separate approval gates remain mandatory.

Until MCP publication, fresh plugin installation from the default repository marketplaces cannot resolve the prepared server pin. Main's `Require published catalog pins before merging to main` CI step fails for that reason. Do not remove or bypass the guard, treat that failure as a full validation pass, or claim published-install evidence from the local tarball checks.

The merged `main` commit is also validated through retained branch `release/0.16.0`. After pushing the merge to `main`, fast-forward and push that release branch to the same commit. Its CI push run validates the exact merged tree without the pre-publication availability check. Keep the branch until the release cycle closes. This permits the release agent to work from `main` and tag its exact validated commit.

The release workflow selects the newest eligible push CI run for the target commit, not any historical successful run. A newer failed main run can shadow an older green release run at the same commit. Push the matching release branch after the main push, and confirm that the newest eligible run is completed successfully. The target must still belong to the matching remote branch. If release-preparation edits change the commit before MCP publication, repeat this exact-commit validation rather than borrowing an earlier green run.

### Fresh-Agent Checklist

1. Start from a clean, current `main`. Read this page, the package-prefixed changelog entries and both evidence records. Confirm both manifests, lockfile entries, native default history and generated plugin pins agree; verify the actual registry state rather than assuming publication.
2. The full paced live suite passed on merged commit `5605a2a`. Repeat it if executable candidate code changes. [_Kimi_](https://www.kimi.com) agent-loop quota failures were retained as failures during implementation. Native [_DeepSeek_](https://www.deepseek.com) Flash was used successfully instead; scenarios 1 and 11 consume `TEST_MODEL`, while other scenarios use `E2E_LOOP_MODEL_ID`. The pipeline models remain scenario-configured. Use the existing credential workflow in `AGENTS.md`; never copy operator OAuth credentials.
3. Set each prepared changelog date when that package's release is approved. If this or another edit changes the commit, commit and push it, then validate that exact commit through `release/0.16.0` while the MCP registry pin remains unpublished. Require the newest eligible push CI run to pass. Confirm both changelog headings and reference links exist; never tag a commit that only passed an earlier ancestor's checks.
4. The owner has approved MCP staging for this candidate. Create the approved [_GitHub_ Release](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) with the `mcp-v` tag matching its manifest; use the full target commit SHA. Publishing that release triggers the existing trusted-publishing workflow, which submits the package to npm staging. The maintainer approves the staged package on npm with two-factor authentication; the agent never approves it.
5. Verify MCP registry publication and the expected dist-tag. Install both plugins from the committed catalogues into clean profiles and confirm the pinned launcher downloads and starts the published server. Record this as registry-pin evidence in the compatibility matrix. Rerun main CI after the pin becomes public.
6. Only after that gate passes, use the owner's approval of native staging and stage the `pi-v` tag matching its manifest. Require exact-commit CI and retain the native derived-README publish hook. The maintainer approves this staged package separately. Verify its registry publication and installed README.
7. Update publication state, compatibility evidence and changelog dates from observed results. Remove the repository-only pending-publication notice in the root README after both packages and the plugin pins are verified, then regenerate the package READMEs. No bootstrap publish or trusted-publisher reconfiguration is required for these existing packages.

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
