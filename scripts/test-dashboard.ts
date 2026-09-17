/**
 * Dashboard tests.
 *
 * Boots the real Express app against a real database with a stub Discord
 * client, then drives it over HTTP. The focus is the security-critical
 * behaviour — anonymous access, role checks, CSRF, open-redirect and HTML
 * escaping — because those are the parts that are expensive to get wrong and
 * invisible when they silently regress.
 *
 *   DATABASE_URL=postgresql://... npm run test:dashboard
 */
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.DASHBOARD_BASE_URL = 'http://localhost:38123';
process.env.DASHBOARD_SESSION_SECRET = 'a'.repeat(48);
process.env.DASHBOARD_GUILD_ID = 'test-guild-web';
process.env.DASHBOARD_PORT = '38123';
process.env.OFFICER_ROLE_IDS = 'role-officer';
// Cleared so an ambient PORT from the shell or a host platform cannot move the
// server off the port these tests connect to.
delete process.env.PORT;
delete process.env.RAILWAY_PUBLIC_DOMAIN;

import { prisma } from '../src/db/prisma';
import { startDashboard } from '../src/web/server';
import { seal, csrfToken, SESSION_COOKIE, type SessionUser } from '../src/web/auth';
import { currentGameMonth } from '../src/lib/fans/ingest';

const GUILD = 'test-guild-web';
const SECRET = 'a'.repeat(48);
const BASE = 'http://127.0.0.1:38123';

let pass = 0;
let fail = 0;

/** JSON.stringify refuses BigInt, which Prisma returns for fan counts. */
function show(value: unknown): string {
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v}n` : v)) ?? 'undefined';
}

function check(label: string, actual: unknown, expected: unknown) {
    const ok = show(actual) === show(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${show(actual)} want=${show(expected)}`}`);
}

/** Builds a session cookie for a synthetic user. */
function session(isOfficer: boolean): { user: SessionUser; cookie: string } {
    const user: SessionUser = {
        id: isOfficer ? 'user-officer' : 'user-member',
        username: 'tester',
        displayName: 'Tester',
        avatarUrl: null,
        isOfficer,
        exp: Date.now() + 3_600_000,
    };
    return { user, cookie: `${SESSION_COOKIE}=${seal(user, SECRET)}` };
}

async function get(path: string, cookie?: string) {
    const res = await fetch(`${BASE}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
    });
    return { status: res.status, location: res.headers.get('location'), body: await res.text(), res };
}

async function post(path: string, body: Record<string, string>, cookie?: string) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: new URLSearchParams(body),
        redirect: 'manual',
    });
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

async function main() {
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });

    // A hostile circle name, to prove output is escaped.
    const circle = await prisma.trackedCircle.create({
        data: {
            guildId: GUILD,
            circleId: BigInt(424242),
            name: '<script>alert(1)</script>Freakrose',
            monthlyQuota: BigInt(80_000_000),
        },
    });

    const { year, month } = currentGameMonth();
    for (let day = 1; day <= 5; day += 1) {
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id,
                viewerId: BigInt(7001),
                trainerName: 'ハルウララ',
                year, month, day,
                cumulativeFans: BigInt(3_000_000 * day),
            },
        });
    }

    const stubClient = { guilds: { cache: new Map() } } as never;
    const stop = startDashboard(stubClient);
    if (!stop) throw new Error('Dashboard did not start');
    await new Promise((r) => setTimeout(r, 400));

    const officer = session(true);
    const member = session(false);

    // ── Anonymous access ──────────────────────────────────────────────────────
    const anonHome = await get('/');
    check('anonymous sees the sign-in page', anonHome.status, 200);
    check('sign-in page offers Discord', anonHome.body.includes('Sign in with Discord'), true);
    check('anonymous home leaks no circle data', anonHome.body.includes('Freakrose'), false);

    const anonCircle = await get(`/circles/${circle.id}`);
    check('anonymous circle page redirects to login', anonCircle.status, 302);
    check('...and points at /login', anonCircle.location, '/login');

    const anonPng = await get(`/circles/${circle.id}/report.png`);
    check('anonymous report image is refused', anonPng.status, 302);

    // A forged cookie must not be accepted.
    const forged = await get('/', `${SESSION_COOKIE}=${Buffer.from(JSON.stringify({ id: 'x', isOfficer: true, exp: Date.now() + 1000 })).toString('base64url')}.badsignature`);
    check('tampered session cookie is rejected', forged.body.includes('Sign in with Discord'), true);

    // ── Signed-in reads ───────────────────────────────────────────────────────
    const home = await get('/', member.cookie);
    check('member sees the overview', home.status, 200);
    check('overview lists the circle', home.body.includes('Freakrose'), true);
    check('overview escapes hostile names', home.body.includes('<script>alert(1)</script>'), false);
    check('overview escapes to entities', home.body.includes('&lt;script&gt;'), true);
    check('member is not offered the add-circle form', home.body.includes('Add circle'), false);

    const officerHome = await get('/', officer.cookie);
    check('officer is offered the add-circle form', officerHome.body.includes('Add circle'), true);

    const detail = await get(`/circles/${circle.id}`, member.cookie);
    check('circle page renders', detail.status, 200);
    check('circle page shows the trainer', detail.body.includes('ハルウララ'), true);
    check('circle page shows the total', detail.body.includes('15,000,000'), true);
    check('member sees no settings form', detail.body.includes('Stop tracking'), false);

    const officerDetail = await get(`/circles/${circle.id}`, officer.cookie);
    check('officer sees the settings form', officerDetail.body.includes('Stop tracking'), true);

    const png = await get(`/circles/${circle.id}/report.png`, member.cookie);
    check('report image renders for a signed-in member', png.status, 200);
    check('report image is a PNG', png.res.headers.get('content-type'), 'image/png');

    const trainer = await get(`/circles/${circle.id}/trainers/7001`, member.cookie);
    check('trainer page renders', trainer.status, 200);
    check('trainer page shows daily gains', trainer.body.includes('3,000,000'), true);

    const missing = await get(`/circles/${circle.id}/trainers/999999`, member.cookie);
    check('unknown trainer is a 404', missing.status, 404);

    const badId = await get(`/circles/${circle.id}/trainers/not-a-number`, member.cookie);
    check('non-numeric trainer ID is a 404, not a crash', badId.status, 404);

    // ── Mutations ─────────────────────────────────────────────────────────────
    const officerCsrf = csrfToken(officer.user, SECRET);

    const noCsrf = await post(`/circles/${circle.id}`, { quota: '10M' }, officer.cookie);
    check('mutation without a CSRF token is refused', noCsrf.status, 403);

    const wrongCsrf = await post(`/circles/${circle.id}`, { quota: '10M', _csrf: 'wrong' }, officer.cookie);
    check('mutation with a bad CSRF token is refused', wrongCsrf.status, 403);

    const memberMutation = await post(
        `/circles/${circle.id}`,
        { quota: '10M', _csrf: csrfToken(member.user, SECRET) },
        member.cookie,
    );
    check('non-officer mutation is refused', memberMutation.status, 403);

    const anonMutation = await post(`/circles/${circle.id}`, { quota: '10M', _csrf: officerCsrf });
    check('anonymous mutation is refused', anonMutation.status, 401);

    const unchanged = await prisma.trackedCircle.findUnique({ where: { id: circle.id } });
    check('refused mutations changed nothing', unchanged?.monthlyQuota, BigInt(80_000_000));

    const ok = await post(
        `/circles/${circle.id}`,
        { quota: '55M', report_channel: '12345', alert_channel: '', active: 'true', _csrf: officerCsrf },
        officer.cookie,
    );
    check('officer mutation is accepted', ok.status, 302);

    const updated = await prisma.trackedCircle.findUnique({ where: { id: circle.id } });
    check('quota was updated', updated?.monthlyQuota, BigInt(55_000_000));
    check('report channel was set', updated?.reportChannelId, '12345');
    check('blank alert channel clears the value', updated?.alertChannelId, null);

    const badQuota = await post(
        `/circles/${circle.id}`,
        { quota: 'banana', active: 'true', _csrf: officerCsrf },
        officer.cookie,
    );
    check('invalid quota is rejected with a message', badQuota.location?.includes('err='), true);
    const afterBad = await prisma.trackedCircle.findUnique({ where: { id: circle.id } });
    check('invalid quota left the old value intact', afterBad?.monthlyQuota, BigInt(55_000_000));

    // ── Trainer links, and the open-redirect guard ────────────────────────────
    const link = await post(
        '/links',
        { viewer_id: '7001', discord_user_id: '123456789012345678', return_to: `/circles/${circle.id}`, _csrf: officerCsrf },
        officer.cookie,
    );
    check('link is saved', link.status, 302);
    const savedLink = await prisma.trainerLink.findFirst({ where: { guildId: GUILD, viewerId: BigInt(7001) } });
    check('link points at the right Discord user', savedLink?.discordUserId, '123456789012345678');

    const evil = await post(
        '/links',
        { viewer_id: '7001', discord_user_id: '123456789012345678', return_to: 'https://evil.example/', _csrf: officerCsrf },
        officer.cookie,
    );
    check('absolute return_to is not followed', evil.location?.startsWith('https://evil.example'), false);

    const protocolRelative = await post(
        '/links',
        { viewer_id: '7001', discord_user_id: '123456789012345678', return_to: '//evil.example/', _csrf: officerCsrf },
        officer.cookie,
    );
    check('protocol-relative return_to is not followed', protocolRelative.location?.startsWith('//evil.example'), false);

    const badDiscordId = await post(
        '/links',
        { viewer_id: '7001', discord_user_id: 'not-an-id', return_to: '/', _csrf: officerCsrf },
        officer.cookie,
    );
    check('malformed Discord ID is rejected', badDiscordId.location?.includes('err='), true);

    // ── Misc ──────────────────────────────────────────────────────────────────
    const missingPage = await get('/nope', member.cookie);
    check('unknown page is a 404', missingPage.status, 404);

    const otherGuild = await prisma.trackedCircle.create({
        data: { guildId: 'some-other-guild', circleId: BigInt(555), name: 'Elsewhere', monthlyQuota: BigInt(1) },
    });
    const crossGuild = await get(`/circles/${otherGuild.id}`, officer.cookie);
    check("another guild's circle is not reachable", crossGuild.status, 404);
    await prisma.trackedCircle.delete({ where: { id: otherGuild.id } });

    stop();
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
