/**
 * `/fans all|club|me`, `/uma-id` and `/fans circle config club:`, driven through
 * the real command handler with a fake Discord interaction and a real
 * Postgres.
 *
 * Seeds two circles in the current game month (the checks read the current
 * month): one with a trainer on pace, one behind, and one who left, its
 * report going to a thread; another with no channels. Then checks who may run
 * what, where, and what each command replies and posts.
 *
 *   DATABASE_URL=postgresql://... npm run test:commands
 */
import { ChannelType, Collection } from 'discord.js';

const OFFICER_ROLE = 'officer-role';
process.env.OFFICER_ROLE_IDS = OFFICER_ROLE;
// A plain channel standing in for #staff-commands.
process.env.STAFF_COMMANDS_CHANNEL_IDS = 'c-staff';
// No key: /fans all and club must still report from stored data, and say so.
delete process.env.EXTERNAL_API_KEY;

const GUILD = 'test-guild-commands';

/**
 * The server's roles and channels, as the bot's cache holds them. Empty to
 * start; the name-matching checks add "Checkrose Trainer" and friends.
 */
const FAKE_GUILD = {
    id: GUILD,
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    channels: { cache: new Collection<string, { id: string; name: string; type: ChannelType }>() },
};

/** A member's role cache: the officer role if asked, plus any others. */
function roleCache(officer: boolean | undefined, roles: string[] = []) {
    return new Map([...(officer ? [OFFICER_ROLE] : []), ...roles].map((id) => [id, {}]));
}
let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

/** Everything a handler sent, in order. */
interface SentEmbed {
    title?: string;
    description?: string;
    fields?: { name: string; value: string }[];
}
interface Sent {
    kind: 'reply' | 'defer' | 'edit' | 'followUp' | 'channel';
    channelId?: string | undefined;
    ephemeral?: boolean | undefined;
    content?: string | undefined;
    embeds?: SentEmbed[] | undefined;
    files?: number | undefined;
    users?: string[] | undefined;
}

/** A channel that records what is sent to it. */
function fakeChannel(id: string, log: Sent[]) {
    return {
        isTextBased: () => true,
        send: async (message: { content?: string; files?: unknown[]; allowedMentions?: { users?: string[] } }) => {
            log.push({ kind: 'channel', channelId: id, content: message.content, files: message.files?.length ?? 0, users: message.allowedMentions?.users });
        },
    };
}

/** The slice of ChatInputCommandInteraction the fans handlers use. */
interface FakeOptions {
    sub: string;
    group?: string;
    userId: string;
    officer?: boolean;
    circle?: string;
    /** Any other string options, by name (e.g. `/club create name:`). */
    strings?: Record<string, string>;
    /** `/uma-id id:` and `remove:` */
    id?: string;
    remove?: boolean;
    /** Channel the command runs in; a thread unless `inThread` is false. */
    channel?: string;
    inThread?: boolean;
    /** For a thread, the channel it is in. */
    parent?: string;
    /** Discord roles the caller holds, besides the officer role. */
    roles?: string[];
}

function fakeInteraction(opts: FakeOptions, log: Sent[]) {
    const embedsOf = (payload: { embeds?: { toJSON(): Record<string, unknown> }[] }) =>
        payload.embeds?.map((e) => e.toJSON() as SentEmbed);
    const interaction = {
        guildId: GUILD,
        guild: FAKE_GUILD,
        user: { id: opts.userId },
        member: { id: opts.userId, roles: { cache: roleCache(opts.officer, opts.roles) }, guild: FAKE_GUILD },
        channelId: opts.channel ?? 'c-plain',
        channel: { isThread: () => opts.inThread ?? opts.channel !== undefined, parentId: opts.parent ?? null },
        deferred: false,
        replied: false,
        inGuild: () => true,
        options: {
            getSubcommandGroup: () => opts.group ?? null,
            getSubcommand: () => opts.sub,
            getString: (name: string) =>
                opts.strings?.[name] ?? (name === 'circle' ? opts.circle ?? null : name === 'id' ? opts.id ?? null : null),
            getBoolean: (name: string) => (name === 'remove' ? opts.remove ?? null : null),
            getChannel: () => null,
            getUser: () => null,
        },
        client: {
            channels: { fetch: async (id: string) => fakeChannel(id, log) },
        },
        async reply(payload: { embeds?: { toJSON(): Record<string, unknown> }[]; flags?: unknown }) {
            interaction.replied = true;
            log.push({ kind: 'reply', ephemeral: payload.flags !== undefined, embeds: embedsOf(payload) });
        },
        async deferReply(payload: { flags?: unknown } = {}) {
            interaction.deferred = true;
            log.push({ kind: 'defer', ephemeral: payload.flags !== undefined });
        },
        async editReply(payload: { content?: string; files?: unknown[]; embeds?: { toJSON(): Record<string, unknown> }[]; allowedMentions?: { users?: string[] } }) {
            log.push({ kind: 'edit', content: payload.content, files: payload.files?.length ?? 0, embeds: embedsOf(payload), users: payload.allowedMentions?.users });
        },
        async followUp(payload: { content?: string; files?: unknown[]; flags?: unknown; allowedMentions?: { users?: string[] } }) {
            log.push({ kind: 'followUp', ephemeral: payload.flags !== undefined, content: payload.content, files: payload.files?.length ?? 0, users: payload.allowedMentions?.users });
        },
    };
    return interaction;
}

async function main() {
    const { prisma } = await import('../src/db/prisma');
    const { currentGameMonth } = await import('../src/lib/fans/ingest');
    const { execute } = await import('../src/commands/fans');

    const run = async (opts: Parameters<typeof fakeInteraction>[0]) => {
        const log: Sent[] = [];
        await execute(fakeInteraction(opts, log) as never);
        return log;
    };

    // ── Seed: the current game month, three game days of data ────────────────
    const { year, month } = currentGameMonth();
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    // 31M a month over at most 31 days is at least 1M a day; 3 days owe ~3M.
    const circle = await prisma.trackedCircle.create({
        data: {
            guildId: GUILD, circleId: BigInt(999777), name: 'Checkrose', quota: BigInt(31_000_000),
            reportChannelId: 't-check', alertChannelId: 'c-alert',
        },
    });
    // Clubs and circles are one row now: its staff, a Trainer and an Assistant.
    await prisma.clubMember.createMany({
        data: [
            { clubId: circle.id, discordUserId: 'u-trainer', role: 'TRAINER' },
            { clubId: circle.id, discordUserId: 'u-assistant', role: 'ASSISTANT' },
        ],
    });
    const club = circle;

    // A second circle with no channels, so `check all` has to post it here.
    const other = await prisma.trackedCircle.create({
        data: { guildId: GUILD, circleId: BigInt(999778), name: 'Otherrose', quota: BigInt(31_000_000) },
    });

    const BASE = 1_000_000_000;
    const seed = async (viewerId: number, name: string, perDay: number, lastStored: number, into = circle) => {
        for (let stored = 1; stored <= lastStored; stored += 1) {
            await prisma.fanSnapshot.create({
                data: {
                    trackedCircleId: into.id, viewerId: BigInt(viewerId), trainerName: name,
                    year, month, day: stored, cumulativeFans: BigInt(BASE + viewerId + perDay * (stored - 1)),
                },
            });
        }
    };
    await seed(1, 'Ahead', 5_000_000, 4); // 15M over 3 days: on pace
    await seed(2, 'Behind', 100_000, 4); // 300K over 3 days: behind
    await seed(3, 'Gone', 9_000_000, 2); // left after day 1
    await seed(4, 'Elsewhere', 2_000_000, 4, other);

    await prisma.trainerLink.createMany({
        data: [
            { guildId: GUILD, discordUserId: 'u-behind', viewerId: BigInt(2) },
            { guildId: GUILD, discordUserId: 'u-gone', viewerId: BigInt(3) },
        ],
    });

    const desc = (log: Sent[]) => log[0]?.embeds?.[0]?.description;

    // ── /club fancount amounts (stored in millions) ───────────────────────────
    const { parseClubFanAmount } = await import('../src/commands/club');
    check('club fan amount: bare number is millions', parseClubFanAmount('50'), 50);
    check('club fan amount: 50M', parseClubFanAmount('50M'), 50);
    check('club fan amount: lowercase with a space', parseClubFanAmount(' 50 m '), 50);
    check('club fan amount: fraction', parseClubFanAmount('0.25M'), 0.25);
    check('club fan amount: thousands', parseClubFanAmount('500K'), 0.5);
    check('club fan amount: billions', parseClubFanAmount('1.2B'), 1200);
    check('club fan amount: separators', parseClubFanAmount('1,500M'), 1500);
    check('club fan amount: words rejected', parseClubFanAmount('lots'), null);
    check('club fan amount: zero rejected', parseClubFanAmount('0'), null);

    // ── /fans me ──────────────────────────────────────────────────────────────
    const me = await run({ sub: 'me', userId: 'u-behind', channel: 't-check' });
    const embed = me[0]?.embeds?.[0];
    const field = (name: string) => embed?.fields?.find((f) => f.name === name)?.value;
    check('me replies privately', me[0]?.ephemeral, true);
    check("me uses the thread's circle", embed?.title, 'Behind · Checkrose');
    check('me shows fans earned', field('Fans this month'), '300,000');
    check('me ranks among current members only', field('Rank'), '2 of 2');
    check('me says how far behind', field('Status')?.startsWith('Behind by **'), true);

    const nowhere = "Run this in one of your club's channels, or in <#c-staff>.";
    check('me in a channel no circle uses is refused', desc(await run({ sub: 'me', userId: 'u-behind' }))?.startsWith(nowhere), true);
    check('me in a thread no circle uses is refused',
        desc(await run({ sub: 'me', userId: 'u-behind', channel: 't-random' }))?.startsWith(nowhere), true);
    const meStaff = await run({ sub: 'me', userId: 'u-behind', channel: 'c-staff', inThread: false });
    check('me works in the staff channel too', meStaff[0]?.embeds?.map((e) => e.title), ['Behind · Checkrose']);

    // A plain channel (not a thread) that a circle reports to works the same.
    await prisma.trackedCircle.update({ where: { id: other.id }, data: { reportChannelId: 'c-bot', alertChannelId: 'c-bot' } });
    await prisma.trainerLink.create({ data: { guildId: GUILD, discordUserId: 'u-else', viewerId: BigInt(4) } });
    const mePlain = await run({ sub: 'me', userId: 'u-else', channel: 'c-bot', inThread: false });
    check("me works in a circle's plain report channel", mePlain[0]?.embeds?.map((e) => e.title), ['Elsewhere · Otherrose']);
    check('me in another circle\'s channel says not a member there',
        desc(await run({ sub: 'me', userId: 'u-behind', channel: 'c-bot', inThread: false }))?.includes('**Otherrose**'), true);
    const clubPlain = await run({ sub: 'club', userId: 'u-officer', officer: true, channel: 'c-bot', inThread: false });
    check("club works in a circle's plain report channel", clubPlain.find((s) => s.kind === 'edit')?.content?.includes('Otherrose'), true);
    await prisma.trackedCircle.update({ where: { id: other.id }, data: { reportChannelId: null, alertChannelId: null } });
    check('me without a link explains how to link',
        desc(await run({ sub: 'me', userId: 'u-nobody', channel: 't-check' }))?.includes('/uma-id'), true);
    check('me for a leaver says not a current member',
        desc(await run({ sub: 'me', userId: 'u-gone', channel: 't-check' }))?.includes('not a current member'), true);

    // ── /uma-id ───────────────────────────────────────────────────────────────
    const umaId = await import('../src/commands/umaId');
    const runUma = async (opts: FakeOptions) => {
        const log: Sent[] = [];
        await umaId.execute(fakeInteraction(opts, log) as never);
        return log;
    };
    check('uma-id with no ID says you are not linked',
        desc(await runUma({ sub: '', userId: 'u-new' }))?.startsWith('You are not linked yet.'), true);
    const linked = await runUma({ sub: '', userId: 'u-new', id: ' 555 ' });
    check('uma-id links you', linked[0]?.embeds?.[0]?.description, '<@u-new> is now linked to trainer `555`.');
    check('uma-id stores the link', String((await prisma.trainerLink.findUnique({ where: { guildId_discordUserId: { guildId: GUILD, discordUserId: 'u-new' } } }))?.viewerId), '555');
    check('uma-id with no ID shows your link', desc(await runUma({ sub: '', userId: 'u-new' }))?.includes('`555`'), true);
    check('uma-id refuses an ID someone else has',
        desc(await runUma({ sub: '', userId: 'u-other', id: '555' })), 'That trainer ID is already linked to <@u-new>.');
    check('uma-id refuses a non-number', desc(await runUma({ sub: '', userId: 'u-other', id: 'abc' }))?.startsWith('A viewer ID is a number'), true);
    check('uma-id refuses an ID and remove together',
        desc(await runUma({ sub: '', userId: 'u-new', id: '556', remove: true })), 'Give an ID to link, or `remove:true` to unlink, not both.');
    const removed = await runUma({ sub: '', userId: 'u-new', remove: true });
    check('uma-id remove:true unlinks you', removed[0]?.embeds?.[0]?.description, '<@u-new> is no longer linked.');
    check('uma-id remove:true deletes the link', await prisma.trainerLink.count({ where: { guildId: GUILD, discordUserId: 'u-new' } }), 0);
    check('uma-id remove:true when not linked says so',
        desc(await runUma({ sub: '', userId: 'u-new', remove: true })), '<@u-new> was not linked to a trainer.');

    // ── /fans club ────────────────────────────────────────────────────────────
    check("club lets the club's Assistant post too",
        (await run({ sub: 'club', userId: 'u-assistant', channel: 't-check' })).some((s) => s.kind === 'edit' && s.files === 1), true);
    check('club refuses someone who is not club staff',
        desc(await run({ sub: 'club', userId: 'u-behind', channel: 't-check' })), "Only **Checkrose**'s Trainers, Assistants and Club Managers can run this.");
    check("club refuses outside a circle's channel or the staff channel",
        desc(await run({ sub: 'club', userId: 'u-trainer' }))?.startsWith(nowhere), true);

    // #staff-commands: not a thread, so the circle is the caller's club's.
    const staff = await run({ sub: 'club', userId: 'u-trainer', channel: 'c-staff', inThread: false });
    check("club in the staff channel uses the caller's club", staff.find((s) => s.kind === 'edit')?.content?.includes('Checkrose'), true);
    check('club in the staff channel posts there, publicly', [staff[0]?.ephemeral, staff.find((s) => s.kind === 'edit')?.files], [false, 1]);
    check('club in the staff channel needs a circle when the caller has no club',
        desc(await run({ sub: 'club', userId: 'u-officer', officer: true, channel: 'c-staff', inThread: false }))?.includes('Name one with `circle:`'), true);
    const named = await run({ sub: 'club', userId: 'u-officer', officer: true, channel: 'c-staff', inThread: false, circle: other.id });
    check('club in the staff channel takes a named circle', named.find((s) => s.kind === 'edit')?.content?.includes('Otherrose'), true);
    check('club in the staff channel still checks permission',
        desc(await run({ sub: 'club', userId: 'u-behind', channel: 'c-staff', inThread: false, circle: circle.id }))?.startsWith('Only **Checkrose**'), true);

    const clubCheck = await run({ sub: 'club', userId: 'u-trainer', channel: 't-check' });
    const posted = clubCheck.find((s) => s.kind === 'edit');
    check("club lets the club's Trainer post", clubCheck[0]?.ephemeral, false);
    check('club attaches the report image', posted?.files, 1);
    check('club names who is behind', posted?.content?.includes('1 trainer behind quota'), true);
    check('club tags the linked trainer', posted?.users, ['u-behind']);
    check('club says it used stored data without a key', posted?.content?.includes('No uma.moe API key'), true);
    check('club does not list the leaver', posted?.content?.includes('Gone'), false);
    check('club posts in the thread, not to the channels', clubCheck.some((s) => s.kind === 'channel'), false);

    // ── /fans all ─────────────────────────────────────────────────────────────
    check('all is for Club Managers', desc(await run({ sub: 'all', userId: 'u-trainer' })), 'Only Club Managers can check every circle.');

    // Checkrose has channels; Otherrose has none, so its report comes here as
    // a public follow-up.
    const all = await run({ sub: 'all', userId: 'u-officer', officer: true });
    const edits = all.filter((s) => s.kind === 'edit');
    const followUps = all.filter((s) => s.kind === 'followUp');
    const summary = edits[edits.length - 1]?.embeds?.[0];
    check('all keeps the summary private', all[0]?.ephemeral, true);
    check('all fills the reply before any follow-up', all.findIndex((s) => s.kind === 'edit') < all.findIndex((s) => s.kind === 'followUp'), true);
    check('all posts Checkrose to its report thread', all.find((s) => s.kind === 'channel' && s.channelId === 't-check')?.files, 1);
    check('all posts the alert to the alert channel', all.find((s) => s.kind === 'channel' && s.channelId === 'c-alert')?.users, ['u-behind']);
    check('all posts Otherrose here, publicly', followUps.map((f) => [f.files, f.ephemeral]), [[1, false]]);
    check('all summarises both circles', summary?.title, 'Quota check · 2 circles');
    check('all names each circle', ['Checkrose', 'Otherrose'].every((n) => summary?.description?.includes(n)), true);

    await prisma.trackedCircle.update({ where: { id: other.id }, data: { active: false } });
    const activeOnly = await run({ sub: 'all', userId: 'u-officer', officer: true });
    check('all skips paused circles', activeOnly.some((s) => s.kind === 'followUp'), false);

    // ── /club edit form ───────────────────────────────────────────────────────
    const clubCmd = await import('../src/commands/club');
    // Checkrose's real quota is 31M a month; the form must show that, not a separate fan count.
    const editable = await prisma.trackedCircle.update({ where: { id: club.id }, data: { rank: 'S', headcount: 99, fanCountAmount: 50, fanCountPeriod: 'MONTH' } });
    type ModalJson = { custom_id: string; components: { label: string; component: { custom_id: string; value?: string; options?: { value: string; default?: boolean }[] } }[] };
    const fullForm = clubCmd.buildClubEditModal(editable, true).toJSON() as unknown as ModalJson;
    const staffForm = clubCmd.buildClubEditModal(editable, false).toJSON() as unknown as ModalJson;
    const pre = (f: ModalJson, label: string) => f.components.find((c) => c.label === label)?.component;
    check('a tracked club form: expected rank, quota, period, home channels, staff roles', fullForm.components.map((c) => c.label), ['Expected rank', 'Quota per member', 'Quota period', 'Home channels', 'Staff roles']);
    check('club form for staff has the quota only', staffForm.components.map((c) => c.label), ['Quota per member', 'Quota period']);
    check('headcount is not a field', fullForm.components.some((c) => c.label.toLowerCase().includes('headcount')), false);
    check('the form shows the real quota, exactly', pre(fullForm, 'Quota per member')?.value, '31M');
    check('club form pre-selects expected rank and quota period',
        [pre(fullForm, 'Expected rank')?.options?.find((o) => o.default)?.value, pre(fullForm, 'Quota period')?.options?.find((o) => o.default)?.value], ['S', 'MONTH']);
    const loose = await prisma.trackedCircle.create({ data: { guildId: GUILD, name: 'Loose Club', rank: 'B', fanCountAmount: 0.25 } });
    const looseForm = clubCmd.buildClubEditModal(loose, true).toJSON() as unknown as ModalJson;
    check('an untracked club form has the name instead of home channels', looseForm.components.map((c) => c.label), ['Name', 'Expected rank', 'Quota per member', 'Quota period', 'Staff roles']);
    check('an untracked club form pre-fills the name', pre(looseForm, 'Name')?.value, 'Loose Club');
    check('with no quota yet, an old club fan count pre-fills it', pre(looseForm, 'Quota per member')?.value, '0.25M');
    check('club form is routed by its prefix', clubCmd.isClubModal(fullForm.custom_id), true);

    /** Submits the club form with the given values, as the given user. */
    const submitClub = async (
        customId: string, userId: string, officer: boolean, values: Record<string, string>, home: string[] = [], roles: string[] = [], held: string[] = [],
    ) => {
        const out: { description?: string | undefined; ephemeral: boolean }[] = [];
        await clubCmd.handleClubModal({
            customId,
            user: { id: userId },
            member: { id: userId, roles: { cache: roleCache(officer, held) }, guild: FAKE_GUILD },
            fields: {
                getTextInputValue: (id: string) => values[id] ?? '',
                getStringSelectValues: (id: string) => (values[id] ? [values[id]] : []),
                getSelectedChannels: () => new Collection(home.map((id) => [id, { id }])),
                getSelectedRoles: () => new Collection(roles.map((id) => [id, { id }])),
            },
            guildId: GUILD,
            guild: FAKE_GUILD,
            reply: async (p: { embeds?: { toJSON(): { description?: string } }[]; flags?: unknown }) =>
                void out.push({ description: p.embeds?.[0]?.toJSON().description, ephemeral: p.flags !== undefined }),
        } as never);
        return out[0];
    };
    const reload = () => prisma.trackedCircle.findUniqueOrThrow({ where: { id: club.id } });

    const saved = await submitClub(fullForm.custom_id, 'u-officer', true, {
        'club:rank': 'A_PLUS', 'club:quota': '14M', 'club:period': 'WEEK',
    }, ['c-room', 'c-room-bot']);
    const afterFull = await reload();
    check('club form saves expected rank and the real quota', [afterFull.rank, String(afterFull.quota), afterFull.quotaPeriod], ['A_PLUS', '14000000', 'WEEK']);
    check('the old club fan count is cleared, not left as a second number', [afterFull.fanCountAmount, afterFull.fanCountPeriod], [null, null]);
    check('club form saves home channels', afterFull.homeChannelIds, ['c-room', 'c-room-bot']);
    check('club form confirms publicly with the quota', [saved?.ephemeral, saved?.description?.includes('14.0M per week')], [false, true]);
    check('headcount comes from uma.moe, not the stored column', saved?.description?.includes('Headcount: **2/30** (from uma.moe)'), true);

    // Home channels: the room itself, and any thread inside it, now resolve to the club.
    const inRoom = await run({ sub: 'me', userId: 'u-behind', channel: 'c-room', inThread: false });
    check('me works in a home channel', inRoom[0]?.embeds?.map((e) => e.title), ['Behind · Checkrose']);
    const inThreadOfRoom = await run({ sub: 'me', userId: 'u-behind', channel: 't-private', parent: 'c-room' });
    check('me works in a thread inside a home channel', inThreadOfRoom[0]?.embeds?.map((e) => e.title), ['Behind · Checkrose']);
    check('a thread elsewhere still does not',
        desc(await run({ sub: 'me', userId: 'u-behind', channel: 't-private', parent: 'c-other' }))?.startsWith(nowhere), true);

    await submitClub(looseForm.custom_id, 'u-officer', true, { 'club:name': 'Looser Club', 'club:rank': 'B', 'club:quota': '0.25M', 'club:period': 'MONTH' });
    check('an untracked club can be renamed', (await prisma.trackedCircle.findUniqueOrThrow({ where: { id: loose.id } })).name, 'Looser Club');
    check('renaming to a taken name is refused, ignoring case',
        (await submitClub(looseForm.custom_id, 'u-officer', true, { 'club:name': 'checkrose', 'club:rank': 'B' }))?.description,
        'A club named **checkrose** already exists.');

    await submitClub(staffForm.custom_id, 'u-assistant', false, { 'club:quota': '31M', 'club:period': 'MONTH' });
    check('club staff can change the quota', [String((await reload()).quota), (await reload()).quotaPeriod], ['31000000', 'MONTH']);
    check('staff cannot submit the full form',
        (await submitClub(fullForm.custom_id, 'u-assistant', false, { 'club:rank': 'B', 'club:quota': '1M' }))?.description,
        "Only Club Managers can change a club's name, rank or channels.");
    check('outsiders cannot submit the quota form',
        (await submitClub(staffForm.custom_id, 'u-behind', false, { 'club:quota': '1M' }))?.description?.startsWith('You must be a trainer or assistant'), true);
    check('a bad quota is refused',
        (await submitClub(staffForm.custom_id, 'u-trainer', false, { 'club:quota': 'lots' }))?.description?.startsWith('Quota must be'), true);
    check('refusals leave the club unchanged', String((await reload()).quota), '31000000');

    // /club fancount sets the same quota (in millions, as its option says).
    const runClubCmd = async (opts: FakeOptions) => {
        const log: Sent[] = [];
        await clubCmd.execute(fakeInteraction(opts, log) as never);
        return log;
    };
    await runClubCmd({ sub: 'fancount', userId: 'u-trainer', strings: { club: club.id, amount: '35', period: 'MONTH' } });
    check('/club fancount sets the quota', String((await reload()).quota), '35000000');

    // ── Roles and channels matched by name ────────────────────────────────────
    const links = await import('../src/lib/clubLinks');
    const clubsNamed = (...names: string[]) => names.map((name, i) => ({ id: `x${i}`, name, homeChannelIds: [], staffRoleIds: [] }));
    const owners = (clubs: { name: string }[], target: string) => links.clubsForName(clubs, target).map((c) => c.name);
    const cosmos = clubsNamed('Cosmos', 'Cosmos II', 'Primrose', 'Alt Lair', 'First Room', 'Café');
    check('"Cosmos Trainer" is Cosmos\'s', owners(cosmos, 'Cosmos Trainer'), ['Cosmos']);
    check('the longest club name wins: "Cosmos II Trainer"', owners(cosmos, 'Cosmos II Trainer'), ['Cosmos II']);
    check('emoji and punctuation are ignored', owners(cosmos, '🌌 Cosmos | Assistant'), ['Cosmos']);
    check('a near miss does not match', owners(cosmos, 'Cosmo Trainer'), []);
    check('a name run into another word does not match', owners(cosmos, 'cosmoschat'), []);
    check('a channel with a trailing dash matches', owners(cosmos, 'primrose-'), ['Primrose']);
    check('a bot channel matches', owners(cosmos, 'primrose-bot-'), ['Primrose']);
    check('a two-word club matches its name run together', owners(cosmos, 'altlair'), ['Alt Lair']);
    check('underscores split words', owners(cosmos, 'first_room'), ['First Room']);
    check('accents are ignored', owners(cosmos, 'cafe-chat'), ['Café']);
    check('a channel two clubs share goes to both', owners(cosmos, 'cosmos-primrose'), ['Cosmos', 'Primrose']);
    check('"Club" in a club name is optional', owners(clubsNamed('Cosmos Club'), 'Cosmos Trainer'), ['Cosmos Club']);
    check('a staff role needs Trainer or Assistant in its name',
        [links.isStaffRoleName('Cosmos Trainer'), links.isStaffRoleName('Cosmos Assistants'), links.isStaffRoleName('Cosmos')], [true, true, false]);
    check('a list equal to the matches is stored empty', links.listToStore(['b', 'a'], ['a', 'b']), []);
    check('a different list is stored', links.listToStore(['a'], ['a', 'b']), ['a']);

    // The server, as the bot reads it: Checkrose's roles and channels by name.
    FAKE_GUILD.roles.cache.set('r-ck-trainer', { id: 'r-ck-trainer', name: 'Checkrose Trainer' });
    FAKE_GUILD.roles.cache.set('r-ck-assistant', { id: 'r-ck-assistant', name: 'Checkrose Assistant' });
    FAKE_GUILD.roles.cache.set('r-ck-member', { id: 'r-ck-member', name: 'Checkrose' });
    FAKE_GUILD.roles.cache.set('r-other-trainer', { id: 'r-other-trainer', name: 'Otherrose Trainer' });
    FAKE_GUILD.channels.cache.set('c-ck-chat', { id: 'c-ck-chat', name: 'checkrose-chat', type: ChannelType.GuildText });
    FAKE_GUILD.channels.cache.set('c-ck-voice', { id: 'c-ck-voice', name: 'checkrose-vc', type: ChannelType.GuildVoice });
    await prisma.trackedCircle.update({ where: { id: club.id }, data: { homeChannelIds: [], staffRoleIds: [] } });
    await prisma.trackedCircle.update({ where: { id: other.id }, data: { active: true } });

    const byRole = await run({ sub: 'club', userId: 'u-role-asst', roles: ['r-ck-assistant'], channel: 't-check' });
    check('a "Checkrose Assistant" role holder can run /fans club', byRole.some((s) => s.kind === 'edit' && s.files === 1), true);
    check('a plain "Checkrose" member role is not staff',
        desc(await run({ sub: 'club', userId: 'u-role-member', roles: ['r-ck-member'], channel: 't-check' }))?.startsWith('Only **Checkrose**'), true);
    check("another club's Trainer role is not staff",
        desc(await run({ sub: 'club', userId: 'u-role-other', roles: ['r-other-trainer'], channel: 't-check' }))?.startsWith('Only **Checkrose**'), true);
    const roleStaff = await run({ sub: 'club', userId: 'u-role-trainer', roles: ['r-ck-trainer'], channel: 'c-staff', inThread: false });
    check("in the staff channel, a role holder's club is picked", roleStaff.find((s) => s.kind === 'edit')?.content?.includes('Checkrose'), true);

    const inNamed = await run({ sub: 'me', userId: 'u-behind', channel: 'c-ck-chat', inThread: false });
    check('a channel named after the club is a home channel', inNamed[0]?.embeds?.map((e) => e.title), ['Behind · Checkrose']);
    const inNamedThread = await run({ sub: 'me', userId: 'u-behind', channel: 't-bot', parent: 'c-ck-chat' });
    check('so is a thread inside it', inNamedThread[0]?.embeds?.map((e) => e.title), ['Behind · Checkrose']);
    check('a voice channel is not',
        desc(await run({ sub: 'me', userId: 'u-behind', channel: 'c-ck-voice', inThread: false }))?.startsWith(nowhere), true);

    // The form shows what the bot uses: the matches, when nothing is stored.
    const matchedClub = await reload();
    const matchedForm = clubCmd.buildClubEditModal(matchedClub, true, { home: ['c-ck-chat'], roles: ['r-ck-trainer', 'r-ck-assistant'] }).toJSON() as unknown as {
        custom_id: string; components: { label: string; component: { default_values?: { id: string }[] } }[];
    };
    const defaults = (label: string) => matchedForm.components.find((c) => c.label === label)?.component.default_values?.map((v) => v.id);
    check('the form pre-fills the matched roles', defaults('Staff roles'), ['r-ck-trainer', 'r-ck-assistant']);
    check('the form pre-fills the matched channels', defaults('Home channels'), ['c-ck-chat']);
    const keep = await submitClub(matchedForm.custom_id, 'u-officer', true, { 'club:rank': 'A', 'club:quota': '35M', 'club:period': 'MONTH' },
        ['c-ck-chat'], ['r-ck-assistant', 'r-ck-trainer']);
    check('saving the matches unchanged keeps following the names', [(await reload()).staffRoleIds, (await reload()).homeChannelIds], [[], []]);
    check('the confirmation says they were matched by name',
        [keep?.description?.includes('Staff roles: <@&r-ck-trainer> <@&r-ck-assistant> (matched by name)'), keep?.description?.includes('Home channels: <#c-ck-chat> (matched by name)')], [true, true]);

    await submitClub(matchedForm.custom_id, 'u-officer', true, { 'club:rank': 'A', 'club:quota': '35M', 'club:period': 'MONTH' }, ['c-ck-chat'], ['r-ck-trainer']);
    check('a changed list is stored', (await reload()).staffRoleIds, ['r-ck-trainer']);
    check('a stored list replaces the name matches',
        desc(await run({ sub: 'club', userId: 'u-role-asst', roles: ['r-ck-assistant'], channel: 't-check' }))?.startsWith('Only **Checkrose**'), true);
    check('a role holder on the stored list may use the quota form', (await submitClub(staffForm.custom_id, 'u-role-trainer', false, { 'club:quota': '36M' }, [], [], ['r-ck-trainer']))?.ephemeral, false);
    check('and it saved', String((await reload()).quota), '36000000');

    const linkList = await runClubCmd({ sub: 'links', userId: 'u-officer', officer: true });
    const linkText = linkList[0]?.embeds?.map((e) => e.description).join('\n') ?? '';
    check('/club links is private', linkList[0]?.ephemeral, true);
    check('/club links shows a stored role list as set', linkText.includes('**Checkrose**\nStaff roles: <@&r-ck-trainer>\nHome channels: <#c-ck-chat> (matched by name)'), true);
    check('/club links shows matched roles for another club', linkText.includes('**Otherrose**\nStaff roles: <@&r-other-trainer> (matched by name)'), true);
    check('/club links says when nothing matched', linkText.includes('Home channels: none found by name'), true);
    await prisma.trackedCircle.update({ where: { id: club.id }, data: { staffRoleIds: [] } });
    await prisma.trackedCircle.update({ where: { id: other.id }, data: { active: false } });
    FAKE_GUILD.roles.cache.clear();
    FAKE_GUILD.channels.cache.clear();

    // ── Clubs and circles are one thing ───────────────────────────────────────
    const runClub = runClubCmd;
    const created = await runClub({ sub: 'create', userId: 'u-officer', officer: true, strings: { name: 'Fresh Club', rank: 'A' } });
    const fresh = await prisma.trackedCircle.findFirst({ where: { guildId: GUILD, name: 'Fresh Club' } });
    check('/club create without a circle makes an untracked club', [fresh?.circleId, fresh?.rank], [null, 'A']);
    check('/club create confirms', created.find((x) => x.kind === 'edit')?.embeds?.[0]?.title, 'Club created');
    check('/club create refuses a taken name, ignoring case',
        desc(await runClub({ sub: 'create', userId: 'u-officer', officer: true, strings: { name: 'fresh club', rank: 'B' } })), 'A club named **fresh club** already exists.');

    // Casual sits below B.
    await runClub({ sub: 'create', userId: 'u-officer', officer: true, strings: { name: 'Casual Club', rank: 'CASUAL' } });
    const casual = await prisma.trackedCircle.findFirstOrThrow({ where: { guildId: GUILD, name: 'Casual Club' } });
    check('a club can be Casual', casual.rank, 'CASUAL');
    const casualForm = clubCmd.buildClubEditModal(casual, true).toJSON() as unknown as ModalJson;
    check('Casual is listed first, below B', pre(casualForm, 'Expected rank')?.options?.slice(0, 2).map((o) => o.value), ['CASUAL', 'B']);
    const { renderClubList } = await import('../src/lib/image/renderClubList');
    const png = await renderClubList([{ id: casual.id, name: casual.name, rank: 'CASUAL', headcount: null, quotaText: 'Not set' }]);
    check('the club directory draws a Casual badge', png.subarray(1, 4).toString(), 'PNG');

    const allAgain = await run({ sub: 'all', userId: 'u-officer', officer: true });
    const allTitle = allAgain.filter((x) => x.kind === 'edit').at(-1)?.embeds?.[0]?.title;
    check('fan checks skip clubs without a uma.moe circle', allTitle, 'Quota check · 1 circle');

    // /fans circle add for a circle whose uma.moe name matches an untracked club
    // folds into that club instead of making a second one.
    const { adoptUntrackedClub } = await import('../src/lib/fans/ingest');
    const added = await prisma.trackedCircle.create({ data: { guildId: GUILD, circleId: BigInt(999990), name: 'fresh CLUB', quota: BigInt(70_000_000) } });
    await prisma.fanSnapshot.create({ data: { trackedCircleId: added.id, viewerId: BigInt(77), year, month, day: 1, cumulativeFans: BigInt(5) } });
    const survivor = await adoptUntrackedClub(added);
    check('the club takes over the tracking', [survivor.id, String(survivor.circleId), String(survivor.quota)], [fresh?.id, '999990', '70000000']);
    check('the club keeps its own info', survivor.rank, 'A');
    check('the duplicate row is gone', await prisma.trackedCircle.count({ where: { id: added.id } }), 0);
    check('its fan data moved to the club', await prisma.fanSnapshot.count({ where: { trackedCircleId: survivor.id } }), 1);
    const other2 = await prisma.trackedCircle.create({ data: { guildId: GUILD, circleId: BigInt(999991), name: 'No Match' } });
    check('no same-name club means no change', (await adoptUntrackedClub(other2)).id, other2.id);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
