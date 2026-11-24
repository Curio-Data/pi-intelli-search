# Fetch-Only Proxy Requirement Brief

Status (24 November 2026): requirement recorded; nothing implemented. Ten decisions and three proposed properties are open for the owner in [Open Decisions](#open-decisions). This brief proposes that an implementing agent starts after the owner has recorded each one there.

## Summary

The owner wants the page-fetching stage of `intelli-search` to send its requests through an HTTP (Hypertext Transfer Protocol) proxy, with [_NodeMaven_](https://nodemaven.com) named as an example service, while the rest of the extension keeps its current network path. Neither proxy environment variables nor a global `httpProxy` guarantee fetch-only routing. On `Pi` 1.6.0 both can send the model calls of the search, extract, collate and cache-suggest stages to the proxy along with the page fetches. A `httpProxy` set only by a trusted project already separates the extension's page fetches from the host's model route in the inspected source; no host session has exercised that case. This brief records the requirement in the owner's words, the behaviour of the code at `66b1b61`, what a local test established about the fetch client, the constraints an implementation must respect, and the decisions the owner still has to make.

## The Requirement

The owner stated the requirement in a `Pi` session on 24 November 2026:

> I want to consider http proxy support for services such as nodemaven

> For context, we want fetch only proxy and not whole extension

When the agent that recorded this brief moved on to design options, the owner corrected it: the task was to understand the requirement and document it for a fresh agent, not to implement.

| ID | Requirement | Basis |
|---|---|---|
| R1 | Page fetching can send its requests through an HTTP proxy | First statement |
| R2 | The proxy is generic. NodeMaven is an example, not the only service to support | "such as" in the first statement |
| R3 | The proxy applies to fetching only. The other stages of the extension keep their current network path | Second statement |
| R4 | The present deliverable is a documented requirement for a fresh agent | The correction |

Fetching means every outbound request that `src/core/fetch.ts` makes:

- The request for the page's HyperText Markup Language (HTML), which [_Defuddle_](https://github.com/kepano/defuddle) cleans.
- The request that asks for a Markdown variant with an `Accept: text/markdown` header.
- When that request yields no Markdown, the request that looks for a Markdown alternate link in the page, and the alternate's own request when a link is found.
- When a run completes with a synthesis and discovery is enabled, the `llms-full.txt` probe and download, attempted once per distinct hostname among the successfully fetched pages.

Each page therefore starts two client fetches and can trigger two more. A count of client fetches is not a count of wire requests or of exit addresses. These are the requests that the fetch module makes with its own client. Its HTML parser, Defuddle, can also request supplementary content for some sites through the host's global `fetch` function, which the module's proxy option does not reach (decision D9). The last item is a fetch by this definition and is treated as in scope unless the owner decides otherwise (decision D5).

## Current Behaviour

The reference for this section is the code at `66b1b61`. The installed native package, 0.24.0, has the same proxy code: `src/core/fetch.ts` is byte-identical, and the proxy lines of `src/settings.ts`, `src/core/types.ts`, `src/core/defaults.ts` and `src/core/operations/research.ts` match.

**Setting.** `httpProxy` is a top-level `Pi` setting, not a `pi-intelli-search` key. `loadSettings()` in `src/settings.ts` reads `settings.json` from the agent directory and, for a trusted project, from the project's configuration directory; a later file overrides an earlier one. `extractOverrides()` copies `httpProxy` into `ResearchSettings.httpProxy` and accepts any nonempty string. Page fetching has honoured it since 0.10.2 ([changelog](../../CHANGELOG.md#0102---2026-06-17)).

**Fetch path.** `runFetchStage()` passes `settings.httpProxy` as `proxy` to `fetchPages()`, and `startLlmsFullDownloads()` passes it to `downloadLlmsFullToCache()`. `FetchOptions.proxy` in `src/core/fetch.ts` reaches every request the file makes.

**Model stages.** The search, extract, collate and cache-suggest calls do not pass through `src/core/fetch.ts`. In the native extension they go through `ctx.modelRegistry.streamSimple()` to `Pi`'s managed HTTP clients, which apply `httpProxy` as well ([README](../../README.md#pi-extension-compatibility)). The installed `Pi` 1.6.0 does so in two steps, in `dist/core/http-dispatcher.js`: `applyHttpProxySettings()` copies a set `httpProxy` into the `HTTP_PROXY` and `HTTPS_PROXY` variables when they are unset, and `configureHttpDispatcher()` installs an `EnvHttpProxyAgent` as the global dispatcher, whether or not `httpProxy` is set. The host passes only its global settings to the first step. A global `httpProxy` therefore can send both routes to the same gateway. Model requests that use the host dispatcher follow its effective environment and bypass rules. A metered gateway such as NodeMaven's can then carry model calls as well as page fetches. The extension also reads a trusted project's `httpProxy`, after the global one, and passes it to its fetch paths alone. A value set only by a trusted project would change page fetches in that project and leave the model calls on the global route. That case follows from the installed source and was not exercised in a host session.

**MCP server.** The standalone Model Context Protocol (MCP) server, which serves [_Claude Code_](https://code.claude.com/docs/en/plugins), [_Codex_](https://developers.openai.com/codex/plugins) and [_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) (dsh), accepts no proxy configuration key. `parseDocument()` in `packages/mcp/src/config.ts` accepts only `providers`, `models` and `tuning`, and the [README](../../README.md#configuration-1) states that proxy settings are not accepted. No code in `packages/mcp/src` hands a proxy to the fetch layer. The server's model calls use Node's global `fetch` unless one is injected (`packages/mcp/src/providers/openrouter.ts`).

**Tests and documentation.** `test/settings.test.ts` covers reading `httpProxy`. No test in the repository's suites sends a request through a proxy. `docs/ARCHITECTURE.md`, `skills/intelli-search/SKILL.md` and `guidance/` do not mention the proxy.

## Observed Fetch Failures

This section holds dated observations from one host, made on 24 November 2026. The group called organic use is selected by path: research caches under any `.search/` directory, minus this repository's `evidence/` and `.tmp/` folders and every path that contains `.worktrees/`. The selection is not a positive record of who ran a query.

**Telemetry sidecars.**

| Measure | This Repository | Other Projects | Total |
|---|---|---|---|
| Research runs | 86 | 189 | 275 |
| Completed | 77 | 176 | 253 |
| Page fetches succeeded | 298 | 856 | 1,154 |
| Page fetches failed | 42 | 169 | 211 |

211 of 1,365 page fetches failed (≈15.5%). The share was between ≈14.6% and ≈16.7% in each month from July to November.

**Failed pages in cached reports.** The sidecar counts failed page fetches but records no reason for each one. Each cached report lists its failed pages with a fetch or an extraction reason under "Blocked/Failed URLs". The reports are a different population from the sidecars: older reports have no sidecar, and a batch entry has a sidecar of its own. Of 402 organic reports dated April to November 2026, 115 list at least one failed page, in 191 lines:

| Reason | Lines |
|---|---|
| HTTP 403 or 429 | 75 |
| Domain name system (DNS) lookup failure on a name classed as guessed from prose, such as `plugin.json` | 32 |
| DNS lookup failure on another hostname | 29 |
| Content type rejected, for example a Portable Document Format (PDF) file | 25 |
| Other HTTP status (401, 404, 405, 410, 418) | 21 |
| Connection error, timeout or other | 9 |

The split between the two DNS rows is a judgement: a name with no dot, a trailing colon or a file extension was classed as guessed from prose. The origin of each name was not verified, and the rule is recorded in the evidence README.

54 reports (≈13%) lost at least one page to a 403 or 429, as did 8 of the 119 dated October or November. The count covers failure lines present in saved reports. A run in which every page fetch fails saves no new report, so the count cannot measure the share of all runs affected by blocking.

A 403 or 429 is the largest group of classified failure lines, and the group that proxy vendors claim a different exit address changes. The research cache holds only vendor-affiliated guides for that claim. Neither dataset shows how many failures a proxy would prevent, and whether a residential exit address clears those responses for these pages is untested.

The figures come from `evidence/agents/2026-11-24-fetch-proxy-requirements/usage/`. It names client project paths and page hostnames, so it stays in the gitignored evidence folder.

## Fetch Client Behaviour

The tests below ran on 24 November 2026 against `fetchPages()` from `src/core/fetch.ts`, in a standalone process without a `Pi` host, with a local proxy that demands `Proxy-Authorization` and logs each request. Each test gives the fetch client the proxy's uniform resource locator (URL), as an option or through the environment. Conditions: [_wreq-js_](https://github.com/sqdshguy/wreq-js) 2.3.1, the installed version (the manifest range is `^2.3.0`), whose `dist/wreq-js.js` is byte-identical to the copy installed with the native package; and [_Node.js_](https://nodejs.org) 26.13.1. The environment tests set the upper-case and lower-case form of each variable. Not tested: inside a `Pi` process, on the MCP path, with a SOCKS5 proxy URL, or with a commercial gateway.

| # | Test | Result |
|---|---|---|
| P1 | `proxy` set to a URL with a username and password; one plain-HTTP target and one HTTPS (HTTP Secure) target | Every request carried the credentials as `Proxy-Authorization` before any challenge: three absolute-form requests for the HTTP page and one `CONNECT` tunnel per request for the HTTPS page. Both pages returned content |
| P2 | No `proxy`; `HTTP_PROXY` and `HTTPS_PROXY` set in the process environment | The fetch client used the environment proxy, credentials included. Node's global `fetch` in the same process ignored the variables: its request to a name that does not resolve failed, and the proxy log shows no request for it |
| P3 | Environment proxy, with `NO_PROXY` naming the HTTPS target | That target was fetched directly. The unlisted HTTP target still used the proxy |
| P4 | Environment proxy, and an explicit `proxy` without credentials | The explicit option won: the tunnel requests carried no credentials, and the proxy refused them. Both URLs named the same listener |
| P5 | `proxy` pointing at a closed port | `page.error` named the connection failure. It did not contain the password |
| P6 | Proxy answering 407 to every request | `page.error` named the proxy authorisation failure. It did not contain the password |
| P7 | Tunnels opened and bytes counted on the proxy's client connections for three public pages | Two tunnels for `nextjs.org/docs` and three each for `nodejs.org/api/fs.html` and `www.python.org`. Bytes sent to the client totalled ≈70 KB, ≈323 KB and ≈56 KB. Client-connection bytes, both directions combined and including tunnel setup, totalled ≈75 KB, ≈330 KB and ≈64 KB |

The fetch client honoured the environment proxy in P2 although the wreq-js 2.3.1 README does not describe that behaviour and its type declarations expose no option to disable it.

The results bear on the requirement in four ways:

- **Basic authentication from a proxy URL works unchanged.** NodeMaven's URL format carries its credentials the way P1 exercised: the client sends Basic proxy credentials taken from the URL, and no other authentication mechanism was exercised. P1 does not establish a protected route to a gateway. The only gateway scheme exercised is `http://`, whose `Proxy-Authorization` header carries the password in clear text on the hop to the gateway, and P1 ran on loopback. Whether the example service offers a protected gateway connection was not checked.
- **Proxy environment variables are not a fetch-only route on `Pi`.** The fetch client honours them (P2, P3). So does the host: `Pi` 1.6.0 routes its model calls through the same variables (see Model stages). Setting them on a `Pi` process can send model calls through the proxy as well. On the MCP server the model calls use Node's global `fetch`, which ignored the variables in the standalone process (P2); the MCP path itself was not tested.
- **`httpProxy` is passed to the fetch layer as the explicit option.** In P4 the explicit option determined the credentials used at a single gateway. The extension passes the last `httpProxy` it reads, which a trusted project can set. The host applies the global `httpProxy` to its own dispatcher. A project-level value therefore need not give model calls and page fetches the same route. Precedence between different gateway addresses was not tested; it belongs to the tests for D8.
- **The tunnel counts and byte totals of P7 are observations for three pages**, not a fixed ratio to page size.

## The Example Service

Facts from NodeMaven's documentation and pricing page, read on 24 November 2026. The session and pricing rules below apply to its Residential and Mobile proxies; its ISP proxies are a separate product priced per address. Each exit is an Internet Protocol (IP) address, chosen by parameters in the username, and traffic is billed by the gigabyte (GB). The session and targeting parameters belong to this service; a generic proxy need not recognise them.

| Item | Value |
|---|---|
| Gateway | `gate.nodemaven.com`, for every Residential and Mobile proxy |
| HTTP ports | `8080` to `9080` and `32000` to `33000`; the dashboard gives `8080` |
| SOCKS5 ports | `1080` to `2080` and `42000` to `43000`; the dashboard gives `1080` |
| URL format | `http://USERNAME-country-us-sid-abc123:PASSWORD@gate.nodemaven.com:8080` |
| Session control | Written into the username. A sticky session (`-sid-<id>`) keeps one address for up to 24 hours while that address is available, and by default substitutes one from the same location when it is not. A username without `-sid-` gets a new address on every request. `-norotate-true` turns substitution off. The dashboard accepts a custom duration from 60 to 86,400 seconds and writes it into the username as a duration, so 500 seconds becomes `-ttl-8m20s` |
| Dashboard default | Sticky. A string copied from the dashboard with its default settings keeps one address for up to 24 hours |
| Targeting | `-country-`, `-region-`, `-city-` or `-zip-`. The IP filter `-filter-medium` is the default |
| Billing | By traffic. Monthly subscription or pay-as-you-go. Paid trial: 750 megabytes (MB) for $3.50 |
| Prices shown | Monthly plans from $4.25 per GB at 2 GB to $2.20 per GB at 1k GB; pay-as-you-go from $5.00 per GB at 2 GB to $2.45 per GB at 1k GB. The calculator's default selection, 20 GB, showed $75 monthly ($3.75 per GB) and $90 pay-as-you-go ($4.50 per GB) |

Two facts bear on the open decisions. The URL format is the one P1 exercised. Session control lives in the username. A fixed setting therefore fixes the choice between one exit and a new exit per request, and a distinct session identifier per research call would need the extension to generate it (decision D4).

## Bandwidth and Cost

The figures in this section are constructed examples from small samples, not measurements of typical traffic or of a bill.

- **Pages.** For the three P7 pages, the proxy counted ≈64 KB to ≈330 KB per page on its client connections, both directions combined and including tunnel setup.
- **`llms-full.txt`.** This repository's cache holds 103 downloaded files with 209 MB of stored text across 98 reports: ≈2.1 MB per report on average, and a largest file of 40.9 MB from `docs.claude.com`. Stored size is not a measure of transferred bytes.
- **Cost, for scale only.** If billable bytes equalled stored text plus the P7 client-connection bytes, ten pages of the largest P7 size and the largest saved file would come to ≈44 MB, which is ≈$0.20 at $4.50 per GB. Ten pages of the smallest P7 size with the mean stored text per report would come to ≈3 MB, which is ≈$0.01. Neither example is a measured run or a bill. On those assumptions the larger figure is about twice the README's [planning estimate](../../README.md#cost) for the model cost of a ten-page run.
- **Disclosure.** For an HTTPS target sent through it, the proxy operator sees the hostname. For a plain-HTTP target it can also read the path, query, headers and page content. Research on client-related topics would disclose that list of hostnames to a third party.

## Constraints

An implementation works inside these rules of the repository, recorded in `AGENTS.md`.

- **Versioning.** A change under `src/core/` bumps the minor version of the native and MCP packages. An MCP change, alone or with the core change, also gives the dsh bundle that MCP version.
- **Settings.** Every namespaced key appears once in `NESTED_KEYS` in `src/settings.ts`. The round-trip test keeps its own list of cases (`NESTED_CASES` in `test/settings.test.ts`), so a new key needs a case there as well. The numeric tuning keys are range-checked: an invalid value is dropped with a warning that repeats the value, and nothing is thrown, so that a typo cannot take the session down. `httpProxy` has no such check. A new proxy key needs a validation whose warning does not repeat the URL, because the URL can hold the password. That is a requirement of this change, not present behaviour. Project settings load only for a trusted project.
- **MCP configuration.** `parseDocument()` rejects unknown keys. A credential enters through the name of an environment variable or the path of a file, never as a value in the configuration, and generated launch configuration carries no credential.
- **Core boundary.** `src/core/` stays host-neutral, and `Pi` libraries stay out of the standalone runtime.
- **Telemetry.** The `meta.json` schema in `src/core/telemetry.ts` grows by optional fields only and stays local. The sidecar has no credential field, but it holds the full query and can hold diagnostic text, so a proxy URL or password must never be copied into it from settings or transport diagnostics. `disableTelemetry` suppresses it.
- **Documentation.** The root `README.md` is the only hand-edited package README; `npm run generate:readmes` and `npm run generate:plugins` derive the others. `docs/ARCHITECTURE.md` has no proxy section.
- **Evidence.** Do not cite disposable scratch under `.tmp/` in tracked files. Promote scratch to `evidence/` before citing it.

Three properties follow from R3, from the trusted-settings rule in `loadSettings()` and from the repository's rule that credentials never enter prompts, cache metadata or generated launch configuration. An implementation must hold them.

| ID | Property |
|---|---|
| S1 | The new setting changes only the page-fetching stage, and leaves every model call on the route it has without the setting. What the stage includes follows the owner's answer to D9 |
| S2 | No credential taken from the proxy configuration or from transport diagnostics reaches a prompt, cache file, telemetry record, tool result, log line, error message or settings warning. P5 and P6 cover two failure modes of `page.error`. A Transport Layer Security (TLS) failure inside the tunnel, a timeout and a gateway error are untested |
| S3 | An untrusted project cannot set the proxy |

This brief proposes three more properties, which the owner may decline in [Open Decisions](#open-decisions).

| ID | Property |
|---|---|
| S4 | The password reaches the gateway only over a protected or trusted connection, because `Proxy-Authorization` carries it in clear text on that hop (P1). A protected gateway connection is unverified |
| S5 | Telemetry, when enabled, records whether a run was configured to use a proxy, as a Boolean and never the URL. It would record configuration, not the route a request took |
| S6 | A setting that is present but invalid, or whose credential cannot be loaded, fails the affected fetches with a redacted error. It does not send them on another route |

## Open Decisions

The owner records each decision and its date in the last column. The implementing session follows that column. The recommendations are the recording agent's, not decisions.

| # | Decision | Options | Recommendation | Owner Decision |
|---|---|---|---|---|
| D1 | How the proxy is configured | (a) A `pi-intelli-search` setting that only the fetch layer reads. (b) Proxy environment variables on the host process, which do not satisfy R3 on the inspected native host | (a) | |
| D2 | Which packages | (a) Native extension only. (b) Native extension and MCP server | (b) | |
| D3 | When a fetch uses the proxy | (a) Always, when one is configured. (b) Direct first, proxy after a failure. (c) Only for hosts on a list | (a) | |
| D4 | Exit address rotation | (a) Session parameters written into a fixed setting. (b) A session identifier generated per research call | (a) | |
| D5 | `llms-full.txt` downloads | (a) Through the proxy. (b) Direct | (a) | |
| D6 | Where the password lives | (a) In `settings.json`. (b) In an environment variable the setting names. (c) In a file the setting names | (c) | |
| D7 | Proxy variables already in the environment | (a) Accept that they still route fetches when the setting is absent. (b) Require the fetch layer to ignore them | (a) | |
| D8 | Order of precedence | (a) The new setting, then `httpProxy`, then proxy variables in the environment. (b) Another order, recorded here | (a) | |
| D9 | Supplementary requests made by the HTML parser | (a) Route them through the fetch proxy as well. (b) Leave them on the host's global route and document that | (a) | |
| D10 | Meaning of direct for an exception while the setting is present | (a) Omit the new proxy only; other proxies in the environment can still apply. (b) Bypass every proxy, for which no supported per-request bypass has been verified | (a) | |
| S4 | Protected or explicitly trusted gateway connection | (a) Required. (b) Not required | (a) | |
| S5 | Telemetry field for proxy use | (a) Accept. (b) Decline | (a) | |
| S6 | Failing fetches on an unusable setting | (a) Accept. (b) Decline | (a) | |

**D1: How the proxy is configured.** Option (b) needs no code change and routes the fetch layer (P2, P3). It cannot guarantee R3 on `Pi` 1.6.0, whose dispatcher routes model calls through the same variables, and it exports the password to every child process whose environment is not scrubbed. The recommendation is option (a) as the intentional, supported and testable interface, for three reasons. It leaves model calls on their existing route. A trusted project can set its own proxy. A test can pin the behaviour. A trusted project's `httpProxy` already gives part of that effect (see Model stages). It is undocumented for that purpose, has no validation, and does not reach the MCP server. How proxy variables in the environment behave when the setting is absent is D7.

**D2: Which packages.** Option (b) lets sessions on Claude Code, Codex and DeepSeek Harness benefit. The MCP server needs its own configuration key, which under the repository's rule names an environment variable or a file. If the MCP server is selected, option (a) of D6 is unavailable for it.

**D3: When a fetch uses the proxy.** The recommendation is option (a): one code path, and no failed direct attempt before a blocked page is fetched. Option (b) avoids gateway traffic on pages whose first attempt succeeds, when that route bypasses the gateway. It costs a second attempt for each blocked page and depends on the failure class: a block page served with a success status would not trigger it, and whether that occurs is untested. Option (c) needs a list that someone maintains. If hosts determine the route, record whether the rule follows the original page or each destination, including a redirect, a Markdown alternate and a supplementary parser request. Under (b) and (c), and for the loopback bypass below, what a direct route means is D10.

**D4: Exit address rotation.** The recommendation is option (a) first, because it needs no extension logic. A fixed URL leaves rotation to the gateway. For this service, a username without a session identifier requests a new address on every request, and one with it requests a sticky session, subject to availability and expiry. Option (b) is worth revisiting if failures suggest per-address limits.

**D5: `llms-full.txt` downloads.** The recommendation is option (a): one code path. The largest stored file alone would represent ≈$0.18 under the assumptions of Bandwidth and Cost. Option (b) spares gateway traffic only if the chosen route actually bypasses the gateway (D10). If the exception actually selects the ordinary direct route, the download avoids gateway traffic but can meet the same blocks as other direct requests.

**D6: Where the password lives.** The recommendation is option (c), by the rule the MCP server already follows for its model application programming interface (API) key. A file reference keeps the password out of the inherited environment. Option (b), a reference to an exported variable, does not. Option (a) puts the password in the same file as the model settings, as `httpProxy` does today when its URL carries credentials.

**D7: Proxy variables already in the environment.** Option (a) keeps today's behaviour when the setting is absent, and leaves the decision with whoever launches the host. Option (b) would have the fetch layer ignore those variables; the existing `httpProxy` setting would keep its effect. Whether wreq-js 2.3.1 can be told to ignore environment proxies is unknown: its type declarations expose no such option. D7 governs the fallback when the new setting is absent. An exception while it is present is D10.

**D8: Order of precedence.** The recommendation is option (a): for each eligible request, the new setting decides the route; when it is absent, `httpProxy` applies as today; proxy variables in the environment come last. Requests excluded by an exception follow D10, and whether an exception also skips `httpProxy` is part of the recorded order. It changes nothing about what `httpProxy` does for model calls. The tests in Verification Approach check the agreed order rather than an assumed one. Record the effective order as one sequence, so that the answer to D7 and this one cannot conflict.

**D9: Supplementary parser requests.** Defuddle 0.19.4 hands its site extractors a `fetch` function, and uses the host's global `fetch` when the caller supplies none, as `src/core/fetch.ts` does. On a Reddit comments page, for example, the extractor requests further content. Those requests belong to page fetching and do not receive the `proxy` option. The recommendation is option (a): give the parser a `fetch` function that uses the fetch proxy. Supply it locally, and only where the agreed policy requires it: on the inspected Reddit extractor, a supplied client also bypasses the extractor's short-lived response cache. Do not replace the process-wide function or dispatcher: other clients, including model transports, can use them.

**D10: Direct for an exception.** The recommendation is option (a). Under it an exception omits the new setting. The resulting route, including any proxy named by `httpProxy` or by the environment, can still use the same gateway. For option (b), no supported per-request bypass has been verified: the type declarations of wreq-js 2.3.1 expose no way to ignore environment proxies.

**S4 to S6.** All three are this brief's proposals, described under Constraints. Record accept or decline in their rows. For S4, name the plain-HTTP hops, if any, that count as trusted. If S6 is declined, record what happens instead: whether any fetch is sent, and on which route.

The implementing agent decides the rest:

- The name of the setting and of the MCP configuration key.
- Which URL schemes pass validation. Only `http://` is verified (P1).
- Whether loopback and private-address targets bypass the proxy. A local development server's documentation cannot be reached through a remote exit, so the recommendation is to bypass them.
- The names of the telemetry fields, if the owner accepts S5.

## Verification Approach

- **Preserve the recorded probe.** Do not re-run the retained scripts in place: they import the checkout by a relative path and write over the dated logs.
- **Deterministic tests.** Build a disposable fixture with local listeners only and no external upstream: the proxy answers plain-HTTP targets itself from canned pages and logs `CONNECT` without tunnelling. Include a target that the selected policy routes through the proxy, and a separate bypass target if bypass is selected, so that the test cannot pass by every request going direct. Exercise the real setting through each selected adapter. Read the proxy log to confirm that the expected fetch requests arrived. Make a model request in the same test. Establish its route with the setting absent and repeat it with the setting present. Show that it succeeds at its original local endpoint and that the proxy receives no request or tunnel for that endpoint, so that S1 is witnessed rather than assumed. The standalone MCP server sends model traffic to a fixed HTTPS origin. Exercise its transport in isolated local routing, or label a check that injects a `fetch` function as an adapter test only, and do not add a configurable provider endpoint for this test. Exercise a page that selects a parser extractor with an async path, if D9 selects option (a). Test S2 against a closed port, a 407 gateway and the other failure modes. The fixture uses loopback sockets and no external network, which satisfies `AGENTS.md` Principle 1.
- **Settings tests.** Reading the key, a warning for an invalid value that does not repeat the URL, the precedence order agreed in D8, the gateway schemes accepted if the owner requires S4, and, if the owner accepts S6, that an invalid setting or an unloaded credential fails the affected fetches and reaches no listener.
- **Live check.** A comparison through the owner's real gateway needs the owner's approval before any spend. Fetch pages that returned 403 directly and compare the outcomes, on targets the owner authorises for the check. Record the result with its date.
- **After each change.** `AGENTS.md` requires the build, `npm test`, `./test/e2e/01_main.sh` and `npm audit --audit-level=low`.

## Scope and Non-Goals

In scope: the setting, its validation, the fetch-layer wiring, tests, the telemetry field if the owner accepts S5, and the documentation each package needs.

Out of scope:

- Routing model calls through the proxy, or changing what `httpProxy` does.
- Solving bot challenges or running a browser.
- Provider client libraries, failover between providers, and proxy pools managed by the extension.

## Starting Points

| File | What It Holds |
|---|---|
| `src/core/fetch.ts` | `FetchOptions.proxy` and every request site |
| `src/core/types.ts`, `src/core/defaults.ts` | `ResearchSettings.httpProxy` and its default |
| `src/settings.ts` | `loadSettings()`, `extractOverrides()` and `NESTED_KEYS` |
| `test/settings.test.ts` | `NESTED_CASES`, the round-trip test's own list |
| `src/core/operations/research.ts` | `runFetchStage()` and `startLlmsFullDownloads()` |
| `packages/mcp/src/config.ts` | `parseDocument()` and the accepted `tuning` keys |
| `src/core/telemetry.ts` | The `meta.json` schema |
| `test/fetch.test.ts` | The existing fetch tests |
| `README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md` | Settings rows, architecture section and release notes |
| `scripts/analyze-sessions.sh` | Section 9 aggregates, which a new telemetry field would extend |

First steps for the implementing agent:

1. Read the Owner Decision column. Ask the owner about any decision left blank, or recorded without the alternative it needs.
2. Confirm that the code at `HEAD` still matches [Current Behaviour](#current-behaviour), and that the installed `Pi` still routes model calls as Model stages describes.
3. If the wreq-js version has changed, run a relocated copy of the probe that imports the checkout and writes fresh logs. P2 to P4 rest on behaviour that version 2.3.1 does not document.

## Evidence

`evidence/agents/2026-11-24-fetch-proxy-requirements/` in the main checkout holds the evidence, gitignored:

| Path | Holds |
|---|---|
| `probe/` | The proxy, the driver, the case sequence, and their output and logs (P1 to P7) |
| `sources/nodemaven/` | NodeMaven documentation pages and its pricing page as fetched |
| `research/` | Three web research runs with their sources |
| `usage/` | Both `analyze-sessions.sh` runs and the path classifications behind the tables |
| `reports/` | Independent prose reviews of this brief, one file per round |

`usage/` names client project paths and page hostnames and stays on the encrypted drive. A clone does not carry this folder, and this brief states every figure it needs.
