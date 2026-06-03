// src/types.ts — Shared TypeScript interfaces

export interface SearchResult {
  summary: string;
  sources: Array<{ url: string; title: string }>;
  query: string;
  timestamp: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  content: string; // Defuddle-cleaned or raw markdown
  status: "success" | "error";
  error?: string;
  source?: string; // "defuddle", "markdown", or "llms-full"
}

export interface ExtractResult {
  url: string;
  title: string;
  extraction: string;
  sourceType: string;
  currentness: string;
  status: "success" | "failed" | "blocked";
}

export interface ModelConfig {
  provider: string;
  model: string;
}

export interface ResearchSettings {
  searchModel: ModelConfig;
  extractModel: ModelConfig;
  collateModel: ModelConfig;
  defaultUrls: number;
  maxUrls: number;
  cacheDir: string;
  extractMaxChars: number;
  fetchTimeoutMs: number;
  fetchConcurrency: number;
  extractionConcurrency: number;
  extractionMaxTokens: number;
  collationMaxTokens: number;
  browserFingerprint: string;
  disableLlmsFullDiscovery: boolean;
  // ── Rate-limit resilience ──
  // Per-call timeout (ms) for each LLM request. Bounds a stalled provider
  // connection (common under rate limiting) so it surfaces as a retryable
  // timeout instead of hanging on the SDK's ~10-minute default.
  llmTimeoutMs: number;
  // Transport-level retry per LLM call (1 = no retry; includes the first try).
  llmRetryAttempts: number;
  // Backoff base and cap (ms) for full-jitter retry delays.
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  // Application-level retry when search returns a valid 2xx with zero usable
  // links (degraded response). Includes the first try.
  searchRetryAttempts: number;
  // Minimum gap (ms) between concurrent LLM calls in the extract fan-out.
  // 0 disables the throttle (default; paid providers have no hard rate limit).
  minRequestIntervalMs: number;
}
