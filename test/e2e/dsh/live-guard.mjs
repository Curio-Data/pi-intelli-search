// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import { writeFileSync } from 'node:fs';

export const name = 'intelli-live-guard';
export const inject = ['tools'];

export function apply(ctx) {
  const tool = process.env.S19_TOOL;
  const witness = process.env.S19_WITNESS;
  ctx.tools.guard(({ name, arguments: args }) => {
    if (!witness || name !== tool || !['mcp__intelli__intelli_search', 'mcp__intelli__intelli_research'].includes(name)) return 'Outside this verification case.';
    if (name.endsWith('_research') && (args.maxUrls !== 3 || !args.query || args.queries || args.domains?.length !== 1 || args.domains[0] !== 'nodejs.org')) return 'Expected a single research query with maxUrls 3 and domains [nodejs.org].';
    try {
      writeFileSync(witness, name, { flag: 'wx', mode: 0o600 });
    } catch {
      return 'No additional calls permitted.';
    }
  });
}
