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

    // ── The band ──────────────────────────────────────────────────────────────
    check('T1000 samples every 10th place from 900 to 1100', cutoff.bandRanks(1000), Array.from({ length: 21 }, (_, i) => 900 + i * 10));
    check('T100 takes every place from 90 to 110', cutoff.bandRanks(100), Array.from({ length: 21 }, (_, i) => 90 + i));
    check('T500 runs 450 to 550', [cutoff.bandRanks(500)[0], cutoff.bandRanks(500).at(-1), cutoff.bandRanks(500).length], [450, 550, 21]);
    check('the band never goes below 1st', cutoff.bandRanks(1), [1]);

    // ── The uma.moe lookups ───────────────────────────────────────────────────
    // October has three game days of data, so four days come from September.
    // Every 20th place is a one-member circle earning 1M a day; the rest have
    // three members earning 2M a day each. Pooled: (11 x 1M + 10 x 6M) / 41.
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
            // The ranking ends at 1050th: the band's top end is missing.
            const size = Math.max(0, Math.min(100, 1050 - page * 100));
            body = { circles: Array.from({ length: size }, (_, i) => ({ circle_id: page * 100 + i + 1, name: `Circle ${page * 100 + i + 1}` })) };
        } else {
            const id = Number(url.searchParams.get('circle_id'));
            body = { members: membersOf(id, url.searchParams.get('month') === '10' ? 3 : 30) };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const series = await cutoff.refreshCutoff(now);
    const lists = requests.filter((r) => r.startsWith('/api/v4/circles/list'));
    check('each page of the band is fetched once', lists.map((r) => /page=(\d+)/.exec(r)?.[1]), ['8', '9', '10']);
    check('places past the end of the ranking are skipped', [series.circles, series.from, series.to], [16, 900, 1100]);
    check('this month, then last month when it is short', requests.filter((r) => r.includes('circle_id=900&')).map((r) => /month=(\d+)/.exec(r)?.[1]), ['10', '9']);
    check('the last 7 days, oldest first, across the months',
        series.days.map((d) => `${d.month}/${d.day}`), ['9/27', '9/28', '9/29', '9/30', '10/1', '10/2', '10/3']);
    // 900..1050 sampled: 900, 920, ..., 1040 are one-member (8); 910, ..., 1050 are three-member (8).
    check('circles are pooled by member, not averaged', series.days[0]?.perMember, Math.round((8 * 1_000_000 + 8 * 6_000_000) / (8 + 24)));
    check('members counted across circles', series.days[0]?.members, 32);
    check('kept for the form', cutoff.currentCutoff()?.circles, 16);
    check('fresh figures are not fetched again', await cutoff.refreshCutoffIfStale(new Date(now.getTime() + 60_000)), null);
    check('stale ones are', (await cutoff.refreshCutoffIfStale(new Date(now.getTime() + cutoff.CUTOFF_MAX_AGE_MS)))?.circles, 16);

    // ── The text ──────────────────────────────────────────────────────────────
    const line = cutoff.cutoffLine(series);
    check('the option line', line, 'T1000 (±10%) per member/day, last 7 days: 1.75M 1.75M 1.75M 1.75M 1.75M 1.75M 1.75M');
    check('fits a select option description', (line?.length ?? 0) <= 100, true);
    check('the dated detail', cutoff.cutoffDetail(series)?.startsWith('T1000 (16 circles ranked 900–1100), fans per member per day: 9/27: **1.75M** · '), true);
    check('nothing to show before the first run', [cutoff.cutoffLine(null), cutoff.cutoffDetail(null)], [null, null]);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
