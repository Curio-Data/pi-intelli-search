# Release Readiness

The current working candidate fixes the release-review findings across the native extension, shared engine and Model Context Protocol (MCP) server. Package versions are defined by the two manifests; their release notes are in [CHANGELOG.md](../CHANGELOG.md). This page records release gates, not authorisation to publish.

## Publication State

The MCP bootstrap is complete: the registry published its initial alpha on 2026-10-05, and both `alpha` and `latest` pointed to it at the 2026-10-06 check. The native registry remained on its previous stable release. The planning branch is merged into `main`; the old [phased handoff](plans/mcp-intelli-search/README.md) is historical, not a branch-switch instruction.

The candidate ships as the `0.15.0` stable generation: the native `0.15.0` was prepared but never published, and the MCP package promotes its published `0.15.0-alpha.0` to stable. Generated plugin launchers pin the candidate version. Do not publish those new pins on the default installation branch before the matching MCP package is available; use a release branch and local-tarball verification until publication.

## Finding Dispositions

| Finding | Correction | Evidence |
|---|---|---|
| R1 / F2: MCP answer lost on structured-content hosts | Return the same full operation text in text content and `structuredContent.text` | Protocol equality assertions; scenario 13 checks model-visible answer text |
| R2: damaged native model configuration overwritten | Preserve invalid/unreadable files and symlinks; validate, lock and atomically merge valid configuration | Isolated malformed-file, override, concurrent-start and symlink tests |
| R3: extraction dependency advisories | Upgrade extraction and MathML conversion dependencies; the converter now loads patched xmldom externally | Dependency-source regression and full dependency audit |
| R4: incorrect related-history selection | Share the last-20 candidate window between prompt and parser | Large-history regression |
| R5: broken partial-result cache paths | Allocate source identity once for physical files, prompts and reports | Mixed-result, optional-page and reordered-page regressions |
| R6: obsolete refresh artefacts | Replace source/extraction sets, preserve supplementary documentation and clear superseded successful output on degraded refresh | Repeated-query and concurrent-writer regressions |
| R7 / F3 / F15: configuration startup failure and ambiguous errors | Serve actionable file errors until a selected file loads; preserve strict launcher/workspace checks and safe syntax diagnostics | CLI and protocol repair-in-place tests |
| R8: incomplete acceptance checks | Isolate host state; inspect actual tool arguments and page budgets; fail on degraded or absent artefacts; distinguish skipped live scenarios | Provider isolation and E2E-helper regressions, paced live suite |
| F1, F4, F10, F16: installation and evidence gaps | Main has catalogs; root README supplies setup and distinguishes connection from inference | Generated README drift checks and compatibility matrix |
| F5, F6, F7, F8, F9, F12, F13: host guidance | Explicit research selection and unavailable-tool reporting, diagnostics, secret entry, profile paths and real tool-call verification | Generated plugin drift tests and host scenarios |
| F11: generator discoverability | Non-mutating help plus linked complete tarball instructions | Generator tests |
| F14: unresolvable suggested report | Include each exact report path | Cache-format and native-fixture regression |

The Claude Code startup-failure cache and skill auto-selection observations were recorded on the host versions in [Compatibility](COMPATIBILITY.md), not established for every later version. Clear guidance is not a guarantee that an agent selects a skill automatically.

## Dependency Evidence

The production extraction path uses [_Defuddle_](https://github.com/kepano/defuddle) and [_mathml-to-latex_](https://github.com/asnunes/mathml-to-latex). The updated converter's CommonJS entry imports `@xmldom/xmldom` rather than embedding a private parser. `test/dependency-security.test.ts` verifies that executable path and a conversion result. Inspecting only a transitive lockfile entry would not establish this.

The security review checked [the Defuddle advisory](https://github.com/advisories/GHSA-jg4p-g6xj-4qmf) and [xmldom's parser advisory](https://github.com/advisories/GHSA-8344-3jmq-59r6). The Defuddle cross-site scripting advisory concerns downstream HTML rendering, which is not proof of executable script exposure in a Markdown-only server. The upgrade removes the vulnerable dependency rather than relying on that distinction. Development SDK dependencies also move to current releases so their pinned transitive dependencies do not retain audit findings; native peer floors are unchanged.

## Independent Review

Two independent whole-release reviewers examined the combined candidate after the fixes, and both re-examined the corrected tree after adjudication (reports under `.tmp/agents/release-016/reports/`, not tracked). Their verdicts agree: **no shipping-code or verification blocker remains**.

- The first review round caught a release-verification blocker: scenario 5 had failed in the interrupted suite and the initial evidence summary overstated completion. The correction (non-reasoning comparison model, retained strict assertions, honest evidence) was confirmed resolved in the follow-up pass.
- Residual, resolved after the follow-up: the native `Pi` tool descriptions initially did not carry the cache-replacement disclosure. The owner approved it on 2026-10-06; both descriptions now carry it and the frozen tool-description fixture was regenerated as an intentional contract change.
- Other non-blocking observations recorded by the reviewers: empty collation is not retried (the actionable error remains re-runnable), and scenario 5's character threshold is advisory while the decisive size comparison stays enforced.

## Verification

The combined candidate passes both builds, isolated native and standalone test suites, native-contract type checking, generated-file checks, ShellCheck, both fresh-tarball installation gates and the full dependency audit. The test total is maintained only in the root README badge.

The initial live run failed scenario 5 and was then interrupted during scenario 10. The first evidence summary incorrectly treated earlier scenarios as all passing; independent review caught this. Scenario 5 now uses a non-reasoning collation model for its 200-token visible-output comparison, retains the non-empty-result assertion, and passed on rerun. All scenarios have successful receipts across the paced runs and continuation, and scenarios 1, 5, 11, 12, 13 and 14 were re-run on the corrected final tree; this is not a claim that the interrupted aggregate invocation exited successfully. Re-run the full paced suite on the final committed release candidate before tagging. The [compatibility matrix](COMPATIBILITY.md#release-candidate-verification) records host versions, retries and the corrected skill-discovery assertion. Two independent reviewers assess the corrected combined candidate after those fixes; their verdicts and limitations are recorded here when complete. Builder evidence is scoped to its own worktree and focused checks.

A degraded repeat deliberately clears prior same-day cached output. The README and tool descriptions disclose this replacement behaviour, and MCP cache-writing tools carry `destructiveHint: true`. The cache is not an archive; copy reports that must survive a repeated query. Empty collation now fails before a successful report is written, rather than letting a header-only report satisfy a size comparison.

A passing unit test or a completed sidecar is not sufficient proof that a host model received the answer. Scenario 13 inspects the model-visible result. Registry-pin verification is distinct from the local-tarball class and must use the exact version subsequently published.

## Deferred Work: Cache Refresh Semantics

The owner approved a change to degraded-refresh behaviour on 2026-10-06 and deferred implementation to the next agent. Until it lands, the candidate keeps the behaviour described here and every disclosure matches it.

**Current behaviour (this candidate):** repeating a query on the same UTC date replaces that cache entry's numbered files. A degraded repeat additionally clears the earlier successful report, extractions, numbered sources and index entry, preserving only `llms-full-*` downloads and `meta.json`.

**Approved target:** a successful repeat still replaces the entry. The consistency argument is structural, not staleness: the folder contract is one report describing exactly the files beside it, referenced by the fixed `report.md` path in tool results, skills and the cache index. A degraded repeat instead preserves the previous successful report, extractions, numbered sources and index entry untouched, and records the failed attempt in `meta.json` only, so degradation remains visible to `scripts/analyze-sessions.sh`. A degraded query with no prior artefacts keeps the current meta-only behaviour.

**Why accumulate-both-runs was rejected:** filenames are positionally numbered and collide across runs; `report.md` is a single fixed-path contract; a new collation covers only its own pages, so retained files would become orphans the report does not vouch for; covering the union would require re-collating prior extractions on every repeat.

**Implementation notes:**

- `degradedReturn()` in `src/core/operations/research.ts` performs the clearing under the cache lock and drops the index entry. Branch on whether a successful `report.md` already exists at the cache path.
- `clearCacheArtefacts()` and `removeIndexEntry()` in `src/core/cache.ts` may become unused on this path; remove or retain them deliberately.
- Rewrite the `test/core-operations.test.ts` case "clears a previous successful run's artefacts on a degraded refresh of the same query" to assert preservation. Keep coverage for the fresh-degraded case and the successful-replacement case, including the lock ordering.
- Update disclosure wording everywhere it names the clearing behaviour: the README cache section; `guidance/research-guide.md` and then `npm run generate:plugins`; the native tool descriptions in `src/tools/intelli-research.ts` and `src/tools/intelli-collate.ts`; the MCP descriptions in `packages/mcp/src/server.ts` and their assertions in `packages/mcp/test/server.test.ts`. Regenerate `test/fixtures/native-contract/tools.json` with `node --import tsx scripts/capture-native-contract.mts --write` and review the diff (intentional, owner-approved contract change). Update the CHANGELOG entries under `[pi-0.15.0]`.
- `destructiveHint: true` stays on the cache-writing MCP tools: a successful repeat still replaces cached files.
- Then run the full verification set: `npm run build:all`, `npm run test:all`, the native-contract type check, all drift checks, ShellCheck, both tarball install gates, and `npm audit --audit-level=low`.

The corrected candidate is committed and pushed on `release/0.15.0`. Land the deferred change as a follow-up commit on that branch, require green CI on the resulting commit, run the full paced live suite on that tree, and only then proceed to the owner publication gates below.

## Remaining Owner Gates

1. Confirm rotation of the test token previously recorded as exposed in [the historical checkpoint](plans/mcp-intelli-search/POST-PHASE-6.md). Do not copy, read or refresh operator credential files as a test workaround.
2. The corrected candidate is committed on `release/0.15.0`; the deferred cache-refresh work above lands as a follow-up commit on the same branch, including the pre-existing README attribution addition already carried by the candidate. Require green CI on the exact final commit. Keep the unpublished catalog pin off `main` until MCP publication makes it installable.
3. Confirm the MCP package's own trusted-publisher binding for `Curio-Data/pi-intelli-search`, `release.yml`, no environment and stage-publish permission only. Do not repeat the first-publish bootstrap.
4. Approve MCP staging explicitly. After the maintainer approves the staged package with two-factor authentication, verify registry dist-tags and install both host plugins into clean profiles against the published pin. Record that evidence in [Compatibility](COMPATIBILITY.md).
5. Approve the native release separately only after matching-generation MCP verification. Verify the native package from the registry after maintainer approval.

CI also checks registry-pin availability on `main` and pull requests targeting it, while `release/` pushes can validate unpublished candidates. The release workflow requires its commit to belong to `main` or a `release/` branch with successful CI, checks both generated artefacts and tarball installations, audits dependencies, and verifies the exact MCP registry pin before native staging. Registry existence does not replace the owner's clean-profile host verification gate.
