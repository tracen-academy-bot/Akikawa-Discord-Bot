/**
 * `/fans check` and `/fans me`, driven through the real command handler with
 * a fake Discord interaction and a real Postgres.
 *
 * Seeds a circle in the current game month (both commands read the current
 * month) with a trainer on pace, one behind, and one who left, then checks
 * what each command replies and posts.
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
    kind: 'reply' | 'defer' | 'edit' | 'channel';
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
function fakeInteraction(opts: { sub: string; userId: string; officer?: boolean; circle?: string }, log: Sent[]) {
    const embedsOf = (payload: { embeds?: { toJSON(): Record<string, unknown> }[] }) =>
        payload.embeds?.map((e) => e.toJSON() as SentEmbed);
    const interaction = {
        guildId: GUILD,
        user: { id: opts.userId },
        member: { roles: { cache: new Map(opts.officer ? [[OFFICER_ROLE, {}]] : []) } },
        deferred: false,
        replied: false,
        inGuild: () => true,
        options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => opts.sub,
            getString: (name: string) => (name === 'circle' ? opts.circle ?? null : null),
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
        data: { guildId: GUILD, circleId: BigInt(999777), name: 'Checkrose', quota: BigInt(31_000_000) },
    });

    const BASE = 1_000_000_000;
    const seed = async (viewerId: number, name: string, perDay: number, lastStored: number) => {
        for (let stored = 1; stored <= lastStored; stored += 1) {
            await prisma.fanSnapshot.create({
                data: {
                    trackedCircleId: circle.id, viewerId: BigInt(viewerId), trainerName: name,
                    year, month, day: stored, cumulativeFans: BigInt(BASE + viewerId + perDay * (stored - 1)),
                },
            });
        }
    };
    await seed(1, 'Ahead', 5_000_000, 4); // 15M over 3 days: on pace
    await seed(2, 'Behind', 100_000, 4); // 300K over 3 days: behind
    await seed(3, 'Gone', 9_000_000, 2); // left after day 1

    await prisma.trainerLink.createMany({
        data: [
            { guildId: GUILD, discordUserId: 'u-behind', viewerId: BigInt(2) },
            { guildId: GUILD, discordUserId: 'u-gone', viewerId: BigInt(3) },
        ],
    });

    // ── /fans me ──────────────────────────────────────────────────────────────
    const me = await run({ sub: 'me', userId: 'u-behind' });
    const embed = me[0]?.embeds?.[0];
    const field = (name: string) => embed?.fields?.find((f) => f.name === name)?.value;
    check('me replies privately', me[0]?.ephemeral, true);
    check('me titles the trainer and circle', embed?.title, 'Behind · Checkrose');
    check('me shows fans earned', field('Fans so far'), '300,000');
    check('me ranks among current members only', field('Rank'), '2 of 2');
    check('me says how far behind', field('Status')?.startsWith('Behind by **'), true);

    const unlinked = await run({ sub: 'me', userId: 'u-nobody' });
    check('me without a link explains how to link', unlinked[0]?.embeds?.[0]?.description?.includes('/fans link'), true);

    const gone = await run({ sub: 'me', userId: 'u-gone' });
    check('me for a leaver says not a current member', gone[0]?.embeds?.[0]?.description?.includes('not a current member'), true);

    // ── /fans check ───────────────────────────────────────────────────────────
    const denied = await run({ sub: 'check', userId: 'u-behind' });
    check('check is for Club Managers', denied[0]?.embeds?.[0]?.description, 'Only Club Managers can run a quota check.');

    // No report channel: everything lands in the channel the command ran in.
    const here = await run({ sub: 'check', userId: 'u-officer', officer: true });
    const posted = here.find((s) => s.kind === 'edit');
    check('check without a report channel replies publicly', here[0]?.ephemeral, false);
    check('check attaches the report image', posted?.files, 1);
    check('check names who is behind', posted?.content?.includes('1 trainer behind quota'), true);
    check('check tags the linked trainer', posted?.users, ['u-behind']);
    check('check says it used stored data without a key', posted?.content?.includes('No uma.moe API key'), true);
    check('check does not list the leaver', posted?.content?.includes('Gone'), false);

    // Report and alert channels set: posted there, confirmed privately.
    await prisma.trackedCircle.update({ where: { id: circle.id }, data: { reportChannelId: 'c-report', alertChannelId: 'c-alert' } });
    const there = await run({ sub: 'check', userId: 'u-officer', officer: true });
    const toReport = there.find((s) => s.kind === 'channel' && s.channelId === 'c-report');
    const toAlert = there.find((s) => s.kind === 'channel' && s.channelId === 'c-alert');
    const confirm = there.find((s) => s.kind === 'edit');
    check('check confirms privately when posting elsewhere', there[0]?.ephemeral, true);
    check('check posts the image to the report channel', toReport?.files, 1);
    check('check posts the alert to the alert channel', toAlert?.users, ['u-behind']);
    check('check confirms where it posted', confirm?.embeds?.[0]?.description?.includes('<#c-report>'), true);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.trainerLink.deleteMany({ where: { guildId: GUILD } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
