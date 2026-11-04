/**
 * Club applications: trainer ID parsing, the merged daily series, the
 * averages, club fits, the decision tags, the recruitment board, the card
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
    const { renderApplicantCard, rankFileStem } = await import('../src/lib/image/renderApplicant');
    const { renderClubPoster } = await import('../src/lib/image/renderClubPoster');
    const { prisma } = await import('../src/db/prisma');
    const bf = await import('../src/lib/applications/backfill');

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
    check('id: spaced groups in brackets', h.extractTrainerId('[467 492 654 277] Applying'), '467492654277');
    check('id: commas in fours of three', h.extractTrainerId('id 467,492,654,277 pls'), '467492654277');
    check('id: dots in fours of three', h.extractTrainerId('467.492.654.277'), '467492654277');
    check('id: full-width digits', h.extractTrainerId('ＩＤ：４６７４９２６５４２７７'), '467492654277');
    check('id: full-width spaced groups', h.extractTrainerId('４６７　４９２　６５４　２７７'), '467492654277');
    check('id: comma fan count is not an ID', h.extractTrainerId('I have 1,234,567,890 fans'), null);
    check('id: comma fan count of nine digits is not an ID', h.extractTrainerId('123,456,789 fans this month'), null);
    check('id: mixed separators are not an ID', h.extractTrainerId('467,492.654,277'), null);
    check('id: fan count then a real ID', h.extractTrainerId('1,234,567,890 fans, ID 467,492,654,277'), '467492654277');

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
            { year: 2026, month: 10, gain: 3100, activeDays: 20, clubName: 'TeamSirius', clubRank: 'B' },
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
    check('months: club and club rank carried', [months[1]!.clubName, months[1]!.clubRank], ['TeamSirius', 'B']);
    check('months: absent fields are null', [months[2]!.clubName, months[2]!.clubRank], [null, null]);
    check('rank files: names map to badge files', ['D', 'D+', 'B+', 'S+', 'SS'].map(rankFileStem), ['D', 'D_PLUS', 'B_PLUS', 'S_PLUS', 'SS']);
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

    // ── Month inside a club ───────────────────────────────────────────────────
    // A is in all month (+10 a day); B joins for day 3 (+30); C leaves after day 1.
    const circleRows = [
        { viewerId: 'A', daily: [100, 110, 120, 130] },
        { viewerId: 'B', daily: [0, 0, 200, 230] },
        { viewerId: 'C', daily: [50, 60, 0, 0] },
    ];
    check('club month: joiner on their own days; the leaver is out of total and headcount', h.clubMonthStats(circleRows, 'B'), {
        gain: 30, daysInClub: 1, perDay: 30, members: 2, share: 0.75, vsAverage: 1.5, place: 1, leftBeforeEnd: false,
    });
    const fullMonth = h.clubMonthStats(circleRows, 'A')!;
    check('club month: full member is exactly average; a tie shares the better place', [fullMonth.gain, fullMonth.daysInClub, fullMonth.members, fullMonth.place, fullMonth.share, fullMonth.vsAverage], [30, 3, 2, 1, 0.5, 1]);
    check('club month: trainer who left has no share', h.clubMonthStats(circleRows, 'C'), {
        gain: 10, daysInClub: 1, perDay: 10, members: 2, share: null, vsAverage: null, place: 0, leftBeforeEnd: true,
    });
    check('club month: not in the circle', h.clubMonthStats(circleRows, 'Z'), null);
    check('club month: carried into the summary', h.monthSummaries([{ year: 2026, month: 10, gain: 30, activeDays: 1, club: h.clubMonthStats(circleRows, 'B') }], now, 2)[1]!.club?.share, 0.75);

    // ── Tags and pings ────────────────────────────────────────────────────────
    check('tags: status tag first, rejected one removed', svc.withStatusTag(['s', 'rej', 'casual'], 'acc', ['rej']), ['acc', 's', 'casual']);
    check('tags: five-tag limit keeps the decision', svc.withStatusTag(['1', '2', '3', '4', '5'], 'acc', []), ['acc', '1', '2', '3', '4']);
    check('tags: no status tag configured', svc.withStatusTag(['1', '2'], null, ['x']), ['1', '2']);
    check('labels: S+ and Casual', svc.tierLabelsFor(['S+', 'Casual']), ['competitive', 'casual']);
    check('labels: no tier tags', svc.tierLabelsFor(['Transfer']), []);
    check('recruiting: an A+ post pings A+ only, not A', svc.recruitingRolesFor(['A+'], [{ id: 'r-ap', name: 'A+ recruiting' }, { id: 'r-a', name: 'A recruiting' }]), ['r-ap']);
    const serverRoles = [
        { id: 'r-s', name: 'S recruiting' },
        { id: 'r-ap', name: 'A+ recruiting' },
        { id: 'r-a', name: 'A recruiting' },
        { id: 'r-c', name: 'Casual recruiting' },
        { id: 'r-x', name: 'Rose Trainer' },
    ];
    check('recruiting: S+ and S ping S recruiting once', svc.recruitingRolesFor(['S+', 'S'], serverRoles), ['r-s']);
    check('recruiting: A+ and A are separate roles', svc.recruitingRolesFor(['A'], serverRoles), ['r-a']);
    check('recruiting: B+ and Casual ping Casual recruiting', svc.recruitingRolesFor(['B+'], serverRoles), ['r-c']);
    check('recruiting: several tiers', svc.recruitingRolesFor(['S', 'A+', 'Casual'], serverRoles), ['r-s', 'r-ap', 'r-c']);
    check('recruiting: no tier tags, no pings', svc.recruitingRolesFor(['Transfer'], serverRoles), []);
    check('recruiting: missing role is skipped', svc.recruitingRolesFor(['A'], [{ id: 'r-s', name: 'S recruiting' }]), []);

    // ── Club member role on accept ────────────────────────────────────────────
    const cr = await import('../src/lib/applications/clubRole');
    const roleClubs = [
        { id: 'rose', name: 'Rose', staffRoleIds: [] },
        { id: 'prim', name: 'Primrose', staffRoleIds: [] },
        { id: 'lily', name: '☆Lily☆', staffRoleIds: [] },
    ];
    const guildRoles = [
        { id: 'g-rose', name: 'Rose' },
        { id: 'g-rose-t', name: 'Rose Trainer' },
        { id: 'g-rose-v', name: 'Rose Visa' },
        { id: 'g-prim', name: 'Primrose' },
        { id: 'g-lily', name: 'Lily' },
        { id: 'g-other', name: 'Rose fan club' },
    ];
    const clubIds = new Set(['g-rose', 'g-rose-t', 'g-rose-v', 'g-prim', 'g-lily']);
    const isClub = (id: string) => clubIds.has(id);
    check('club role: Rose gets Rose, not its Trainer or Visa role', cr.clubMemberRole(roleClubs[0]!, roleClubs, guildRoles, isClub)?.id, 'g-rose');
    check('club role: Primrose is not taken for Rose', cr.clubMemberRole(roleClubs[1]!, roleClubs, guildRoles, isClub)?.id, 'g-prim');
    check('club role: decorated club name still matches', cr.clubMemberRole(roleClubs[2]!, roleClubs, guildRoles, isClub)?.id, 'g-lily');
    check('club role: roles outside CLUB_ROLE_IDS are never used', cr.clubMemberRole(roleClubs[0]!, roleClubs, guildRoles, () => false), null);
    check('club role: two matching roles means none, not a guess', cr.clubMemberRole(roleClubs[0]!, roleClubs, [...guildRoles, { id: 'g-rose2', name: 'Team Rose' }], (id) => isClub(id) || id === 'g-rose2'), null);
    check('visa: named visas are recognised', [cr.isVisaRoleName('Rose Visa'), cr.isVisaRoleName('VISA - Cosmos'), cr.isVisaRoleName('Rose')], [true, true, false]);

    // ── Recruitment board ─────────────────────────────────────────────────────
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
    const board = await import('../src/lib/applications/board');
    const t0 = Math.floor(base.createdAt.getTime() / 1000);
    check('board line: applicant, pace, time open, post', board.availableLine(base), `<@u1> · 7.8M/day · <t:${t0}:R> · <#t>`);
    check('board line: no ID yet', board.availableLine({ ...base, viewerId: null, pace30: null }), `<@u1> · no ID yet · <t:${t0}:R> · <#t>`);
    check('board line: no 30-day data', board.availableLine({ ...base, pace30: null }), `<@u1> · no 30d data · <t:${t0}:R> · <#t>`);
    const at = (iso: string) => new Date(iso);
    const apps = [
        { ...base, threadId: 'newer', applicantId: 'n', createdAt: at('2026-11-03T00:00:00Z') },
        { ...base, threadId: 'older', applicantId: 'o', createdAt: at('2026-11-01T00:00:00Z') },
        { ...base, threadId: 'r2', applicantId: 'r2', status: 'ACCEPTED' as const, clubName: 'Rose', resolvedAt: at('2026-11-02T00:00:00Z') },
        { ...base, threadId: 'r1', applicantId: 'r1', status: 'ACCEPTED' as const, clubName: 'Rose', resolvedAt: at('2026-11-01T00:00:00Z') },
        { ...base, threadId: 'f1', applicantId: 'f1', status: 'ACCEPTED' as const, clubName: 'First', resolvedAt: null },
        { ...base, threadId: 'x', applicantId: 'x', status: 'REJECTED' as const },
        { ...base, threadId: 'j', applicantId: 'j', status: 'JOINED' as const, clubName: 'Rose' },
        { ...base, threadId: 'w', applicantId: 'w', status: 'WITHDRAWN' as const },
    ];
    const [avail, going] = board.boardEmbeds(apps).map((e) => e.toJSON());
    check('board: available, oldest first', [avail?.title, avail?.description?.split('\n').map((l) => l.split(' · ')[0])], ['Available (2)', ['<@o>', '<@n>']]);
    check('board: going to, grouped by club', [going?.title, going?.description?.split('\n').map((l) => l.split(' · ')[0])], [
        'Going to (3)',
        ['**First**', '<@f1>', '**Rose**', '<@r1>', '<@r2>'],
    ]);
    check('board: rejected, joined and withdrawn are off it', /<@(x|j|w)>/.test(`${avail?.description}${going?.description}`), false);
    const [emptyA, emptyG] = board.boardEmbeds([]).map((e) => e.toJSON());
    check('board: empty', [emptyA?.description, emptyG?.description], ['Nobody is waiting.', 'Nobody is on their way.']);
    const many = board.boardEmbeds(Array.from({ length: 200 }, (_, i) => ({ ...base, threadId: `t${i}`, applicantId: `${100000 + i}` })))[0]!.toJSON();
    check('board: a long list is cut with a count', [many.description!.length <= 4096, /\*\+\d+ more\*$/.test(many.description!)], [true, true]);
    check('ask for ID: pings only the applicant', svc.askForIdMessage('123').allowedMentions, { users: ['123'] });

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

    // ── Matching old posts ────────────────────────────────────────────────────
    const ourClubs = [
        { id: 'rose', name: 'Rose', circleId: 132902185n },
        { id: 'first', name: 'First', circleId: 999n },
        { id: 'lily', name: 'Lily', circleId: null },
    ];
    const match = (over: Partial<Parameters<typeof bf.matchApplication>[0]>) =>
        bf.matchApplication({ tagNames: [], archived: false, locked: false, postedIn: { year: 2026, month: 9 }, profile: null, clubs: ourClubs, ...over });
    const prof = (current: number | null, history: [number, number, number | null][]) => ({
        currentCircleId: current,
        history: history.map(([year, month, circleId]) => ({ year, month, circleId })),
    });
    let m = match({ profile: prof(132902185, [[2026, 11, 132902185], [2026, 10, 132902185], [2026, 9, 555]]) });
    check('match: in our club now is joined', [m.status, m.club?.name, m.since.map((c) => c.name), m.note], ['JOINED', 'Rose', ['Rose'], null]);
    m = match({ tagNames: ['Club App Accepted'], profile: prof(555, [[2026, 11, 555], [2026, 10, 999], [2026, 8, 132902185]]) });
    check('match: accepted then left; months before the post ignored', [m.status, m.club?.name, m.since.map((c) => c.name), m.note], [
        'ACCEPTED',
        'First',
        ['First'],
        'Was in First after posting; not any more.',
    ]);
    check('match: rejected tag', match({ tagNames: ['S', 'Rejected'], profile: prof(555, []) }).status, 'REJECTED');
    check('match: archived, no decision', match({ archived: true }).status, 'CLOSED');
    check('match: still open', match({}).status, 'OPEN');
    check('match: joined beats a rejected tag', match({ tagNames: ['Rejected'], profile: prof(999, []) }).status, 'JOINED');
    check('match: untracked club never matches', match({ profile: prof(null, [[2026, 10, null]]) }).nowIn, null);
    check('csv: quotes commas and quotes', bf.backfillCsv([{
        threadUrl: 'u', title: 'Hi, "me"', applicantId: 'a', openedAt: new Date('2026-01-02T00:00:00Z'), tags: ['S', 'A'], trainerId: null, trainerName: null,
        umaCircle: null, status: 'OPEN', club: null, nowIn: null, since: [], pace3m: 1234.6, pace6m: null, problem: null, linked: false,
    }]).split('\n')[1], 'u,"Hi, ""me""",a,2026-01-02T00:00:00.000Z,S | A,,,,OPEN,,,,1235,,,');

    // ── Resolve and close, against the database ───────────────────────────────
    const guildId = `test-applications-${Date.now()}`;
    const threadId = `${guildId}-thread`;
    const sent: { id: string; payload: unknown }[] = [];
    const edits: unknown[] = [];
    const deleted: string[] = [];
    const recruitment = {
        id: 'recruit-1',
        isSendable: () => true,
        send: async (payload: unknown) => {
            const m = { id: `msg-${sent.length + 1}` };
            sent.push({ id: m.id, payload });
            return m;
        },
        messages: { fetch: async (id: string) => ({ id, edit: async (p: unknown) => void edits.push(p), delete: async () => void deleted.push(id) }) },
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
        check('board: posted once', [sent.length, resolved.resolvedById], [1, 'staff-1']);
        const boardRow = await prisma.recruitmentBoard.findUnique({ where: { guildId } });
        check('board: message stored', [boardRow?.channelId, boardRow?.messageId], ['recruit-1', 'msg-1']);
        check('reject: message pings only the applicant', svc.decisionMessage(resolved).allowedMentions, { users: ['applicant-1'] });

        resolved = await svc.resolveApplication(thread as unknown as Thread, club, 'staff-2', null);
        check('accept: changes the decision, swaps the tag', [resolved.status, resolved.clubName, thread.appliedTags], [
            'ACCEPTED',
            'Rose',
            ['tag-accepted', 'tag-bplus', 'tag-casual'],
        ]);
        check('board: edited, not reposted', [sent.length, edits.length], [1, 1]);
        await prisma.clubApplication.update({ where: { threadId }, data: { recruitmentChannelId: 'recruit-1', recruitmentMessageId: 'old-entry' } });
        await board.refreshRecruitmentBoard(client as never, guildId, 'recruit-1');
        const cleared = await prisma.clubApplication.findUnique({ where: { threadId } });
        check('board: old per-application entry deleted once', [deleted, cleared?.recruitmentMessageId ?? null], [['old-entry'], null]);
        check('accept: message names the club', svc.decisionMessage(resolved).content.includes('accepted into **Rose**'), true);

        const closed = await svc.closeApplication(thread as unknown as Thread);
        check('close: accepted becomes joined', [closed.app.status, closed.app.closedAt !== null], ['JOINED', true]);
        await svc.archivePost(thread as unknown as Thread, 'test');
        check('close: archived', thread.archived, true);

        await prisma.clubApplication.update({ where: { threadId }, data: { status: 'OPEN' } });
        check('close: open becomes withdrawn', (await svc.closeApplication(thread as unknown as Thread)).app.status, 'WITHDRAWN');

        // Linking Discord to the trainer happens on close, and only to a trainer uma.moe knows.
        const link = (user: string) => prisma.trainerLink.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId: user } } });
        await prisma.clubApplication.update({ where: { threadId }, data: { status: 'ACCEPTED', applicantId: '9001', trainerName: null } });
        await svc.closeApplication(thread as unknown as Thread);
        check('link: not made for a trainer uma.moe does not know', await link('9001'), null);
        await prisma.clubApplication.update({ where: { threadId }, data: { status: 'ACCEPTED', trainerName: 'WakuWaku' } });
        await svc.closeApplication(thread as unknown as Thread);
        check('link: made on close', (await link('9001'))?.viewerId.toString(), '574910875032');
        check('link: never overwrites the member', await svc.linkApplicant(guildId, '9001', 111n, null), false);
        check('link: never takes a trainer linked to someone else', await svc.linkApplicant(guildId, '9002', 574910875032n, null), false);
        check('link: existing link kept', (await link('9001'))?.viewerId.toString(), '574910875032');

        // A post with no ID: the applicant is pinged, and their reply with the ID is picked up.
        const posted: { content?: string; allowedMentions?: unknown }[] = [];
        const thread2 = {
            ...thread,
            id: `${guildId}-thread2`,
            name: 'Looking for a casual club',
            ownerId: '7007',
            appliedTags: [] as string[],
            isThread: () => true,
            fetch: async () => thread2,
            fetchStarterMessage: async () => ({ content: 'hi, I play daily', author: { id: '7007' } }),
            send: async (p: { content?: string; allowedMentions?: unknown }) => void posted.push(p),
        };
        const sentBefore = sent.length;
        const editsBefore = edits.length;
        await svc.openApplication(thread2 as unknown as Thread);
        const opened2 = await prisma.clubApplication.findUnique({ where: { threadId: thread2.id } });
        check('no ID: application waits for one', [opened2?.viewerId ?? null, opened2?.status], [null, 'OPEN']);
        check('no ID: applicant pinged for it', [posted.length, posted[0]?.content?.startsWith('<@7007>'), posted[0]?.allowedMentions], [1, true, { users: ['7007'] }]);
        check('no ID: board edited, nothing new posted', [sent.length, edits.length > editsBefore], [sentBefore, true]);
        await svc.takeIdFromMessage({ author: { id: '8008', bot: false }, content: '467492654277', channel: thread2 });
        check("reply: someone else's ID is ignored", (await prisma.clubApplication.findUnique({ where: { threadId: thread2.id } }))?.viewerId ?? null, null);
        await svc.takeIdFromMessage({ author: { id: '7007', bot: false }, content: 'sorry! my id is ４６７,４９２,６５４,２７７', channel: thread2 });
        const withId = await prisma.clubApplication.findUnique({ where: { threadId: thread2.id } });
        check("reply: applicant's ID picked up", withId?.viewerId?.toString(), '467492654277');
        check('reply: post told the result', posted.length, 2);
        check('reply: no link before the post closes', await link('7007'), null);
        await svc.takeIdFromMessage({ author: { id: '7007', bot: false }, content: '111222333444', channel: thread2 });
        check('reply: a later number does not replace the ID', (await prisma.clubApplication.findUnique({ where: { threadId: thread2.id } }))?.viewerId?.toString(), '467492654277');

        // Backfill over a fake forum: one active post, two pages of archived ones.
        const post = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
            id: `${guildId}-${id}`,
            name,
            parentId: 'forum-bf',
            ownerId: `owner-${id}`,
            url: `https://discord.com/channels/${guildId}/${id}`,
            appliedTags: [] as string[],
            archived: false,
            locked: false,
            createdAt: new Date('2026-10-05T00:00:00Z'),
            archivedAt: null,
            client,
            fetchStarterMessage: async () => ({ content: 'no id here', author: { id: `owner-${id}` } }),
            ...extra,
        });
        const active = post('p1', '[123456789] hi');
        const archivedA = post('p2', 'Looking for a club', { archived: true, appliedTags: ['tag-acc'] });
        const archivedB = post('p3', 'old', { archived: true, fetchStarterMessage: async () => { throw new Error('Unknown Message'); } });
        const asMap = (list: unknown[]) => new Map(list.map((t) => [(t as { id: string }).id, t]));
        let archivedCalls = 0;
        const forum = {
            id: 'forum-bf',
            guildId,
            client,
            availableTags: [{ id: 'tag-acc', name: 'Club App Accepted' }],
            threads: {
                fetchActive: async () => ({ threads: asMap([active, post('other', 'elsewhere', { parentId: 'not-this-forum' })]) }),
                fetchArchived: async (o: { before?: unknown }) => {
                    archivedCalls += 1;
                    return o.before ? { threads: asMap([archivedB]), hasMore: false } : { threads: asMap([archivedA]), hasMore: true };
                },
            },
        };
        type Forum = Parameters<typeof bf.backfillApplications>[0];
        const progress: number[] = [];
        const sentBeforeBackfill = sent.length;
        const editsBeforeBackfill = edits.length;
        const report = await bf.backfillApplications(forum as unknown as Forum, { onProgress: (d) => void progress.push(d) });
        check('backfill: pages through archived posts, skips other forums', [report.scanned, archivedCalls], [3, 2]);
        check('backfill: outcome by post', report.rows.map((r) => [r.title, r.status, r.trainerId, r.problem]), [
            ['[123456789] hi', 'OPEN', '123456789', 'uma.moe not set up (EXTERNAL_API_KEY)'],
            ['Looking for a club', 'ACCEPTED', null, 'no trainer ID in the post'],
            ['old', 'CLOSED', null, 'no trainer ID in the post'],
        ]);
        check('backfill: rows written with the post date', (await prisma.clubApplication.findUnique({ where: { threadId: `${guildId}-p2` } }))?.createdAt.toISOString(), '2026-10-05T00:00:00.000Z');
        check('backfill: board refreshed once, nothing new posted', [sent.length, edits.length - editsBeforeBackfill], [sentBeforeBackfill, 1]);
        const again = await bf.backfillApplications(forum as unknown as Forum);
        check('backfill: a second run imports nothing', [again.imported, again.alreadyTracked], [0, 3]);
        check('backfill: progress reported at the end', progress.at(-1), 3);
    } finally {
        await prisma.trainerLink.deleteMany({ where: { guildId } });
        await prisma.recruitmentBoard.deleteMany({ where: { guildId } });
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
