// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  ModelBinding,
  ModelClient,
  ModelCompletion,
  ModelRequest,
  ModelUsage,
  OperationLogger,
} from "../../../../src/core/contracts.js";
import { parseCitations, type FetchFunction } from "../../../../src/core/annotations.js";
import { runModelWithPolicy, type AttemptHints } from "../../../../src/core/llm.js";
import { throwIfAborted } from "../../../../src/core/util.js";
import type { StandaloneConfig } from "../config.js";
import { StandaloneError } from "../errors.js";

const endpoint = "https://openrouter.ai/api/v1";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const numeric = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Never expose response bodies, transport exceptions, headers or credentials in errors. */
function statusError(status: number, hints?: AttemptHints): Error {
  if (status === 402 && hints?.retryAfterMs !== undefined)
    return new StandaloneError(
      "PROVIDER",
      "OpenRouter HTTP 402: temporarily unavailable (in-flight spending budget)",
    );
  const hint =
    status === 401
      ? "check the configured API key"
      : status === 402
        ? "check account credits"
        : status === 403
          ? "check account permissions and provider policy"
          : status === 404
            ? "check the exact model identifier"
            : status === 429
              ? "rate limited"
              : status === 408
                ? "request timed out"
                : status >= 500
                  ? "server error"
                  : "provider request failed";
  return new StandaloneError("PROVIDER", `OpenRouter HTTP ${status}: ${hint}`);
}
function responseError(value: unknown, hints: AttemptHints): Error {
  const error = record(value);
  const types: Record<string, number> = {
    rate_limit_exceeded: 429,
    provider_overloaded: 503,
    provider_unavailable: 502,
    server: 500,
    timeout: 408,
    authentication: 401,
    payment_required: 402,
    permission_denied: 403,
    content_policy_violation: 403,
    refusal: 403,
    invalid_request: 400,
    invalid_prompt: 400,
    not_found: 404,
    context_length_exceeded: 400,
    max_tokens_exceeded: 400,
  };
  const type = record(error.metadata).error_type;
  const code = Number(error.code);
  const status =
    typeof type === "string" && Object.hasOwn(types, type)
      ? types[type]
      : Number.isInteger(code) && code >= 400 && code <= 599
        ? code
        : 400;
  return statusError(status, hints);
}
async function bodyText(
  response: Response,
  signal: AbortSignal | undefined,
  limit: number,
): Promise<string> {
  if (!response.body) throw new Error("OpenRouter returned an empty response body");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    throwIfAborted(signal);
    for (;;) {
      const { value, done } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw new Error("OpenRouter response exceeds the configured transport safety limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function usage(value: unknown): ModelUsage | undefined {
  const raw = record(value);
  const out: ModelUsage = {};
  for (const [key, val] of Object.entries({
    input: raw.prompt_tokens,
    output: raw.completion_tokens,
    totalTokens: raw.total_tokens,
    totalCost: raw.cost,
    cacheRead: record(raw.prompt_tokens_details).cached_tokens,
    reasoning: record(raw.completion_tokens_details).reasoning_tokens,
  })) {
    const n = numeric(val);
    if (n !== undefined) Object.assign(out, { [key]: n });
  }
  // Preserve the reported total separately; never invent a per-component breakdown.
  return Object.keys(out).length ? out : undefined;
}
export interface OpenRouterOptions {
  fetch?: FetchFunction;
  env?: Readonly<Record<string, string | undefined>>;
  logger: OperationLogger;
  signal?: AbortSignal;
  policyTesting?: {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    random?: () => number;
  };
}
export function createOpenRouterClient(
  config: StandaloneConfig,
  options: OpenRouterOptions,
): ModelClient {
  const transport = options.fetch ?? globalThis.fetch;
  const env = { ...(options.env ?? process.env) };
  const settings = config.settings;
  const configured = [settings.searchModel, settings.extractModel, settings.collateModel];
  let catalogue: Record<string, unknown>[] | undefined;
  function key(): string {
    const value = env[config.apiKeyEnv];
    if (!value || !value.trim() || /\s/.test(value))
      throw new StandaloneError(
        "CONFIGURATION",
        `Set the credential environment variable ${config.apiKeyEnv} before creating the runtime; restart it after changing credentials`,
      );
    return value;
  }
  function policy(request: ModelRequest): ModelRequest {
    return {
      ...request,
      timeoutMs: request.timeoutMs ?? settings.llmTimeoutMs,
      retry: request.retry ?? {
        attempts: settings.llmRetryAttempts,
        baseDelayMs: settings.retryBaseDelayMs,
        maxDelayMs: settings.retryMaxDelayMs,
      },
    };
  }
  async function send(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    hints: AttemptHints,
  ): Promise<{ raw: string; data: Record<string, unknown> }> {
    let response: Response;
    try {
      response = await transport(`${endpoint}${path}`, {
        ...init,
        signal,
        redirect: "error",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      });
    } catch {
      throwIfAborted(signal);
      throw new Error("OpenRouter service unavailable; check connectivity");
    }
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(delay) && delay >= 0) hints.retryAfterMs = delay;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw statusError(response.status, hints);
    }
    let raw: string;
    try {
      raw = await bodyText(response, signal, path === "/models" ? 16_000_000 : 8_000_000);
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof Error && error.message.startsWith("OpenRouter response exceeds"))
        throw error;
      throw new Error("OpenRouter server error: response body failed");
    }
    let data: Record<string, unknown>;
    try {
      data = record(JSON.parse(raw));
    } catch {
      throw new Error("OpenRouter returned malformed JSON");
    }
    if (data.error !== undefined) throw responseError(data.error, hints);
    return { raw, data };
  }
  function capabilities(binding: ModelBinding): boolean {
    if (
      binding.config.provider !== "openrouter" ||
      !configured.some((item) => item.model === binding.config.model)
    )
      return false;
    const entry = catalogue?.find((item) => item.id === binding.config.model);
    if (!entry) return false;
    const architecture = record(entry.architecture);
    if (
      !Array.isArray(architecture.input_modalities) ||
      !architecture.input_modalities.includes("text") ||
      !Array.isArray(architecture.output_modalities) ||
      !architecture.output_modalities.includes("text")
    )
      throw new Error(`Configured ${binding.role} model does not advertise text input/output`);
    const search = binding.role === "search";
    const effort =
      search && settings.searchWebSearch.enabled
        ? (settings.searchWebSearch.reasoning ?? "low")
        : "low";
    const efforts = record(entry.reasoning).supported_efforts;
    if (Array.isArray(efforts) && !efforts.includes(effort))
      throw new Error(
        `Configured ${binding.role} model does not support the requested reasoning effort`,
      );
    if (
      search &&
      settings.searchWebSearch.enabled &&
      (!Array.isArray(entry.supported_parameters) || !entry.supported_parameters.includes("tools"))
    )
      throw new Error("Configured search model does not advertise tool support");
    return true;
  }
  const client: ModelClient = {
    async preflight(bindings) {
      key();
      // No inference is billed by catalogue validation. Its transport is bounded by the same policy.
      if (!catalogue) {
        const data = await runModelWithPolicy(
          async (signal, hints) => {
            const { data } = await send("/models", { method: "GET" }, signal, hints);
            if (!Array.isArray(data.data))
              throw new Error("OpenRouter returned an invalid model catalogue");
            return { value: data.data.map(record) };
          },
          policy({
            model: settings.searchModel,
            systemPrompt: "",
            userMessage: "",
            signal: options.signal,
          }),
          options.logger,
          options.policyTesting,
        );
        catalogue = data;
      }
      return bindings.filter((binding) => !capabilities(binding));
    },
    async complete(request) {
      throwIfAborted(request.signal);
      key();
      if (
        request.model.provider !== "openrouter" ||
        !configured.some((item) => item.model === request.model.model)
      )
        throw new Error("Model is not explicitly configured for this provider");
      if (!catalogue) throw new Error("Run provider preflight before model completion");
      const entry = catalogue.find((item) => item.id === request.model.model);
      if (!entry) throw new Error("Configured model is absent from the provider catalogue");
      const supportsReasoning =
        (Array.isArray(entry.supported_parameters) &&
          entry.supported_parameters.includes("reasoning")) ||
        Object.keys(record(entry.reasoning)).length > 0;
      return runModelWithPolicy<ModelCompletion>(
        async (signal, hints) => {
          const base: Record<string, unknown> = {
            model: request.model.model,
            stream: false,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userMessage },
            ],
          };
          if (supportsReasoning)
            base.reasoning = { effort: request.reasoning ?? "low", exclude: true };
          if (request.maxTokens !== undefined) base.max_completion_tokens = request.maxTokens;
          const payload = request.payloadPatch ? request.payloadPatch(base) : base;
          // Patches supply supported search tools, never routing or transport changes.
          if (
            payload.model !== base.model ||
            payload.stream !== false ||
            payload.messages !== base.messages ||
            "models" in payload ||
            "route" in payload
          )
            throw new Error("Payload patch cannot change model routing or message ownership");
          const { data, raw } = await send(
            "/chat/completions",
            { method: "POST", body: JSON.stringify(payload) },
            signal,
            hints,
          );
          const choices = data.choices;
          if (!Array.isArray(choices) || choices.length !== 1)
            throw new Error("OpenRouter returned invalid completion choices");
          const choice = record(choices[0]);
          if (choice.error !== undefined) throw responseError(choice.error, hints);
          if (choice.finish_reason === "error")
            throw new StandaloneError(
              "PROVIDER",
              "OpenRouter returned a failed completion without an error classification",
            );
          const message = record(choice.message);
          if (message.refusal || choice.finish_reason === "content_filter")
            throw new Error("OpenRouter declined the request under provider policy");
          if (typeof message.content !== "string")
            throw new Error("OpenRouter returned no text completion");
          if (!message.content.trim() && choice.finish_reason === "length")
            throw new Error(
              "OpenRouter exhausted the output budget without visible text; increase token limits or lower reasoning effort",
            );
          return {
            value: {
              text: message.content,
              citations: request.collectCitations ? parseCitations(raw) : [],
              usage: usage(data.usage),
            },
          };
        },
        policy(request),
        options.logger,
        options.policyTesting,
      );
    },
  };
  async function safe<T>(call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (error instanceof StandaloneError) throw error;
      throw new StandaloneError(
        "PROVIDER",
        error instanceof Error ? error.message : "OpenRouter request failed",
      );
    }
  }
  return {
    preflight: (bindings) => safe(client.preflight(bindings)),
    complete: (request) => safe(client.complete(request)),
  };
}
