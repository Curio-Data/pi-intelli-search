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
  maxUrls: number;
  cacheDir: string;
  extractMaxChars: number;
}
