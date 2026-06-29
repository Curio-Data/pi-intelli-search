// test/fetch.test.ts — Unit tests for fetch utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadLlmsFullToCache, LLMS_FULL_TIMEOUT_MS } from "../src/fetch.js";

describe("fetch module structure", () => {
  it("exports fetchPages as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.fetchPages, "function");
  });

  it("exports downloadLlmsFullToCache as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.downloadLlmsFullToCache, "function");
  });

  it("exports FetchOptions type via interface", async () => {
    const mod = await import("../src/fetch.js");
    // FetchOptions is a type, so it's not available at runtime.
    // Just verify the module loaded successfully.
    assert.ok(mod.fetchPages !== undefined);
  });
});

// llms-full.txt discovery is supplementary and must never stall the research
// result: it honours the caller's AbortSignal and uses a tight per-probe
// timeout instead of the original 30s. These tests are network-free.
describe("downloadLlmsFullToCache (cancellable, bounded)", () => {
  it("uses a tight per-probe timeout (no 30s stall)", () => {
    assert.ok(
      LLMS_FULL_TIMEOUT_MS <= 15_000,
      `expected a tight probe timeout, got ${LLMS_FULL_TIMEOUT_MS}ms`,
    );
  });

  it("returns null for a URL with no resolvable hostname (no network)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "llmsfull-"));
    try {
      const result = await downloadLlmsFullToCache("not-a-url", dir);
      assert.strictEqual(result, null);
      // Nothing should have been written.
      assert.deepStrictEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns null immediately when the signal is already aborted, writing nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "llmsfull-"));
    try {
      const start = Date.now();
      const result = await downloadLlmsFullToCache(
        "https://example.com/docs/page",
        dir,
        AbortSignal.abort(),
      );
      const elapsed = Date.now() - start;
      assert.strictEqual(result, null);
      // Must not block on the network or the timeout: aborts are honoured up front.
      assert.ok(elapsed < 3000, `aborted probe should return fast, took ${elapsed}ms`);
      assert.deepStrictEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// --- Test the scoring/sanitize logic (mimics the private scoreContent) ---
// The actual scoreContent is module-private, so we replicate the logic
// to verify the rules described in the code.
describe("content scoring logic (indirect)", () => {
  function mimicScoreContent(content: string): number {
    let score = content.length;
    score += (content.match(/```/g) ?? []).length * 100;
    score += (content.match(/^#{1,6}\s/gm) ?? []).length * 50;
    score += (content.match(/^\|/gm) ?? []).length * 20;
    score -= (content.match(/Skip to content|Was this helpful|Edit page|Report issue|Copy page/g) ?? []).length * 500;
    if (content.startsWith("---")) score -= 1000;
    return score;
  }

  it("prefers content with code blocks", () => {
    const plain = "Some text about a function.";
    const withCode = "Some text:\n```js\nconst x = 1;\n```\n";
    assert.ok(mimicScoreContent(withCode) > mimicScoreContent(plain));
  });

  it("penalizes nav chrome", () => {
    const clean = "Good content here about APIs.";
    const withNav = "Skip to content\nGood content here about APIs.\nWas this helpful?";
    assert.ok(mimicScoreContent(clean) > mimicScoreContent(withNav));
  });

  it("penalizes YAML frontmatter", () => {
    const noFrontmatter = "# Title\nContent here.";
    const withFrontmatter = "---\ntitle: Foo\n---\n# Title\nContent here.";
    assert.ok(mimicScoreContent(noFrontmatter) > mimicScoreContent(withFrontmatter));
  });

  it("bonus for headings", () => {
    const flat = "Paragraph of text.";
    const structured = "# Section\nParagraph of text.\n## Subsection\nMore text.";
    assert.ok(mimicScoreContent(structured) > mimicScoreContent(flat));
  });

  it("bonus for tables", () => {
    const noTable = "Here is some data.";
    const withTable = "Here is some data.\n| A | B |\n| 1 | 2 |\n| 3 | 4 |";
    assert.ok(mimicScoreContent(withTable) > mimicScoreContent(noTable));
  });
});

// --- Test cleanBrokenMetadata via Defuddle integration ---
// We can't import the private function directly, so we test the behaviour
// by simulating what Defuddle would see. The function is called before
// Defuddle.parseAsync(), and its job is to fix/remove elements that would
// crash Defuddle's MetadataExtractor.
describe("cleanBrokenMetadata (via DOM simulation)", () => {
  it("resolves relative canonical URLs that would crash new URL()", () => {
    // Verify that new URL('/owner/repo/releases') throws without a base
    assert.throws(() => new URL("/firecracker-microvm/firecracker/releases"), {
      code: "ERR_INVALID_URL",
    });

    // Verify that new URL(relative, base) resolves correctly
    const resolved = new URL(
      "/firecracker-microvm/firecracker/releases",
      "https://github.com",
    );
    assert.strictEqual(resolved.href, "https://github.com/firecracker-microvm/firecracker/releases");
  });

  it("removes meta tags with literal undefined content", async () => {
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(`<!DOCTYPE html><html><head>
      <meta property="og:url" content="undefined">
      <meta property="og:title" content="Valid Title">
    </head><body></body></html>`);

    // Simulate cleanBrokenMetadata
    const elements = document.querySelectorAll('meta[content], link[href], a[href]');
    for (const el of Array.from(elements)) {
      const tag = (el as any).tagName.toLowerCase();
      for (const attr of tag === 'meta' ? ['content'] : ['href']) {
        const val = (el as any).getAttribute(attr);
        if (!val) continue;
        if (/^(undefined|null)$/i.test(val)) {
          el.remove();
          break;
        }
      }
    }

    const remaining = document.querySelectorAll('meta[property="og:url"]');
    assert.strictEqual(remaining.length, 0);
    const title = document.querySelectorAll('meta[property="og:title"]');
    assert.strictEqual(title.length, 1);
  });

  it("resolves relative paths to absolute URLs", async () => {
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(`<!DOCTYPE html><html><head>
      <link rel="canonical" href="/firecracker-microvm/firecracker/releases">
    </head><body></body></html>`);

    const pageUrl = "https://github.com/firecracker-microvm/firecracker/releases";
    const elements = document.querySelectorAll('meta[content], link[href], a[href]');
    for (const el of Array.from(elements)) {
      const tag = (el as any).tagName.toLowerCase();
      for (const attr of tag === 'meta' ? ['content'] : ['href']) {
        const val = (el as any).getAttribute(attr);
        if (!val) continue;
        if (/^(undefined|null)$/i.test(val)) {
          el.remove();
          break;
        }
        try {
          new URL(val);
        } catch {
          try {
            const resolved = new URL(val, pageUrl).href;
            (el as any).setAttribute(attr, resolved);
          } catch {
            el.remove();
            break;
          }
        }
      }
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    assert.strictEqual(
      (canonical as any).getAttribute('href'),
      "https://github.com/firecracker-microvm/firecracker/releases",
    );
  });

  it("Defuddle does not crash on GitHub releases page with relative metadata", async () => {
    // Reproduces the exact crash from the user report:
    //   Failed to parse URL: TypeError: Invalid URL
    //     at MetadataExtractor.extract (defuddle/dist/metadata.js:24:30)
    //     input: '/firecracker-microvm/firecracker/releases'
    //
    // GitHub pages use relative paths in <link rel="canonical"> and
    // <meta property="og:url">. Defuddle calls new URL() on these
    // without a base, which throws ERR_INVALID_URL.
    const { Defuddle } = await import("defuddle/node");
    const { parseHTML } = await import("linkedom");

    // Simplified GitHub releases page HTML with the problematic metadata
    const githubHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="canonical" href="/firecracker-microvm/firecracker/releases">
  <meta property="og:url" content="/firecracker-microvm/firecracker/releases">
  <meta property="og:title" content="Releases · firecracker-microvm/firecracker">
  <meta property="og:description" content="Amazon Firecracker">
  <title>Releases · firecracker-microvm/firecracker</title>
</head>
<body>
  <article>
    <h1>Releases · firecracker-microvm/firecracker</h1>
    <h2>v1.9.0</h2>
    <p>Bug fixes and performance improvements.</p>
    <h2>v1.8.0</h2>
    <p>Added new PID namespace support in jailer.</p>
  </article>
</body>
</html>`;

    const pageUrl = "https://github.com/firecracker-microvm/firecracker/releases";
    const { document } = parseHTML(githubHtml);

    // Apply the fix — same logic as cleanBrokenMetadata in fetch.ts
    const elements = document.querySelectorAll('meta[content], link[href], a[href]');
    for (const el of Array.from(elements)) {
      const tag = (el as any).tagName.toLowerCase();
      for (const attr of tag === 'meta' ? ['content'] : ['href']) {
        const val = (el as any).getAttribute(attr);
        if (!val) continue;
        if (/^(undefined|null)$/i.test(val)) {
          el.remove();
          break;
        }
        try {
          new URL(val);
        } catch {
          try {
            const resolved = new URL(val, pageUrl).href;
            (el as any).setAttribute(attr, resolved);
          } catch {
            el.remove();
            break;
          }
        }
      }
    }

    // This would crash with ERR_INVALID_URL before the fix
    const result = await Defuddle(document, pageUrl, { markdown: true });
    assert.ok(result.contentMarkdown || result.content, "Defuddle should extract content");
    assert.ok(result.title, "Defuddle should extract a title");
  });

  it("strips <script type='application/ld+json'> with invalid JSON", async () => {
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(`<!DOCTYPE html><html><head>
      <title>Test Page</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject"}</script>
      <script type="application/ld+json">not json at all {{</script>
      <script type="application/ld+json">  </script>
    </head><body><p>Hello</p></body></html>`);

    const pageUrl = "https://example.com";

    // Apply cleanBrokenMetadata logic
    const elements = document.querySelectorAll('meta[content], link[href], a[href]');
    for (const el of Array.from(elements)) {
      const tag = (el as any).tagName.toLowerCase();
      for (const attr of tag === 'meta' ? ['content'] : ['href']) {
        const val = (el as any).getAttribute(attr);
        if (!val) continue;
        if (/^(undefined|null)$/i.test(val)) { el.remove(); break; }
        try { new URL(val); } catch {
          try { (el as any).setAttribute(attr, new URL(val, pageUrl).href); } catch { el.remove(); break; }
        }
      }
    }

    // And the ld+json stripping logic
    const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of Array.from(ldJsonScripts)) {
      const text = script.textContent?.trim();
      if (!text) { script.remove(); continue; }
      try { JSON.parse(text); } catch { script.remove(); }
    }

    // Valid JSON script should remain
    const remaining = document.querySelectorAll('script[type="application/ld+json"]');
    assert.strictEqual(remaining.length, 1);
    assert.ok(remaining[0].textContent?.includes('VideoObject'));
    assert.ok(document.querySelector('title'));
    assert.ok(document.querySelector('p'));
  });

  it("Defuddle fallback extracts basic content when Defuddle degrades", async () => {
    const { parseHTML } = await import("linkedom");
    // Simulates the DOM text fallback used when Defuddle throws or logs a
    // degraded result (e.g. malformed CSS attribute selector) and is muzzled
    // by fetchViaDefuddle via withMuzzledConsole.
    const html = `<!DOCTYPE html><html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fallback Test Page</title>
  <meta name="description" content="A description for fallback testing">
</head>
<body>
  <div class="px-20 py-4">
    <h1>Main Heading</h1>
    <p>Some paragraph text.</p>
  </div>
</body></html>`;

    const { document } = parseHTML(html);

    // Simulate the fallback extraction
    const title = document.querySelector("title")?.textContent?.trim() ?? "";
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
    const bodyText = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const content = [`# ${title}`, metaDesc ? `> ${metaDesc}` : "", bodyText].filter(Boolean).join("\n\n");

    assert.strictEqual(title, "Fallback Test Page");
    assert.ok(content.includes("Fallback Test Page"));
    assert.ok(content.includes("A description for fallback testing"));
    assert.ok(content.includes("Main Heading"));
    assert.ok(content.includes("Some paragraph text"));
  });
});
