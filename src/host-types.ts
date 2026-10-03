// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

/** Native rendering and update types. Never import these from the core. */
type ToolDetails = Record<string, unknown> | undefined;
export type OnUpdate = AgentToolUpdateCallback<ToolDetails>;
export type ToolResultLike = AgentToolResult<ToolDetails>;

export interface PiTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}
