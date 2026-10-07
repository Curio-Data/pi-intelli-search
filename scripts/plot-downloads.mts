/**
 * Weekly npm download chart, hand-drawn style, stacked across both packages:
 * the native Pi extension (@curio-data/pi-intelli-search, bottom) and the MCP
 * server (@curio-data/mcp-intelli-search, top).
 * Run: node scripts/plot-downloads.mts
 *      node scripts/plot-downloads.mts --offline   (render from cache, no network)
 */
import rough from 'roughjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const FIRST_DAY = {
  pi: '2026-05-04', // clamp: first publish (0.3.1-alpha.1)
  mcp: '2026-10-05', // clamp: first publish (0.15.0-alpha.0)
};
const CACHE = {
  pi: 'data/downloads.json',
  mcp: 'data/downloads-mcp.json',
};
const OUT_LIGHT = 'docs/images/downloads-light.svg';
const OUT_DARK = 'docs/images/downloads-dark.svg';

const THEMES = {
  light: {
    bg: '#faf6ee', ink: '#2e2a25', grid: '#c9bfae',
    pi: '#8b3a2e', mcp: '#3f6f8f',
  },
  dark: {
    bg: '#0d1117', ink: '#d8d2c8', grid: '#3d3630',
    pi: '#d4805f', mcp: '#8fb6d9',
  },
};

type Pkg = keyof typeof FIRST_DAY;
type Day = { day: string; downloads: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** npm publishes yesterday's counts after UTC midnight; today is never complete. */
function lastCompleteDay(): string {
  return addDays(iso(new Date()), -1);
}

async function fetchRange(pkg: Pkg, from: string, to: string): Promise<Day[]> {
  const url = `https://api.npmjs.org/downloads/range/${from}:${to}/@curio-data/${pkg}-intelli-search`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return (await res.json()).downloads ?? [];
    if (res.status === 404) return []; // no data in window
    if (attempt === 4) throw new Error(`npm API ${res.status} for ${pkg} ${from}:${to}`);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return [];
}

async function loadCache(pkg: Pkg): Promise<Day[]> {
  try {
    return JSON.parse(await readFile(CACHE[pkg], 'utf8'));
  } catch {
    return [];
  }
}

/** npm computes a day's downloads shortly after UTC midnight and can revise
 * recent days. Re-fetch a short trailing window so a provisional value can
 * never be frozen by the append-only cache. */
const REFETCH_DAYS = 3;

/** Append-only plus the trailing re-fetch window: fetch the gap between the
 * cache and the last complete day, overlapping the final days. */
async function refresh(pkg: Pkg, offline: boolean): Promise<Day[]> {
  const cached = await loadCache(pkg);
  if (offline) return cached;

  const end = lastCompleteDay();
  const start = cached.length
    ? (cached.length >= REFETCH_DAYS
        ? cached[cached.length - REFETCH_DAYS].day
        : FIRST_DAY[pkg])
    : FIRST_DAY[pkg];
  if (start > end) return cached;

  const fresh: Day[] = [];
  // 500-day chunks keep every request under the API's 18-month ceiling.
  for (let from = start; from <= end; from = addDays(from, 500)) {
    const to = addDays(from, 499) > end ? end : addDays(from, 499);
    fresh.push(...(await fetchRange(pkg, from, to)));
    await new Promise((r) => setTimeout(r, 200));
  }

  const merged = [...cached, ...fresh.filter((d) => d.day >= start && d.day <= end)];
  // Later entries win, so re-fetched days overwrite their cached values.
  const seen = new Map(merged.map((d) => [d.day, d]));
  const out = [...seen.values()].sort((a, b) => a.day.localeCompare(b.day));

  await mkdir(dirname(CACHE[pkg]), { recursive: true });
  await writeFile(CACHE[pkg], JSON.stringify(out, null, 2) + '\n');
  return out;
}

type Week = { week: string; downloads: number };

/**
 * Monday-anchored weekly buckets.
 * Leading all-zero weeks (pre-publish) and any partial week are dropped:
 * a partial week always renders as a fake cliff at the right-hand edge.
 */
function toWeeks(days: Day[]): Week[] {
  const buckets = new Map<string, { total: number; n: number }>();
  for (const d of days) {
    const dt = new Date(d.day + 'T00:00:00Z');
    const monday = addDays(d.day, -((dt.getUTCDay() + 6) % 7));
    const b = buckets.get(monday) ?? { total: 0, n: 0 };
    b.total += d.downloads;
    b.n += 1;
    buckets.set(monday, b);
  }
  const weeks = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, b]) => b.n === 7)
    .map(([week, b]) => ({ week, downloads: b.total }));

  const firstReal = weeks.findIndex((w) => w.downloads > 0);
  return firstReal === -1 ? [] : weeks.slice(firstReal);
}

/** Union of both series' weeks; a package absent from a week contributes zero. */
function stackWeeks(pi: Week[], mcp: Week[]): { week: string; pi: number; mcp: number }[] {
  const byWeek = new Map<string, { pi: number; mcp: number }>();
  for (const w of pi) byWeek.set(w.week, { pi: w.downloads, mcp: 0 });
  for (const w of mcp) {
    const b = byWeek.get(w.week) ?? { pi: 0, mcp: 0 };
    b.mcp = w.downloads;
    byWeek.set(w.week, b);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({ week, ...v }));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(
  weeks: { week: string; pi: number; mcp: number }[],
  theme: keyof typeof THEMES,
): string {
  const t = THEMES[theme];
  const W = 900, H = 360;
  const M = { top: 64, right: 24, bottom: 54, left: 66 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const max = Math.max(...weeks.map((w) => w.pi + w.mcp), 1);
  const niceMax = Math.ceil(max / 100) * 100 || 100;
  const g = rough.generator();
  const parts: string[] = [];

  // Deterministic seeds. Unseeded rough.js re-scribbles on every run and the
  // SVG churns in git even when the numbers are identical.
  let seed = 1;
  const draw = (drawable: ReturnType<typeof g.line>) => {
    for (const p of g.toPaths(drawable)) {
      parts.push(
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}"/>`,
      );
    }
  };

  // horizontal gridlines + y labels
  for (let i = 0; i <= 4; i++) {
    const y = M.top + ph - (ph * i) / 4;
    draw(g.line(M.left, y, M.left + pw, y, {
      stroke: t.grid, strokeWidth: 1, roughness: 1.1, seed: seed++,
    }));
    parts.push(
      `<text x="${M.left - 12}" y="${y + 4}" text-anchor="end" font-size="13" fill="${t.ink}" opacity="0.75">${Math.round((niceMax * i) / 4)}</text>`,
    );
  }

  // stacked bars: pi on the bottom, mcp on top of it
  const slot = pw / weeks.length;
  const bw = Math.max(4, Math.min(slot * 0.62, 40));
  weeks.forEach((w, i) => {
    const hPi = (w.pi / niceMax) * ph;
    const hMcp = (w.mcp / niceMax) * ph;
    const x = M.left + slot * i + (slot - bw) / 2;
    if (hPi > 0) {
      draw(g.rectangle(x, M.top + ph - hPi, bw, hPi, {
        stroke: t.pi, strokeWidth: 1.6, fill: t.pi,
        fillStyle: 'hachure', fillWeight: 1.4, hachureAngle: -41,
        roughness: 1.5, bowing: 1.4, seed: seed++,
      }));
    }
    if (hMcp > 0) {
      draw(g.rectangle(x, M.top + ph - hPi - hMcp, bw, hMcp, {
        stroke: t.mcp, strokeWidth: 1.6, fill: t.mcp,
        fillStyle: 'hachure', fillWeight: 1.4, hachureAngle: 49,
        roughness: 1.5, bowing: 1.4, seed: seed++,
      }));
    }
  });

  // x labels: thinned so they never collide
  const every = Math.ceil(weeks.length / 10);
  weeks.forEach((w, i) => {
    if (i % every) return;
    const x = M.left + slot * i + slot / 2;
    parts.push(
      `<text x="${x}" y="${M.top + ph + 26}" text-anchor="middle" font-size="12" fill="${t.ink}" opacity="0.7">${esc(w.week.slice(5))}</text>`,
    );
  });

  // axes
  draw(g.line(M.left, M.top + ph, M.left + pw, M.top + ph, {
    stroke: t.ink, strokeWidth: 2, roughness: 1.3, seed: seed++,
  }));
  draw(g.line(M.left, M.top, M.left, M.top + ph, {
    stroke: t.ink, strokeWidth: 2, roughness: 1.3, seed: seed++,
  }));

  const total = weeks.reduce((s, w) => s + w.pi + w.mcp, 0);
  const font =
    "'Comic Sans MS','Segoe Print','Bradley Hand','Chalkboard SE',cursive,sans-serif";

  // legend: pi bottom segment, mcp top segment; the swatch hatch matches its
  // series so the hatch direction stays a redundant cue beside colour.
  const legend = (label: string, colour: string, angle: number, x: number) => {
    draw(g.rectangle(x, 36, 14, 14, {
      stroke: colour, strokeWidth: 1.4, fill: colour,
      fillStyle: 'hachure', fillWeight: 1.2, hachureAngle: angle,
      roughness: 1.2, seed: seed++,
    }));
    parts.push(
      `<text x="${x + 20}" y="48" font-size="13" fill="${t.ink}" opacity="0.85">${esc(label)}</text>`,
    );
  };
  legend('mcp server', t.mcp, 49, W - M.right - 118);
  legend('pi extension', t.pi, -41, W - M.right - 262);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}" role="img" aria-label="Stacked weekly npm downloads for @curio-data/pi-intelli-search and @curio-data/mcp-intelli-search">
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<text x="${M.left}" y="28" font-size="18" fill="${t.ink}">weekly npm downloads &#183; both intelli-search packages</text>
<text x="${M.left}" y="48" font-size="13" fill="${t.ink}" opacity="0.65">${total.toLocaleString('en-GB')} over ${weeks.length} weeks</text>
${parts.join('\n')}
</svg>
`;
}

const offline = process.argv.includes('--offline');

const piWeeks = toWeeks(await refresh('pi', offline));
const mcpWeeks = toWeeks(await refresh('mcp', offline));
const weeks = stackWeeks(piWeeks, mcpWeeks);
if (!weeks.length) {
  console.error('No complete weeks with data yet: nothing rendered.');
  process.exit(0);
}
await mkdir(dirname(OUT_LIGHT), { recursive: true });
await writeFile(OUT_LIGHT, render(weeks, 'light'));
await writeFile(OUT_DARK, render(weeks, 'dark'));
console.log(
  `Rendered ${weeks.length} weeks (${piWeeks.length} pi, ${mcpWeeks.length} mcp).`,
);
