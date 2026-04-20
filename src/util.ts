// src/util.ts — Shared utilities
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a properly-typed text content object for tool results.
 */
export function textContent(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text };
}

/**
 * Get the pi agent directory path.
 */
export function getAgentDir(): string {
  return join(homedir(), ".pi", "agent");
}
