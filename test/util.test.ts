// test/util.test.ts — Unit tests for shared utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  textContent,
  getAgentDir,
  extractSourceUrls,
  inferSourceType,
  inferCurrentness,
  mapWithConcurrency,
  withRetry,
  isRetryableMessage,
  parseRetryAfterMs,
  createRateLimiter,
  callWithAbortTimeout,
  type RetryDecision,
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
  it("returns a path ending in .pi/agent", () => {
    const result = getAgentDir();
    assert.ok(result.endsWith(".pi/agent"), `Expected path ending in .pi/agent, got: ${result}`);
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
    await mapWithConcurrency(
      items,
      2,
      async (s, i) => `${s}-${i}`,
      { onSettled: (item, index, result) => settled.push({ item, index, result }) },
    );
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
    assert.ok(results.some((r) => r === undefined), "aborted run should leave holes");
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
  ];
  const nonRetryable = [
    "No API key for openrouter/x. Run /login.",
    "Model not found: openrouter/minimax/M3.7",
    "invalid_request_error: max_tokens too large",
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
      async () => { calls++; return "ok"; },
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
      async () => { calls++; return calls < 2 ? "bad" : "good"; },
      (r) => (r === "bad" ? { retry: true } : { retry: false }),
      { attempts: 3, baseDelayMs: 1000, maxDelayMs: 20000, sleep: fn, random: () => 1 },
    );
    assert.strictEqual(result, "good");
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(delays, [1000]); // random()=1 → full exp delay, attempt 1
  });

  it("uses full-jitter exponential schedule (random()=1)", async () => {
    const { delays, fn } = makeSleep();
    await withRetry(
      async () => "x",
      alwaysRetry,
      { attempts: 4, baseDelayMs: 1000, maxDelayMs: 20000, sleep: fn, random: () => 1 },
    );
    // attempt 1 -> 1000*2^0, 2 -> 2000, 3 -> 4000 (3 sleeps for 4 attempts)
    assert.deepStrictEqual(delays, [1000, 2000, 4000]);
  });

  it("caps each delay at maxDelayMs", async () => {
    const { delays, fn } = makeSleep();
    await withRetry(
      async () => "x",
      alwaysRetry,
      { attempts: 4, baseDelayMs: 10000, maxDelayMs: 15000, sleep: fn, random: () => 1 },
    );
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
      async () => { calls++; return `try-${calls}`; },
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
        async () => { calls++; throw new Error(`boom-${calls}`); },
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
      async () => { calls++; ac.abort(); return "bad"; },
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
    const { value, timedOut } = await callWithAbortTimeout(
      async () => "done",
      1000,
    );
    assert.strictEqual(value, "done");
    assert.strictEqual(timedOut, false);
  });

  it("passes a no-op (undefined) signal through when timeout disabled", async () => {
    let received: AbortSignal | undefined = {} as AbortSignal;
    const { value, timedOut } = await callWithAbortTimeout(
      async (signal) => { received = signal; return 42; },
      0,
    );
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
