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

    await rewardChecks();

    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}
/**
 * Weekly top-runner awards and milestone roles. The week of Mon 2026-10-19 to
 * Sun 2026-10-25 JST runs from 2026-10-18 15:00 UTC to 2026-10-25 15:00 UTC.
 */
async function rewardChecks() {
    const rewards = await import('../src/lib/timer/rewards');
    const G2 = 'test-guild-rewards';
    const clean = async () => {
        await prisma.trainingRun.deleteMany({ where: { guildId: G2 } });
        await prisma.timerSettings.deleteMany({ where: { guildId: G2 } });
        await prisma.timerMilestoneRole.deleteMany({ where: { guildId: G2 } });
        await prisma.timerWeeklyAward.deleteMany({ where: { guildId: G2 } });
    };
    await clean();

    // ── Weeks ─────────────────────────────────────────────────────────────────
    check('Monday 00:00 JST starts its week', rewards.weekKey(new Date('2026-10-18T15:00:00Z')), '2026-10-19');
    check('Sunday 23:59 JST is still the week before', rewards.weekKey(new Date('2026-10-18T14:59:00Z')), '2026-10-12');
    check('the last minute of the week', rewards.weekKey(new Date('2026-10-25T14:59:00Z')), '2026-10-19');
    check('the week ends Monday 00:00 JST', rewards.nextWeekStart(new Date('2026-10-21T00:00:00Z')).toISOString(), '2026-10-25T15:00:00.000Z');
    check('a week label', rewards.weekLabel('2026-10-19'), 'Oct 19 – Oct 25');

    // ── Standings ─────────────────────────────────────────────────────────────
    const run = (user: string, iso: string) =>
        prisma.trainingRun.create({ data: { guildId: G2, discordUserId: user, startedAt: new Date(iso), completedAt: new Date(iso) } });
    for (const iso of ['2026-10-19T03:00:00Z', '2026-10-20T03:00:00Z', '2026-10-21T03:00:00Z']) await run('alice', iso);
    for (const iso of ['2026-10-19T04:00:00Z', '2026-10-20T04:00:00Z', '2026-10-22T03:00:00Z']) await run('bob', iso);
    for (const iso of ['2026-10-19T05:00:00Z', '2026-10-23T05:00:00Z']) await run('carol', iso);
    await run('dave', '2026-10-24T05:00:00Z');
    // Just outside the week at either end.
    await run('dave', '2026-10-18T14:59:00Z');
    await run('erin', '2026-10-25T15:00:00Z');
    const standings = await rewards.getWeekStandings(G2, '2026-10-19');
    check('a week counts only its own runs; a tie goes to who got there first',
        standings.map((r) => [r.discordUserId, r.runs]), [['alice', 3], ['bob', 3], ['carol', 2], ['dave', 1]]);
    const board = await rewards.getBoard(G2, 'lastweek', 2, new Date('2026-10-26T01:00:00Z'));
    check('last week\'s board shows the top rows with totals over everyone',
        [board.week, board.rows.length, board.totalRuns, board.trainers], ['2026-10-19', 2, 9, 4]);

    // ── Weekly award ──────────────────────────────────────────────────────────
    const log: string[] = [];
    const guild = {
        id: G2,
        members: {
            fetch: async (id: string) => {
                if (id === 'gone') throw new Error('Unknown Member');
                return { roles: { add: async (r: string) => void log.push(`+${id}:${r}`), remove: async (r: string) => void log.push(`-${id}:${r}`) } };
            },
            me: { roles: { highest: { position: 5 } } },
        },
        roles: {
            cache: new Map([
                ['r-low', { id: 'r-low', name: 'Low', position: 2, managed: false }],
                ['r-high', { id: 'r-high', name: 'High', position: 10, managed: false }],
            ]),
            fetch: async () => null,
        },
    } as never;
    const created = await rewards.saveTimerSettings(G2, { topRoleId: 'r-top' }, new Date('2026-10-20T00:00:00Z'));
    check('turning rewards on mid-week skips weeks already over', created.lastAwardedWeek, '2026-10-12');
    // Last week's holders: zed loses the role, alice keeps it.
    await prisma.timerWeeklyAward.createMany({
        data: [
            { guildId: G2, week: '2026-10-12', place: 1, discordUserId: 'zed', runs: 9 },
            { guildId: G2, week: '2026-10-12', place: 2, discordUserId: 'alice', runs: 8 },
        ],
    });
    const guildOf = async () => guild;
    check('not awarded in the first quarter hour of the new week',
        (await rewards.runWeeklyAwards(guildOf, new Date('2026-10-25T15:10:00Z'))).length, 0);
    const [award] = await rewards.runWeeklyAwards(guildOf, new Date('2026-10-25T15:20:00Z'));
    check('the top 3 are awarded', award?.winners.map((w) => w.discordUserId), ['alice', 'bob', 'carol']);
    check('the role leaves last week\'s holders who did not place', award?.removed, ['zed']);
    check('and goes to this week\'s', log, ['-zed:r-top', '+alice:r-top', '+bob:r-top', '+carol:r-top']);
    check('the places are kept for next week',
        (await prisma.timerWeeklyAward.findMany({ where: { guildId: G2, week: '2026-10-19' }, orderBy: { place: 'asc' } })).map((a) => a.discordUserId),
        ['alice', 'bob', 'carol']);
    check('a week is awarded once', (await rewards.runWeeklyAwards(guildOf, new Date('2026-10-25T16:00:00Z'))).length, 0);
    check('the week is marked done', (await rewards.getTimerSettings(G2))?.lastAwardedWeek, '2026-10-19');

    // ── Milestones ────────────────────────────────────────────────────────────
    await prisma.timerMilestoneRole.create({ data: { guildId: G2, runs: 3, roleId: 'r-3' } });
    log.length = 0;
    check('a run landing on a milestone gives its role', await rewards.awardMilestone(guild, 'alice', 3), 'r-3');
    check('any other count gives nothing', await rewards.awardMilestone(guild, 'carol', 2), null);
    log.length = 0;
    check('adding a milestone gives it to everyone already past it', await rewards.backfillMilestone(guild, 3, 'r-3'), 2);
    check('which is alice and bob', log.sort(), ['+alice:r-3', '+bob:r-3']);

    // ── Which roles the bot can give ──────────────────────────────────────────
    check('a role below the bot is fine', await rewards.roleProblem(guild, 'r-low'), null);
    check('a role above the bot is refused', (await rewards.roleProblem(guild, 'r-high'))?.includes('above my highest role'), true);
    check('a missing role is refused', await rewards.roleProblem(guild, 'r-none'), 'That role no longer exists.');

    await clean();
}

main();
