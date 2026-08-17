/**
 * Weekly npm download chart, hand-drawn style.
 * Run: node scripts/plot-downloads.mts
 *      node scripts/plot-downloads.mts --offline   (render from cache, no network)
 */
import rough from 'roughjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const PKG = '@curio-data/pi-intelli-search';
const FIRST_DAY = '2026-05-04'; // clamp: first publish (0.3.1-alpha.1)
const CACHE = 'data/downloads.json';
const OUT_LIGHT = 'docs/images/downloads-light.svg';
const OUT_DARK = 'docs/images/downloads-dark.svg';

const THEMES = {
  light: { bg: '#faf6ee', ink: '#2e2a25', grid: '#c9bfae', accent: '#8b3a2e' },
  dark: { bg: '#0d1117', ink: '#d8d2c8', grid: '#3d3630', accent: '#d4805f' },
};

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

async function fetchRange(from: string, to: string): Promise<Day[]> {
  const url = `https://api.npmjs.org/downloads/range/${from}:${to}/${PKG}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return (await res.json()).downloads ?? [];
    if (res.status === 404) return []; // no data in window
    if (attempt === 4) throw new Error(`npm API ${res.status} for ${from}:${to}`);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return [];
}

async function loadCache(): Promise<Day[]> {
  try {
    return JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    return [];
  }
}

/** Append-only: fetch just the gap between the cache and the last complete day. */
async function refresh(offline: boolean): Promise<Day[]> {
  const cached = await loadCache();
  if (offline) return cached;

  const end = lastCompleteDay();
  const start = cached.length ? addDays(cached[cached.length - 1].day, 1) : FIRST_DAY;
  if (start > end) return cached;

  const fresh: Day[] = [];
  // 500-day chunks keep every request under the API's 18-month ceiling.
  for (let from = start; from <= end; from = addDays(from, 500)) {
    const to = addDays(from, 499) > end ? end : addDays(from, 499);
    fresh.push(...(await fetchRange(from, to)));
    await new Promise((r) => setTimeout(r, 200));
  }

  const merged = [...cached, ...fresh.filter((d) => d.day >= start && d.day <= end)];
  const seen = new Map(merged.map((d) => [d.day, d]));
  const out = [...seen.values()].sort((a, b) => a.day.localeCompare(b.day));

  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify(out, null, 2) + '\n');
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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(weeks: Week[], theme: keyof typeof THEMES): string {
  const t = THEMES[theme];
  const W = 900, H = 360;
  const M = { top: 46, right: 24, bottom: 54, left: 66 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const max = Math.max(...weeks.map((w) => w.downloads), 1);
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

  // bars
  const slot = pw / weeks.length;
  const bw = Math.max(4, Math.min(slot * 0.62, 40));
  weeks.forEach((w, i) => {
    const h = (w.downloads / niceMax) * ph;
    const x = M.left + slot * i + (slot - bw) / 2;
    draw(g.rectangle(x, M.top + ph - h, bw, h, {
      stroke: t.accent, strokeWidth: 1.6, fill: t.accent,
      fillStyle: 'hachure', fillWeight: 1.4, hachureAngle: -41,
      roughness: 1.5, bowing: 1.4, seed: seed++,
    }));
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

  const total = weeks.reduce((s, w) => s + w.downloads, 0);
  const font =
    "'Comic Sans MS','Segoe Print','Bradley Hand','Chalkboard SE',cursive,sans-serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}" role="img" aria-label="Weekly npm downloads for ${esc(PKG)}">
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<text x="${M.left}" y="28" font-size="18" fill="${t.ink}">weekly npm downloads &#183; ${esc(PKG)}</text>
<text x="${W - M.right}" y="28" text-anchor="end" font-size="13" fill="${t.ink}" opacity="0.65">${total.toLocaleString('en-GB')} over ${weeks.length} weeks</text>
${parts.join('\n')}
</svg>
`;
}

const offline = process.argv.includes('--offline');
const days = await refresh(offline);
const weeks = toWeeks(days);
if (!weeks.length) {
  console.error('No complete weeks with data yet: nothing rendered.');
  process.exit(0);
}
await mkdir(dirname(OUT_LIGHT), { recursive: true });
await writeFile(OUT_LIGHT, render(weeks, 'light'));
await writeFile(OUT_DARK, render(weeks, 'dark'));
console.log(`Rendered ${weeks.length} weeks, ${days.length} days cached.`);
