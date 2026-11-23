// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

it('stacks launch-day downloads, but never fills a missing day after publication', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'download-chart-'));
  try {
    mkdirSync(join(cwd, 'data'));
    for (const [file, count] of [['downloads', 2], ['downloads-mcp', 3], ['downloads-dsh', 5]] as const) {
      const rows = Array.from({length: file === 'downloads-dsh' ? 8 : 14}, (_, i) => ({
        day: new Date(Date.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10), downloads: count,
      }));
      if (file === 'downloads-dsh') rows.unshift({day: '2026-11-22', downloads: 170});
      writeFileSync(join(cwd, `data/${file}.json`), JSON.stringify(rows));
    }
    const script = fileURLToPath(new URL('../scripts/plot-downloads.mts', import.meta.url));
    const run = () => execFileSync(process.execPath, [script, '--offline'], {cwd, encoding: 'utf8'});
    assert.match(run(), /2 pi, 2 mcp, 2 dsh/);
    const chart = (theme: string) => readFileSync(join(cwd, `docs/images/downloads-${theme}.svg`), 'utf8');
    const before = [chart('light'), chart('dark')];
    for (const [i, svg] of before.entries()) {
      assert.match(svg, />275 over 3 weeks</); // 170 launch-day + (2+3)*14 + 5*7
      assert.match(svg, />dsh bundle</);
      const green = ['#36704c', '#87c998'][i];
      // The launch and first full weeks plus the legend; no incomplete final week.
      assert.equal(svg.split(`stroke="${green}"`).length - 1, 6);
    }
    run();
    assert.deepEqual([chart('light'), chart('dark')], before);
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});
