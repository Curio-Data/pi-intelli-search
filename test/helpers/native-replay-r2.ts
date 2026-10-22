// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// TEMPORARY R2 dry-run wrapper (C33/T33, C34). Test-only: it proves that the
// public R1 APIs suffice for the native R2 patch without any core/MCP edit.
// It is NOT the R2 implementation and NOT complete replay: `intelli_fetch`
// reaches the real native runtime only through the unit-mode
// `operations.search` substitution, because the R1 native runtime dispatches
// no fetch operation (src/native-operation-runtime.ts `default:` branch).
//
// Public R1 surface used: createNativeExtension (immutable factory),
// operationOutputSchemas, fetchPage and search (src/core/index.ts exports),
// and the host's visibleWidth/truncateToWidth helpers.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Context, CoreResult, FetchParams } from "../../src/core/execution-contracts.js";
import type { NativeTestInjection } from "../../src/native-injection.js";

type NativeModule = typeof import("../../src/index.js");
type CoreModule = typeof import("../../src/core/index.js");

export interface WidthHelpers {
  visibleWidth(text: string): number;
  truncateToWidth(text: string, width: number, ellipsis?: string, pad?: boolean): string;
}

/** One widget row, keyed by session generation, parent call and operation. */
export interface WidgetRow {
  readonly key: string;
  readonly generation: number;
  readonly parentToolCallId: string;
  readonly operationId: string;
  tool: string;
  message: string;
  state: "running" | "done" | "error";
}

/**
 * Widget model for nested intelli progress. Rows never share another
 * parent's state; missing ends are pruned at parent completion/abort and at
 * session replacement, without touching another live parent's rows.
 */
export class R2Widget {
  readonly rows = new Map<string, WidgetRow>();
  generation = 0;
  pruned = 0;
  constructor(private readonly width: WidthHelpers) {}

  newGeneration(): void {
    this.pruned += this.rows.size;
    this.rows.clear();
    this.generation++;
  }

  update(event: { toolName?: string; toolCallId?: string; parentToolCallId?: string; partialResult?: unknown; result?: unknown; isError?: boolean; type?: string }): void {
    if (!event.parentToolCallId || !String(event.toolName).startsWith("intelli_")) {
      // A top-level call ending prunes its own nested rows (completion or abort).
      if (event.type === "tool_execution_end" && event.toolCallId) this.pruneParent(event.toolCallId);
      return;
    }
    const details = ((event.partialResult ?? event.result) as { details?: { operationId?: string; message?: string; intelli?: { operationId?: string } } } | undefined)?.details;
    const operationId = details?.operationId ?? details?.intelli?.operationId;
    if (!operationId) return;
    const key = `${this.generation}:${event.parentToolCallId}:${operationId}`;
    const row = this.rows.get(key) ?? {
      key,
      generation: this.generation,
      parentToolCallId: event.parentToolCallId,
      operationId,
      tool: String(event.toolName),
      message: "",
      state: "running" as const,
    };
    if (details?.message) row.message = details.message;
    if (event.type === "tool_execution_end") row.state = event.isError ? "error" : "done";
    this.rows.set(key, row);
  }

  pruneParent(parentToolCallId: string): void {
    for (const [key, row] of this.rows)
      if (row.parentToolCallId === parentToolCallId) {
        this.rows.delete(key);
        this.pruned++;
      }
  }

  /** Lines no wider than `columns` visible cells, measured by the host helper. */
  render(columns: number): string[] {
    const lines: string[] = [];
    for (const row of this.rows.values()) {
      const mark = row.state === "running" ? "…" : row.state === "done" ? "✓" : "✗";
      const text = `${mark} ${row.tool.replace(/^intelli_/, "")} ${row.message}`;
      lines.push(this.width.visibleWidth(text) <= columns ? text : this.width.truncateToWidth(text, columns, "…"));
    }
    return lines;
  }
}

export interface R2Options {
  readonly native: NativeModule;
  readonly core: Pick<CoreModule, "operationOutputSchemas" | "fetchPage" | "search">;
  readonly width: WidthHelpers;
  /** Transports beneath the real policy; R2 cannot use transport-replay mode. */
  readonly registryStreamSimple?: NonNullable<NativeTestInjection["registryStreamSimple"]>;
  readonly pageTransport?: NonNullable<NativeTestInjection["pageTransport"]>;
  readonly onWidget?: (widget: R2Widget) => void;
}

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolResult = { content: unknown[]; details?: Record<string, unknown>; isError?: boolean; structuredContent?: unknown };

/** The temporary R2 native extension. */
export function createR2DryRunExtension(options: R2Options): (pi: ExtensionAPI) => void {
  const fetchRequests = new WeakMap<object, FetchParams>();
  const extension = options.native.createNativeExtension({
    mode: "unit",
    ...(options.registryStreamSimple ? { registryStreamSimple: options.registryStreamSimple } : {}),
    ...(options.pageTransport ? { pageTransport: options.pageTransport } : {}),
    operations: {
      search: (params, context: Context): Promise<CoreResult> => {
        const fetch = fetchRequests.get(params);
        return fetch ? options.core.fetchPage(fetch, context) : options.core.search(params, context);
      },
    },
  });
  return (pi) => {
    const captured = new Map<string, RegisteredTool>();
    const proxy = Object.create(pi) as ExtensionAPI;
    proxy.registerTool = ((tool: RegisteredTool) => {
      captured.set(tool.name, tool);
    }) as ExtensionAPI["registerTool"];
    extension(proxy);
    const structured = (result: ToolResult): ToolResult => ({
      ...result,
      ...(result.details?.intelli !== undefined ? { structuredContent: result.details.intelli } : {}),
    });
    for (const tool of captured.values()) {
      pi.registerTool({
        ...tool,
        outputSchema: options.core.operationOutputSchemas[tool.name as keyof typeof options.core.operationOutputSchemas],
        execute: async (...args: Parameters<RegisteredTool["execute"]>) => structured((await tool.execute(...args)) as ToolResult),
      } as RegisteredTool);
    }
    // Capability sentinel: hosts without Codemode exposure register no fetch tool.
    const search = captured.get("intelli_search");
    if (typeof pi.registerMcpServer === "function" && search) {
      pi.registerTool({
        name: "intelli_fetch",
        label: "Intelli Fetch",
        description: "Fetch one page through the bounded intelli page client and return its full SourceRecord. Script-only.",
        parameters: {
          type: "object",
          properties: { url: { type: "string" }, maxChars: { type: "integer", minimum: 1 } },
          required: ["url"],
          additionalProperties: false,
        } as never,
        outputSchema: options.core.operationOutputSchemas.intelli_fetch,
        exposure: "codemode",
        annotations: { readOnlyHint: true, openWorldHint: true },
        execute: async (toolCallId, params, signal, onUpdate, ctx) => {
          const marker = { query: "intelli_fetch" };
          fetchRequests.set(marker, { url: String((params as FetchParams).url), ...((params as FetchParams).maxChars ? { maxChars: (params as FetchParams).maxChars } : {}) });
          return structured((await search.execute(toolCallId, marker as never, signal, onUpdate, ctx)) as ToolResult) as never;
        },
      } as RegisteredTool);
    }
    const widget = new R2Widget(options.width);
    options.onWidget?.(widget);
    pi.on("session_start", () => widget.newGeneration());
    pi.on("session_shutdown", () => widget.newGeneration());
    for (const name of ["tool_execution_start", "tool_execution_update", "tool_execution_end"] as const)
      pi.on(name as "tool_execution_end", (event) => widget.update({ ...(event as object), type: name }));
  };
}

/**
 * Supplied manual workflow: finite `timeout_ms`, bounded fan-out, error
 * handling, and a script-reduced result that carries no raw page body.
 */
export function manualWorkflowScript(query: string, maxPages: number, timeoutMs: number): string {
  return [
    `// @options: {"timeout_ms": ${timeoutMs}}`,
    `const found = await tools.intelli_search({ query: ${JSON.stringify(query)} });`,
    `const urls = found.sources.map((s) => s.url).slice(0, ${maxPages});`,
    "const fetched = await Promise.allSettled(urls.map((url) => tools.intelli_fetch({ url, maxChars: 4000 })));",
    "const pages = fetched.map((r, i) => r.status === 'fulfilled'",
    "  ? { url: urls[i], outcome: r.value.outcome, state: r.value.sources[0].state, chars: (r.value.sources[0].content || '').length }",
    "  : { url: urls[i], outcome: 'rejected', error: String(r.reason && r.reason.message).slice(0, 80) });",
    "const usable = fetched.filter((r) => r.status === 'fulfilled' && r.value.outcome === 'completed').map((r) => r.value.sources[0]);",
    "const extractions = [];",
    "for (const page of usable) {",
    `  const x = await tools.intelli_extract({ url: page.url, title: page.title, content: page.content, query: ${JSON.stringify(query)} });`,
    "  extractions.push({ url: page.url, title: page.title, extraction: x.sources[0].extraction || '', sourceType: x.sources[0].sourceType || 'unknown', status: x.outcome === 'completed' ? 'success' : 'failed' });",
    "}",
    "let collated = null;",
    `try { const c = await tools.intelli_collate({ query: ${JSON.stringify(query)}, extractions }); collated = { outcome: c.outcome, used: c.counts.used }; }`,
    "catch (error) { collated = { outcome: 'rejected', error: String(error.message).slice(0, 80) }; }",
    "return JSON.stringify({ searchOutcome: found.outcome, pages, collated });",
  ].join("\n");
}
