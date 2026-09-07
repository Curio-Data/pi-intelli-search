// test/annotations.test.ts — url_citation annotation harvesting tests
//
// parseCitations handles both SSE (streaming) and plain JSON
// (non-streaming) bodies. wrapFetchForAnnotations tees the response body:
// the SDK path is untouched and failures in the side channel never surface.
// mergeCitations combines text-scraped links with harvested citations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  settleAnnotationSink,
  createAnnotationSink,
  mergeCitations,
  parseCitations,
  wrapFetchForAnnotations,
  type AnnotationSink,
} from "../src/annotations.js";

const ANN = (url: string, title?: string) =>
  JSON.stringify({
    type: "url_citation",
    url_citation: { url, ...(title ? { title } : {}) },
  });

function sseChunk(annotations: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { annotations: annotations.map((a) => JSON.parse(a)) } }] })}\n\n`;
}

describe("parseCitations", () => {
  it("collects url_citations across SSE chunks and dedupes by url", () => {
    const body = [
      ": OPENROUTER PROCESSING comment line",
      sseChunk([ANN("https://a.example/1", "A One")]),
      sseChunk([ANN("https://a.example/1", "A One"), ANN("https://b.example/2")]),
      "data: [DONE]\n\n",
    ].join("");
    const citations = parseCitations(body);
    assert.deepStrictEqual(citations, [
      { url: "https://a.example/1", title: "A One" },
      { url: "https://b.example/2" },
    ]);
  });

  it("reads non-streaming JSON bodies (message.annotations)", () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "text",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://x.example/1", title: "X" } },
              { type: "url_citation", url_citation: { url: "https://x.example/2", title: "Y" } },
            ],
          },
        },
      ],
    });
    const citations = parseCitations(body);
    assert.strictEqual(citations.length, 2);
    assert.deepStrictEqual(citations[0], { url: "https://x.example/1", title: "X" });
  });

  it("ignores malformed chunks, non-citation annotations, and non-http urls", () => {
    const body = [
      "data: {not json",
      sseChunk([JSON.stringify({ type: "other_marker", marker: { url: "https://no.example/" } })]),
      sseChunk([ANN("ftp://not-http.example/file")]),
      sseChunk([ANN("https://ok.example/1")]),
    ].join("");
    const citations = parseCitations(body);
    assert.deepStrictEqual(citations, [{ url: "https://ok.example/1" }]);
  });

  it("returns [] for bodies that are neither SSE nor JSON", () => {
    assert.deepStrictEqual(parseCitations("<html>gateway error</html>"), []);
    assert.deepStrictEqual(parseCitations(""), []);
  });
});

describe("wrapFetchForAnnotations", () => {
  it("tees the body: returns the original response and fills the sink in the background", async () => {
    const sink = createAnnotationSink();
    const sseBody = sseChunk([ANN("https://tee.example/1", "Tee")]) + sseChunk([ANN("https://tee.example/2")]);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    const baseFetch = async () => response;
    const wrapped = wrapFetchForAnnotations(baseFetch as typeof fetch, sink);

    const returned = await wrapped("https://api.example/v1/chat/completions", { method: "POST" });
    assert.strictEqual(returned, response, "SDK must receive the untouched Response");
    assert.strictEqual(returned.status, 200);

    // Background read resolves once the (already-complete) stream drains.
    for (let i = 0; i < 50 && sink.citations.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.deepStrictEqual(sink.citations, [
      { url: "https://tee.example/1", title: "Tee" },
      { url: "https://tee.example/2" },
    ]);
  });

  it("skips harvesting on non-2xx responses and passes them through", async () => {
    const sink = createAnnotationSink();
    const errorResponse = new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });
    const wrapped = wrapFetchForAnnotations((async () => errorResponse) as typeof fetch, sink);

    const returned = await wrapped("https://api.example/v1/chat/completions");
    assert.strictEqual(returned, errorResponse);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(sink.citations, []);
  });

  it("propagates base fetch errors untouched so retry semantics are preserved", async () => {
    const sink = createAnnotationSink();
    const failure = new Error("ECONNRESET");
    const wrapped = wrapFetchForAnnotations(
      (async () => {
        throw failure;
      }) as typeof fetch,
      sink,
    );
    await assert.rejects(wrapped("https://api.example/v1/chat/completions"), /ECONNRESET/);
  });
});

describe("mergeCitations", () => {
  it("keeps text links first, appends annotation-only urls, dedupes by exact url", () => {
    const sink = createAnnotationSink();
    sink.citations.push(
      { url: "https://a.example/1", title: "A via annotation" },
      { url: "https://c.example/3", title: "C" },
    );
    const merged = mergeCitations(
      [
        { url: "https://a.example/1", title: "A via text" },
        { url: "https://b.example/2", title: "B" },
      ],
      sink,
    );
    assert.deepStrictEqual(merged, [
      { url: "https://a.example/1", title: "A via text" },
      { url: "https://b.example/2", title: "B" },
      { url: "https://c.example/3", title: "C" },
    ]);
  });

  it("falls back to the url itself when an annotation carries no title", () => {
    const sink = createAnnotationSink();
    sink.citations.push({ url: "https://no-title.example/1" });
    const merged = mergeCitations([], sink);
    assert.deepStrictEqual(merged, [{ url: "https://no-title.example/1", title: "https://no-title.example/1" }]);
  });
});

describe("settleAnnotationSink", () => {
  it("resolves once all background reads complete, making citations visible", async () => {
    const sink = createAnnotationSink();
    let releaseRead: (() => void) | undefined;
    const read = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    sink.reads = [read];
    let settled = false;
    const settlePromise = settleAnnotationSink(sink).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.strictEqual(settled, false, "must not settle while a read is in flight");
    releaseRead!();
    await settlePromise;
    assert.strictEqual(settled, true);
  });

  it("returns immediately when there are no reads (plain sinks from callers)", async () => {
    const sink: AnnotationSink = { citations: [] };
    await settleAnnotationSink(sink, 5);
  });

  it("is bounded: a hanging read resolves via the timeout, not by hanging forever", async () => {
    const sink = createAnnotationSink();
    sink.reads = [new Promise<void>(() => {})];
    const t0 = Date.now();
    await settleAnnotationSink(sink, 50);
    assert.ok(Date.now() - t0 < 2_000, "timeout must bound the wait");
  });
});

describe("wrapFetchForAnnotations read tracking", () => {
  it("records the background read on the sink so callers can settle it", async () => {
    const sink = createAnnotationSink();
    const response = new Response(sseChunk([ANN("https://tracked.example/1")]), { status: 200 });
    const wrapped = wrapFetchForAnnotations((async () => response) as typeof fetch, sink);
    await wrapped("https://api.example/v1/chat/completions");
    assert.ok(sink.reads && sink.reads.length === 1, "read promise recorded");
    await settleAnnotationSink(sink);
    assert.deepStrictEqual(sink.citations, [{ url: "https://tracked.example/1" }]);
  });
});
