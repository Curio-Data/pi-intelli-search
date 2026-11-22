# Installation and Promotion

For the integrated 0.25.0 candidate, follow the [release gates](RELEASE-025.md). The preview announcement below describes the exploration branch; do not use it as the release announcement.

## Preview: Link to the Branch, Not npm

The audience for the preview is a [_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) user who wants cited web research inside an existing project. Lead with what the user gets: a quick answer with sources, or a multi-page report whose fetched sources and extractions stay in the project's `.search/` directory. The bundle adds four tools and a research skill to a named profile. It does not replace the harness's own web search.

Suggested preview announcement:

> **Preview: cited web research inside DeepSeek Harness.** Ask for a quick answer with sources, or compare documentation across pages and keep the report in the project. We verified both workflows with a local build on Linux and DeepSeek Harness `0.2.2-rc.1`. The plugin is not on npm yet. [See how it works and what was tested](https://github.com/Curio-Data/pi-intelli-search/blob/explore/dsh-host/README.md#deepseek-harness).

Use that branch link in a project update or a community channel that permits project announcements. Do not link to a nonexistent npm package or offer `git clone` as a one-command install. The tracked bundle launches a registry package; cloning it does not supply the matching unreleased server. For a technical audience, show one prompt, the cited result and the local report. Label the demonstration **local build**; use a public query and omit credentials, session logs and private workspace paths.

For maintainers who want to reproduce installation now, [scenario 18](../../../test/e2e/18_dsh_plugin.sh) builds and installs the local bundle and matching MCP tarball into a disposable profile. Follow [Environment and Isolation](PLAN.md#environment-and-isolation) for Node.js, `DSH_BIN` and pnpm, then run `./test/e2e/18_dsh_plugin.sh` from the prepared branch. No model credential is required; this checks registration, not real search. Scenario 19 spends provider quota and is not an onboarding step. [Compatibility](../../COMPATIBILITY.md#deepseek-harness-evidence-and-limits) separates the two evidence classes.

## Public Release: Lead With the Profile Install Command

Do not switch from “preview” to “install” until both packages are public **and** a clean profile starts the exact published server, exposes the four tools and loads the skill. The server must accept `--host dsh`; finding its version on npm is not sufficient. Replace the preview notices in the root README (route table, installation, compatibility and development sections) and the bundle template only on the release path, regenerate the derived files, and check their links before announcing availability.

The intended public install is through the harness, **not** `npm install -g`. For an operator using the `tui` profile:

1. Have a working harness model login, Node.js 24.9 or later with `node` and `npx`, and `pnpm` on `PATH`. The research server needs its own OpenRouter key; entering a key in the harness model settings does not provision the server.
2. Install into the profile with `dsh plugin --profile tui add @curio-data/dsh-intelli-search`. Configure the key using the [documented credential routes](../../../README.md#deepseek-harness), then start that profile from the project directory with `dsh --profile tui`.
3. Ask: “Use `mcp__intelli__intelli_search` to find what Node.js `AsyncLocalStorage.getStore()` returns outside a context. Cite the official docs.” Confirm a successful tool call and a cited answer. A listed tool alone does not prove the credential works.

To remove the bundle, run `dsh plugin --profile tui remove @curio-data/dsh-intelli-search` and restart that profile.

After public verification, put the install command and quick-start link in the release notes, the npm package README and a short community announcement. Link to the tagged installation guide, not this development branch. State the versions and operating system actually tested. Do not advertise an official marketplace listing: for the inspected hosts, discovery through an operator-added [custom JSON index](PLAN.md#optional-step-8-publish-a-custom-json-index) is optional and is not part of installation. No catalogue submission, repository topic change or external promotion is authorised by this guide.
