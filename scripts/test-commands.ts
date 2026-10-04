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
const OFFICER_ROLE = 'officer-role';
process.env.OFFICER_ROLE_IDS = OFFICER_ROLE;
// A plain channel standing in for #staff-commands.
process.env.STAFF_COMMANDS_CHANNEL_IDS = 'c-staff';
// No key: /fans all and club must still report from stored data, and say so.
delete process.env.EXTERNAL_API_KEY;

const GUILD = 'test-guild-commands';
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
    club?: string;
    /** `/uma-id id:` and `remove:` */
    id?: string;
    remove?: boolean;
    /** Channel the command runs in; a thread unless `inThread` is false. */
    channel?: string;
    inThread?: boolean;
}

function fakeInteraction(opts: FakeOptions, log: Sent[]) {
    const embedsOf = (payload: { embeds?: { toJSON(): Record<string, unknown> }[] }) =>
        payload.embeds?.map((e) => e.toJSON() as SentEmbed);
    const interaction = {
        guildId: GUILD,
        user: { id: opts.userId },
        member: { roles: { cache: new Map(opts.officer ? [[OFFICER_ROLE, {}]] : []) } },
        channelId: opts.channel ?? 'c-plain',
        channel: { isThread: () => opts.inThread ?? opts.channel !== undefined },
        deferred: false,
        replied: false,
        inGuild: () => true,
        options: {
            getSubcommandGroup: () => opts.group ?? null,
            getSubcommand: () => opts.sub,
            getString: (name: string) =>
                name === 'circle' ? opts.circle ?? null : name === 'club' ? opts.club ?? null : name === 'id' ? opts.id ?? null : null,
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
    await prisma.club.deleteMany({ where: { name: 'Test Checkrose Club' } });
    // 31M a month over at most 31 days is at least 1M a day; 3 days owe ~3M.
    const circle = await prisma.trackedCircle.create({
        data: {
            guildId: GUILD, circleId: BigInt(999777), name: 'Checkrose', quota: BigInt(31_000_000),
            reportChannelId: 't-check', alertChannelId: 'c-alert',
        },
    });
    // Its /club record, with a Trainer and an Assistant.
    const club = await prisma.club.create({
        data: {
            name: 'Test Checkrose Club', rank: 'S',
            members: { create: [{ discordUserId: 'u-trainer', role: 'TRAINER' }, { discordUserId: 'u-assistant', role: 'ASSISTANT' }] },
        },
    });

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

    const nowhere = "Run this in your circle's report or alert channel, or in <#c-staff>.";
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
    const unlinkedClub = await run({ sub: 'club', userId: 'u-trainer', channel: 't-check' });
    check('club on an unlinked circle is for Club Managers only', desc(unlinkedClub)?.includes('not linked to a club yet'), true);

    const link = await run({ group: 'circle', sub: 'config', userId: 'u-officer', officer: true, circle: circle.id, club: club.id });
    check('circle config links the club', (await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } })).clubId, club.id);
    check('circle config says the staff can now check', link[0]?.embeds?.[0]?.description?.includes('/fans club'), true);

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

    await run({ group: 'circle', sub: 'config', userId: 'u-officer', officer: true, circle: circle.id, club: 'none' });
    check('circle config club:none unlinks', (await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } })).clubId, null);

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
    const editable = await prisma.club.update({ where: { id: club.id }, data: { headcount: 8, fanCountAmount: 50, fanCountPeriod: 'MONTH' } });
    type ModalJson = { custom_id: string; components: { label: string; component: { custom_id: string; value?: string; options?: { value: string; default?: boolean }[] } }[] };
    const fullForm = clubCmd.buildClubEditModal(editable, true).toJSON() as unknown as ModalJson;
    const staffForm = clubCmd.buildClubEditModal(editable, false).toJSON() as unknown as ModalJson;
    const pre = (f: ModalJson, label: string) => f.components.find((c) => c.label === label)?.component;
    check('club form for Club Managers has every field', fullForm.components.map((c) => c.label), ['Name', 'Rank', 'Headcount', 'Fan count', 'Fan count period']);
    check('club form for staff has the stats only', staffForm.components.map((c) => c.label), ['Headcount', 'Fan count', 'Fan count period']);
    check('club form is pre-filled', [pre(fullForm, 'Name')?.value, pre(fullForm, 'Headcount')?.value, pre(fullForm, 'Fan count')?.value], ['Test Checkrose Club', '8', '50M']);
    check('club form pre-selects rank and period',
        [pre(fullForm, 'Rank')?.options?.find((o) => o.default)?.value, pre(fullForm, 'Fan count period')?.options?.find((o) => o.default)?.value], ['S', 'MONTH']);
    check('club form is routed by its prefix', clubCmd.isClubModal(fullForm.custom_id), true);

    /** Submits the club form with the given values, as the given user. */
    const submitClub = async (customId: string, userId: string, officer: boolean, values: Record<string, string>) => {
        const out: { description?: string | undefined; ephemeral: boolean }[] = [];
        await clubCmd.handleClubModal({
            customId,
            user: { id: userId },
            member: { id: userId, roles: { cache: new Map(officer ? [[OFFICER_ROLE, {}]] : []) } },
            fields: {
                getTextInputValue: (id: string) => values[id] ?? '',
                getStringSelectValues: (id: string) => (values[id] ? [values[id]] : []),
            },
            reply: async (p: { embeds?: { toJSON(): { description?: string } }[]; flags?: unknown }) =>
                void out.push({ description: p.embeds?.[0]?.toJSON().description, ephemeral: p.flags !== undefined }),
        } as never);
        return out[0];
    };
    const reload = () => prisma.club.findUniqueOrThrow({ where: { id: club.id } });

    const saved = await submitClub(fullForm.custom_id, 'u-officer', true, {
        'club:name': 'Test Checkrose Club', 'club:rank': 'A_PLUS', 'club:headcount': '12', 'club:fancount': '0.5M', 'club:period': 'WEEK',
    });
    const afterFull = await reload();
    check('club form saves every field', [afterFull.rank, afterFull.headcount, afterFull.fanCountAmount, afterFull.fanCountPeriod], ['A_PLUS', 12, 0.5, 'WEEK']);
    check('club form confirms publicly', [saved?.ephemeral, saved?.description?.includes('0.5M/week')], [false, true]);

    await submitClub(staffForm.custom_id, 'u-assistant', false, { 'club:headcount': '13', 'club:fancount': '', 'club:period': 'WEEK' });
    const afterStaff = await reload();
    check("club staff can save the stats", afterStaff.headcount, 13);
    check('an empty fan count clears it', [afterStaff.fanCountAmount, afterStaff.fanCountPeriod], [null, null]);
    check('staff cannot submit the full form',
        (await submitClub(fullForm.custom_id, 'u-assistant', false, { 'club:name': 'Hijacked', 'club:headcount': '1' }))?.description,
        'Only Club Managers can rename a club or change its rank.');
    check('outsiders cannot submit the stats form',
        (await submitClub(staffForm.custom_id, 'u-behind', false, { 'club:headcount': '1' }))?.description?.startsWith('You must be a trainer or assistant'), true);
    check('headcount over the limit is refused',
        (await submitClub(staffForm.custom_id, 'u-trainer', false, { 'club:headcount': '31' }))?.description, 'Headcount must be a whole number from 0 to 30.');
    check('a bad fan count is refused',
        (await submitClub(staffForm.custom_id, 'u-trainer', false, { 'club:headcount': '5', 'club:fancount': 'lots' }))?.description?.startsWith('Fan count must be'), true);
    check('refusals leave the club unchanged', (await reload()).headcount, 13);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    await prisma.club.deleteMany({ where: { id: club.id } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
