// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { PageTransport } from "../../src/core/contracts.js";

/** Lower transport fixture: real FetchClient variants, limits and permits remain active. */
export const markdownPage =
  (content = "# Docs\n\nFacts"): PageTransport =>
  async (url, request) => ({
    url,
    status: 200,
    headers: new Headers({
      "content-type": request.headers.Accept === "text/markdown" ? "text/markdown" : "text/html",
    }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(content));
        controller.close();
      },
    }),
  });
