import type { SessionUser } from './auth';

/**
 * Server-rendered HTML for the dashboard.
 *
 * Plain template literals rather than a view library: the dashboard is a
 * handful of pages, and the bot already carries enough dependencies. Charts
 * reuse the bot's own PNG renderers, served as images, so there is exactly one
 * implementation of every figure.
 */

/**
 * Escapes text for HTML.
 *
 * Every interpolation of external data — trainer names, circle names, anything
 * from uma.moe or Discord — must go through this. Umamusume trainer names are
 * user-chosen and are not trustworthy markup.
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

/** Formats fans compactly, e.g. "80.0M". */
export function compact(value: number): string {
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return num(value);
}

const STYLES = `
:root {
  --bg: #0d0e15; --panel: #161823; --panel-2: #1c1f2c;
  --line: rgba(255,255,255,0.08);
  --text: #e6e6e6; --muted: #9ba3b4; --faint: #6b7280;
  --accent: #58a6ff; --good: #3fb950; --warn: #e0a33e; --bad: #f85149; --gold: #ffd166;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  display: flex; align-items: center; gap: 24px;
  padding: 14px 28px; background: var(--panel); border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 10;
}
header .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.2px; }
header nav { display: flex; gap: 18px; margin-left: 12px; }
header nav a { color: var(--muted); font-size: 14px; padding: 4px 0; }
header nav a.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
header .spacer { flex: 1; }
header .me { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
header .me img { width: 26px; height: 26px; border-radius: 50%; }
.badge {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
  padding: 2px 7px; border-radius: 999px; background: rgba(88,166,255,.15); color: var(--accent);
}
main { max-width: 1400px; margin: 0 auto; padding: 28px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.4px; }
h2 { font-size: 18px; margin: 32px 0 12px; }
.sub { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px;
}
.card h3 { margin: 0 0 4px; font-size: 16px; }
.card .meta { color: var(--faint); font-size: 13px; }
.tiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin-bottom: 8px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.tile .label { font-size: 11px; font-weight: 700; letter-spacing: .6px; color: var(--faint); text-transform: uppercase; }
.tile .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
.tile .detail { font-size: 12px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th {
  text-align: left; font-size: 11px; letter-spacing: .6px; text-transform: uppercase;
  color: var(--faint); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap;
}
td { padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
tbody tr:hover { background: rgba(255,255,255,0.03); }
.right { text-align: right; }
.muted { color: var(--muted); } .faint { color: var(--faint); }
.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.dot.ok { background: #3b82f6; } .dot.behind { background: var(--bad); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
img.report { width: 100%; border-radius: 12px; border: 1px solid var(--line); display: block; }
form.inline { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
input, select {
  background: var(--panel-2); border: 1px solid var(--line); color: var(--text);
  border-radius: 8px; padding: 8px 10px; font: inherit; min-width: 150px;
}
button {
  background: var(--accent); color: #0b0c12; border: 0; border-radius: 8px;
  padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
button.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); }
button.danger { background: var(--bad); color: #fff; }
.notice { padding: 12px 16px; border-radius: 10px; margin-bottom: 20px; font-size: 14px; }
.notice.err { background: rgba(248,81,73,.12); border: 1px solid rgba(248,81,73,.3); }
.notice.ok { background: rgba(63,185,80,.12); border: 1px solid rgba(63,185,80,.3); }
.empty { padding: 40px; text-align: center; color: var(--faint); }
.login { max-width: 420px; margin: 14vh auto; text-align: center; }
.login .card { padding: 34px; }
.login button { width: 100%; margin-top: 18px; padding: 12px; font-size: 15px; }
@media (max-width: 720px) {
  header { flex-wrap: wrap; gap: 12px; padding: 12px 16px; }
  main { padding: 16px; }
  .panel { overflow-x: auto; }
}
`;

/** Navigation entries. `key` matches the `active` argument to `layout`. */
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
        ? NAV.map(
              (item) =>
                  `<a href="${item.href}" class="${item.key === active ? 'active' : ''}">${esc(item.label)}</a>`,
          ).join('')
        : '';

    const me = user
        ? `<div class="me">
             ${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="">` : ''}
             <span>${esc(user.displayName)}</span>
             ${user.isOfficer ? '<span class="badge">Manager</span>' : ''}
             <a href="/logout">Sign out</a>
           </div>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Akikawa</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <span class="brand">Akikawa</span>
  <nav>${nav}</nav>
  <span class="spacer"></span>
  ${me}
</header>
<main>${body}</main>
</body>
</html>`;
}

/** Sign-in page. */
export function loginPage(error?: string): string {
    return layout({
        title: 'Sign in',
        body: `<div class="login">
          <div class="card">
            <h1>Akikawa</h1>
            <p class="sub">Club fan tracking and training stats.</p>
            ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
            <form method="get" action="/login">
              <button type="submit">Sign in with Discord</button>
            </form>
          </div>
        </div>`,
    });
}

/** A single headline figure. */
export function tile(label: string, value: string, detail?: string, tone?: string): string {
    return `<div class="tile">
      <div class="label">${esc(label)}</div>
      <div class="value ${tone ?? ''}">${esc(value)}</div>
      ${detail ? `<div class="detail">${esc(detail)}</div>` : ''}
    </div>`;
}

/** A hidden CSRF field for a form post. */
export function csrfField(token: string): string {
    return `<input type="hidden" name="_csrf" value="${esc(token)}">`;
}
