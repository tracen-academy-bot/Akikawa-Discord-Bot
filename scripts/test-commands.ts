/**
 * `/fans check all|club|me` and `/fans circle config club:`, driven through
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
// No key: /fans check must still report from stored data, and say so.
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
            getString: (name: string) => (name === 'circle' ? opts.circle ?? null : name === 'club' ? opts.club ?? null : null),
            getBoolean: () => null,
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

    // ── /fans check me ────────────────────────────────────────────────────────
    const me = await run({ group: 'check', sub: 'me', userId: 'u-behind', channel: 't-check' });
    const embed = me[0]?.embeds?.[0];
    const field = (name: string) => embed?.fields?.find((f) => f.name === name)?.value;
    check('me replies privately', me[0]?.ephemeral, true);
    check("me uses the thread's circle", embed?.title, 'Behind · Checkrose');
    check('me shows fans earned', field('Fans this month'), '300,000');
    check('me ranks among current members only', field('Rank'), '2 of 2');
    check('me says how far behind', field('Status')?.startsWith('Behind by **'), true);

    check('me outside a thread is refused', desc(await run({ group: 'check', sub: 'me', userId: 'u-behind' })), "Run this inside your circle's thread.");
    check('me in a thread no circle uses is refused',
        desc(await run({ group: 'check', sub: 'me', userId: 'u-behind', channel: 't-random' }))?.includes('not a tracked circle'), true);
    check('me without a link explains how to link',
        desc(await run({ group: 'check', sub: 'me', userId: 'u-nobody', channel: 't-check' }))?.includes('/fans link'), true);
    check('me for a leaver says not a current member',
        desc(await run({ group: 'check', sub: 'me', userId: 'u-gone', channel: 't-check' }))?.includes('not a current member'), true);

    // ── /fans check club ──────────────────────────────────────────────────────
    const unlinkedClub = await run({ group: 'check', sub: 'club', userId: 'u-trainer', channel: 't-check' });
    check('club on an unlinked circle is for Club Managers only', desc(unlinkedClub)?.includes('not linked to a club yet'), true);

    const link = await run({ group: 'circle', sub: 'config', userId: 'u-officer', officer: true, circle: circle.id, club: club.id });
    check('circle config links the club', (await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } })).clubId, club.id);
    check('circle config says the staff can now check', link[0]?.embeds?.[0]?.description?.includes('/fans check club'), true);

    check("club lets the club's Assistant post too",
        (await run({ group: 'check', sub: 'club', userId: 'u-assistant', channel: 't-check' })).some((s) => s.kind === 'edit' && s.files === 1), true);
    check('club refuses someone who is not club staff',
        desc(await run({ group: 'check', sub: 'club', userId: 'u-behind', channel: 't-check' })), "Only **Checkrose**'s Trainers, Assistants and Club Managers can run this.");
    check('club refuses outside a thread',
        desc(await run({ group: 'check', sub: 'club', userId: 'u-trainer' })), "Run this inside your circle's thread.");

    const clubCheck = await run({ group: 'check', sub: 'club', userId: 'u-trainer', channel: 't-check' });
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

    // ── /fans check all ───────────────────────────────────────────────────────
    check('all is for Club Managers', desc(await run({ group: 'check', sub: 'all', userId: 'u-trainer' })), 'Only Club Managers can check every circle.');

    // Checkrose has channels; Otherrose has none, so its report comes here as
    // a public follow-up.
    const all = await run({ group: 'check', sub: 'all', userId: 'u-officer', officer: true });
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
    const activeOnly = await run({ group: 'check', sub: 'all', userId: 'u-officer', officer: true });
    check('all skips paused circles', activeOnly.some((s) => s.kind === 'followUp'), false);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    await prisma.club.deleteMany({ where: { id: club.id } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
