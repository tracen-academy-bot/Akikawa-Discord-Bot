/**
 * The T1000 figures shown under the competitive ranks in `/club edit`:
 * per-member daily fans, the uma.moe lookups behind them, and the text.
 * uma.moe is stubbed (global fetch), so no key or network is needed.
 *
 *   npm run test:cutoff
 */
process.env.EXTERNAL_API_KEY = 'test-key';
process.env.EXTERNAL_API_BASE_URL = 'https://uma.test';

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

/** 32 `daily_fans` entries from the given leading values, zero after. */
const fans = (...values: number[]) => [...values, ...new Array(32 - values.length).fill(0)];

async function main() {
    const cutoff = await import('../src/lib/fans/cutoff');

    // ── Per-member daily fans ─────────────────────────────────────────────────
    // Index 0 is the month's start, index d the end of game day d.
    const two = cutoff.dailyPerMember([fans(100, 110, 125, 135), fans(200, 205, 215, 230)]);
    check('a day is the members\' gains over the members in the circle', two.map((d) => [d.day, d.perMember, d.members]), [[1, 8], [2, 13], [3, 13]].map(([d, p]) => [d, p, 2]));
    const joiner = cutoff.dailyPerMember([fans(100, 110, 125, 135), fans(200, 205, 215, 230), fans(0, 0, 50, 60)]);
    check('a joiner counts from their first full day', joiner.map((d) => [d.day, d.members]), [[1, 2], [2, 2], [3, 3]]);
    check('and their gain that day is averaged in', joiner[2]?.perMember, Math.round((10 + 15 + 10) / 3));
    const leaver = cutoff.dailyPerMember([fans(100, 110, 120, 130), fans(200, 210, 0, 0)]);
    check('a leaver stops counting the day they are gone', leaver.map((d) => [d.day, d.members]), [[1, 2], [2, 1], [3, 1]]);
    const skipped = cutoff.dailyPerMember([fans(100, 110, 0, 130, 140), fans(200, 210, 0, 230, 240)]);
    check('days next to a skipped scrape are left out', skipped.map((d) => [d.day, d.perMember]), [[1, 10], [4, 10]]);
    check('the day in progress is not shown', cutoff.dailyPerMember([fans(100, 110)]).map((d) => d.day), [1]);
    check('no data, no days', cutoff.dailyPerMember([]), []);

    // ── The bands ─────────────────────────────────────────────────────────────
    const steps = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + i * step);
    check('the cutoffs, by expected rank', cutoff.CUTOFF_BY_RANK, { S_PLUS: 30, S: 100, A_PLUS: 500, A: 1000, B_PLUS: 3000 });
    check('T30 takes every place from 27 to 33', cutoff.bandRanks(30), steps(27, 1, 7));
    check('T100 samples 90 to 110', cutoff.bandRanks(100), steps(90, 2, 11));
    check('T500 is set by hand to 475 to 525', cutoff.bandRanks(500), steps(475, 5, 11));
    check('T1000 runs 950 to 1050', cutoff.bandRanks(1000), steps(950, 10, 11));
    check('T3000 runs 2950 to 3050', cutoff.bandRanks(3000), steps(2950, 10, 11));
    check('the band never goes below 1st', cutoff.bandRanks(1), [1]);

    // ── The uma.moe lookups ───────────────────────────────────────────────────
    // October has three game days of data, so four days come from September.
    // Every 20th place is a one-member circle earning 1M a day; the rest have
    // three members earning 2M a day each.
    const now = new Date('2026-10-04T12:00:00Z');
    const requests: string[] = [];
    const daily = (start: number, perDay: number, days: number) => fans(...Array.from({ length: days + 1 }, (_, d) => start + d * perDay));
    const membersOf = (id: number, days: number) =>
        id % 20 === 0
            ? [{ daily_fans: daily(10_000_000, 1_000_000, days) }]
            : [1, 2, 3].map((k) => ({ daily_fans: daily(k * 10_000_000, 2_000_000, days) }));
    globalThis.fetch = (async (input: string | URL) => {
        const url = new URL(String(input));
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        let body: unknown;
        if (url.pathname === '/api/v4/circles/list') {
            const page = Number(url.searchParams.get('page'));
            // The ranking ends at 1030th: T1000's top end is missing, and T3000's band is empty.
            const size = Math.max(0, Math.min(100, 1030 - page * 100));
            body = { circles: Array.from({ length: size }, (_, i) => ({ circle_id: page * 100 + i + 1, name: `Circle ${page * 100 + i + 1}` })) };
        } else {
            const id = Number(url.searchParams.get('circle_id'));
            body = { members: membersOf(id, url.searchParams.get('month') === '10' ? 3 : 30) };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const series = await cutoff.refreshCutoff(1000, now);
    const lists = requests.filter((r) => r.startsWith('/api/v4/circles/list'));
    check('each page of the band is fetched once', lists.map((r) => /page=(\d+)/.exec(r)?.[1]), ['9', '10']);
    check('places past the end of the ranking are skipped', [series.circles, series.from, series.to], [9, 950, 1050]);
    check('this month, then last month when it is short', requests.filter((r) => r.includes('circle_id=950&')).map((r) => /month=(\d+)/.exec(r)?.[1]), ['10', '9']);
    check('the last 7 days, oldest first, across the months',
        series.days.map((d) => `${d.month}/${d.day}`), ['9/27', '9/28', '9/29', '9/30', '10/1', '10/2', '10/3']);
    // Sampled 950..1030: 960, 980, 1000, 1020 are one-member (4); 950, 970, 990, 1010, 1030 three-member (5).
    check('circles are pooled by member, not averaged', series.days[0]?.perMember, Math.round((4 * 1_000_000 + 5 * 6_000_000) / (4 + 15)));
    check('members counted across circles', series.days[0]?.members, 19);
    check('kept for the A rank', cutoff.cutoffForRank('A')?.circles, 9);
    check('Casual and no rank have none', [cutoff.cutoffForRank('CASUAL'), cutoff.cutoffForRank(null)], [null, null]);

    const all = await cutoff.refreshCutoffs(now);
    check('every rank\'s cutoff is worked out', all.done, [30, 100, 500, 1000]);
    check('one the ranking does not reach fails on its own', all.failed.map((f) => f.split(':')[0]), ['T3000']);
    check('and B+ has nothing to show', cutoff.cutoffForRank('B_PLUS'), null);
    check('S+ has T30', cutoff.cutoffForRank('S_PLUS')?.from, 27);
    check('a recent attempt is not repeated', await cutoff.refreshCutoffsIfStale(new Date(now.getTime() + 60_000)), null);
    check('even though T3000 failed', cutoff.cutoffForRank('B_PLUS'), null);
    check('an old one is', (await cutoff.refreshCutoffsIfStale(new Date(now.getTime() + cutoff.CUTOFF_MAX_AGE_MS)))?.done.length, 4);

    // ── The text ──────────────────────────────────────────────────────────────
    const line = cutoff.cutoffLine(series);
    check('the option line', line, 'T1000 (950–1050) per member/day, last 7 days: 1.79M 1.79M 1.79M 1.79M 1.79M 1.79M 1.79M');
    const widest = cutoff.cutoffLine({ ...series, rank: 3000, from: 2950, to: 3050, days: series.days.map((d) => ({ ...d, perMember: 12_345_678 })) });
    check('even T3000 with big numbers fits an option description', (widest?.length ?? 0) <= 100, true);
    check('the dated detail', cutoff.cutoffDetail(series)?.startsWith('T1000 (9 circles ranked 950–1050), fans per member per day: 9/27: **1.79M** · '), true);
    check('nothing to show before the first run', [cutoff.cutoffLine(null), cutoff.cutoffDetail(null)], [null, null]);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
