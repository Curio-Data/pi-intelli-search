// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { OperationProgress, ResearchStage } from "./contracts.js";

export const STAGES = ["search", "fetch", "extract", "collate", "cache"] as const;

export function progress(
  stage: ResearchStage,
  message: string,
  subProgress?: { current: number; total: number },
): OperationProgress {
  const stageIdx = STAGES.indexOf(stage);
  return {
    stage,
    stageIdx,
    totalStages: STAGES.length,
    message,
    pct: Math.round(((stageIdx + 1) / STAGES.length) * 100),
    ...(subProgress ? { subProgress } : {}),
  };
}
