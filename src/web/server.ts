import express, { type Request, type Response } from 'express';
import * as path from 'path';
import cookieParser from 'cookie-parser';
import type { Client } from 'discord.js';
import { prisma } from '../db/prisma';
import {
    beginLogin,
    completeLogin,
    csrfToken,
    loadWebConfig,
    logout,
    requireLogin,
    requireOfficer,
    sessionMiddleware,
    verifyCsrf,
    type WebConfig,
} from './auth';
import { csrfField, compact, dash, esc, layout, loginPage, monthPicker, num, tile } from './views';
import { currentGameMonth, loadCircleProgress, syncBenchmark, syncCircle } from '../lib/fans/ingest';
import { TRAINER_WINDOW_DAYS, buildBenchmark, buildTrainerReport, currentCircleProgress, formatReportDate, listCircleMonths } from '../lib/fans/reports';
import { toSafeNumber, type CircleProgress } from '../lib/fans/metrics';
import { parseQuota } from '../commands/fans';
import { renderFanReport } from '../lib/image/renderFanReport';
import { renderTrainerReport } from '../lib/image/renderTrainerReport';
import { renderBenchmark } from '../lib/image/renderBenchmark';
import { renderTimerLeaderboard } from '../lib/image/renderTimerLeaderboard';
import { getLeaderboard, getPanelContext, type LeaderboardPeriod } from '../lib/timer/service';

/**
 * The self-hosted dashboard.
 *
 * Runs in the bot's own process, so there is one container, one database
 * connection pool, and no way for the dashboard's view of the data to drift
 * from the bot's. Charts are served by the same renderers the bot posts to
 * Discord, so every figure has exactly one implementation.
 *
 * Reading is open to any member of the guild; every mutation requires a Club
 * Manager role and a CSRF token.
 */

/** Cache lifetime for rendered PNGs. Data refreshes daily, so this is generous. */
const IMAGE_CACHE_SECONDS = 120;

/**
 * Reads a route parameter as a string.
 *
 * Express 5 types params as `string | string[] | undefined`, which no query or
 * validation here accepts. Anything unexpected collapses to the empty string
 * and then fails the lookup or the digit check below it.
 */
function param(req: Request, name: string): string {
    const value = req.params[name];
    return typeof value === 'string' ? value : '';
}

/** Sends a rendered PNG with caching headers. */
function sendPng(res: Response, buffer: Buffer) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', `private, max-age=${IMAGE_CACHE_SECONDS}`);
    res.send(buffer);
}

/** Renders a page, or a friendly 404 body. */
function notFound(res: Response, user: Request['user'], message: string) {
    res.status(404).send(
        layout({
            title: 'Not found',
            user,
            body: `<h1>Not found</h1><p class="sub">${esc(message)}</p><p><a href="/">Back to overview</a></p>`,
        }),
    );
}

/** Bundled fonts, served to the browser so the dashboard matches the images. */
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

/**
 * Game month selected by `?year=&month=`, falling back to the current one.
 * Out-of-range values fall back rather than erroring: a mistyped URL should
 * show this month, not a 400.
 */
function selectedMonth(req: Request): { year: number; month: number } {
    const current = currentGameMonth();
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (Number.isInteger(year) && year >= 2020 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12) {
        return { year, month };
    }
    return { year: current.year, month: current.month };
}

/** Reads a one-shot status message passed back after a redirect. */
function flash(req: Request): string {
    const ok = typeof req.query.ok === 'string' ? req.query.ok : null;
    const err = typeof req.query.err === 'string' ? req.query.err : null;
    if (ok) return `<div class="notice ok">${esc(ok)}</div>`;
    if (err) return `<div class="notice err">${esc(err)}</div>`;
    return '';
}

/** Builds the member table shared by the circle page. */
function memberRows(progress: CircleProgress, circleId: string): string {
    return progress.members
        .map((m) => {
            const movement =
                m.rankChange === null || m.rankChange === 0
                    ? ''
                    : ` <span class="${m.rankChange > 0 ? 'gold' : 'red'}">${m.rankChange > 0 ? '\u2191' : '\u2193'}${Math.abs(m.rankChange)}</span>`;
            // Row class drives the left bar: placement tint for the top four,
            // red for anyone behind, nothing otherwise.
            const cls = m.rank <= 4 ? `p${m.rank}` : m.onPace ? '' : 'behind';
            const projTone = m.projectedTotal >= progress.effectiveQuota ? 'green' : m.onPace ? 'muted' : 'red';

            return `<tr class="${cls}">
        <td class="faint" data-value="${m.rank}">${m.rank}${movement}</td>
        <td class="name"><a href="/circles/${esc(circleId)}/trainers/${m.viewerId}">${esc(m.trainerName)}</a></td>
        <td class="right"><strong>${num(m.total)}</strong></td>
        <td class="right faint">${num(m.expected)}</td>
        <td class="right ${m.behind > 0 ? 'red' : 'faint'}">${dash(m.behind > 0 ? m.behind : null)}</td>
        <td class="right muted">${num(m.avgPerDay)}</td>
        <td class="right ${m.needPerDay !== null ? 'gold' : 'faint'}">${dash(m.needPerDay)}</td>
        <td class="right muted">${num(m.latestDayGain)}</td>
        <td class="right ${projTone}">${compact(m.projectedTotal)}</td>
      </tr>`;
        })
        .join('');
}

/**
 * Health check for the hosting platform.
 *
 * Deliberately unauthenticated and registered before every other route: the
 * platform probes it without a session, and a probe that redirected to the
 * login flow would be read as an unhealthy container and restart-loop the bot.
 * It verifies the database too, so a deploy that cannot reach Postgres is
 * reported as failed rather than silently serving errors.
 *
 * Served whether or not the dashboard is configured. The health of the bot --
 * connected to Discord, database reachable -- is independent of whether
 * someone has set up OAuth yet, and the platform's deploy gate must reflect
 * the former, not the latter.
 */
function registerHealthCheck(app: express.Express, client: Client) {
    // Railway injects the deployed commit; reporting it makes "which build is
    // actually running" answerable with one curl instead of guesswork.
    const commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'unknown').slice(0, 7);

    app.get('/healthz', async (_req, res) => {
        try {
            await prisma.$queryRaw`SELECT 1`;
            res.json({ ok: true, discord: client.isReady(), commit });
        } catch {
            res.status(503).json({ ok: false, error: 'database unreachable', commit });
        }
    });
}

/** Port to bind, whether or not the dashboard is configured. */
function resolvePort(): number {
    return Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 3000);
}

/**
 * Minimal server for when the dashboard is not configured.
 *
 * Exists so the platform health check passes and a visitor to the public URL
 * sees why there is no dashboard, instead of a bare 502. Without this, a bot
 * that is fully working on Discord would fail its deploy gate purely for
 * lacking an OAuth client secret.
 */
function startFallbackServer(client: Client, missing: string[]): () => void {
    const app = express();
    app.set('trust proxy', 1);
    registerHealthCheck(app, client);

    app.get('/', (_req, res) => {
        res.status(503).send(
            layout({
                title: 'Dashboard not configured',
                body: `<h1>Dashboard not configured</h1>
          <p class="sub">The bot is running, but the dashboard needs these variables:</p>
          <ul>${missing.map((m) => `<li><code>${esc(m)}</code></li>`).join('')}</ul>
          <p class="sub">See <code>.env.example</code>. The bot's Discord features are unaffected.</p>`,
            }),
        );
    });

    app.use((_req, res) => res.status(404).end());

    const port = resolvePort();
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Health check listening on 0.0.0.0:${port} (dashboard disabled)`);
    });
    return () => server.close();
}

/** Builds and starts the dashboard. Returns null when it is not configured. */
export function startDashboard(client: Client): () => void {
    let config: WebConfig | null;
    try {
        config = loadWebConfig();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('Dashboard configuration is invalid:', message);
        return startFallbackServer(client, [message]);
    }

    if (!config) {
        // Name exactly what is missing. "Dashboard disabled" on its own sent an
        // operator hunting through five variables when only one was absent.
        const missing = [
            !process.env.DISCORD_CLIENT_ID && 'DISCORD_CLIENT_ID',
            !process.env.DISCORD_CLIENT_SECRET && 'DISCORD_CLIENT_SECRET (OAuth2 client secret, not the bot token)',
            !process.env.DASHBOARD_BASE_URL && !process.env.RAILWAY_PUBLIC_DOMAIN && 'DASHBOARD_BASE_URL (or a Railway public domain)',
            !process.env.DASHBOARD_GUILD_ID && !process.env.DEV_GUILD_ID && 'DASHBOARD_GUILD_ID (or DEV_GUILD_ID)',
        ].filter((m): m is string => Boolean(m));
        console.log(`Dashboard disabled. Missing: ${missing.join(', ')}.`);
        return startFallbackServer(client, missing);
    }

    const cfg = config;
    const app = express();

    // Behind a reverse proxy, trust its forwarded headers so redirects and
    // secure-cookie decisions use the external scheme, not the internal one.
    app.set('trust proxy', 1);
    app.use('/fonts', express.static(FONT_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));
    app.use(cookieParser());
    app.use(express.urlencoded({ extended: false }));
    app.use(sessionMiddleware(cfg));

    const guildId = cfg.guildId;
    const csrf = (req: Request) => (req.user ? csrfToken(req.user, cfg.sessionSecret) : '');

    registerHealthCheck(app, client);

    // ── Auth ──────────────────────────────────────────────────────────────────
    app.get('/login', (req, res) => beginLogin(cfg, req, res));

    app.get('/auth/callback', async (req, res) => {
        const error = await completeLogin(cfg, req, res);
        if (error) return res.status(403).send(loginPage(error));
        return res.redirect('/');
    });

    app.get('/logout', (_req, res) => {
        logout(res);
        res.redirect('/');
    });

    // ── Overview ──────────────────────────────────────────────────────────────
    app.get('/', async (req, res) => {
        if (!req.user) return res.send(loginPage());

        const circles = await prisma.trackedCircle.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
        const timerContext = await getPanelContext(guildId);
        const activeTimers = await prisma.trainingTimer.count({ where: { guildId } });

        const cards = await Promise.all(
            circles.map(async (circle) => {
                const progress = await currentCircleProgress(circle);
                const behind = progress?.members.filter((m) => !m.onPace).length ?? 0;
                const total = progress?.totalFans ?? 0;

                return `<a class="card" href="/circles/${esc(circle.id)}" style="display:block">
                  <h3>${esc(circle.name)}${circle.active ? '' : ' <span class="faint">(paused)</span>'}</h3>
                  <div class="meta">
                    Quota ${esc(compact(toSafeNumber(circle.monthlyQuota)))} / member / month<br>
                    ${progress ? `${progress.members.length} members · day ${progress.daysElapsed}/${progress.daysInMonth}` : 'No data ingested yet'}
                  </div>
                  <div style="margin-top:12px;display:flex;gap:24px">
                    <div><div class="label">Total</div><strong>${esc(compact(total))}</strong></div>
                    <div><div class="label">Behind</div><strong class="${behind > 0 ? 'red' : 'green'}">${behind}</strong></div>
                  </div>
                </a>`;
            }),
        );

        return res.send(
            layout({
                title: 'Overview',
                user: req.user,
                active: 'overview',
                body: `${flash(req)}
          <h1>Overview</h1>
          <p class="sub">Club fan quotas and training activity.</p>
          <div class="tiles">
            ${tile('Tracked circles', String(circles.length))}
            ${tile('Training now', String(activeTimers), 'active timers')}
            ${tile('Runs today', String(timerContext.runsToday), 'server-wide')}
          </div>
          <h2>Circles</h2>
          ${
              circles.length === 0
                  ? `<div class="panel"><div class="empty">No circles tracked yet.${req.user.isOfficer ? ' Add one below.' : ' A Club Manager can add one.'}</div></div>`
                  : `<div class="grid">${cards.join('')}</div>`
          }
          ${
              req.user.isOfficer
                  ? `<h2>Track a new circle</h2>
                 <div class="card">
                   <form class="inline" method="post" action="/circles">
                     ${csrfField(csrf(req))}
                     <div><label>uma.moe circle ID</label><input name="circle_id" required placeholder="123456"></div>
                     <div><label>Monthly quota per member</label><input name="quota" required placeholder="80M"></div>
                     <button type="submit">Add circle</button>
                   </form>
                   <p class="meta" style="margin-top:10px">Find the ID at <a href="https://uma.moe/circles" target="_blank" rel="noopener">uma.moe/circles</a>.</p>
                 </div>`
                  : ''
          }`,
            }),
        );
    });

    // ── Circle detail ─────────────────────────────────────────────────────────
    app.get('/circles/:id', requireLogin, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return notFound(res, req.user, 'That circle is not tracked.');

        const { year, month } = selectedMonth(req);
        const progress = await loadCircleProgress(circle, year, month);
        const months = await listCircleMonths(circle);
        const picker = monthPicker(`/circles/${circle.id}`, months, { year, month });

        const admin = req.user?.isOfficer
            ? `<h2>Settings</h2>
         <div class="card">
           <form class="inline" method="post" action="/circles/${esc(circle.id)}">
             ${csrfField(csrf(req))}
             <div><label>Monthly quota per member</label><input name="quota" value="${esc(compact(toSafeNumber(circle.monthlyQuota)))}"></div>
             <div><label>Report channel ID</label><input name="report_channel" value="${esc(circle.reportChannelId ?? '')}" placeholder="thread or channel ID"></div>
             <div><label>Alert channel ID</label><input name="alert_channel" value="${esc(circle.alertChannelId ?? '')}" placeholder="thread or channel ID"></div>
             <div><label>Syncing</label><select name="active">
               <option value="true"${circle.active ? ' selected' : ''}>Active</option>
               <option value="false"${circle.active ? '' : ' selected'}>Paused</option>
             </select></div>
             <button type="submit">Save</button>
           </form>
           <div style="display:flex;gap:10px;margin-top:16px">
             <form method="post" action="/circles/${esc(circle.id)}/sync">${csrfField(csrf(req))}<button class="secondary" type="submit">Sync now</button></form>
             <form method="post" action="/circles/${esc(circle.id)}/delete" onsubmit="return confirm('Stop tracking this circle and delete its snapshots?')">${csrfField(csrf(req))}<button class="danger" type="submit">Stop tracking</button></form>
           </div>
         </div>`
            : '';

        return res.send(
            layout({
                title: circle.name,
                user: req.user,
                body: `${flash(req)}
          <h1>${esc(circle.name)}</h1>
          <p class="sub gold">day ${progress?.daysElapsed ?? 0} of ${progress?.daysInMonth ?? '\u2014'} · quota ${esc(compact(toSafeNumber(circle.monthlyQuota)))} per member · ${progress ? esc(compact(progress.quotaPerDay)) : '\u2014'}/day</p>
          <p class="sub">circle <code>${esc(String(circle.circleId))}</code> · last sync ${circle.lastSyncedAt ? esc(circle.lastSyncedAt.toUTCString()) : 'never'}</p>
          ${picker}
          ${
              progress
                  ? `<div class="tiles">
                   ${tile('Members', String(progress.members.length))}
                   ${tile('Total fans', compact(progress.totalFans))}
                   ${tile('Behind quota', String(progress.members.filter((m) => !m.onPace).length), 'of ' + progress.members.length, progress.members.some((m) => !m.onPace) ? 'bad' : 'good')}
                   ${tile('Day', `${progress.daysElapsed}/${progress.daysInMonth}`, formatReportDate(year, month, progress.daysElapsed))}
                 </div>
                 <h2>Members</h2>
                 <div class="panel">
                   <table data-sortable>
                     <thead><tr>
                       <th data-sort>#</th><th data-sort>Trainer</th><th class="right" data-sort>Total</th><th class="right" data-sort>Expected</th>
                       <th class="right" data-sort>Behind</th><th class="right" data-sort>Avg/Day</th><th class="right" data-sort>Need/Day</th>
                       <th class="right" data-sort>Day ${progress.daysElapsed}</th><th class="right" data-sort>Proj.</th>
                     </tr></thead>
                     <tbody>${memberRows(progress, circle.id)}</tbody>
                   </table>
                 </div>
                 <h2>Report image</h2>
                 <img class="report" src="/circles/${esc(circle.id)}/report.png?year=${year}&month=${month}" alt="Fan quota report">`
                  : `<div class="panel"><div class="empty">No fan data ingested yet.${req.user?.isOfficer ? ' Use “Sync now” below.' : ''}</div></div>`
          }
          ${admin}`,
            }),
        );
    });

    app.get('/circles/:id/report.png', requireLogin, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return res.status(404).end();

        const { year, month } = selectedMonth(req);
        const progress = await loadCircleProgress(circle, year, month);
        if (!progress) return res.status(404).end();

        return sendPng(
            res,
            await renderFanReport(progress, {
                circleName: circle.name,
                monthlyRank: circle.monthlyRank,
                memberCount: progress.members.length,
                dateLabel: formatReportDate(year, month, progress.daysElapsed),
            }),
        );
    });

    // ── Trainer detail ────────────────────────────────────────────────────────
    app.get('/circles/:id/trainers/:viewerId', requireLogin, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return notFound(res, req.user, 'That circle is not tracked.');

        if (!/^\d+$/.test(param(req, 'viewerId'))) return notFound(res, req.user, 'Invalid trainer ID.');
        const viewerId = BigInt(param(req, 'viewerId'));

        const report = await buildTrainerReport(circle, viewerId, 30, await currentCircleProgress(circle));
        if (!report) return notFound(res, req.user, 'No data for that trainer this month.');

        const link = await prisma.trainerLink.findFirst({ where: { guildId, viewerId } });

        const rows = [...report.dailyGains]
            .reverse()
            .map(
                (d) => `<tr><td>${esc(d.label)}</td><td class="right">${num(d.gain)}</td><td class="right muted">${esc(compact(d.gain))}</td></tr>`,
            )
            .join('');

        const linkForm = req.user?.isOfficer
            ? `<h2>Discord link</h2>
         <div class="card">
           <p class="meta">${link ? `Linked to Discord user <code>${esc(link.discordUserId)}</code>.` : 'Not linked to a Discord account.'}</p>
           <form class="inline" method="post" action="/links" style="margin-top:10px">
             ${csrfField(csrf(req))}
             <input type="hidden" name="viewer_id" value="${esc(String(viewerId))}">
             <input type="hidden" name="return_to" value="/circles/${esc(circle.id)}/trainers/${esc(String(viewerId))}">
             <div><label>Discord user ID</label><input name="discord_user_id" value="${esc(link?.discordUserId ?? '')}" placeholder="18-digit ID"></div>
             <button type="submit">${link ? 'Update link' : 'Link'}</button>
           </form>
         </div>`
            : '';

        return res.send(
            layout({
                title: report.trainerName,
                user: req.user,
                body: `${flash(req)}
          <h1>${esc(report.trainerName)}</h1>
          <p class="sub">${esc(circle.name)} · trainer <code>${esc(String(viewerId))}</code></p>
          <img class="report" src="/circles/${esc(circle.id)}/trainers/${esc(String(viewerId))}/report.png" alt="Trainer report">
          <h2>Daily gains</h2>
          <div class="panel">
            <table><thead><tr><th>Day</th><th class="right">Fans gained</th><th class="right"></th></tr></thead>
            <tbody>${rows}</tbody></table>
          </div>
          ${linkForm}`,
            }),
        );
    });

    app.get('/circles/:id/trainers/:viewerId/report.png', requireLogin, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle || !/^\d+$/.test(param(req, 'viewerId'))) return res.status(404).end();

        const report = await buildTrainerReport(circle, BigInt(param(req, 'viewerId')), TRAINER_WINDOW_DAYS, await currentCircleProgress(circle));
        if (!report) return res.status(404).end();
        return sendPng(res, await renderTrainerReport(report));
    });

    // ── Benchmark ─────────────────────────────────────────────────────────────
    /** First tracked circle for the guild, for the benchmark overlay. */
    const overlayCircle = () =>
        prisma.trackedCircle.findFirst({ where: { guildId, active: true }, orderBy: { createdAt: 'asc' } });

    app.get('/benchmark', requireLogin, async (req, res) => {
        const data = await buildBenchmark(TRAINER_WINDOW_DAYS, await overlayCircle());
        return res.send(
            layout({
                title: 'Benchmark',
                user: req.user,
                active: 'benchmark',
                body: `<h1>Benchmark</h1>
          <p class="sub">What it currently takes to sit inside the top circles, in fans per member per day.</p>
          <div class="tiles">
            ${data.current.map((t) => tile(`Top ${t.tier} entry`, num(t.entry), `avg ${num(t.average)}`)).join('')}
          </div>
          <img class="report" src="/benchmark.png" alt="Benchmark">
          ${data.historyNote ? `<p class="sub" style="margin-top:14px">${esc(data.historyNote)}</p>` : ''}`,
            }),
        );
    });

    app.get('/benchmark.png', requireLogin, async (_req, res) =>
        sendPng(res, await renderBenchmark(await buildBenchmark(TRAINER_WINDOW_DAYS, await overlayCircle()))),
    );

    // ── Training ──────────────────────────────────────────────────────────────
    app.get('/timer', requireLogin, async (req, res) => {
        const period = (typeof req.query.period === 'string' ? req.query.period : 'week') as LeaderboardPeriod;
        const valid: LeaderboardPeriod[] = ['week', 'month', 'all'];
        const selected = valid.includes(period) ? period : 'week';

        const rows = await getLeaderboard(guildId, selected, 50);
        const context = await getPanelContext(guildId);
        const active = await prisma.trainingTimer.findMany({ where: { guildId }, orderBy: { expiresAt: 'asc' } });

        // Same resolution the leaderboard image uses: the bot's member cache,
        // falling back to the ID for anyone not cached.
        const guild = client.guilds.cache.get(guildId);
        const nameOf = (id: string) => guild?.members.cache.get(id)?.displayName ?? id;

        const body = rows
            .map(
                (r, i) =>
                    `<tr class="${i < 4 ? `p${i + 1}` : ''}"><td class="faint" data-value="${i + 1}">${i + 1}</td><td class="name">${esc(nameOf(r.discordUserId))}</td>
           <td class="right"><strong>${num(r.runs)}</strong></td>
           <td class="right muted">${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m</td></tr>`,
            )
            .join('');

        return res.send(
            layout({
                title: 'Training',
                user: req.user,
                active: 'timer',
                body: `<h1>Independent Training</h1>
          <p class="sub">50-minute runs tracked by the timer panel.</p>
          <div class="tiles">
            ${tile('Training now', String(active.length))}
            ${tile('Runs today', String(context.runsToday))}
            ${tile('Trainers ranked', String(rows.length))}
          </div>
          <h2>Leaderboard</h2>
          <p class="sub">
            ${valid.map((p) => `<a href="/timer?period=${p}" ${p === selected ? 'style="color:var(--text)"' : ''}>${p === 'all' ? 'All time' : p === 'week' ? 'Last 7 days' : 'Last 30 days'}</a>`).join(' · ')}
          </p>
          <div class="panel">
            ${rows.length === 0 ? '<div class="empty">No runs recorded in this period.</div>' : `<table data-sortable><thead><tr><th data-sort>#</th><th data-sort>Trainer</th><th class="right" data-sort>Runs</th><th class="right" data-sort>Time</th></tr></thead><tbody>${body}</tbody></table>`}
          </div>`,
            }),
        );
    });

    app.get('/timer/leaderboard.png', requireLogin, async (req, res) => {
        const rows = await getLeaderboard(guildId, 'week', 20);
        const names = new Map<string, string>();

        // Resolve display names through the bot's cache; the dashboard has no
        // Discord token of its own.
        const guild = client.guilds.cache.get(guildId);
        for (const row of rows) {
            names.set(row.discordUserId, guild?.members.cache.get(row.discordUserId)?.displayName ?? row.discordUserId);
        }
        return sendPng(res, await renderTimerLeaderboard(rows, names, 'week'));
    });

    // ── Mutations ─────────────────────────────────────────────────────────────
    const mutate = [requireLogin, requireOfficer, verifyCsrf(cfg)] as const;

    app.post('/circles', ...mutate, async (req, res) => {
        const rawId = String(req.body.circle_id ?? '').trim();
        const quota = parseQuota(String(req.body.quota ?? ''));

        if (!/^\d+$/.test(rawId)) return res.redirect('/?err=Circle+ID+must+be+a+number.');
        if (quota === null || quota <= 0) return res.redirect('/?err=Quota+must+be+a+positive+amount+like+80M.');

        const circleId = BigInt(rawId);
        if (await prisma.trackedCircle.findFirst({ where: { guildId, circleId } })) {
            return res.redirect('/?err=That+circle+is+already+tracked.');
        }

        const circle = await prisma.trackedCircle.create({
            data: { guildId, circleId, name: `Circle ${rawId}`, monthlyQuota: BigInt(quota) },
        });

        try {
            const result = await syncCircle(circle);
            return res.redirect(`/circles/${circle.id}?ok=${encodeURIComponent(`Tracking ${result.name}.`)}`);
        } catch (e) {
            // Roll back so a bad ID does not leave an empty circle behind.
            await prisma.trackedCircle.delete({ where: { id: circle.id } });
            return res.redirect(`/?err=${encodeURIComponent(e instanceof Error ? e.message : 'Sync failed.')}`);
        }
    });

    app.post('/circles/:id', ...mutate, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return res.redirect('/?err=Circle+not+found.');

        const quota = parseQuota(String(req.body.quota ?? ''));
        if (quota === null || quota <= 0) {
            return res.redirect(`/circles/${circle.id}?err=Quota+must+be+a+positive+amount+like+80M.`);
        }

        const reportChannel = String(req.body.report_channel ?? '').trim();
        const alertChannel = String(req.body.alert_channel ?? '').trim();

        await prisma.trackedCircle.update({
            where: { id: circle.id },
            data: {
                monthlyQuota: BigInt(quota),
                reportChannelId: reportChannel || null,
                alertChannelId: alertChannel || null,
                active: String(req.body.active) === 'true',
            },
        });

        return res.redirect(`/circles/${circle.id}?ok=Settings+saved.`);
    });

    app.post('/circles/:id/sync', ...mutate, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return res.redirect('/?err=Circle+not+found.');

        try {
            const result = await syncCircle(circle);
            await syncBenchmark().catch(() => undefined);
            return res.redirect(
                `/circles/${circle.id}?ok=${encodeURIComponent(`Synced ${result.membersSeen} members.`)}`,
            );
        } catch (e) {
            return res.redirect(
                `/circles/${circle.id}?err=${encodeURIComponent(e instanceof Error ? e.message : 'Sync failed.')}`,
            );
        }
    });

    app.post('/circles/:id/delete', ...mutate, async (req, res) => {
        const circle = await prisma.trackedCircle.findFirst({ where: { id: param(req, 'id'), guildId } });
        if (!circle) return res.redirect('/?err=Circle+not+found.');

        await prisma.trackedCircle.delete({ where: { id: circle.id } });
        return res.redirect(`/?ok=${encodeURIComponent(`Stopped tracking ${circle.name}.`)}`);
    });

    app.post('/links', ...mutate, async (req, res) => {
        const viewerRaw = String(req.body.viewer_id ?? '').trim();
        const discordUserId = String(req.body.discord_user_id ?? '').trim();
        const returnTo = String(req.body.return_to ?? '/');

        // Only ever redirect to a path on this site, never to an absolute URL.
        const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';

        if (!/^\d+$/.test(viewerRaw)) return res.redirect(`${safeReturn}?err=Invalid+trainer+ID.`);

        const viewerId = BigInt(viewerRaw);

        if (!discordUserId) {
            await prisma.trainerLink.deleteMany({ where: { guildId, viewerId } });
            return res.redirect(`${safeReturn}?ok=Link+removed.`);
        }

        if (!/^\d{15,25}$/.test(discordUserId)) {
            return res.redirect(`${safeReturn}?err=Discord+user+IDs+are+15-25+digits.`);
        }

        // One trainer per Discord account and vice versa; clear both sides first.
        await prisma.trainerLink.deleteMany({
            where: { guildId, OR: [{ viewerId }, { discordUserId }] },
        });
        await prisma.trainerLink.create({ data: { guildId, viewerId, discordUserId } });

        return res.redirect(`${safeReturn}?ok=Link+saved.`);
    });

    // ── Errors ────────────────────────────────────────────────────────────────
    app.use((req, res) => notFound(res, req.user, 'That page does not exist.'));

    app.use((error: unknown, req: Request, res: Response, _next: unknown) => {
        console.error('Dashboard error:', error);
        if (res.headersSent) return;
        res.status(500).send(
            layout({
                title: 'Error',
                user: req.user,
                body: '<h1>Something went wrong</h1><p class="sub">The failure was logged. Try again.</p>',
            }),
        );
    });

    // Bind on every interface, not loopback. A container that listens only on
    // 127.0.0.1 is unreachable from outside itself, so the platform's health
    // check never connects.
    const server = app.listen(cfg.port, '0.0.0.0', () => {
        console.log(`Dashboard listening on 0.0.0.0:${cfg.port} (${cfg.baseUrl})`);
    });

    return () => server.close();
}
