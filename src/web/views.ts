import type { SessionUser } from './auth';

/**
 * Server-rendered HTML for the dashboard.
 *
 * Plain template literals rather than a view library: the dashboard is a
 * handful of pages, and the bot already carries enough dependencies. Charts
 * reuse the bot's own PNG renderers, served as images, so every figure has
 * exactly one implementation. The stylesheet mirrors `src/lib/image/theme.ts`
 * so the dashboard and the rendered images read as one system.
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

/** An em dash for a missing value, matching the rendered images. */
export function dash(value: number | null | undefined): string {
    return value === null || value === undefined ? '\u2014' : num(value);
}

const STYLES = `
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url("/fonts/IBMPlexMono-Regular.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; src: url("/fonts/IBMPlexMono-Medium.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; font-weight: 700; src: url("/fonts/IBMPlexMono-Bold.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Sans JP"; font-weight: 400; src: url("/fonts/IBMPlexSansJP-Regular.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "IBM Plex Sans JP"; font-weight: 700; src: url("/fonts/IBMPlexSansJP-Bold.ttf") format("truetype"); font-display: swap; }
:root {
  --bg: #0c0b0b; --raised: #121010; --line: #1e1b19;
  --gold: #d4a54a; --gold-dim: rgba(212,165,74,.55);
  --text: #e9e6df; --muted: #8b877f; --faint: #5e5b55;
  --red: #d0584c; --green: #8fbf6a;
  --p1: #e9c8f2; --p2: #d4a54a; --p3: #d5d6dc; --p4: #c97c4c;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; color: var(--text); font: 14px/1.55 "IBM Plex Mono", "IBM Plex Sans JP", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
a { color: var(--gold); text-decoration: none; } a:hover { text-decoration: underline; }
code { font: inherit; color: var(--muted); }
.label { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
header { display: flex; align-items: center; gap: 28px; padding: 16px 32px; border-bottom: 1px solid var(--gold-dim); position: sticky; top: 0; background: var(--bg); z-index: 10; }
header .brand { color: var(--gold); font-weight: 500; font-size: 15px; letter-spacing: .28em; text-transform: uppercase; }
header nav { display: flex; gap: 22px; }
header nav a { color: var(--muted); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; padding: 4px 0; }
header nav a.active { color: var(--text); box-shadow: inset 0 -1px 0 var(--gold); }
header .spacer { flex: 1; }
header .me { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); }
header .me img { width: 24px; height: 24px; }
.badge { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 2px 8px; border: 1px solid var(--gold-dim); color: var(--gold); }
main { max-width: 1440px; margin: 0 auto; padding: 32px; }
h1 { font-size: 26px; font-weight: 500; letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin: 0 0 6px; }
h2 { font-size: 11px; font-weight: 400; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); margin: 40px 0 12px; }
.sub { color: var(--muted); font-size: 13px; margin: 0 0 22px; }
.sub.gold { color: var(--gold); }
.rule { height: 1px; background: var(--gold-dim); margin: 14px 0 22px; }
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.card { display: block; background: var(--raised); border: 1px solid var(--line); padding: 18px 20px; color: inherit; }
.card:hover { border-color: var(--gold-dim); text-decoration: none; }
.card h3 { margin: 0 0 6px; font-size: 16px; font-weight: 500; color: var(--text); }
.card .meta { color: var(--faint); font-size: 12px; }
.tiles { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 6px; }
.tile { background: var(--raised); border: 1px solid var(--line); padding: 16px 18px; }
.tile .value { font-size: 26px; font-weight: 700; margin-top: 6px; color: var(--text); }
.tile .detail { font-size: 12px; color: var(--faint); }
.panel { border-top: 1px solid var(--gold-dim); overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 400; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); padding: 12px 12px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th.right, td.right { text-align: right; }
th[data-sort] { cursor: pointer; user-select: none; } th[data-sort]:hover { color: var(--text); }
th[data-sort].asc::after { content: " \\2191"; color: var(--gold); } th[data-sort].desc::after { content: " \\2193"; color: var(--gold); }
td { padding: 11px 12px; border-bottom: 1px solid var(--line); }
tbody tr:hover td { background: var(--raised); }
tr.p1 td:first-child, tr.p2 td:first-child, tr.p3 td:first-child, tr.p4 td:first-child, tr.behind td:first-child { box-shadow: inset 3px 0 0 var(--bar); }
tr.p1 { --bar: var(--p1); } tr.p2 { --bar: var(--p2); } tr.p3 { --bar: var(--p3); } tr.p4 { --bar: var(--p4); } tr.behind { --bar: var(--red); }
tr.p1 .name { color: var(--p1); } tr.p2 .name { color: var(--p2); } tr.p3 .name { color: var(--p3); } tr.p4 .name { color: var(--p4); }
.muted { color: var(--muted); } .faint { color: var(--faint); } .gold { color: var(--gold); } .red { color: var(--red); } .green { color: var(--green); }
strong { font-weight: 700; }
img.report { width: 100%; display: block; border: 1px solid var(--line); }
form.inline { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
label { display: block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
input, select { background: var(--bg); border: 1px solid var(--line); color: var(--text); padding: 9px 11px; font: inherit; min-width: 160px; }
input:focus, select:focus { outline: none; border-color: var(--gold-dim); }
button { background: var(--gold); color: #0c0b0b; border: 0; padding: 10px 18px; font: inherit; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; cursor: pointer; }
button.secondary { background: transparent; color: var(--text); border: 1px solid var(--line); }
button.danger { background: transparent; color: var(--red); border: 1px solid var(--red); }
.notice { padding: 12px 16px; margin-bottom: 20px; font-size: 13px; border: 1px solid; }
.notice.err { border-color: var(--red); color: var(--red); } .notice.ok { border-color: var(--green); color: var(--green); }
.empty { padding: 44px; text-align: center; color: var(--faint); }
.months { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 18px; }
.months a { color: var(--muted); } .months a.on { color: var(--gold); box-shadow: inset 0 -1px 0 var(--gold); }
.login { max-width: 420px; margin: 16vh auto; text-align: center; }
.login .card { padding: 40px 34px; }
.login button { width: 100%; margin-top: 22px; padding: 13px; }
@media (max-width: 720px) { header { flex-wrap: wrap; gap: 12px; padding: 12px 16px; } main { padding: 16px; } h1 { font-size: 20px; } }
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
