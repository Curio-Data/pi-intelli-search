# DeepSeek Harness Host Support

Status: proposed host, recorded 18 November 2026. Not implemented. The owner has not decided on the sequencing. This brief specifies the smallest change that makes `intelli-search` a first-class host plugin for _DeepSeek Harness_ (`dsh`), reusing the existing standalone MCP server and the existing generator.

Read with `docs/COMPATIBILITY.md` (evidence classes), `scripts/README.md` (the bundle generator) and `docs/proposals/BATCH-RESEARCH.md` (the proposal format this document follows).

## 1. Summary

Add `plugins/dsh` as a third generated host plugin, emitted by `scripts/generate-plugin-bundles.mjs` from the same `guidance/` source that produces the _Claude Code_ and _Codex_ bundles. The plugin mounts the published `@curio-data/mcp-intelli-search` package through the Model Context Protocol (MCP) client bridge that ships inside `dsh`, registers the four `intelli_*` tools, and registers the shared research skill through the host's skill service because a `dsh` bundle cannot add files to a scanned skill directory by itself.

Three things make this cheaper than the existing hosts:

1. The bridge is in-box and enabled by default, so the bundle carries no runtime module except a small skill registrar.
2. The host namespaces MCP tools by server name, exactly as the generator already computes per host, so the skill stays generated.
3. The host has a documented credential layer (`$DSH_HOME/.env`) whose values are copied into `process.env` at boot, so the key crosses the process boundary without a bespoke key file and without a settings card.

The adapter needs one small change, `--host dsh`, so that the launcher can rely on the host's per-user configuration directory and its working directory instead of explicit path exports.

## 2. Motivation

The standalone server already supports any stdio host through explicit `--config` and `--workspace`. That path works today on `dsh`, and is what the first local verification used. It is not good enough to publish for three reasons:

| Problem with generic registration | Consequence on `dsh` |
|---|---|
| `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` must be absolute paths | A generated bundle cannot know the operator's home directory, so the patch cannot carry them |
| The key must reach the child process | The host scrubs the ambient environment, so the key has to be passed explicitly in the row, and the store consulted by the host's own model settings is not reachable from a synchronous config expression |
| No zero-configuration first run | _Codex_ returns actionable guidance from an empty state; `dsh` would fail with a path error |

`--host dsh` removes all three, mirroring what `--host codex` already does for _Codex_.

## 3. Host Facts the Implementation Encodes

Established by inspection of `dsh` 0.2.2-rc.1 on 17 and 18 November 2026. The host is a developer preview, so treat these as version-specific.

| Fact | Value |
|---|---|
| Package and binary | `@deepseek-ai/dsh`, `dsh` on `PATH`; `engines.node` is `>=24.9.0` |
| MCP bridge | `@deepseek-ai/dsh-mcp-client`, shipped and enabled; no server enabled by default |
| Bridge row fields | `serverName`, `transport` (`stdio` or `streamable-http`), `command`, `args`, `env`, `cwd`, `toolCallTimeoutMs`, `failOnStartupError`, `reconnect` |
| Tool naming | `mcp__<serverName>__<rawName>`; `serverName` matches `[A-Za-z0-9_-]{1,32}` |
| Default call timeout | `toolCallTimeoutMs` 60,000 ms |
| Credential layer | `$DSH_HOME/.env` is copied into `process.env` at boot; a stored credential behind the model settings page is service-only and asynchronous |
| Skill registration | `ctx.skills.register(SkillRegistration)`; `source` is required, `invocation` and `provider` are supplied by the registry |
| Skill body | Markdown without frontmatter; the registering plugin parses `name`, `description` and `whenToUse` itself |
| Bundle manifest | `package.json` with `dsh.bundle.patch`, exported `./locale/*.json` and `./icon` |
| Display metadata | `meta.title` and `meta.description` in locale JSON, plus an SVG, PNG, JPEG or WebP icon up to 256 KiB |
| Install | `dsh plugin --profile <name> add <spec>`; bundles resolve from the profile's `node_modules` |
| Catalogue submission | A pull request adding one YAML file under `data/plugins/` in the community catalogue, plus the `dsh-plugin` repository topic |

The `toolCallTimeoutMs` default is the single most consequential fact. A default `intelli_research` run with budget retries can exceed ten minutes, so a bundle that omits this field guarantees a timeout as the first user experience.

## 4. Relationship to the Existing Hosts

The proposal adds a host, not a second product.

| Option | Decision | Reason |
|---|---|---|
| Native `dsh` extension in TypeScript, mirroring `src/` | Rejected | The `dsh` pipeline would be a third copy of the five stages; `packages/mcp` already provides the same behaviour over stdio |
| Replace the host's own `web_search` provider | Rejected | The host's web seam is a provider swap behind two tool names, a crowded and commoditised surface; it would discard the differentiator of cached, cited, collated research |
| Generated host plugin over MCP | Accepted | Matches the two existing hosts, keeps one engine and one cache format, and needs no pipeline code |

The native `Pi` extension remains the reference implementation. Nothing in this brief changes `src/`.

## 5. Evidence and Limits

All evidence below was produced by an external contributor on one Linux workstation, not by the owner and not in the repository's harness. It falls outside the recorded evidence classes in `docs/COMPATIBILITY.md` until the owner reproduces it.

| Check | Result |
|---|---|
| Adapter start under a configuration-file row | Server started, four tools registered as `mcp__intelli__*` |
| Credential from the host's environment | `OPENROUTER_API_KEY` passed through a `!!js` expression resolved correctly |
| Inference | `intelli_search` returned a grounded answer with six sources |
| Full pipeline | Three-page `intelli_research` completed search, dual fetch, extraction, collation and cache write, with the source inventory and `[S1]` to `[S3]` references |
| Credential fallback | With the environment variable empty and a key file present, the server fell back to the file, so the `|| ''` form is safe during migration |
| Skill registration | `ctx.skills.register()` published a skill that loaded with its base directory inside the bundle; disabling the plugin removed it from the catalogue and re-enabling restored it |

Limits: one workstation, one host version, no continuous integration run, and no measurement of first-run `npx` latency inside the host. The skill registration was verified, but the two required fields were found by failure, which suggests the registration contract deserves a unit test on the host side before it is relied on.

## 6. Design Decisions

Four choices need the owner's agreement because they appear in generated output that is hard to change later.

### 6.1 Server Name

Use `serverName: intelli` for this host, not the shared `SERVER_NAME` constant.

The host repeats the server name in every tool identifier. The shared constant gives `mcp__intelli_search__intelli_search`, which is long in every tool call and in every skill example. `intelli` gives `mcp__intelli__intelli_search`. The generator already derives a per-host tool prefix, so the change is a third entry in the same mapping.

The cost is inconsistency with the other two hosts, where the server is `intelli_search` because _Codex_ rewrites hyphens and because the underscore keeps declared and observed names identical. Document the difference in the compatibility matrix rather than hiding it.

### 6.2 Credential

Reuse the host's environment layer and nothing else.

The generated patch passes the key as:

```yaml
env:
  OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''
```

The empty-string form is load-bearing. The host's config expressions are evaluated synchronously, so they cannot await the host's credential service, and an operator who pastes a key into the host's model settings page has it stored somewhere a child process cannot see. The `.env` layer is the only place both the host's models and the child process can read.

Setups that must not be reproduced: a bundle-specific key file, and a shim plugin that mutates `process.env` before the row mounts. Both work; neither is worth the maintenance.

### 6.3 Workspace

Take the workspace from the process working directory, as `--host codex` does, and keep the home-and-root guard.

The limitation to document: the bridge fixes `cwd` when it spawns the child, and the host allows the agent to change directory during a session. Research cache therefore follows the directory the harness was launched in, not a later `cd`. The bundle exposes `cwd` as an override for operators who need a fixed project root.

### 6.4 Skill Delivery

Register the skill from a module inside the bundle.

A `dsh` bundle cannot drop a file into a scanned skill directory, and the alternative field (`bundledSkillDir`) needs an absolute path in the patch. A module that reads `skills/intelli-search/SKILL.md` relative to its own location is portable and stays out of the adapter.

Requirements found by failure, to be encoded in the generator:

| Requirement | Detail |
|---|---|
| `source` | Required on the registration; omitting it fails at load with `source must be a string`. Use `'bundled'` |
| Body | Must exclude the YAML frontmatter, which the registrar parses for `name`, `description` and `whenToUse` |
| Precedence | A project or user skill of the same name outranks the registration, which keeps local overrides working |

## 7. Adapter Changes

### 7.1 `packages/mcp/src/cli.ts`

Accept the new host, and stop comparing against the string `"codex"` in the four places that mean "a host supplied the paths".

```ts
// cliOptions
if (values.host !== undefined && values.host !== "codex" && values.host !== "dsh")
  throw new Error("Unsupported host");
const host = values.host === "codex" || values.host === "dsh";
return {
  ...values,
  setup,
  config: values.config ?? (setup || host ? undefined : env.INTELLI_SEARCH_CONFIG),
  workspace: values.workspace ?? (setup || host ? undefined : env.INTELLI_SEARCH_WORKSPACE),
};
```

In `main()`, `args.host === "codex"` becomes a truthiness test on the host, `hostPaths()` is used for both hosts, `process.cwd()` supplies the workspace for both, and the diagnostic strings gain a host label so the guard reads correctly:

```
DeepSeek Harness working directory must be a project directory, not the home or
filesystem root; start the harness from the project or set cwd on the bridge row
```

The `--help` text gains a line for the new host and the summary of what host mode supplies. Exact wording is an implementation decision, but the help must keep the existing statement that generic serving requires explicit paths.

### 7.2 `packages/mcp/src/host.ts`

Generalise `defaultCodexConfig(workspace, paths)` to `defaultHostConfig(host, workspace, paths)` and keep the _Codex_ behaviour byte-identical. The defaults are already host-neutral: `perplexity/sonar` for search and `minimax/minimax-m3` for extraction and collation, with the same tuning. The function's name is the only thing tying it to one host.

`hostPaths()` needs no change if both hosts share `$XDG_CONFIG_HOME/mcp-intelli-search`. That is the recommendation: one per-user configuration across hosts, so an operator who sets models once does not maintain two files.

### 7.3 Tests

| Test | Assertion |
|---|---|
| Unit, `cliOptions` | `--host dsh` is accepted, leaves `config` and `workspace` unset, and still yields to explicit `--config` and `--workspace` |
| Unit, `cliOptions` | An unknown host is still rejected |
| Unit, `defaultHostConfig` | The _Codex_ output is unchanged by the generalisation (a golden comparison) |
| E2E, new `test/e2e/18_dsh_plugin.sh` | Generated bundle installs into a scratch profile, the four tools appear, `--check-config` passes, a credentialed `intelli_search` returns sources |
| E2E, registration | Disabling the bundle removes both the tools and the skill from the catalogue; re-enabling restores them |

The end-to-end script needs a `dsh` discovery guard like the existing host scripts: skip with a recorded note when the binary is absent, rather than failing.

## 8. Generator Changes

### 8.1 `launcherFor`

Add a third branch. Registry mode:

```js
{
  command: "npx",
  args: [
    "-y",
    "--package",
    `${mcpPkg.name}@${mcpPkg.version}`,
    "mcp-intelli-search",
    "--host",
    "dsh",
  ],
}
```

Tarball mode needs the same treatment as _Codex_: no placeholder expansion exists, so the launcher embeds the absolute vendor directory passed to the generator.

### 8.2 `renderSkill`

Add `dsh` to the host mapping:

| Token | `dsh` value |
|---|---|
| Tool prefix | `mcp__intelli__` |
| Host label | `DeepSeek Harness` |
| Cache read hint | ``Use the `read` tool, this host's file-reading capability.`` |

No change to `guidance/research-guide.md` is required: every host-specific reference already goes through `{{TOOL_*}}`, `{{HOST}}`, `{{CACHE_READ_HINT}}` and `{{SETUP}}`.

### 8.3 New Generated Files

The bundle is a publishable package, not only a repository directory, because the host installs from an npm or pinned-git specification rather than from a repository marketplace catalogue.

| File | Purpose |
|---|---|
| `plugins/dsh/package.json` | Bundle manifest with `dsh.bundle.patch`, exported locale and icon, and the version pinned from `packages/mcp/package.json` |
| `plugins/dsh/index.js` | Skill registrar, generated from a template in `scripts/` |
| `plugins/dsh/cordis.patch.yml` | Two rows: the bridge row and the registrar |
| `plugins/dsh/skills/intelli-search/SKILL.md` | `renderSkill("dsh")` output |
| `plugins/dsh/locale/en.json`, `locale/zh.json` | Display title and description |
| `plugins/dsh/icon.svg` | Original artwork, distinct from the other hosts so the plugin manager does not show three identical icons |
| `plugins/dsh/README.md` | Install, verify, limits and uninstall, for the catalogue listing |

Sketch of the patch, with the version interpolated from the MCP package:

```yaml
- insert:
    - id: mcp-intelli-search
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: intelli
        transport: stdio
        command: npx
        args: ['-y', '--package', '@curio-data/mcp-intelli-search@<version>', 'mcp-intelli-search', '--host', 'dsh']
        env:
          # The host copies $DSH_HOME/.env into process.env at boot. An empty
          # value is absent to the server, so the row stays valid before setup.
          OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''
        toolCallTimeoutMs: 600000
        failOnStartupError: false
    - id: intelli-search-skill
      name: '@curio-data/dsh-intelli-search'
```

Rationale for the two defaults that differ from the bridge defaults:

- `toolCallTimeoutMs: 600000` trades a long wait for a spurious timeout. Ship it; document that the host's own deadline still applies to the call.
- `failOnStartupError: false` keeps a missing or slow `npx` download from rejecting the whole profile. The row stays visible and the failure is logged.

`plugins/dsh/package.json`:

```json
{
  "name": "@curio-data/dsh-intelli-search",
  "version": "<mcp version>",
  "type": "module",
  "exports": { ".": "./index.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["index.js", "cordis.patch.yml", "skills/**", "locale/*.json", "icon.svg", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`plugins/dsh/index.js` follows the shape already validated locally: read the sibling `SKILL.md`, strip the frontmatter, parse `name`, `description` and `whenToUse`, and call `ctx.skills.register({..., source: 'bundled', path, resourceBase})`. The registrar declares `inject: ['skills']` and imports nothing from the host, so the bundle needs no peer dependencies.

### 8.4 Drift Gate

`generate:plugins` and `check:plugins` already cover the committed tree. Add the new paths to the same map so `--check` fails on drift. `scripts/README.md` must name the third host in the script's description and in the modes table.

## 9. Guidance Changes

### 9.1 New `guidance/setup-dsh.md`

Proposed content, following the shape of `guidance/setup-codex.md`:

- The plugin launches the pinned package through `npx` with `--host dsh`; the first start downloads, so it needs network access and Node.js 24.9 or later, the host's own floor.
- No path exports are required. The server uses the harness working directory as its workspace and writes cache below it. Start the harness from the project, or set `cwd` on the bridge row.
- Credentials come from the harness environment layer. Put `OPENROUTER_API_KEY` in `$DSH_HOME/.env` and restart the harness once, because the layer is copied into the environment at boot. An exported variable in the launching environment takes precedence.
- Do not paste the key into a patch file. The host's model settings page stores its own credentials in a service a child process cannot read, so it does not provision this server.
- Verification: request a quick search and confirm a tool call and an answer with sources. The tool list alone does not prove provider access.
- Tool names are `mcp__intelli__intelli_search` and its three siblings. A missing tool set means the bridge row did not start; report that rather than substituting the host's own search.
- Research calls can take minutes. A slow call is not a hang; the bundle raises the call limit to ten minutes.
- Uninstall: `dsh plugin --profile <name> remove @curio-data/dsh-intelli-search`, then confirm with `dsh --profile <name> --dump-config`.

### 9.2 `guidance/research-guide.md`

No text change. One check before implementing: the guide currently tells the agent to treat the cache as below the selected workspace. On this host that is the harness launch directory, so the wording stays true.

## 10. Publication and Catalogue

| Step | Detail |
|---|---|
| Publish the bundle | `npm publish --access public` from `plugins/dsh`, in lockstep with the MCP package version. Add it to the release checklist next to the two package publishes |
| Community catalogue | One YAML file under `data/plugins/` in a pull request, plus the `dsh-plugin` topic on this repository. The catalogue's stated checks are: installable pinned version, complete metadata, name match, declared host range, openable README and licence, and a clean install, use and uninstall cycle |
| Host compatibility range | Declare `engines.dsh` on the catalogue entry as a range covering the preview line, and treat it as evidence-bounded rather than aspirational |
| Optional, later | A repository-hosted custom index (`format: 1`) so operators can add this repository under Plugins, Discover, Add index source. Not required for a first release; it duplicates the community listing |

The catalogue's `install-verified` and `security-audited` labels are index metadata, not attestations. Do not repeat them in this repository's documentation as if they certified the code.

## 11. Documentation Changes

Edit `README.md` only. `mcp.README.md`, `pi.README.md` and `packages/mcp/README.md` are generated; run `npm run generate:readmes` and `npm run check:readmes` afterwards, per the one-hand-edited-README rule.

### 11.1 `README.md`

| Location | Change |
|---|---|
| "Two Packages, One Engine" route table | Add a row: Host Plugin, _DeepSeek Harness_, generated bundle launching the pinned MCP package |
| Contents | Add the new install subsection to the generated contents list (the generator maintains it) |
| Install, MCP Server | New `#### DeepSeek Harness` subsection after `#### Codex` and before `#### Generic MCP Host`: install command, the `.env` credential step with the restart requirement, verification, the ten-minute call limit, tool names, uninstall |
| Install, MCP Prerequisites | State that a host plugin needs Node.js 24.9 or later, the harness floor, while generic registration continues to need 22 or later |
| Tools, Evidence and Provenance | No change; the pipeline is shared |
| Compatibility | Add the new host to the list of hosts with recorded evidence |

Proposed text for the new subsection, in house style:

````markdown
#### DeepSeek Harness

_DeepSeek Harness_ (`dsh`) ships an MCP client bridge, so the plugin is a configuration bundle rather than an extension. It inserts one bridge row and one skill registration; neither contains pipeline code.

The bundle is published as `@curio-data/dsh-intelli-search` and installs into a profile:

```bash
dsh plugin --profile web add @curio-data/dsh-intelli-search
```

Store the [_OpenRouter_](https://openrouter.ai) key in the harness environment layer and restart once:

```bash
printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" >> "${DSH_HOME:-$HOME/.dsh}/.env"
chmod 600 "${DSH_HOME:-$HOME/.dsh}/.env"
```

The layer is copied into `process.env` at boot, which is the only credential source a child process can read. A key stored through the host's model settings page does not reach this server. Start the harness from the project directory, because the server uses the working directory as its workspace and writes cache below it.

The four tools appear as `mcp__intelli__intelli_search` and its siblings. Research calls may take minutes; the bundle raises the bridge call limit to ten minutes. Confirm inference with a quick search and an answer with sources, because a connected server does not prove provider access.
````

### 11.2 `docs/COMPATIBILITY.md`

Add a row to the Host Plugins table and a `### DeepSeek Harness Evidence and Limits` section after the _Codex_ section. The row records the tested host version, and the section records each capability separately in the style of the existing two: installation and skill discovery, credential delivery, real research, unattended approval, and the tool naming difference. State the evidence class honestly, including that the first records come from an external contributor's workstation.

### 11.3 `docs/ARCHITECTURE.md`

One sentence in the standalone adapter bullet: generated host plugins now cover _Claude Code_, _Codex_ and _DeepSeek Harness_. No pipeline description changes, because the adapter is unchanged apart from host path resolution.

### 11.4 `scripts/README.md`

Three changes: the generator's opening sentence names three hosts; the generated-file list adds `plugins/dsh`; the Claude-tool-routing section gains a sibling paragraph only if a routing script is added (recommended, see 7.3).

### 11.5 `CHANGELOG.md`

One entry under the release that ships it: adds the _DeepSeek Harness_ host plugin, the `--host dsh` adapter mode, and the third generated bundle. Record the tool-naming difference because it is visible in every call.

### 11.6 `AGENTS.md`

Add the new host to any list of generated artefacts, and add one line to the documentation style guide's audience table if the new guidance file needs a correctness reference. The likely entry is `guidance/setup-dsh.md` under the same row as the other skill guidance, referencing the host's bridge schema at the tested version.

## 12. Compatibility Matrix Row

Suggested values, to be replaced by recorded evidence:

| Host | Tested Version | Evidence |
|---|---|---|
| _DeepSeek Harness_ | 0.2.2-rc.1 | Credential-free bundle installation and tool registration; credentialed `intelli_search` and three-page `intelli_research` through the bridge; skill registration and removal observed across disable and enable |

The section should note that the host is a developer preview, so the version column is a claim about that version and not a support range.

## 13. Definition of Done

- [ ] `--host dsh` accepted by the adapter; unknown hosts still rejected; help text updated
- [ ] `defaultHostConfig` generalised with unchanged _Codex_ output
- [ ] Unit tests for host parsing and host defaults
- [ ] `plugins/dsh` generated, including the registrar, patch, skill, locale and icon
- [ ] `npm run check:plugins` passes on a clean tree
- [ ] `npm run check:readmes` passes after regenerating from the edited root README
- [ ] `test/e2e/18_dsh_plugin.sh` installs the bundle, calls a tool and removes the bundle
- [ ] Compatibility matrix row and section added with the recorded date
- [ ] Bundle published and installable by name from the registry
- [ ] Community catalogue pull request opened, `dsh-plugin` topic applied
- [ ] Changelog entry written

## 14. Open Questions for the Owner

1. **Server name consistency.** Accept the `intelli` deviation for this host, or keep `intelli_search` everywhere and accept `mcp__intelli_search__intelli_search` in every call and skill example.
2. **Shared per-user configuration.** One `$XDG_CONFIG_HOME/mcp-intelli-search` across hosts, or a host-specific directory so a `dsh` operator can select different models without disturbing _Codex_.
3. **Bundle publication.** Publish `@curio-data/dsh-intelli-search` from `plugins/dsh`, or keep the bundle repository-only and ask operators to install from a pinned git commit.
4. **Workspace semantics.** Accept that cache follows the harness launch directory, or ask the host for a per-session workspace passed to MCP configuration before implementing the bundle.
5. **Evidence ownership.** Whether the contributor's recorded runs are entered as a lower evidence class, or reproduced by the owner before the matrix row is written.

## 15. Non-Goals

- A native `dsh` extension in TypeScript. The MCP adapter is the shared engine.
- A search provider for the host's own `web_search` tool. That surface is commoditised and would not carry the pipeline's value.
- Changes to `src/`, the native `Pi` extension, or the cache format.
- A settings card for the key. The host's environment layer covers it; a host module that proxies credentials would add code for no user-visible gain.
- Windows verification. The host is cross-platform, but the recorded evidence is Linux only, and the matrix must say so.
