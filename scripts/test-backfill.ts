/**
 * History backfill, game-month rollover and lifetime snapshots, end to end.
 *
 * Runs a local stand-in for uma.moe (the client reads its base URL at import,
 * so it is set before the modules load) and a real Postgres. uma.moe sends
 * lifetime fan counts; these tests make sure what lands in the database reads
 * back as this month's gains, that past months import without disturbing the
 * circle's current name and rank, and that the one-time import really runs once.
 *
 *   DATABASE_URL=postgresql://... npm run test:backfill
 */
import * as http from 'http';

const PORT = 38991;
process.env.EXTERNAL_API_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.EXTERNAL_API_KEY = 'test-key';

const GUILD = 'test-guild-backfill';
let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const show = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
    const ok = show(actual) === show(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${show(actual)} want=${show(expected)}`}`);
}

async function main() {
    const { prisma } = await import('../src/db/prisma');
    const ingest = await import('../src/lib/fans/ingest');
    const { formatReportDate } = await import('../src/lib/fans/reports');
    const { currentGameMonth, monthsBefore, backfillCircle, backfillOnce, syncCircle, loadCircleProgress } = ingest;

    // ── Game month starts on the 2nd JST ──────────────────────────────────────
    const at = (iso: string) => currentGameMonth(new Date(iso));
    check('the 1st JST is still the previous game month', at('2026-09-30T16:00:00Z'), { year: 2026, month: 9, day: 30 });
    check('the 2nd JST is game day 1', at('2026-10-01T16:00:00Z'), { year: 2026, month: 10, day: 1 });
    check('new year rolls over on 2 Jan JST', at('2026-12-31T16:00:00Z'), { year: 2026, month: 12, day: 31 });
    check('game day 1 is dated the 2nd', formatReportDate(2026, 10, 1), 'October 2, 2026');
    check('months before crosses a year', monthsBefore(2026, 2, 3), { year: 2025, month: 11 });

    // ── Fake uma.moe ──────────────────────────────────────────────────────────
    const now = currentGameMonth();
    const past = [monthsBefore(now.year, now.month, 1), monthsBefore(now.year, now.month, 2)];
    let requests = 0;

    /** Lifetime counts: starting value, then +1M a day for `days` days. */
    const lifetime = (base: number, days: number) =>
        Array.from({ length: 31 }, (_, i) => (i <= days ? base + i * 1_000_000 : 0));

    const server = http.createServer((req, res) => {
        requests += 1;
        const url = new URL(req.url ?? '/', 'http://x');
        const month = Number(url.searchParams.get('month')) || now.month;
        const year = Number(url.searchParams.get('year')) || now.year;
        const isCurrent = month === now.month && year === now.year;
        const isPast = past.some((p) => p.month === month && p.year === year);
        res.setHeader('Content-Type', 'application/json');
        res.end(
            JSON.stringify({
                circle: isCurrent ? { circle_id: 4242, name: 'Live Name', monthly_rank: 5 } : { circle_id: 4242, name: 'Old Name', monthly_rank: 99 },
                members:
                    isCurrent || isPast
                        ? [
                              { viewer_id: 1, trainer_name: 'Alpha', year, month, daily_fans: lifetime(1_200_000_000, 3) },
                              { viewer_id: 2, trainer_name: 'Beta', year, month, daily_fans: lifetime(800_000_000, 3) },
                          ]
                        : [],
            }),
        );
    });
    await new Promise<void>((r) => server.listen(PORT, r));

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    const circle = await prisma.trackedCircle.create({
        data: { guildId: GUILD, circleId: BigInt(4242), name: 'Circle 4242', quota: BigInt(31_000_000) },
    });
    await prisma.jobRun.deleteMany({ where: { id: `backfill:${circle.id}` } });

    // ── Current month: lifetime counts read back as this month's gains ────────
    await syncCircle(circle);
    const fresh = await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } });
    check('current sync takes the live name', fresh.name, 'Live Name');
    check('current sync takes the live rank', fresh.monthlyRank, 5);

    const progress = await loadCircleProgress(fresh, now.year, now.month);
    check('three game days elapsed after the starting snapshot', progress?.daysElapsed, 3);
    check('totals are gains, not lifetime counts', progress?.members.map((m) => m.total), [3_000_000, 3_000_000]);
    check('circle total is the sum of gains', progress?.totalFans, 6_000_000);

    // ── Backfill: past months, newest first, stop at the first empty month ────
    requests = 0;
    const months = await backfillCircle(fresh, 6);
    const label = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, '0')}`;
    check('imports the two months that exist', months, past.map(label));
    check('stops at the first empty month (3 requests, not 6)', requests, 3);

    const after = await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } });
    check('backfill keeps the current name', after.name, 'Live Name');
    check('backfill keeps the current rank', after.monthlyRank, 5);

    const older = await loadCircleProgress(after, past[0]!.year, past[0]!.month);
    check('a backfilled month reads back as gains', older?.members.map((m) => m.total), [3_000_000, 3_000_000]);

    // ── backfillOnce: once ever, safe to race ─────────────────────────────────
    await prisma.jobRun.deleteMany({ where: { id: `backfill:${circle.id}` } });
    requests = 0;
    await Promise.all([backfillOnce(after), backfillOnce(after), backfillOnce(after)]);
    check('racing callers import once', requests, 3);
    requests = 0;
    await backfillOnce(after);
    check('a later call does nothing', requests, 0);
    const marker = await prisma.jobRun.findUnique({ where: { id: `backfill:${circle.id}` } });
    check('marker records what was imported', marker?.note, `imported 2: ${past.map(label).join(' ')}`);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.jobRun.deleteMany({ where: { id: `backfill:${circle.id}` } });
    await prisma.$disconnect();
    server.close();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
