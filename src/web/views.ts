import type { SessionUser } from './auth';

/**
 * Server-rendered HTML for the dashboard.
 *
 * Plain template literals rather than a view library: the dashboard is a
 * handful of pages, and the bot already carries enough dependencies. Charts
 * reuse the bot's own PNG renderers, served as images, so every figure has
 * exactly one implementation. The stylesheet's tokens mirror `THEME` in
 * `src/lib/image/theme.ts`, and the table pieces below (rank chip, pace bar,
 * sparkline) mirror the image primitives of the same names, so the dashboard
 * and the rendered images read as one system.
 */

/**
 * Escapes text for HTML.
 *
 * Every interpolation of external data -- trainer names, circle names,
 * anything from uma.moe or Discord -- must go through this. Umamusume trainer
 * names are user-chosen and are not trustworthy markup.
 */
export function esc(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Formats a whole number with thousands separators. */
export function num(value: number): string {
    return value.toLocaleString('en-US');
}

/** Formats fans compactly, e.g. "80.0M"; club totals stay in millions. */
export function compact(value: number): string {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return num(value);
}

/** Fans in millions with separators, e.g. "2,351.8M", matching the images' circle totals. */
export function millions(value: number): string {
    return `${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

/** An em dash for a missing value, matching the rendered images. */
export function dash(value: number | null | undefined): string {
    return value === null || value === undefined ? '\u2014' : num(value);
}

const STYLES = `
@font-face { font-family: "IBM Plex Sans JP"; font-weight: 400; src: url("/fonts/IBMPlexSansJP-Regular.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Sans JP"; font-weight: 700; src: url("/fonts/IBMPlexSansJP-Bold.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url("/fonts/IBMPlexMono-Regular.ttf") format("truetype"); font-display: swap; }
:root {
  /* Mirrors THEME in src/lib/image/theme.ts. Change both together. */
  --bg: #0a0e18; --surface: #111726; --surface-alt: #182036; --line: #242d47;
  --text: #e8ecf6; --muted: #98a2bb; --faint: #5f6986;
  --accent: #5aa9ff; --amber: #f2b84b; --red: #ff6b6b; --violet: #a78bfa;
  --p1: #f5c84c; --p2: #cfd6e4; --p3: #e0965f;
  --radius: 16px; --radius-sm: 10px;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; color: var(--text); font: 15px/1.55 "IBM Plex Sans JP", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
code { font: 13px "IBM Plex Mono", ui-monospace, monospace; color: var(--muted); background: var(--surface-alt); padding: 1px 6px; border-radius: 6px; }
.label { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }

header { display: flex; align-items: center; gap: 28px; padding: 14px 32px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: rgba(10,14,24,.88); backdrop-filter: blur(10px); z-index: 10; }
header .brand { color: var(--text); font-weight: 700; font-size: 18px; letter-spacing: .02em; display: flex; align-items: center; gap: 10px; }
header .brand::before { content: ""; width: 12px; height: 12px; border-radius: 4px; background: var(--accent); box-shadow: 0 0 14px rgba(90,169,255,.6); }
header nav { display: flex; gap: 6px; }
header nav a { color: var(--muted); font-size: 14px; font-weight: 700; padding: 7px 14px; border-radius: 999px; }
header nav a:hover { color: var(--text); background: var(--surface); text-decoration: none; }
header nav a.active { color: var(--text); background: var(--surface-alt); }
header .spacer { flex: 1; }
header .me { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
header .me img { width: 28px; height: 28px; border-radius: 50%; }
.badge { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; background: rgba(245,200,76,.14); color: var(--p1); }

main { max-width: 1440px; margin: 0 auto; padding: 36px 32px 64px; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 0 0 6px; }
h1 { font-size: 34px; font-weight: 700; line-height: 1.15; color: var(--text); margin: 0 0 8px; }
h2 { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 40px 0 14px; }
.sub { color: var(--muted); font-size: 15px; margin: 0 0 22px; }
.sub.gold { color: var(--muted); }
.rule { height: 1px; background: var(--line); margin: 14px 0 22px; }

.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.card { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px 22px; color: inherit; }
a.card { transition: border-color .15s, transform .15s; }
a.card:hover { border-color: rgba(90,169,255,.5); text-decoration: none; transform: translateY(-1px); }
.card h3 { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: var(--text); }
.card .meta, .meta { color: var(--faint); font-size: 13px; }
.card strong { font-size: 20px; }

.tiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin-bottom: 8px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; }
.tile .value { font-size: 30px; font-weight: 700; margin-top: 4px; color: var(--text); line-height: 1.2; }
.tile .detail { font-size: 13px; color: var(--faint); }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow-x: auto; padding: 6px 10px 10px; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th { text-align: left; font-weight: 700; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 12px 12px; white-space: nowrap; background: var(--surface-alt); }
th:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); } th:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
th.right, td.right { text-align: right; }
th[data-sort] { cursor: pointer; user-select: none; } th[data-sort]:hover { color: var(--text); }
th[data-sort].asc::after { content: " \\25B2"; color: var(--accent); } th[data-sort].desc::after { content: " \\25BC"; color: var(--accent); }
td { padding: 11px 12px; white-space: nowrap; }
tbody tr:nth-child(even) td { background: rgba(255,255,255,.022); }
tbody tr:hover td { background: var(--surface-alt); }
td:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); } td:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.name { font-weight: 700; } .name a { color: inherit; }
tr.p1 .name, tr.p1 .name a { color: var(--p1); } tr.p2 .name, tr.p2 .name a { color: var(--p2); } tr.p3 .name, tr.p3 .name a { color: var(--p3); }

.chip { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface-alt); color: var(--muted); font-size: 13px; font-weight: 700; }
.chip.p1 { background: rgba(245,200,76,.16); color: var(--p1); box-shadow: inset 0 0 0 1.5px rgba(245,200,76,.6); }
.chip.p2 { background: rgba(207,214,228,.16); color: var(--p2); box-shadow: inset 0 0 0 1.5px rgba(207,214,228,.6); }
.chip.p3 { background: rgba(224,150,95,.16); color: var(--p3); box-shadow: inset 0 0 0 1.5px rgba(224,150,95,.6); }
.move { font-size: 11px; font-weight: 700; margin-left: 8px; }
.pace { display: flex; align-items: center; gap: 12px; min-width: 210px; }
.bar { flex: 1; height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.bar > span { display: block; height: 100%; border-radius: 999px; min-width: 8px; }
.pace b { width: 46px; text-align: right; font-size: 14px; }
svg.spark { display: block; }

.accent, .good, .green { color: var(--accent); } .amber, .gold { color: var(--amber); } .red, .bad { color: var(--red); }
.muted { color: var(--muted); } .faint { color: var(--faint); }
strong { font-weight: 700; }
img.report { width: 100%; display: block; border-radius: var(--radius); }

form.inline { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
label { display: block; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
input, select { background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--text); padding: 10px 12px; font: inherit; min-width: 170px; }
input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(90,169,255,.18); }
button { background: var(--accent); color: #07101f; border: 0; border-radius: 999px; padding: 11px 20px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
button:hover { filter: brightness(1.08); }
button.secondary { background: var(--surface-alt); color: var(--text); }
button.danger { background: transparent; color: var(--red); box-shadow: inset 0 0 0 1px var(--red); }
.notice { padding: 12px 16px; margin-bottom: 20px; font-size: 14px; border-radius: var(--radius-sm); }
.notice.err { background: rgba(255,107,107,.1); color: var(--red); } .notice.ok { background: rgba(90,169,255,.1); color: var(--accent); }
.empty { padding: 44px; text-align: center; color: var(--faint); }
.months, .tabs { display: flex; gap: 6px; flex-wrap: wrap; font-size: 13px; font-weight: 700; margin: 0 0 18px; }
.months a, .tabs a { color: var(--muted); padding: 6px 12px; border-radius: 999px; }
.months a.on, .tabs a.on { color: var(--text); background: var(--surface-alt); }
.login { max-width: 420px; margin: 16vh auto; text-align: center; }
.login .card { padding: 42px 34px; }
.login button { width: 100%; margin-top: 22px; padding: 14px; }
@media (max-width: 720px) { header { flex-wrap: wrap; gap: 10px; padding: 12px 16px; } main { padding: 20px 16px 48px; } h1 { font-size: 26px; } }
`;

/**
 * Client-side table sorting. Numeric cells are compared as numbers after
 * stripping separators; anything else as text. Kept tiny and dependency-free.
 */
const SORT_SCRIPT = `
document.querySelectorAll('table[data-sortable]').forEach(function (table) {
  table.querySelectorAll('th[data-sort]').forEach(function (th, index) {
    th.addEventListener('click', function () {
      var tbody = table.tBodies[0]; if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.rows);
      var desc = !th.classList.contains('desc');
      table.querySelectorAll('th').forEach(function (h) { h.classList.remove('asc', 'desc'); });
      th.classList.add(desc ? 'desc' : 'asc');
      var val = function (row) {
        var cell = row.cells[index]; if (!cell) return '';
        var raw = (cell.getAttribute('data-value') || cell.textContent || '').trim();
        var n = parseFloat(raw.replace(/[,%]/g, ''));
        return raw === '\\u2014' ? -Infinity : (isNaN(n) ? raw.toLowerCase() : n);
      };
      rows.sort(function (a, b) {
        var x = val(a), y = val(b);
        if (typeof x === 'number' && typeof y === 'number') return desc ? y - x : x - y;
        return desc ? String(y).localeCompare(String(x)) : String(x).localeCompare(String(y));
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });
});`;

const NAV = [
    { key: 'overview', href: '/', label: 'Overview' },
    { key: 'timer', href: '/timer', label: 'Training' },
    { key: 'benchmark', href: '/benchmark', label: 'Benchmark' },
];

export interface LayoutOptions {
    title: string;
    user?: SessionUser | undefined;
    active?: string;
    body: string;
}

/** Wraps page content in the shared shell. */
export function layout({ title, user, active, body }: LayoutOptions): string {
    const nav = user
        ? NAV.map((item) => `<a href="${item.href}" class="${item.key === active ? 'active' : ''}">${esc(item.label)}</a>`).join('')
        : '';
    const me = user
        ? `<div class="me">${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="">` : ''}<span>${esc(user.displayName)}</span>${user.isOfficer ? '<span class="badge">Manager</span>' : ''}<a href="/logout">Sign out</a></div>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} \u00b7 Akikawa</title>
<style>${STYLES}</style>
</head>
<body>
<header><span class="brand">Akikawa</span><nav>${nav}</nav><span class="spacer"></span>${me}</header>
<main>${body}</main>
<script>${SORT_SCRIPT}</script>
</body>
</html>`;
}

/** Sign-in page. */
export function loginPage(error?: string): string {
    return layout({
        title: 'Sign in',
        body: `<div class="login"><div class="card">
          <h1>Akikawa</h1>
          <p class="sub">Club fan tracking and training stats.</p>
          ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
          <form method="get" action="/login"><button type="submit">Sign in with Discord</button></form>
        </div></div>`,
    });
}

/** A single headline figure. */
export function tile(label: string, value: string, detail?: string, tone?: string): string {
    return `<div class="tile"><div class="label">${esc(label)}</div><div class="value ${tone ?? ''}">${esc(value)}</div>${detail ? `<div class="detail">${esc(detail)}</div>` : ''}</div>`;
}

/** Rank in a circle; the top three take their place tint, as in the images. */
export function rankChip(rank: number): string {
    return `<span class="chip${rank <= 3 ? ` p${rank}` : ''}">${rank}</span>`;
}

/** Colour class for a percentage of target. Same thresholds as `paceColor`. */
export function paceTone(pct: number, closeAt = 90): 'accent' | 'amber' | 'red' {
    if (pct >= 100) return 'accent';
    if (pct >= closeAt) return 'amber';
    return 'red';
}

const TONE_VAR = { accent: 'var(--accent)', amber: 'var(--amber)', red: 'var(--red)' } as const;

/** Pill progress bar with its percentage. The bar is capped at full; the number is not. */
export function paceBar(pct: number, closeAt = 90): string {
    const tone = paceTone(pct, closeAt);
    const width = Math.max(0, Math.min(100, pct));
    return `<div class="pace"><div class="bar"><span style="width:${width.toFixed(1)}%;background:${TONE_VAR[tone]}"></span></div><b class="${tone}">${Math.floor(pct)}%</b></div>`;
}

/**
 * Inline SVG trend line of recent daily gains, scaled to the member's own
 * range like the image sparkline. The last point is blue if it rose, red if
 * it fell.
 */
export function sparkline(gains: number[], width = 110, height = 26): string {
    if (gains.length < 2) return '<span class="faint">—</span>';
    const max = Math.max(...gains);
    const min = Math.min(...gains);
    const span = max - min || 1;
    const pad = 4;
    const step = (width - pad * 2) / (gains.length - 1);
    const pts = gains.map((g, i) => [pad + i * step, pad + (height - pad * 2) * (1 - (g - min) / span)] as const);
    const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const [lx, ly] = pts[pts.length - 1]!;
    const rising = (gains[gains.length - 1] ?? 0) >= (gains[gains.length - 2] ?? 0);
    return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="var(--muted)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" opacity=".8"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="var(${rising ? '--accent' : '--red'})"/></svg>`;
}

/** A hidden CSRF field for a form post. */
export function csrfField(token: string): string {
    return `<input type="hidden" name="_csrf" value="${esc(token)}">`;
}

/** Month links for browsing a circle's history. */
export function monthPicker(base: string, months: { year: number; month: number }[], selected: { year: number; month: number }): string {
    if (months.length <= 1) return '';
    const name = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `<div class="months">${months
        .map((m) => {
            const on = m.year === selected.year && m.month === selected.month;
            return `<a class="${on ? 'on' : ''}" href="${esc(base)}?year=${m.year}&month=${m.month}">${name(m.month)} ${m.year}</a>`;
        })
        .join('')}</div>`;
}
