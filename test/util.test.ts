// test/util.test.ts — Unit tests for shared utilities
import { getAgentDir } from "../src/agent-dir.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRetryLists } from "../scripts/capture-retry-fixture.mjs";
import {
  textContent,
  extractSourceUrls,
  inferSourceType,
  inferCurrentness,
  mapWithConcurrency,
  withRetry,
  isRetryableMessage,
  NON_RETRYABLE_LIMIT_PATTERNS,
  RETRYABLE_PATTERNS,
  parseRetryAfterMs,
  createRateLimiter,
  callWithAbortTimeout,
  withMuzzledConsole,
  type RetryDecision,
  stripTrailingSourcesSection,
  budgetExhausted,
  reasoningOnlyCompletion,
} from "../src/util.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("textContent", () => {
  it("creates a properly typed text content object", () => {
    const result = textContent("Hello, world!");
    assert.deepStrictEqual(result, { type: "text", text: "Hello, world!" });
  });

  it("handles empty string", () => {
    const result = textContent("");
    assert.deepStrictEqual(result, { type: "text", text: "" });
  });

  it("handles multiline text", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const result = textContent(text);
    assert.strictEqual(result.text, text);
    assert.strictEqual(result.type, "text");
  });
});

describe("getAgentDir", () => {
  it("uses the selected agent directory rather than the operator default", () => {
    const saved = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = "/fixture/private-agent";
      assert.equal(getAgentDir(), "/fixture/private-agent");
      delete process.env.PI_CODING_AGENT_DIR;
      assert.ok(getAgentDir().endsWith(".pi/agent"));
    } finally {
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = saved;
    }
  });
});

describe("extractSourceUrls", () => {
  it("extracts markdown links with URLs", () => {
    const text = "See [Svelte docs](https://svelte.dev/docs) and [React](https://react.dev).";
    const urls = extractSourceUrls(text);
    assert.deepStrictEqual(urls, [
      { url: "https://svelte.dev/docs", title: "Svelte docs" },
      { url: "https://react.dev", title: "React" },
    ]);
  });

  it("deduplicates identical URLs", () => {
    const text = "[Link](https://example.com) and again [Link](https://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://example.com");
  });

  it("returns empty array for text without links", () => {
    assert.deepStrictEqual(extractSourceUrls("No links here"), []);
  });

  it("handles empty titles", () => {
    const text = "[](https://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].title, "");
  });

  it("only matches http/https URLs", () => {
    const text = "[ftp](ftp://files.example.com) [http](http://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "http://example.com");
  });

  it("handles URLs with query params and fragments", () => {
    const text = "[API](https://api.example.com/v2?q=test#section)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls[0].url, "https://api.example.com/v2?q=test#section");
  });

  it("preserves a balanced parenthesis inside the URL (Wikipedia-style)", () => {
    const text = "See [Foo](https://en.wikipedia.org/wiki/Foo_(disambiguation)) here.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://en.wikipedia.org/wiki/Foo_(disambiguation)");
  });

  it("preserves multiple parenthetical groups in a URL (MSDN-style)", () => {
    const text = "[Docs](https://learn.microsoft.com/dotnet/api/system.string.format(v=net-8.0))";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(
      urls[0].url,
      "https://learn.microsoft.com/dotnet/api/system.string.format(v=net-8.0)",
    );
  });

  it("does not swallow trailing markdown after a paren-free URL", () => {
    const text = "[React](https://react.dev). Then [Vue](https://vuejs.org).";
    const urls = extractSourceUrls(text);
    assert.deepStrictEqual(urls, [
      { url: "https://react.dev", title: "React" },
      { url: "https://vuejs.org", title: "Vue" },
    ]);
  });

  // ── Pass 2: bare URL extraction (degraded search responses) ──

  it("extracts bare https URLs from prose", () => {
    const text = "See https://svelte.dev/docs for details.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://svelte.dev/docs");
    assert.strictEqual(urls[0].title, "docs"); // last path segment
  });

  it("extracts bare URLs inside bold markers", () => {
    const text = "🔗 **https://fal.ai/models/fal-ai/nano-banana-2**";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://fal.ai/models/fal-ai/nano-banana-2");
  });

  it("does not duplicate URLs already captured as markdown links", () => {
    const text = "[Svelte](https://svelte.dev) and bare https://svelte.dev";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://svelte.dev");
    assert.strictEqual(urls[0].title, "Svelte"); // markdown title wins (pass 1)
  });

  it("extracts multiple bare URLs from a bullet list", () => {
    const text = `
*   **Source:** https://fal.ai/models/fal-ai/nano-banana-2
*   **SDK docs:** https://fal.ai/docs
*   **Install:** https://www.npmjs.com/package/@fal-ai/client
`;
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 3);
    assert.strictEqual(urls[0].url, "https://fal.ai/models/fal-ai/nano-banana-2");
    assert.strictEqual(urls[1].url, "https://fal.ai/docs");
    assert.strictEqual(urls[2].url, "https://www.npmjs.com/package/@fal-ai/client");
  });

  it("handles URLs with query params and fragments in bare form", () => {
    const text = "API at https://api.example.com/v2?q=test#section ready.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://api.example.com/v2?q=test#section");
  });

  it("strips trailing punctuation from bare URLs", () => {
    const text = "Visit https://example.com/page. Then continue.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://example.com/page");
  });

  it("extracts both markdown links and bare URLs together", () => {
    const text = `
The main docs are at [Svelte](https://svelte.dev/docs).
For API reference, see https://svelte.dev/docs/svelte.
Also bare reference https://kit.svelte.dev.
`;
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 3);
    const urlSet = new Set(urls.map((u) => u.url));
    assert.ok(urlSet.has("https://svelte.dev/docs"));
    assert.ok(urlSet.has("https://svelte.dev/docs/svelte"));
    assert.ok(urlSet.has("https://kit.svelte.dev"));
  });

  it("extracts bare URLs from inline code backtick syntax", () => {
    const text =
      "Source: `https://openrouter.ai/google/gemini-flash-1.5/providers` is the pricing page.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://openrouter.ai/google/gemini-flash-1.5/providers");
  });

  // ── Pass 3: protocol-less source references ──

  it("normalises protocol-less source domains from a degraded response", () => {
    const text = [
      "GitHub: `github.com/microsoft/TypeScript/releases`",
      "Official blog: `devblogs.microsoft.com/typescript`",
    ].join("\n");
    assert.deepStrictEqual(extractSourceUrls(text), [
      {
        url: "https://github.com/microsoft/TypeScript/releases",
        title: "releases",
        inferred: true,
      },
      {
        url: "https://devblogs.microsoft.com/typescript",
        title: "typescript",
        inferred: true,
      },
    ]);
  });

  it("rejects filenames and identifiers as protocol-less domains", () => {
    const urls = extractSourceUrls(
      "Edit app.ini and robots.txt, run manage.py, read README.md, set user.name and " +
        "service.DISABLE, use Node.js. Docs: www.example.md, docs.example.md/guide, example.io.",
    ).map((u) => u.url);
    assert.deepStrictEqual(urls, [
      "https://www.example.md",
      "https://docs.example.md/guide",
      "https://example.io",
    ]);
  });

  it("skips partial hosts and normalises host case in protocol-less references", () => {
    const urls = extractSourceUrls(
      "See bücher.de, example.xn--p1ai, example.com:8080/path, example.net?q=1, main.js.map, " +
        "config.h.in, manage.py, vue.js.org, “notion.so” — publico.pt/2026/story, \u{10400}example.com, " +
        "e\u0301xample.com and EXAMPLE.ORG/Docs.",
    ).map((u) => u.url);
    assert.deepStrictEqual(urls, [
      "https://vue.js.org",
      "https://notion.so",
      "https://publico.pt/2026/story",
      "https://example.org/Docs",
    ]);
  });

  it("keeps file-extension TLDs inside the delegated set", async () => {
    const { TOP_LEVEL_DOMAINS, FILE_EXTENSION_TLDS } = await import("../src/core/tlds.js");
    assert.ok(TOP_LEVEL_DOMAINS.size > 1000);
    for (const tld of FILE_EXTENSION_TLDS) assert.ok(TOP_LEVEL_DOMAINS.has(tld), tld);
  });

  it("does not treat email addresses or absolute URLs as extra domain references", () => {
    const urls = extractSourceUrls(
      "Contact releases@example.com or read https://github.com/microsoft/TypeScript/releases.",
    );
    assert.deepStrictEqual(urls, [
      {
        url: "https://github.com/microsoft/TypeScript/releases",
        title: "releases",
      },
    ]);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n;
    });
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit of 3`);
    assert.ok(peak >= 2, `expected real concurrency, peak was only ${peak}`);
  });

  it("preserves input order regardless of completion order", async () => {
    const items = [40, 10, 30, 20];
    // Earlier items resolve later, so completion order differs from input order.
    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await new Promise<void>((r) => setTimeout(r, ms));
      return ms;
    });
    assert.deepStrictEqual(results, [40, 10, 30, 20]);
  });

  it("invokes onSettled exactly once per item with index and result", async () => {
    const items = ["a", "b", "c"];
    const settled: Array<{ item: string; index: number; result: string }> = [];
    await mapWithConcurrency(items, 2, async (s, i) => `${s}-${i}`, {
      onSettled: (item, index, result) => settled.push({ item, index, result }),
    });
    assert.strictEqual(settled.length, 3);
    // Sort by index for a stable assertion (completion order is non-deterministic).
    settled.sort((a, b) => a.index - b.index);
    assert.deepStrictEqual(settled, [
      { item: "a", index: 0, result: "a-0" },
      { item: "b", index: 1, result: "b-1" },
      { item: "c", index: 2, result: "c-2" },
    ]);
  });

  it("stops launching new work once the signal is aborted", async () => {
    const controller = new AbortController();
    let started = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await mapWithConcurrency(
      items,
      2,
      async (n) => {
        started++;
        if (n === 1) controller.abort(); // abort during the first wave
        await tick();
        return n;
      },
      { signal: controller.signal },
    );
    assert.ok(started < items.length, `expected early stop, but started all ${started}`);
    // Unrun indices are left undefined.
    assert.ok(
      results.some((r) => r === undefined),
      "aborted run should leave holes",
    );
  });

  it("handles an empty item list", async () => {
    const results = await mapWithConcurrency([], 4, async (x) => x);
    assert.deepStrictEqual(results, []);
  });

  it("degrades to serial for non-positive concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = [1, 2, 3];
    await mapWithConcurrency(items, 0, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n;
    });
    assert.strictEqual(peak, 1, "non-positive concurrency should run one at a time");
  });
});

describe("inferSourceType", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "This is official documentation for...", expected: "official docs" },
    { input: "API reference page covering...", expected: "API reference" },
    { input: "A tutorial on how to...", expected: "tutorial" },
    { input: "Blog post about...", expected: "blog post" },
    { input: "A forum thread discussing...", expected: "forum" },
    { input: "StackOverflow answer about...", expected: "forum" },
    { input: "This page covers various topics", expected: "unknown" },
    { input: "OFFICIAL DOCS about...", expected: "official docs" },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${input.slice(0, 40)}..." as ${expected}`, () => {
      assert.strictEqual(inferSourceType(input), expected);
    });
  }
});

describe("inferCurrentness", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "Current and up to date documentation", expected: "current" },
    { input: "Up to date as of 2025", expected: "current" },
    { input: "This is outdated material", expected: "possibly outdated" },
    { input: "Old approach from 2020", expected: "possibly outdated" },
    { input: "No date info available", expected: "undated" },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${input}" as ${expected}`, () => {
      assert.strictEqual(inferCurrentness(input), expected);
    });
  }
});

describe("isRetryableMessage", () => {
  const retryable = [
    "Rate limited by openrouter/perplexity/sonar (retry after 3s)",
    "HTTP 429 Too Many Requests",
    "Provider overloaded, please retry",
    "Server error (HTTP 503)",
    "502 Bad Gateway",
    "request timed out",
    "ETIMEDOUT",
    "ECONNRESET while reading",
    // Parity with the audited host's own retry classifier (pi-ai
    // utils/retry.js, captured for 1.5.0): the host applies this list to its
    // agent-loop calls; the extension's pipeline calls own their retry and
    // keep the same coverage.
    "server_busy",
    "servers are currently busy",
    "error code: server_busy, try again later",
    "The service is temporarily unavailable",
    "currently experiencing high demand",
    "model is at capacity",
    "internal error",
    "HTTP 520",
    "524 gateway timeout",
    // The status-code group is upstream's lookaround form: underscore-adjacent
    // tokens match (upstream's accepted trade), digits and letters do not.
    "HTTP_502_BAD_GATEWAY",
    "status_503",
    "Model not found: acme/foo_500",
    // Known limitation, pinned: this policy has no context-overflow pre-filter,
    // so a delimited token count still matches the status group and retries.
    "This model's maximum context length is 128,500 tokens. However, you requested 2000 tokens.",
    // Gateway and wrapper wording for transient upstream failures.
    "Unable to forward upstream stream",
    "Provider returned error",
    "The upstream provider returned an error",
    "exceeded request buffer limit while retrying upstream",
    // Gateway upstream failures relayed as response.failed error codes (pi
    // #10920) and the Codex mid-stream disconnect (pi #11057).
    "upstream request failed",
    "upstream_stream_read_error",
    "stream was interrupted",
    "http/2 stream failed",
    "stream disconnected before completion: stream closed before response.completed",
    // Network, proxy and fetch transport failures.
    "network error",
    "connection error",
    "connection refused",
    "connection lost",
    "other side closed",
    "fetch failed",
    // The reason is often empty (upstream pi #10996); this form discriminates
    // because nothing else in the message matches a retryable pattern.
    "request to https://oauth2.googleapis.com/token failed, reason: certificate has expired",
    "getaddrinfo ENOTFOUND api.openrouter.ai",
    "upstream connect error or disconnect/reset before headers",
    "socket hang up",
    "websocket closed",
    "terminated",
    // Premature stream endings and HTTP/2 session failures.
    "stream ended before message_stop",
    "Anthropic stream ended without a terminal event",
    "http2 request did not get a response",
    "pending stream has been canceled",
    // Explicit retry guidance and gRPC/provider variants.
    "retry delay exceeded",
    "please retry your request",
    "ResourceExhausted",
    "subscription_sharing_usage_unavailable",
    // Separator-tolerant busy phrasings retained as documented extras beyond
    // the upstream list.
    "The server is currently busy",
    "server busy, try later",
    "server-busy",
    // The Zhipu 1308 lookahead keeps a different code (13089) from matching,
    // so this stays retryable through its 429 status; the escaped body alone
    // (no unescaped 1308 JSON) also stays retryable: the fail-fast pattern
    // depends on the native path's unescaped raw append, not the formatted
    // body.
    "429 {\"code\":13089}",
    "429 {\"message\":\"escaped body \\\"code\\\":\\\"1308\\\" only\"}",
  ];
  const nonRetryable = [
    "No API key for openrouter/x. Run /login.",
    "Model not found: openrouter/minimax/M3.7",
    "invalid_request_error: max_tokens too large",
    // Permanent errors whose digit runs would match unbounded status patterns:
    // the lookaround form (upstream's) rejects codes embedded in digits or
    // letters, so these stay non-retryable without a context pre-filter.
    "invalid_request_error: max_tokens 5000 exceeds limit 4096",
    "This model's maximum context length is 128000 tokens. However, you requested 150293 tokens.",
    "Error code: 400 - prompt too long: 205000 tokens > 200000",
    "Model not found: openrouter/x (id gen-1729429500)",
    // Codes embedded in digits or letters never match, under the lookaround
    // form as under the previous word-bound form.
    "id_429x",
    "x429_",
    "A429",
    "4290",
    // Quota, budget and billing exhaustion is permanent: it must fail fast
    // even when the message also carries a retryable-looking 429 status.
    "Error code: 429 - insufficient_quota",
    "HTTP 429: quota exceeded",
    // Quota exhaustion must fail fast even when the same message carries a
    // retryable-looking status; one pattern per case so each discriminates.
    "429 out of budget",
    "429 Monthly usage limit reached; please upgrade the plan",
    "429 enable available balance usage to continue",
    "429 subscription_sharing_usage_limit_exceeded",
    "429 FreeUsageLimitError",
    // ChatGPT Business workspace admin cap and the Zhipu/Z.ai plan usage
    // limit (HTTP 429 resetting after hours, pi #11537): the fail-fast list
    // must win over the retryable status text in the same message.
    "429 subscription_sharing_workplace_individual_usage_limit_exceeded",
    "429 {\"error\":{\"code\":\"1308\",\"message\":\"Usage limit reached for 5 hour.\"}}",
    // The native OpenRouter path appends error.error.metadata.raw unescaped,
    // so the pattern sees the raw JSON even when the formatted body escapes it.
    "429: {\"message\":\"Provider returned error\",\"code\":429,\"metadata\":{\"raw\":\"{\\\"error\\\":{\\\"code\\\":\\\"1308\\\"...}\"}}\n{\"error\":{\"code\":\"1308\"}}",
    "",
    undefined,
  ];

  for (const m of retryable) {
    it(`treats ${JSON.stringify(m)} as retryable`, () => {
      assert.strictEqual(isRetryableMessage(m), true);
    });
  }
  for (const m of nonRetryable) {
    it(`treats ${JSON.stringify(m)} as non-retryable`, () => {
      assert.strictEqual(isRetryableMessage(m), false);
    });
  }
});

describe("retry classifier parity with the captured pi-ai 1.5.0 fixture", () => {
  // The fixture is a machine capture of the upstream classifier lists from the
  // installed pi-ai 1.5.0 dist/utils/retry.js (scripts/capture-retry-fixture.mjs).
  // This gate holds the extension lists to that capture; it does not read the
  // installed host, so a host bump cannot fail here by itself. Run
  // scripts/capture-retry-fixture.mjs --check <retry.js> during every host-bump
  // audit, and recapture the fixture deliberately when upstream drifts.
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/pi-ai-retry-1.5.0.json", import.meta.url), "utf8"),
  ) as { nonRetryable: string[]; retryable: string[] };

  // Deliberate divergences, documented inline in src/core/util.ts: retained
  // historical extras beyond the upstream list (raw Node transport codes, the
  // standalone adapter's transient 402 wording, separator-tolerant busy
  // phrasings). The status-code group is upstream's verbatim lookaround form.
  const DOCUMENTED_EXTRAS = [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "temporarily.?unavailable",
    "server[ _-]?busy",
    "currently busy",
  ];

  it("exclusion list matches upstream exactly, in order", () => {
    assert.deepStrictEqual(NON_RETRYABLE_LIMIT_PATTERNS, fixture.nonRetryable);
  });

  it("every upstream retryable pattern is present, including the lookaround status group", () => {
    for (const pattern of fixture.retryable) {
      assert.ok(RETRYABLE_PATTERNS.includes(pattern), `missing upstream pattern: ${pattern}`);
    }
  });

  it("divergences from upstream are exactly the documented extras", () => {
    const extras = RETRYABLE_PATTERNS.filter((p) => !fixture.retryable.includes(p));
    assert.deepStrictEqual(extras, DOCUMENTED_EXTRAS);
  });
});

describe("capture-retry-fixture script", () => {
  const SYNTHETIC = [
    "// Build the pattern lists. A comment with \"quoted text\" and `])` inside.",
    "const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([",
    "    // Comment \"with quotes\" and a (?![0-9]) lookahead.",
    "    'GoUsageLimitError',",
    `    '"code"\\\\s*:\\\\s*"?1308(?![0-9])',`,
    "]);",
    "const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([",
    "    \"overloaded\",",
    "    \"(?<![a-z0-9])(?:429|500)(?![a-z0-9])\",",
    "]);",
  ].join("\n");

  it("parses single-quoted literals, patterns containing ]), and comments with quotes", () => {
    const lists = parseRetryLists(SYNTHETIC);
    assert.deepStrictEqual(lists.nonRetryable, [
      "GoUsageLimitError",
      String.raw`"code"\s*:\s*"?1308(?![0-9])`,
    ]);
    assert.deepStrictEqual(lists.retryable, [
      "overloaded",
      "(?<![a-z0-9])(?:429|500)(?![a-z0-9])",
    ]);
  });

  it("fails hard on a missing declaration and a non-literal element", () => {
    assert.throws(() => parseRetryLists("const X = 1;"), /declaration not found/);
    assert.throws(
      () => parseRetryLists("const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([f()]);"),
      /non-literal element/,
    );
  });
});

describe("parseRetryAfterMs", () => {
  const cases: Array<{ input: string | undefined; expected: number | undefined }> = [
    { input: "retry after 3s", expected: 3000 },
    { input: "Rate limited (retry-after: 12)", expected: 12000 },
    { input: "try again in 5 seconds", expected: 5000 },
    { input: "back off for 500ms", expected: undefined }, // no "retry after"/"try again" anchor
    { input: "retry after 500ms", expected: 500 },
    { input: "no numeric hint here", expected: undefined },
    { input: undefined, expected: undefined },
  ];
  for (const { input, expected } of cases) {
    it(`parses ${JSON.stringify(input)} -> ${expected}`, () => {
      assert.strictEqual(parseRetryAfterMs(input), expected);
    });
  }
});

describe("withRetry", () => {
  // A sleep stub that records requested delays and resolves instantly.
  const makeSleep = () => {
    const delays: number[] = [];
    const fn = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    return { delays, fn };
  };
  const alwaysRetry = (): RetryDecision => ({ retry: true });

  it("returns immediately on success without sleeping", async () => {
    const { delays, fn } = makeSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      () => ({ retry: false }),
      { attempts: 3, baseDelayMs: 1000, maxDelayMs: 20000, sleep: fn },
    );
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(delays, []);
  });

  it("retries then succeeds; records one backoff", async () => {
    const { delays, fn } = makeSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return calls < 2 ? "bad" : "good";
      },
      (r) => (r === "bad" ? { retry: true } : { retry: false }),
      { attempts: 3, baseDelayMs: 1000, maxDelayMs: 20000, sleep: fn, random: () => 1 },
    );
    assert.strictEqual(result, "good");
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(delays, [1000]); // random()=1 → full exp delay, attempt 1
  });

  it("uses full-jitter exponential schedule (random()=1)", async () => {
    const { delays, fn } = makeSleep();
    await withRetry(async () => "x", alwaysRetry, {
      attempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 20000,
      sleep: fn,
      random: () => 1,
    });
    // attempt 1 -> 1000*2^0, 2 -> 2000, 3 -> 4000 (3 sleeps for 4 attempts)
    assert.deepStrictEqual(delays, [1000, 2000, 4000]);
  });

  it("caps each delay at maxDelayMs", async () => {
    const { delays, fn } = makeSleep();
    await withRetry(async () => "x", alwaysRetry, {
      attempts: 4,
      baseDelayMs: 10000,
      maxDelayMs: 15000,
      sleep: fn,
      random: () => 1,
    });
    assert.deepStrictEqual(delays, [10000, 15000, 15000]);
  });

  it("honours Retry-After as a floor, clamped to maxDelayMs", async () => {
    const { delays, fn } = makeSleep();
    await withRetry(
      async () => "x",
      () => ({ retry: true, retryAfterMs: 4000 }),
      { attempts: 2, baseDelayMs: 1000, maxDelayMs: 20000, sleep: fn, random: () => 0 },
    );
    assert.deepStrictEqual(delays, [4000]); // jitter 0 but floor raises to 4000

    const clamp = makeSleep();
    await withRetry(
      async () => "x",
      () => ({ retry: true, retryAfterMs: 99999 }),
      { attempts: 2, baseDelayMs: 1000, maxDelayMs: 20000, sleep: clamp.fn, random: () => 0 },
    );
    assert.deepStrictEqual(clamp.delays, [20000]); // clamped to cap
  });

  it("returns the last resolved value when attempts are exhausted", async () => {
    const { fn } = makeSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return `try-${calls}`;
      },
      alwaysRetry,
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 10, sleep: fn, random: () => 0 },
    );
    assert.strictEqual(result, "try-3");
    assert.strictEqual(calls, 3);
  });

  it("rethrows the last error when fn keeps throwing", async () => {
    const { fn } = makeSleep();
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls++;
          throw new Error(`boom-${calls}`);
        },
        () => ({ retry: true }),
        { attempts: 2, baseDelayMs: 1, maxDelayMs: 10, sleep: fn, random: () => 0 },
      ),
      /boom-2/,
    );
    assert.strictEqual(calls, 2);
  });

  it("does not retry once the signal is aborted", async () => {
    const { delays, fn } = makeSleep();
    const ac = new AbortController();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        ac.abort();
        return "bad";
      },
      alwaysRetry,
      { attempts: 5, baseDelayMs: 1, maxDelayMs: 10, sleep: fn, signal: ac.signal },
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(result, "bad");
    assert.deepStrictEqual(delays, []);
  });
});

describe("createRateLimiter", () => {
  it("is a no-op when interval <= 0", async () => {
    const gate = createRateLimiter(0);
    const start = Date.now();
    await gate();
    await gate();
    assert.ok(Date.now() - start < 20);
  });

  it("spaces the second call by at least the interval", async () => {
    const gate = createRateLimiter(30);
    const start = Date.now();
    await gate(); // first call returns immediately
    await gate(); // second waits ~30ms
    assert.ok(Date.now() - start >= 25, "second call should be delayed");
  });
});

describe("callWithAbortTimeout", () => {
  it("returns the value and timedOut=false when run resolves first", async () => {
    const { value, timedOut } = await callWithAbortTimeout(async () => "done", 1000);
    assert.strictEqual(value, "done");
    assert.strictEqual(timedOut, false);
  });

  it("passes a no-op (undefined) signal through when timeout disabled", async () => {
    let received: AbortSignal | undefined = {} as AbortSignal;
    const { value, timedOut } = await callWithAbortTimeout(async (signal) => {
      received = signal;
      return 42;
    }, 0);
    assert.strictEqual(value, 42);
    assert.strictEqual(timedOut, false);
    assert.strictEqual(received, undefined);
  });

  it("aborts the run and reports timedOut=true when it stalls", async () => {
    // A run that only settles when its signal aborts (models a stalled stream).
    const { value, timedOut } = await callWithAbortTimeout<string>(
      (signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
        }),
      20,
    );
    assert.strictEqual(timedOut, true);
    assert.strictEqual(value, "aborted");
  });

  it("combines the user signal so an external abort also fires", async () => {
    const ac = new AbortController();
    const p = callWithAbortTimeout<string>(
      (signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
        }),
      10_000, // long timeout; user abort should win
      ac.signal,
    );
    ac.abort();
    const { value, timedOut } = await p;
    assert.strictEqual(value, "aborted");
    assert.strictEqual(timedOut, false); // user aborted, not our timer
  });
});

describe("withMuzzledConsole", () => {
  it("swallows console.error logs whose first arg matches a muzzled tag and reports muzzled=true", async () => {
    const seen: unknown[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => seen.push(args);
    try {
      const { value, muzzled, warned } = await withMuzzledConsole(async () => {
        // Simulate Defuddle's internal catch log: console.error('Defuddle', '...', err)
        console.error("Defuddle", "Error processing document:", new Error("boom"));
        return "ok";
      }, { error: ["Defuddle"] });
      assert.strictEqual(value, "ok");
      assert.strictEqual(muzzled, true);
      assert.strictEqual(warned, false);
      assert.strictEqual(seen.length, 0, "the Defuddle log must not reach the real console.error");
    } finally {
      console.error = real;
    }
  });

  it("passes unrelated console.error calls straight through", async () => {
    const seen: unknown[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => seen.push(args);
    try {
      const { value, muzzled } = await withMuzzledConsole(async () => {
        console.error("[pi-intelli-search]", "unrelated");
        console.error("Defuddle", "swallowed", new Error("x"));
        console.error("another", "unrelated");
        return 42;
      }, { error: ["Defuddle"] });
      assert.strictEqual(value, 42);
      assert.strictEqual(muzzled, true);
      assert.strictEqual(seen.length, 2, "only the unrelated logs pass through");
      assert.strictEqual(seen[0][0], "[pi-intelli-search]");
      assert.strictEqual(seen[1][0], "another");
    } finally {
      console.error = real;
    }
  });

  it("reports muzzled=false, warned=false and skips setup when no tags are given", async () => {
    const realError = console.error;
    const realWarn = console.warn;
    let touched = false;
    console.error = () => {
      touched = true;
    };
    console.warn = () => {
      touched = true;
    };
    try {
      const { value, muzzled, warned } = await withMuzzledConsole(async () => "clean", {});
      assert.strictEqual(value, "clean");
      assert.strictEqual(muzzled, false);
      assert.strictEqual(warned, false);
      assert.strictEqual(
        touched,
        false,
        "console methods must not be replaced when there is nothing to muzzle",
      );
    } finally {
      console.error = realError;
      console.warn = realWarn;
    }
  });

  it("swallows console.warn logs matching warn tags and reports warned=true, not muzzled", async () => {
    const seenWarn: unknown[] = [];
    const real = console.warn;
    console.warn = (...args: unknown[]) => seenWarn.push(args);
    try {
      // Simulate Defuddle's MetadataExtractor benign warnings:
      // console.warn('Failed to parse URL:', err) / ('Failed to parse base URL:', err)
      const { value, muzzled, warned } = await withMuzzledConsole(async () => {
        console.warn("Failed to parse URL:", new Error("Invalid URL"));
        console.warn("Failed to parse base URL:", new Error("Invalid URL"));
        return "ok";
      }, { warn: ["Failed to parse URL:", "Failed to parse base URL:"] });
      assert.strictEqual(value, "ok");
      assert.strictEqual(warned, true);
      assert.strictEqual(muzzled, false, "benign warnings must never flag degradation");
      assert.strictEqual(seenWarn.length, 0, "the Defuddle warnings must not reach the real console.warn");
    } finally {
      console.warn = real;
    }
  });

  it("passes unrelated console.warn calls straight through", async () => {
    const seenWarn: unknown[] = [];
    const real = console.warn;
    console.warn = (...args: unknown[]) => seenWarn.push(args);
    try {
      const { warned } = await withMuzzledConsole(async () => {
        console.warn("[pi-intelli-search]", "unrelated");
        console.warn("Failed to parse URL:", new Error("Invalid URL"));
        return "ok";
      }, { warn: ["Failed to parse URL:"] });
      assert.strictEqual(warned, true);
      assert.strictEqual(seenWarn.length, 1, "only the unrelated warning passes through");
      assert.strictEqual(seenWarn[0][0], "[pi-intelli-search]");
    } finally {
      console.warn = real;
    }
  });

  it("muzzles error and warn channels independently in one call", async () => {
    const seenError: unknown[] = [];
    const seenWarn: unknown[] = [];
    const realError = console.error;
    const realWarn = console.warn;
    console.error = (...args: unknown[]) => seenError.push(args);
    console.warn = (...args: unknown[]) => seenWarn.push(args);
    try {
      const { muzzled, warned } = await withMuzzledConsole(async () => {
        console.error("Defuddle", "degraded", new Error("x"));
        console.warn("Failed to parse URL:", new Error("Invalid URL"));
        return "ok";
      }, { error: ["Defuddle"], warn: ["Failed to parse URL:"] });
      assert.strictEqual(muzzled, true);
      assert.strictEqual(warned, true);
      assert.strictEqual(seenError.length, 0);
      assert.strictEqual(seenWarn.length, 0);
    } finally {
      console.error = realError;
      console.warn = realWarn;
    }
  });

  it("always restores console methods, even when fn throws", async () => {
    const realError = console.error;
    const realWarn = console.warn;
    await assert.rejects(
      withMuzzledConsole(async () => {
        throw new Error("fn failed");
      }, { error: ["Defuddle"], warn: ["Failed to parse URL:"] }),
      /fn failed/,
    );
    assert.strictEqual(console.error, realError, "console.error must be restored after a throw");
    assert.strictEqual(console.warn, realWarn, "console.warn must be restored after a throw");
  });

  it("restores console.error even when fn rejects after a log", async () => {
    const real = console.error;
    await assert.rejects(
      withMuzzledConsole(async () => {
        console.error("Defuddle", "oops");
        throw new Error("post-log");
      }, { error: ["Defuddle"] }),
      /post-log/,
    );
    assert.strictEqual(console.error, real);
  });
});

describe("stripTrailingSourcesSection", () => {
  it("strips a markdown-heading sources section at the end", () => {
    const text = "Answer prose.\n\n## Sources\n- [A](https://a.example/1)\n- [B](https://b.example/2)\n";
    assert.strictEqual(stripTrailingSourcesSection(text), "Answer prose.\n");
  });

  it("strips bold and colon heading forms", () => {
    assert.strictEqual(
      stripTrailingSourcesSection("Prose.\n\n**Sources**\n[1] https://a.example/1\n"),
      "Prose.\n",
    );
    assert.strictEqual(
      stripTrailingSourcesSection("Prose.\n\nSources:\nhttps://a.example/1\n"),
      "Prose.\n",
    );
  });

  it("leaves text without a trailing sources section unchanged", () => {
    const text = "Answer with an inline [link](https://a.example/1) and more prose.";
    assert.strictEqual(stripTrailingSourcesSection(text), text);
  });

  it("does not touch a sources heading whose body has no URLs", () => {
    const text = "Prose.\n\nSources\nnone available\n";
    assert.strictEqual(stripTrailingSourcesSection(text), text);
  });

  it("does not strip when Sources appears mid-text but not as a trailing section", () => {
    const text = "Sources say X.\n\nMore prose about https://a.example/1 follows here.\n";
    assert.strictEqual(stripTrailingSourcesSection(text), text);
  });
});

describe("budgetExhausted", () => {
  it("reports exhaustion only when reported output reached the cap", () => {
    assert.equal(budgetExhausted({ output: 3000 }, 3000), true);
    assert.equal(budgetExhausted({ output: 3001 }, 3000), true);
    assert.equal(budgetExhausted({ output: 2999 }, 3000), false);
  });

  it("never reports exhaustion from missing usage or a missing cap", () => {
    assert.equal(budgetExhausted(undefined, 3000), false, "missing usage is not zero usage");
    assert.equal(budgetExhausted({}, 3000), false, "no output field");
    assert.equal(budgetExhausted({ output: 3000 }, undefined), false, "no cap to compare against");
  });
});

describe("reasoningOnlyCompletion", () => {
  it("classifies a completion spent almost entirely on hidden reasoning", () => {
    assert.equal(reasoningOnlyCompletion({ output: 3000, reasoning: 2999 }, 3000), true);
    assert.equal(reasoningOnlyCompletion({ output: 3000, reasoning: 3000 }, 3000), true);
    assert.equal(reasoningOnlyCompletion({ output: 3000, reasoning: 1500 }, 3000), false, "half the budget was visible output");
  });

  it("falls back to false when usage lacks the reasoning breakdown", () => {
    assert.equal(reasoningOnlyCompletion({ output: 3000 }, 3000), false);
    assert.equal(reasoningOnlyCompletion(undefined, 3000), false);
  });
});
