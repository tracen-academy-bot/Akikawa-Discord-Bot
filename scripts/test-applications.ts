/**
 * Club applications: trainer ID parsing, the merged daily series, the
 * averages, club fits, the decision tags, the recruitment entry, the card
 * and poster images, and the resolve/close flow against a real database
 * with a fake forum post and channels.
 *
 *   DATABASE_URL=postgresql://... npm run test:applications
 */
import { ChannelType } from 'discord.js';

// Read by the service at import, so set before importing it.
process.env.FORUM_CHANNEL_ID = 'forum-1';
process.env.RECRUITMENT_CHANNEL_ID = 'recruit-1';
process.env.STAFF_DISCUSSION_CHANNEL_ID = 'off';
process.env.TAG_CLUB_APP_ACCEPTED_ID = 'tag-accepted';
process.env.COMP_COUNCIL_ROLE_ID = 'role-comp';
process.env.CASUAL_COUNCIL_ROLE_ID = 'role-casual';
delete process.env.SEMI_COMP_COUNCIL_ROLE_ID;
delete process.env.TAG_REJECTED_ID;
delete process.env.EXTERNAL_API_KEY;

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

/** True when two numbers agree to within a millionth. */
function near(a: number | null, b: number): boolean {
    return a !== null && Math.abs(a - b) < 1e-6;
}

async function main() {
    const h = await import('../src/lib/applications/history');
    const svc = await import('../src/lib/applications/service');
    const { renderApplicantCard } = await import('../src/lib/image/renderApplicant');
    const { renderClubPoster } = await import('../src/lib/image/renderClubPoster');
    const { prisma } = await import('../src/db/prisma');

    // ── Trainer IDs ───────────────────────────────────────────────────────────
    check('id: bare in title', h.extractTrainerId('233568825060 want to transfer to First'), '233568825060');
    check('id: in brackets', h.extractTrainerId('[574910875032] Applying for a Casual Club'), '574910875032');
    check('id: in parentheses', h.extractTrainerId('(895544241292) looking for B rank'), '895544241292');
    check('id: grouped in threes', h.extractTrainerId('my id is 574 910 875 032 thanks'), '574910875032');
    check('id: grouped in fours with dashes', h.extractTrainerId('ID: 4674-9265-4277'), '467492654277');
    check('id: body when title has none', h.extractTrainerId('Looking For Casual Club', 'Zix: 647176684566 Hi!'), '647176684566');
    check('id: title wins over body', h.extractTrainerId('[111222333]', '444555666777'), '111222333');
    check('id: Discord snowflake is not an ID', h.extractTrainerId('see 1523241207600386188'), null);
    check('id: fan counts are not IDs', h.extractTrainerId('I average 9-10 million fans, 1M a day'), null);
    check('id: none', h.extractTrainerId('hello', null, undefined), null);

    // ── Daily series ──────────────────────────────────────────────────────────
    // October: start 100, then +10, +20 on days 1-2.
    const oct = { year: 2026, month: 10, daily: [100, 110, 130] };
    let s = h.dailySeries([oct]);
    check('series: one month gains', s.map((d) => [d.month, d.day, d.gain, d.estimated]), [
        [10, 1, 10, false],
        [10, 2, 20, false],
    ]);

    // A gap on day 2: the rise across days 2-3 is spread evenly and marked.
    s = h.dailySeries([{ year: 2026, month: 10, daily: [100, 110, 0, 150] }]);
    check('series: gap spread evenly', s.map((d) => [d.day, d.gain, d.estimated]), [
        [1, 10, false],
        [2, 20, true],
        [3, 20, true],
    ]);

    // Index 0 of November sits on October 31, and the higher value wins.
    const octFull = new Array(32).fill(0);
    octFull[30] = 500;
    octFull[31] = 600;
    const nov = new Array(32).fill(0);
    nov[0] = 610;
    nov[1] = 650;
    s = h.dailySeries([{ year: 2026, month: 10, daily: octFull }, { year: 2026, month: 11, daily: nov }]);
    check('series: month boundary', s.map((d) => [d.month, d.day, d.gain]), [
        [10, 31, 110],
        [11, 1, 40],
    ]);

    // A 30-day month ignores index 31; negative values (a count from another
    // circle) are not snapshots.
    const sep = new Array(32).fill(0);
    sep[29] = 100;
    sep[30] = 130;
    sep[31] = 999;
    sep[28] = -5;
    s = h.dailySeries([{ year: 2026, month: 9, daily: sep }]);
    check('series: past month end and negatives ignored', s.map((d) => [d.day, d.gain]), [[30, 30]]);

    // Two circles in one month (a mid-month move) merge on one timeline.
    s = h.dailySeries([
        { year: 2026, month: 10, daily: [100, 110, 120, 0, 0] },
        { year: 2026, month: 10, daily: [0, 0, 0, 125, 140] },
    ]);
    check('series: two circles merge', s.map((d) => d.gain), [10, 10, 5, 15]);
    check('series: a fall counts as no gain', h.dailySeries([{ year: 2026, month: 10, daily: [100, 90, 95] }]).map((d) => d.gain), [0, 5]);
    check('series: empty', h.dailySeries([]), []);

    // ── 30-day average ────────────────────────────────────────────────────────
    const long = { year: 2026, month: 10, daily: Array.from({ length: 32 }, (_, i) => 1000 + i * 100) };
    const w = h.windowAverage(h.dailySeries([long]), 30);
    check('window: last 30 of 31 days', [w.days, w.perDay, w.activeDays, w.estimatedDays], [30, 100, 30, 0]);
    const gappy = h.windowAverage(h.dailySeries([{ year: 2026, month: 10, daily: [100, 110, 0, 150, 150] }]), 30);
    check('window: estimated days are not active days', [gappy.days, gappy.activeDays, gappy.estimatedDays], [4, 1, 2]);
    check('window: empty', h.windowAverage([], 30).perDay, null);

    // ── Months ────────────────────────────────────────────────────────────────
    const now = { year: 2026, month: 11, day: 4 };
    const months = h.monthSummaries(
        [
            { year: 2026, month: 11, gain: 300, activeDays: 3 },
            { year: 2026, month: 10, gain: 3100, activeDays: 20 },
            { year: 2026, month: 9, gain: 3000, activeDays: 30 },
            // August missing: not in a tracked circle.
            { year: 2026, month: 7, gain: 6200, activeDays: 31 },
            { year: 2026, month: 6, gain: 300, activeDays: 2 },
        ],
        now,
        7,
    );
    check('months: newest first, current one in progress', months.map((m) => [m.month, m.days, m.inProgress, m.firstOnRecord]), [
        [11, 3, true, false],
        [10, 31, false, false],
        [9, 30, false, false],
        [8, 31, false, false],
        [7, 31, false, false],
        [6, 30, false, true],
        [5, 31, false, false],
    ]);
    check('months: missing month has no figure', [months[3]!.gain, months[3]!.perDay], [null, null]);
    const three = h.monthsAverage(months, 3);
    // Oct + Sep only (Aug missing): 6100 / 61 days.
    check('3 months: missing month left out, not zero', [three.months, near(three.perDay, 6100 / 61)], [2, true]);
    const six = h.monthsAverage(months, 6);
    // Oct, Sep, Jul; June is the first on record and left out.
    check('6 months: first on record left out', [six.months, near(six.perDay, 12300 / 92)], [3, true]);
    const onlyFirst = h.monthsAverage(h.monthSummaries([{ year: 2026, month: 10, gain: 310, activeDays: 5 }], now, 7), 3);
    check('3 months: first on record used when it is the only one', [onlyFirst.months, near(onlyFirst.perDay, 10)], [1, true]);
    check('3 months: nothing on record', h.monthsAverage(h.monthSummaries([], now, 7), 3).perDay, null);
    check('months before: across a year', h.monthsBefore(2026, 2, 3), { year: 2025, month: 11 });

    // ── Club fits ─────────────────────────────────────────────────────────────
    const clubs = [
        { id: 'a', name: 'First', quotaPerDay: 12_000_000 },
        { id: 'b', name: 'Rose', quotaPerDay: 2_000_000 },
        { id: 'c', name: 'Lily', quotaPerDay: 0 },
        { id: 'd', name: 'Spica', quotaPerDay: 5_000_000 },
    ];
    const fits = h.clubFits(6_000_000, clubs);
    check('fits: highest quota first, no-quota clubs left out', fits.map((f) => [f.club.name, f.meets]), [
        ['First', false],
        ['Spica', true],
        ['Rose', true],
    ]);
    check('fits: no pace meets nothing', h.clubFits(null, clubs).some((f) => f.meets), false);
    check('fits text: clears', svc.fitsText(fits).clears, 'Spica (5.0M/day), Rose (2.0M/day)');
    check('fits text: clears none', svc.fitsText(h.clubFits(1, clubs)).clears, 'None (lowest quota: Rose, 2.0M/day)');

    // ── Tags and pings ────────────────────────────────────────────────────────
    check('tags: status tag first, rejected one removed', svc.withStatusTag(['s', 'rej', 'casual'], 'acc', ['rej']), ['acc', 's', 'casual']);
    check('tags: five-tag limit keeps the decision', svc.withStatusTag(['1', '2', '3', '4', '5'], 'acc', []), ['acc', '1', '2', '3', '4']);
    check('tags: no status tag configured', svc.withStatusTag(['1', '2'], null, ['x']), ['1', '2']);
    check('pings: S+ and Casual', svc.tierRolesFor(['S+', 'Casual']), { roles: ['role-comp', 'role-casual'], labels: ['competitive', 'casual'] });
    check('pings: unset role still labels', svc.tierRolesFor(['A']), { roles: [], labels: ['semi-competitive'] });
    check('pings: no tier tags', svc.tierRolesFor(['Transfer']), { roles: [], labels: [] });

    // ── Recruitment entry ─────────────────────────────────────────────────────
    const base = {
        threadId: 't',
        guildId: 'g',
        applicantId: 'u1',
        viewerId: 233568825060n,
        trainerName: 'Typical',
        tags: ['Transfer'],
        status: 'OPEN' as const,
        clubId: null,
        clubName: null,
        note: null,
        pace30: 7_844_919n,
        pace3m: null,
        pace6m: null,
        recruitmentChannelId: null,
        recruitmentMessageId: null,
        resolvedById: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: new Date('2026-11-04T00:00:00Z'),
        updatedAt: new Date('2026-11-04T00:00:00Z'),
    };
    const entry = svc.recruitmentEmbed(base, 'https://discord.com/channels/g/t').toJSON();
    check('entry: title', entry.title, 'Typical · 233568825060');
    check('entry: open status and pace', entry.description?.split('\n').slice(0, 4), [
        '**Status**: Open, waiting for a decision',
        '**Applicant**: <@u1>',
        '**Looking for**: Transfer',
        '**Pace**: **7.8M/day** (30d) · — (3 mo) · — (6 mo)',
    ]);
    check('entry: accepted', svc.statusOf({ status: 'ACCEPTED', clubName: 'First', resolvedById: 'staff' }).text, 'Accepted into **First** by <@staff>, not joined yet');
    check('entry: no data', svc.paceLine({ pace30: null, pace3m: null, pace6m: null }), 'No uma.moe data');

    // ── Images ────────────────────────────────────────────────────────────────
    const series = h.dailySeries([long]);
    const card = await renderApplicantCard({
        trainerName: 'Test',
        viewerId: '123456789',
        currentCircle: null,
        tags: [],
        recent: h.windowAverage(series, 30),
        threeMonths: three,
        sixMonths: six,
        months,
        lastUpdated: null,
    });
    check('card: renders a PNG', card.subarray(1, 4).toString(), 'PNG');
    const emptyCard = await renderApplicantCard({
        trainerName: 'Nobody',
        viewerId: '123456789',
        currentCircle: null,
        tags: ['S'],
        recent: h.windowAverage([], 30),
        threeMonths: h.monthsAverage([], 3),
        sixMonths: h.monthsAverage([], 6),
        months: h.monthSummaries([], now, 7),
        lastUpdated: null,
    });
    check('card: renders with no data', emptyCard.subarray(1, 4).toString(), 'PNG');
    const poster = await renderClubPoster([
        { id: '1', name: 'Rose', tier: 'G3', rank: 'B_PLUS', headcount: 29, quotaText: '2.0M per day', monthlyRank: 722 },
        { id: '2', name: 'Nameless Club With A Very Long Name Indeed', tier: 'DEBUT', rank: null, headcount: null, quotaText: 'Not set', monthlyRank: null },
    ]);
    check('poster: renders a PNG', poster.subarray(1, 4).toString(), 'PNG');
    check('poster: renders with no clubs', (await renderClubPoster([])).subarray(1, 4).toString(), 'PNG');

    // ── Resolve and close, against the database ───────────────────────────────
    const guildId = `test-applications-${Date.now()}`;
    const threadId = `${guildId}-thread`;
    const sent: { id: string; payload: unknown }[] = [];
    const edits: unknown[] = [];
    const recruitment = {
        id: 'recruit-1',
        isSendable: () => true,
        send: async (payload: unknown) => {
            const m = { id: `msg-${sent.length + 1}` };
            sent.push({ id: m.id, payload });
            return m;
        },
        messages: { fetch: async (id: string) => ({ id, edit: async (p: unknown) => void edits.push(p) }) },
    };
    const client = { channels: { fetch: async (id: string) => (id === 'recruit-1' ? recruitment : null) } };
    const thread = {
        id: threadId,
        guildId,
        name: '[574910875032] Applying for a Casual Club',
        ownerId: 'applicant-1',
        parentId: 'forum-1',
        url: `https://discord.com/channels/${guildId}/${threadId}`,
        client,
        appliedTags: ['tag-bplus', 'tag-casual'],
        locked: false,
        archived: false,
        parent: {
            type: ChannelType.GuildForum,
            availableTags: [
                { id: 'tag-bplus', name: 'B+' },
                { id: 'tag-casual', name: 'Casual' },
                { id: 'tag-rejected', name: 'Rejected' },
                { id: 'tag-accepted', name: 'Club App Accepted' },
            ],
        },
        fetchStarterMessage: async () => ({ content: 'hello', author: { id: 'applicant-1' } }),
        async setAppliedTags(tags: string[]) {
            thread.appliedTags = tags;
        },
        async setLocked(v: boolean) {
            thread.locked = v;
        },
        async setArchived(v: boolean) {
            thread.archived = v;
        },
    };
    type Thread = Parameters<typeof svc.resolveApplication>[0];
    const club = await prisma.trackedCircle.create({ data: { guildId, name: 'Rose' } });
    try {
        check('forum post is an application', svc.isApplicationThread(thread), true);
        check('other channel is not', svc.isApplicationThread({ parentId: 'elsewhere' }), false);

        const { app, created } = await svc.ensureApplication(thread as unknown as Thread);
        check('ensure: made from the post', [created, app.viewerId?.toString(), app.applicantId, app.tags, app.status], [true, '574910875032', 'applicant-1', ['B+', 'Casual'], 'OPEN']);
        check('ensure: second call finds it', (await svc.ensureApplication(thread as unknown as Thread)).created, false);

        let resolved = await svc.resolveApplication(thread as unknown as Thread, null, 'staff-1', 'Quota too high for now.');
        check('reject: status, tag first, locked', [resolved.status, thread.appliedTags, thread.locked], ['REJECTED', ['tag-rejected', 'tag-bplus', 'tag-casual'], true]);
        check('reject: entry posted once', [sent.length, resolved.resolvedById], [1, 'staff-1']);
        const stored = await prisma.clubApplication.findUnique({ where: { threadId } });
        check('reject: entry message stored', [stored?.recruitmentChannelId, stored?.recruitmentMessageId], ['recruit-1', 'msg-1']);
        check('reject: message pings only the applicant', svc.decisionMessage(resolved).allowedMentions, { users: ['applicant-1'] });

        resolved = await svc.resolveApplication(thread as unknown as Thread, club, 'staff-2', null);
        check('accept: changes the decision, swaps the tag', [resolved.status, resolved.clubName, thread.appliedTags], [
            'ACCEPTED',
            'Rose',
            ['tag-accepted', 'tag-bplus', 'tag-casual'],
        ]);
        check('accept: entry edited, not reposted', [sent.length, edits.length], [1, 1]);
        check('accept: message names the club', svc.decisionMessage(resolved).content.includes('accepted into **Rose**'), true);

        const closed = await svc.closeApplication(thread as unknown as Thread);
        check('close: accepted becomes joined', [closed.app.status, closed.app.closedAt !== null], ['JOINED', true]);
        await svc.archivePost(thread as unknown as Thread, 'test');
        check('close: archived', thread.archived, true);

        await prisma.clubApplication.update({ where: { threadId }, data: { status: 'OPEN' } });
        check('close: open becomes withdrawn', (await svc.closeApplication(thread as unknown as Thread)).app.status, 'WITHDRAWN');
    } finally {
        await prisma.clubApplication.deleteMany({ where: { guildId } });
        await prisma.trackedCircle.deleteMany({ where: { guildId } });
        await prisma.$disconnect();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
