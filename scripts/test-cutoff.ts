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

    // ── The uma.moe lookups ───────────────────────────────────────────────────
    // Game day 3 of October 2026 (15:00 UTC on the 4th rolls to day 4): only
    // three days this month, so four come from September.
    const now = new Date('2026-10-04T12:00:00Z');
    const requests: string[] = [];
    const september = [100, ...Array.from({ length: 30 }, (_, i) => 100 + (i + 1) * 1_000_000), 0];
    globalThis.fetch = (async (input: string | URL) => {
        const url = new URL(String(input));
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        let body: unknown;
        if (url.pathname === '/api/v4/circles/list') {
            const page = Number(url.searchParams.get('page'));
            body = { circles: Array.from({ length: 100 }, (_, i) => ({ circle_id: page * 100 + i + 1, name: `Circle ${page * 100 + i + 1}` })) };
        } else if (url.searchParams.get('month') === '10') {
            body = { members: [{ daily_fans: fans(5_000_000, 6_200_000, 7_300_000, 8_500_000) }] };
        } else {
            body = { members: [{ daily_fans: september }] };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const series = await cutoff.refreshCutoff(now);
    check('rank 1000 is the last of page 9', [requests[0]?.includes('page=9'), requests[0]?.includes('sort_by=monthly_point'), series.circleId], [true, true, 1000]);
    check('this month, then last month when it is short', requests.slice(1).map((r) => /month=(\d+)/.exec(r)?.[1]), ['10', '9']);
    check('the last 7 days, oldest first, across the months',
        series.days.map((d) => `${d.month}/${d.day}`), ['9/27', '9/28', '9/29', '9/30', '10/1', '10/2', '10/3']);
    check('each day per member', series.days.map((d) => d.perMember), [1e6, 1e6, 1e6, 1e6, 1.2e6, 1.1e6, 1.2e6]);
    check('kept for the form', cutoff.currentCutoff()?.circleName, 'Circle 1000');

    // ── The text ──────────────────────────────────────────────────────────────
    const line = cutoff.cutoffLine(series);
    check('the option line', line, 'T1000 per member/day, last 7 days: 1.00M 1.00M 1.00M 1.00M 1.20M 1.10M 1.20M');
    check('fits a select option description', (line?.length ?? 0) <= 100, true);
    check('the dated detail', cutoff.cutoffDetail(series)?.startsWith('T1000 (Circle 1000), fans per member per day: 9/27: **1.00M** · '), true);
    check('nothing to show before the first run', [cutoff.cutoffLine(null), cutoff.cutoffDetail(null)], [null, null]);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
