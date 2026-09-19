/**
 * Integration tests for the Independent Training timer.
 *
 * Runs against a real Postgres because the logic under test is mostly SQL and
 * timezone-sensitive date bucketing; an in-memory fake would not exercise
 * either. Uses a dedicated `test-guild` scope and cleans up after itself.
 *
 *   DATABASE_URL=postgresql://... npm run test:timer
 */
import { prisma } from '../src/db/prisma';
import { getTrainerStats, getLeaderboard, startTimer, claimExpiredTimers, recordRun, stopTimer, getHourlyHeatmap }
    from '../src/lib/timer/service';

const G = 'test-guild';
const DAY = 86_400_000;
let pass = 0, fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}

/** Seeds a user whose runs happened `daysAgo` days back (one run per entry). */
async function seed(user: string, daysAgo: number[]) {
    const now = Date.now();
    await prisma.trainingRun.deleteMany({ where: { guildId: G, discordUserId: user } });
    for (const d of daysAgo) {
        const at = new Date(now - d * DAY);
        await prisma.trainingRun.create({
            data: { guildId: G, discordUserId: user, startedAt: at, completedAt: at },
        });
    }
}

async function main() {
    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });

    await seed('u_none', []);
    let s = await getTrainerStats(G, 'u_none');
    check('no runs -> current streak', s.currentStreakDays, 0);
    check('no runs -> longest streak', s.longestStreakDays, 0);
    check('no runs -> rank is null', s.rank, null);

    await seed('u_today', [0]);
    s = await getTrainerStats(G, 'u_today');
    check('today only -> streak', s.currentStreakDays, 1);
    check('today only -> runsToday', s.runsToday, 1);

    await seed('u_three', [0, 1, 2]);
    s = await getTrainerStats(G, 'u_three');
    check('3 consecutive days -> streak', s.currentStreakDays, 3);
    check('3 consecutive days -> longest', s.longestStreakDays, 3);
    check('3 consecutive days -> minutes', s.totalMinutes, 150);

    // Not yet trained today: yesterday must still anchor an unbroken streak.
    await seed('u_yesterday', [1, 2, 3]);
    s = await getTrainerStats(G, 'u_yesterday');
    check('ends yesterday -> streak survives', s.currentStreakDays, 3);
    check('ends yesterday -> runsToday', s.runsToday, 0);

    // A two-day gap must break the current streak but preserve the best one.
    await seed('u_gap', [0, 4, 5, 6, 7]);
    s = await getTrainerStats(G, 'u_gap');
    check('gap -> current streak resets', s.currentStreakDays, 1);
    check('gap -> longest remembered', s.longestStreakDays, 4);

    // Several runs on one day must not inflate the streak.
    await seed('u_multi', [0, 0, 0, 1]);
    s = await getTrainerStats(G, 'u_multi');
    check('3 runs today + 1 yesterday -> streak', s.currentStreakDays, 2);
    check('3 runs today -> runsToday', s.runsToday, 3);
    check('3 runs today -> total', s.totalRuns, 4);

    // Crossing a month boundary must not break day-successor arithmetic.
    const longRun = Array.from({ length: 40 }, (_, i) => i);
    await seed('u_long', longRun);
    s = await getTrainerStats(G, 'u_long');
    check('40 days across month boundary -> streak', s.currentStreakDays, 40);

    // Ranking: u_long (40) > u_gap (5) > u_multi (4) > u_three (3)
    s = await getTrainerStats(G, 'u_long');
    check('rank of top trainer', s.rank, 1);

    const lb = await getLeaderboard(G, 'all', 3);
    check('leaderboard top 3 by runs', lb.map((r) => [r.discordUserId, r.runs]),
        [['u_long', 40], ['u_gap', 5], ['u_multi', 4]]);

    // Days 0 and 20: one clearly inside the 7-day window, one clearly outside,
    // so the assertion does not sit on the boundary.
    await seed('u_window', [0, 20]);
    const week = await getLeaderboard(G, 'week', 20);
    const month = await getLeaderboard(G, 'month', 20);
    const all = await getLeaderboard(G, 'all', 20);
    check('week window keeps only the recent run',
        week.find((r) => r.discordUserId === 'u_window')?.runs, 1);
    check('month window keeps both', month.find((r) => r.discordUserId === 'u_window')?.runs, 2);
    check('all time keeps both', all.find((r) => r.discordUserId === 'u_window')?.runs, 2);

    // ── Lifecycle: start, reset, atomic expiry claim, downtime recovery ──
    await prisma.trainingRun.deleteMany({ where: { guildId: G, discordUserId: 'u_life' } });
    const a = await startTimer(G, 'chan', 'panel', 'u_life');
    check('first start is not a reset', a.wasReset, false);
    const b = await startTimer(G, 'chan', 'panel', 'u_life');
    check('second start is a reset', b.wasReset, true);
    check('reset keeps one row', await prisma.trainingTimer.count({ where: { guildId: G } }), 1);
    check('stop removes it', await stopTimer(G, 'u_life'), true);
    check('stopping again is a no-op', await stopTimer(G, 'u_life'), false);

    // Simulate a timer that expired while the bot was offline.
    const expiredAt = new Date(Date.now() - 30 * 60_000);
    await prisma.trainingTimer.create({
        data: { guildId: G, channelId: 'c', discordUserId: 'u_life',
                startedAt: new Date(expiredAt.getTime() - 50 * 60_000), expiresAt: expiredAt },
    });
    const claimed = await claimExpiredTimers(new Date());
    check('downtime: expired timer is recovered', claimed.length, 1);
    check('claim is atomic (row gone)', await prisma.trainingTimer.count({ where: { guildId: G } }), 0);
    check('second claim returns nothing', (await claimExpiredTimers(new Date())).length, 0);

    const summary = await recordRun(claimed[0]!, new Date());
    check('recorded run counts as first', summary.totalRuns, 1);
    check('first run hits the 1-run milestone', summary.milestone, 1);
    check('first run of the day', summary.firstOfDay, true);

    const lag = await prisma.trainingRun.findFirst({
        where: { guildId: G, discordUserId: 'u_life' }, select: { deliveryLagS: true },
    });
    check('delivery lag recorded (~1800s)', Math.abs((lag?.deliveryLagS ?? 0) - 1800) < 10, true);

    // ── Heatmap bucketing in JST ──────────────────────────────────────────
    // Monday 15:30 UTC is Tuesday 00:30 JST; Sunday 14:00 UTC is Sunday 23:00 JST.
    await prisma.trainingRun.deleteMany({ where: { guildId: G, discordUserId: 'u_heat' } });
    for (const iso of ['2026-09-14T15:30:00Z', '2026-09-13T14:00:00Z', '2026-09-13T14:20:00Z']) {
        const at = new Date(iso);
        await prisma.trainingRun.create({ data: { guildId: G, discordUserId: 'u_heat', startedAt: at, completedAt: at } });
    }
    const heat = await getHourlyHeatmap(G, 'u_heat', 3650);
    check('heatmap: Mon 15:30 UTC lands on Tue 00h JST', heat.grid[1]?.[0], 1);
    check('heatmap: Sun 14:00 UTC lands on Sun 23h JST', heat.grid[6]?.[23], 2);
    check('heatmap: nothing on the UTC weekday/hour', heat.grid[0]?.[15], 0);
    check('heatmap: max and total', [heat.max, heat.total], [2, 3]);

    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}
main();
