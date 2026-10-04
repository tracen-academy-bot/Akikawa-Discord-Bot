import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    AttachmentBuilder,
    ChannelType,
    GuildMember,
    MessageFlags,
    type TextBasedChannel,
    type User,
} from 'discord.js';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { isClubStaff, isOfficer, type StaffCandidate } from '../lib/permissions';
import { guildClubs, homeChannelsOf, type LinkableGuild } from '../lib/clubLinks';
import { errorEmbed, successEmbed, infoEmbed } from '../lib/embeds';
import { autocompleteTrackedCircle } from '../lib/fans/circleAutocomplete';
import { TRACKED, adoptUntrackedClub, backfillOnce, currentGameMonth, syncBenchmark, syncCircle } from '../lib/fans/ingest';
import { TRAINER_WINDOW_DAYS, buildBenchmark, buildTrainerReport, currentCircleProgress, formatReportDate } from '../lib/fans/reports';
import {
    describeQuota,
    formatCompactFans,
    formatFans,
    toSafeNumber,
    type CircleProgress,
    type MemberProgress,
    type QuotaPeriod,
} from '../lib/fans/metrics';
import { buildCircleReport, postReport } from '../lib/fans/scheduler';
import { isConfigured, searchCircles } from '../lib/umamoe/client';
import { renderFanReport } from '../lib/image/renderFanReport';
import { renderTrainerReport } from '../lib/image/renderTrainerReport';
import { renderBenchmark } from '../lib/image/renderBenchmark';

/** Quota period choices for `/fans circle add` and `config`. Weeks restart on the 1st. */
const QUOTA_PERIOD_CHOICES = [
    { name: 'Daily', value: 'DAY' },
    { name: 'Weekly (days 1-7, 8-14, ... of the month)', value: 'WEEK' },
    { name: 'Biweekly (days 1-14, 15-28, ... of the month)', value: 'BIWEEKLY' },
    { name: 'Monthly', value: 'MONTH' },
] as const;

/** Narrows a command option to a quota period, or null when absent or unknown. */
export function parsePeriod(value: string | null | undefined): QuotaPeriod | null {
    return value === 'DAY' || value === 'WEEK' || value === 'BIWEEKLY' || value === 'MONTH' ? value : null;
}

/**
 * Club fan-quota tracking backed by uma.moe.
 *
 * Reports read from stored snapshots rather than calling the API, so they stay
 * fast and keep working during a uma.moe outage. Only `/fans circle sync`
 * reaches out to the API on demand.
 */

/** Channel types a report or alert may be sent to. Threads are included. */
const REPORT_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
] as const;

export const data = new SlashCommandBuilder()
    .setName('fans')
    .setDescription('Club fan quota tracking.')
    .addSubcommand((sub) =>
        sub
            .setName('report')
            .setDescription('Post the club fan quota leaderboard.')
            .addStringOption((opt) =>
                opt.setName('circle').setDescription('Tracked circle (defaults to the only one)').setAutocomplete(true),
            ),
    )
    .addSubcommand((sub) =>
        sub.setName('all').setDescription("Sync every active circle and post each report and alert to its channels (Club Managers)."),
    )
    .addSubcommand((sub) =>
        sub
            .setName('club')
            .setDescription("Sync this channel's circle and post its report and alert here (the club's staff).")
            .addStringOption((opt) =>
                opt.setName('circle').setDescription('Which circle, when several could be meant (defaults to yours)').setAutocomplete(true),
            ),
    )
    .addSubcommand((sub) => sub.setName('me').setDescription("Your own progress in this channel's circle, visible only to you."))
    .addSubcommand((sub) =>
        sub
            .setName('trainer')
            .setDescription("Show one trainer's fan report.")
            .addUserOption((opt) => opt.setName('member').setDescription('Discord member (defaults to you)'))
            .addStringOption((opt) =>
                opt.setName('circle').setDescription("Tracked circle (defaults to the trainer's own)").setAutocomplete(true),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('benchmark')
            .setDescription('Show what it takes to sit in the top 10 / 30 / 100 circles, and where yours sits.')
            .addStringOption((opt) =>
                opt.setName('circle').setDescription('Overlay this circle (defaults to the first tracked)').setAutocomplete(true),
            ),
    )
    .addSubcommandGroup((group) =>
        group
            .setName('circle')
            .setDescription('Manage tracked circles. Club Managers only.')
            .addSubcommand((sub) =>
                sub
                    .setName('add')
                    .setDescription('Start tracking a uma.moe circle.')
                    .addStringOption((opt) =>
                        opt.setName('circle_id').setDescription('uma.moe circle ID (from uma.moe/circles)').setRequired(true),
                    )
                    .addStringOption((opt) =>
                        opt.setName('quota').setDescription('Fan quota per member per period, e.g. 80M, 500K, 1.2B').setRequired(true),
                    )
                    .addStringOption((opt) =>
                        opt.setName('period').setDescription('What the quota covers (default: monthly)').addChoices(...QUOTA_PERIOD_CHOICES),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('remove')
                    .setDescription('Stop tracking a circle and delete its snapshots.')
                    .addStringOption((opt) =>
                        opt.setName('circle').setDescription('Tracked circle').setRequired(true).setAutocomplete(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('config')
                    .setDescription("Change a circle's quota, report channel, or paused state.")
                    .addStringOption((opt) =>
                        opt.setName('circle').setDescription('Tracked circle').setRequired(true).setAutocomplete(true),
                    )
                    .addStringOption((opt) => opt.setName('quota').setDescription('Fan quota per member per period, e.g. 80M, 500K'))
                    .addStringOption((opt) =>
                        opt.setName('period').setDescription('What the quota covers').addChoices(...QUOTA_PERIOD_CHOICES),
                    )
                    .addChannelOption((opt) =>
                        opt
                            .setName('report_channel')
                            .setDescription('Where scheduled reports go. A thread works.')
                            .addChannelTypes(...REPORT_CHANNEL_TYPES),
                    )
                    .addChannelOption((opt) =>
                        opt
                            .setName('alert_channel')
                            .setDescription('Where behind-quota alerts go. A thread works.')
                            .addChannelTypes(...REPORT_CHANNEL_TYPES),
                    )
                    .addBooleanOption((opt) => opt.setName('active').setDescription('Pause or resume syncing')),
            )
            .addSubcommand((sub) => sub.setName('list').setDescription('List tracked circles.'))
            .addSubcommand((sub) =>
                sub
                    .setName('search')
                    .setDescription('Search uma.moe for a circle ID by name.')
                    .addStringOption((opt) => opt.setName('name').setDescription('Circle name').setRequired(true)),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('debug')
                    .setDescription('Dump per-member join facts for this month (for diagnosing quota day counts).')
                    .addStringOption((opt) =>
                        opt.setName('circle').setDescription('Tracked circle (defaults to the only one)').setAutocomplete(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('sync')
                    .setDescription('Pull the latest fan data from uma.moe now.')
                    .addStringOption((opt) =>
                        opt.setName('circle').setDescription('Tracked circle (defaults to all)').setAutocomplete(true),
                    ),
            ),
    );

/**
 * Channels besides a circle's own report or alert channel where `/fans club`
 * and `/fans me` may run, comma-separated. Defaults to the club server's #staff-commands, so it works
 * without configuration; set `STAFF_COMMANDS_CHANNEL_IDS` to change it.
 */
const STAFF_CHANNEL_IDS = new Set(
    (process.env.STAFF_COMMANDS_CHANNEL_IDS || '1427571157120450733')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
);

export async function autocomplete(interaction: AutocompleteInteraction) {
    if (interaction.options.getFocused(true).name === 'circle') {
        await autocompleteTrackedCircle(interaction);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a fan amount into whole fans: "80M", "80m", "2.5M", "500k", "1.5B",
 * a bare number, or a number with thousands separators ("80,000,000",
 * "1,500M"). K, M and B are case-insensitive; spaces are ignored.
 */
export function parseQuota(input: string): number | null {
    // Thousands separators only between digit groups, so "8,0M" is rejected
    // rather than silently read as 80M.
    const cleaned = /^\s*\d{1,3}(,\d{3})+(\.\d+)?\s*[kmb]?\s*$/i.test(input) ? input.replace(/,/g, '') : input;
    const match = /^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(cleaned);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;

    const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase() ?? ''] ?? 1;
    return Math.round(amount * multiplier);
}

/**
 * Resolves the circle a command should act on.
 *
 * Falls back to the guild's only tracked circle when the option is omitted,
 * so a server tracking one circle never has to name it.
 */
async function resolveCircle(
    interaction: ChatInputCommandInteraction,
    required: boolean,
): Promise<TrackedCircle | null> {
    const guildId = interaction.guildId!;
    const id = interaction.options.getString('circle');

    if (id) {
        const circle = await prisma.trackedCircle.findFirst({ where: { id, guildId, ...TRACKED } });
        if (!circle) {
            await reply(interaction, errorEmbed('That tracked circle could not be found.'));
            return null;
        }
        return circle;
    }

    const circles = await prisma.trackedCircle.findMany({ where: { guildId, ...TRACKED } });
    if (circles.length === 1) return circles[0]!;

    if (required || circles.length > 1) {
        await reply(
            interaction,
            errorEmbed(
                circles.length === 0
                    ? 'No circles are tracked yet. A Club Manager can add one with `/fans circle add`.'
                    : 'This server tracks several circles. Name one with the `circle` option.',
            ),
        );
        return null;
    }
    return null;
}

/** Replies or edits, depending on whether the interaction was already deferred. */
async function reply(interaction: ChatInputCommandInteraction, embed: ReturnType<typeof errorEmbed>) {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
    } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}

/** Rejects the command unless the caller is a Club Manager. */
async function requireOfficer(interaction: ChatInputCommandInteraction, action: string): Promise<boolean> {
    if (isOfficer(interaction.member as GuildMember)) return true;
    await reply(interaction, errorEmbed(`Only Club Managers can ${action}.`));
    return false;
}

/** Explains the missing API key rather than failing with a raw 403. */
async function requireApiKey(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (isConfigured()) return true;
    await reply(
        interaction,
        errorEmbed(
            'No uma.moe API key is configured. The circle endpoints reject unauthenticated requests. ' +
                'Generate a key from a uma.moe account and set `EXTERNAL_API_KEY`.',
        ),
    );
    return false;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'circle') {
        await handleCircleGroup(interaction, sub);
        return;
    }

    switch (sub) {
        case 'report':
            await handleReport(interaction);
            break;
        case 'all':
            await handleCheckAll(interaction);
            break;
        case 'club':
            await handleCheckClub(interaction);
            break;
        case 'me':
            await handleCheckMe(interaction);
            break;
        case 'trainer':
            await handleTrainer(interaction);
            break;
        case 'benchmark':
            await handleBenchmark(interaction);
            break;
    }
}

// ─── Reports ──────────────────────────────────────────────────────────────────

async function handleReport(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const circle = await resolveCircle(interaction, false);
    if (!circle) return;

    const progress = await currentCircleProgress(circle);
    if (!progress) {
        await reply(
            interaction,
            errorEmbed(
                `No fan data has been ingested for **${circle.name}** yet. ` +
                    'Run `/fans circle sync` to pull it from uma.moe.',
            ),
        );
        return;
    }

    const { year, month } = currentGameMonth();
    const buffer = await renderFanReport(progress, {
        circleName: circle.name,
        monthlyRank: circle.monthlyRank,
        memberCount: progress.members.length,
        dateLabel: formatReportDate(year, month, progress.daysElapsed),
    });

    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `fan-report-${circle.circleId}.png` })],
    });
}

/** A report as posted into the channel the command ran in. */
type CheckPost = { content: string; files: AttachmentBuilder[]; allowedMentions: { users: string[] } };

/**
 * Refreshes one circle from uma.moe for a quota check.
 *
 * @returns A note when the check has to fall back on stored data, else ''.
 */
async function syncForCheck(circle: TrackedCircle): Promise<string> {
    if (!isConfigured()) return 'No uma.moe API key is set, so this uses the last stored data.';
    try {
        await syncCircle(circle);
        return '';
    } catch (e) {
        return `Sync failed (${e instanceof Error ? e.message : String(e)}), so this uses the last stored data.`;
    }
}

/**
 * Checks one circle: sync, then post its report and alert to its configured
 * channels, or hand them to `postHere` when it has no report channel.
 *
 * @returns One summary line for the person who ran the check.
 */
async function checkCircle(
    interaction: ChatInputCommandInteraction,
    circle: TrackedCircle,
    postHere: (post: CheckPost) => Promise<void>,
): Promise<string> {
    const syncNote = await syncForCheck(circle);
    const fresh = await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } });
    const withNote = (line: string) => [line, syncNote].filter(Boolean).join(' ');

    if (fresh.reportChannelId) {
        const posted = await postReport(interaction.client, fresh.id);
        if (!posted) {
            return withNote(`**${fresh.name}** — could not post to <#${fresh.reportChannelId}>. Check the bot can send messages there, or that the circle has data this month.`);
        }
        const alertNote =
            posted.behindCount === 0
                ? 'nobody is behind.'
                : posted.alerted
                  ? `${posted.behindCount} behind, alerted in <#${fresh.alertChannelId}>.`
                  : `${posted.behindCount} behind; no alert channel is set, so nobody was tagged.`;
        return withNote(`**${fresh.name}** — report posted in <#${fresh.reportChannelId}>; ${alertNote}`);
    }

    const report = await buildCircleReport(fresh);
    if (!report) return withNote(`**${fresh.name}** — no fan data this month yet.`);
    await postHere({
        content: [report.alert?.content ?? `**${fresh.name}** — nobody is behind quota.`, syncNote].filter(Boolean).join('\n'),
        files: [report.image],
        allowedMentions: { users: report.alert?.users ?? [] },
    });
    return `**${fresh.name}** — posted here; ${report.behindCount === 0 ? 'nobody is behind.' : `${report.behindCount} behind.`}`;
}

/**
 * `/fans all`: the daily job's sync, report and alert for every active
 * circle, now. Club Managers only, since it posts to every circle's channels.
 *
 * Each circle is synced from uma.moe first so the figures are current, then
 * its report image and behind-quota alert go to its configured channels; a
 * circle with no report channel gets both in the channel the command was run
 * in. The person running it gets a private summary. If a sync fails, that
 * circle is reported from the last stored data and says so; one circle
 * failing never stops the others.
 */
async function handleCheckAll(interaction: ChatInputCommandInteraction) {
    if (!(await requireOfficer(interaction, 'check every circle'))) return;

    const circles = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId!, active: true, ...TRACKED },
        orderBy: { name: 'asc' },
    });
    if (circles.length === 0) {
        await reply(interaction, errorEmbed('No active circles to check.'));
        return;
    }

    // A private summary. Reports for circles without a channel go here as
    // public follow-ups. Discord turns the first follow-up after a deferred
    // reply into an edit of it, so the private reply is filled in before any
    // follow-up is sent.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let acknowledged = false;
    const postHere = async (post: CheckPost) => {
        if (!acknowledged) {
            await interaction.editReply({ embeds: [infoEmbed('Quota check', 'Posting reports below.')] });
            acknowledged = true;
        }
        await interaction.followUp(post);
    };

    const lines: string[] = [];
    for (const circle of circles) {
        try {
            lines.push(await checkCircle(interaction, circle, postHere));
        } catch (e) {
            lines.push(`**${circle.name}** — failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    await interaction.editReply({ embeds: [successEmbed(`Quota check · ${circles.length} circle${circles.length === 1 ? '' : 's'}`, lines.join('\n'))] });
}

/**
 * Where `/fans club` and `me` may run, and which clubs they may be about
 * there. In a staff channel, every tracked club. Elsewhere, the tracked clubs
 * whose home channels include this channel (or, in a thread, the channel the
 * thread is in), or that post their report or alerts here. Home channels are
 * the ones set with `/club edit`, or else the channels named after the club
 * (see `clubLinks.ts`). Replies with the reason and returns null anywhere
 * else.
 */
async function circlesHere(interaction: ChatInputCommandInteraction): Promise<TrackedCircle[] | null> {
    const guildId = interaction.guildId!;
    // Only clubs with a uma.moe circle have fan figures to check.
    const tracked = await prisma.trackedCircle.findMany({ where: { guildId, ...TRACKED }, orderBy: { name: 'asc' } });
    if (STAFF_CHANNEL_IDS.has(interaction.channelId)) return tracked;

    const channelId = interaction.channelId;
    const parentId = interaction.channel?.isThread() ? interaction.channel.parentId : null;
    const guild = interaction.guild as LinkableGuild | null;
    // Name matching picks the longest matching club name, so it needs every club.
    const clubs = guild ? await guildClubs(guildId) : [];
    const here = tracked.filter((circle) => {
        if (circle.reportChannelId === channelId || circle.alertChannelId === channelId) return true;
        const home = guild ? homeChannelsOf(circle, clubs, guild).ids : circle.homeChannelIds;
        return home.includes(channelId) || (parentId !== null && home.includes(parentId));
    });
    if (here.length > 0) return here;
    const staffChannel = [...STAFF_CHANNEL_IDS][0];
    await reply(
        interaction,
        errorEmbed(
            `Run this in one of your club's channels${staffChannel ? `, or in <#${staffChannel}>` : ''}. ` +
                "A Club Manager can set a club's home channels with `/club edit`.",
        ),
    );
    return null;
}

/**
 * True when the caller may run `/fans club` for a club: a Club Manager, or one
 * of the club's staff (a Trainer or Assistant, added with `/club member` or
 * holding the club's Trainer or Assistant role). Replies with the reason when
 * not.
 */
async function requireClubTrainer(interaction: ChatInputCommandInteraction, circle: TrackedCircle): Promise<boolean> {
    const member = interaction.member as StaffCandidate;
    if (isOfficer(member)) return true;
    if (await isClubStaff(member, circle)) return true;
    await reply(interaction, errorEmbed(`Only **${circle.name}**'s Trainers, Assistants and Club Managers can run this.`));
    return false;
}

/**
 * The one circle `/fans club` is about: the one named with `circle`,
 * the only one this channel could mean, or the one linked to the caller's own
 * `/club` among them. Replies with the reason and returns null when that
 * does not pin down exactly one.
 */
async function circleForClubCheck(interaction: ChatInputCommandInteraction, pool: TrackedCircle[]): Promise<TrackedCircle | null> {
    const named = interaction.options.getString('circle');
    if (named) {
        const circle = pool.find((c) => c.id === named) ?? null;
        if (!circle) await reply(interaction, errorEmbed('That circle does not post here. Run this in its own channel or in #staff-commands.'));
        return circle;
    }
    if (pool.length === 1) return pool[0]!;

    const member = interaction.member as StaffCandidate;
    const clubs = member.guild ? await guildClubs(interaction.guildId!) : [];
    const mine: TrackedCircle[] = [];
    for (const c of pool) if (await isClubStaff(member, c, clubs)) mine.push(c);
    if (mine.length === 1) return mine[0]!;
    await reply(
        interaction,
        errorEmbed(mine.length > 1 ? 'You are staff on several circles. Name one with `circle:`.' : 'Several circles could be meant here. Name one with `circle:`.'),
    );
    return null;
}

/**
 * `/fans club`: sync one circle and post its report and behind-quota
 * alert right here, publicly. Runs in a channel or thread the circle reports
 * or alerts to, so the club sees it where it talks, or in a staff channel
 * (#staff-commands). For the club's staff (Trainers and Assistants) and Club
 * Managers.
 */
async function handleCheckClub(interaction: ChatInputCommandInteraction) {
    const pool = await circlesHere(interaction);
    if (!pool) return;
    const circle = await circleForClubCheck(interaction, pool);
    if (!circle) return;
    if (!(await requireClubTrainer(interaction, circle))) return;

    await interaction.deferReply();
    const syncNote = await syncForCheck(circle);
    const fresh = await prisma.trackedCircle.findUniqueOrThrow({ where: { id: circle.id } });
    const report = await buildCircleReport(fresh);
    if (!report) {
        await reply(interaction, errorEmbed(`No fan data for **${fresh.name}** this month yet.${syncNote ? ` ${syncNote}` : ''}`));
        return;
    }
    await interaction.editReply({
        content: [report.alert?.content ?? `**${fresh.name}** — nobody is behind quota.`, syncNote].filter(Boolean).join('\n'),
        files: [report.image],
        allowedMentions: { users: report.alert?.users ?? [] },
    });
}

/**
 * The tracked circles a trainer is currently in, with that circle's progress.
 *
 * Used when a command about one trainer omits `circle`: the trainer's link
 * already says who they are, so the circle is found from the data instead of
 * asked for. "Currently in" is the same rule the reports use, so someone who
 * left a circle is not matched to it.
 */
async function circlesForTrainer(
    guildId: string,
    viewerId: bigint,
): Promise<{ circle: TrackedCircle; progress: CircleProgress; member: MemberProgress }[]> {
    const { year, month } = currentGameMonth();
    const candidates = await prisma.trackedCircle.findMany({
        where: { guildId, snapshots: { some: { viewerId, year, month } } },
        orderBy: { name: 'asc' },
    });
    const found: { circle: TrackedCircle; progress: CircleProgress; member: MemberProgress }[] = [];
    for (const circle of candidates) {
        const progress = await currentCircleProgress(circle);
        const member = progress?.members.find((m) => m.viewerId === toSafeNumber(viewerId));
        if (progress && member) found.push({ circle, progress, member });
    }
    return found;
}

/** One member's progress card, as `/fans me` shows it. */
function progressCard(circle: TrackedCircle, progress: CircleProgress, member: MemberProgress) {
    const checkpoints = progress.period !== 'MONTH';
    const status = member.onPace
        ? checkpoints
            ? 'Made every check so far'
            : `On pace (${formatFans(member.total - member.expected)} ahead of where you need to be)`
        : `Behind by **${formatFans(member.behind)}**${checkpoints ? ` since the day ${progress.checkpointDay} check` : ''}`;
    const fields = [
        { name: 'Fans this month', value: formatFans(member.total), inline: true },
        {
            name: checkpoints ? (progress.checkpointDay > 0 ? `Due at day ${progress.checkpointDay} check` : 'Due so far') : 'Expected by now',
            value: formatFans(member.expected),
            inline: true,
        },
        { name: 'Rank', value: `${member.rank} of ${progress.members.length}`, inline: true },
        { name: 'Status', value: status, inline: false },
    ];
    if (checkpoints && progress.daysRemaining > 0) {
        fields.push({ name: `Due by end of day ${progress.nextCheckpointDay}`, value: formatFans(member.target), inline: true });
    }
    fields.push(
        { name: 'Need per day', value: member.needPerDay === null ? 'Nothing more needed' : formatFans(member.needPerDay), inline: true },
        { name: 'Projected', value: `${formatCompactFans(member.projectedTotal)} of ${formatCompactFans(progress.effectiveQuota)}`, inline: true },
    );
    return infoEmbed(
        `${member.trainerName} · ${circle.name}`,
        `${progress.windowLabel} · day ${progress.daysElapsed} of ${progress.daysInMonth} · quota ${describeQuota(progress.quota, progress.period)}`,
    ).addFields(fields);
}

/**
 * `/fans me`: the caller's own progress, privately, in each circle this
 * channel could mean that they are currently in (usually one). Runs where
 * `club` does. Uses the trainer linked with `/uma-id`; someone who is not a
 * current member is told so rather than shown stale figures.
 */
async function handleCheckMe(interaction: ChatInputCommandInteraction) {
    const pool = await circlesHere(interaction);
    if (!pool) return;

    const link = await prisma.trainerLink.findUnique({
        where: { guildId_discordUserId: { guildId: interaction.guildId!, discordUserId: interaction.user.id } },
    });
    if (!link) {
        await reply(interaction, errorEmbed('You are not linked to a uma.moe trainer yet. Use `/uma-id` with your viewer ID.'));
        return;
    }

    const ids = new Set(pool.map((c) => c.id));
    const found = (await circlesForTrainer(interaction.guildId!, link.viewerId)).filter((f) => ids.has(f.circle.id));
    if (found.length === 0) {
        const where = pool.length === 1 ? `**${pool[0]!.name}**` : 'any circle here';
        await reply(interaction, errorEmbed(`Trainer \`${link.viewerId}\` is not a current member of ${where}, or has no data this month yet.`));
        return;
    }
    // Discord allows ten embeds per message; nobody is in more circles than that.
    const embeds = found.slice(0, 10).map((f) => progressCard(f.circle, f.progress, f.member));
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

async function handleTrainer(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target = interaction.options.getUser('member') ?? interaction.user;
    const link = await prisma.trainerLink.findUnique({
        where: { guildId_discordUserId: { guildId: interaction.guildId!, discordUserId: target.id } },
    });

    if (!link) {
        await reply(
            interaction,
            errorEmbed(
                target.id === interaction.user.id
                    ? 'You are not linked to a uma.moe trainer yet. Use `/uma-id` with your viewer ID.'
                    : `<@${target.id}> is not linked to a uma.moe trainer yet.`,
            ),
        );
        return;
    }

    // Without a named circle, use the one the trainer is in (the first, by
    // name, if they are in several) rather than asking.
    let circle: TrackedCircle | null;
    if (interaction.options.getString('circle')) {
        circle = await resolveCircle(interaction, true);
    } else {
        circle = (await circlesForTrainer(interaction.guildId!, link.viewerId))[0]?.circle ?? null;
        if (!circle) {
            await reply(interaction, errorEmbed(`Trainer \`${link.viewerId}\` is not a current member of any tracked circle, or has no data this month yet.`));
            return;
        }
    }
    if (!circle) return;

    const report = await buildTrainerReport(circle, link.viewerId, TRAINER_WINDOW_DAYS, await currentCircleProgress(circle));
    if (!report) {
        await reply(
            interaction,
            errorEmbed(`No fan data for that trainer in **${circle.name}** this month yet.`),
        );
        return;
    }

    const buffer = await renderTrainerReport(report);
    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `trainer-${link.viewerId}.png` })],
    });
}

async function handleBenchmark(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    // Overlay the named circle, else the first tracked one. Never an error:
    // the benchmark is still useful with no club to compare against.
    const named = interaction.options.getString('circle');
    const circle = named
        ? await prisma.trackedCircle.findFirst({ where: { id: named, guildId: interaction.guildId!, ...TRACKED } })
        : await prisma.trackedCircle.findFirst({ where: { guildId: interaction.guildId!, active: true, ...TRACKED }, orderBy: { createdAt: 'asc' } });

    const buffer = await renderBenchmark(await buildBenchmark(TRAINER_WINDOW_DAYS, circle));
    await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'benchmark.png' })] });
}

// ─── Trainer links ────────────────────────────────────────────────────────────

/**
 * Links a Discord member to their uma.moe trainer: the caller themselves, or
 * `target` when a Club Manager links someone else. Used by `/uma-id`.
 */
export async function linkTrainer(interaction: ChatInputCommandInteraction, rawViewerId: string, target: User | null) {
    // Linking someone else is a moderation action; linking yourself is not.
    if (target && target.id !== interaction.user.id && !(await requireOfficer(interaction, 'link other members'))) {
        return;
    }

    const subject = target ?? interaction.user;
    const raw = rawViewerId.trim();

    if (!/^\d+$/.test(raw)) {
        await reply(interaction, errorEmbed('A viewer ID is a number. Find yours on your uma.moe trainer profile.'));
        return;
    }

    const viewerId = BigInt(raw);
    const guildId = interaction.guildId!;

    const clash = await prisma.trainerLink.findFirst({
        where: { guildId, viewerId, NOT: { discordUserId: subject.id } },
    });
    if (clash) {
        await reply(interaction, errorEmbed(`That trainer ID is already linked to <@${clash.discordUserId}>.`));
        return;
    }

    await prisma.trainerLink.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId: subject.id } },
        create: { guildId, discordUserId: subject.id, viewerId },
        update: { viewerId },
    });

    await reply(interaction, successEmbed('Trainer linked', `<@${subject.id}> is now linked to trainer \`${raw}\`.`));
}

/**
 * Removes a member's uma.moe trainer link: the caller's own, or `target`'s
 * when a Club Manager removes someone else's. Used by `/uma-id remove:true`.
 */
export async function unlinkTrainer(interaction: ChatInputCommandInteraction, target: User | null) {
    if (target && target.id !== interaction.user.id && !(await requireOfficer(interaction, 'unlink other members'))) {
        return;
    }

    const subject = target ?? interaction.user;
    const { count } = await prisma.trainerLink.deleteMany({
        where: { guildId: interaction.guildId!, discordUserId: subject.id },
    });

    await reply(
        interaction,
        count > 0
            ? successEmbed('Trainer unlinked', `<@${subject.id}> is no longer linked.`)
            : errorEmbed(`<@${subject.id}> was not linked to a trainer.`),
    );
}

// ─── Circle management ────────────────────────────────────────────────────────

async function handleCircleGroup(interaction: ChatInputCommandInteraction, sub: string) {
    if (sub !== 'list' && !(await requireOfficer(interaction, 'manage tracked circles'))) return;

    switch (sub) {
        case 'add':
            await handleCircleAdd(interaction);
            break;
        case 'remove':
            await handleCircleRemove(interaction);
            break;
        case 'config':
            await handleCircleConfig(interaction);
            break;
        case 'list':
            await handleCircleList(interaction);
            break;
        case 'search':
            await handleCircleSearch(interaction);
            break;
        case 'sync':
            await handleCircleSync(interaction);
            break;
        case 'debug':
            await handleCircleDebug(interaction);
            break;
    }
}

/**
 * Per-member join facts for the current month, as a JSON attachment.
 *
 * Exists to settle one open question in the quota maths: for a member who
 * transferred in mid-month, does the reference report count expectation from
 * their first day with data, or from the day after? uma.moe's
 * `previous_circle_id` marks a transfer, and the first non-zero day marks
 * when their fans started counting here. One real dump of both is enough.
 */
async function handleCircleDebug(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const circle = await resolveCircle(interaction, false);
    if (!circle) return;

    const { year, month } = currentGameMonth();
    const snapshots = await prisma.fanSnapshot.findMany({
        where: { trackedCircleId: circle.id, year, month },
        orderBy: [{ viewerId: 'asc' }, { day: 'asc' }],
    });

    if (snapshots.length === 0) {
        await reply(interaction, errorEmbed(`No snapshots for **${circle.name}** this month. Run \`/fans circle sync\` first.`));
        return;
    }

    type Fact = {
        viewerId: string; name: string | null; firstDay: number; lastDay: number; dataDays: number;
        previousCircleId: string | null; previousCircleName: string | null; nextMonthStart: string | null;
        dailyFans: number[];
    };
    const byViewer = new Map<string, Fact>();
    for (const s of snapshots) {
        const key = s.viewerId.toString();
        let f = byViewer.get(key);
        if (!f) {
            f = { viewerId: key, name: s.trainerName, firstDay: s.day, lastDay: s.day, dataDays: 0,
                  previousCircleId: s.previousCircleId?.toString() ?? null, previousCircleName: s.previousCircleName,
                  nextMonthStart: s.nextMonthStart?.toString() ?? null, dailyFans: [] };
            byViewer.set(key, f);
        }
        f.firstDay = Math.min(f.firstDay, s.day);
        f.lastDay = Math.max(f.lastDay, s.day);
        f.dataDays += 1;
        f.dailyFans[s.day - 1] = toSafeNumber(s.cumulativeFans);
        if (s.trainerName) f.name = s.trainerName;
    }

    const facts = [...byViewer.values()];
    const interesting = facts.filter((f) => f.firstDay > 1 || f.previousCircleId !== null);

    const summary = interesting.length === 0
        ? 'Every member has data from day 1 and no transfer marker; nothing here distinguishes the two hypotheses.'
        : interesting.slice(0, 12).map((f) =>
            `**${f.name ?? f.viewerId}** — first day ${f.firstDay}, ${f.dataDays} days of data` +
            (f.previousCircleName ? `, from *${f.previousCircleName}*` : f.previousCircleId ? `, from circle ${f.previousCircleId}` : ''),
          ).join('\n');

    const file = new AttachmentBuilder(Buffer.from(JSON.stringify({ circle: circle.name, year, month, members: facts }, null, 2)), {
        name: `circle-debug-${circle.circleId}-${year}-${String(month).padStart(2, '0')}.json`,
    });

    await interaction.editReply({
        embeds: [infoEmbed(`${circle.name} — join facts, ${year}-${String(month).padStart(2, '0')}`,
            `${facts.length} members, ${interesting.length} joined late or transferred in.\n\n${summary}\n\nFull dump attached.`)],
        files: [file],
    });
}

async function handleCircleAdd(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await requireApiKey(interaction))) return;

    const rawId = interaction.options.getString('circle_id', true).trim();
    if (!/^\d+$/.test(rawId)) {
        await reply(interaction, errorEmbed('A circle ID is a number. Find it at <https://uma.moe/circles>.'));
        return;
    }

    const quota = parseQuota(interaction.options.getString('quota', true));
    if (quota === null || quota <= 0) {
        await reply(interaction, errorEmbed('Quota must be a positive amount like `80M`, `500K`, `1.2B` or `80,000,000`.'));
        return;
    }
    const period = parsePeriod(interaction.options.getString('period')) ?? 'MONTH';

    const guildId = interaction.guildId!;
    const circleId = BigInt(rawId);

    const existing = await prisma.trackedCircle.findFirst({ where: { guildId, circleId } });
    if (existing) {
        await reply(interaction, errorEmbed(`**${existing.name}** is already tracked.`));
        return;
    }

    // Created first so the sync has a row to attach snapshots to; a failed
    // first sync leaves a tracked circle with no data rather than losing it.
    const circle = await prisma.trackedCircle.create({
        data: { guildId, circleId, name: `Circle ${rawId}`, quota: BigInt(quota), quotaPeriod: period },
    });

    try {
        const result = await syncCircle(circle);
        // A club made with /club create under the same name takes the tracking.
        const tracking = await adoptUntrackedClub(circle);
        void backfillOnce(tracking);
        await reply(
            interaction,
            successEmbed(
                'Circle tracked',
                `Now tracking **${result.name}** with a quota of **${describeQuota(quota, period)}** per member.\n` +
                    `Ingested ${result.daysWritten} day records across ${result.membersSeen} members. Past months are importing in the background.`,
            ),
        );
    } catch (e) {
        await prisma.trackedCircle.delete({ where: { id: circle.id } });
        await reply(
            interaction,
            errorEmbed(`Could not fetch that circle from uma.moe: ${e instanceof Error ? e.message : String(e)}`),
        );
    }
}

async function handleCircleRemove(interaction: ChatInputCommandInteraction) {
    const circle = await resolveCircle(interaction, true);
    if (!circle) return;

    // Snapshots cascade-delete with the circle.
    await prisma.trackedCircle.delete({ where: { id: circle.id } });
    await reply(
        interaction,
        successEmbed('Circle removed', `**${circle.name}** is no longer tracked, and its snapshots were deleted.`),
    );
}

async function handleCircleConfig(interaction: ChatInputCommandInteraction) {
    const circle = await resolveCircle(interaction, true);
    if (!circle) return;

    const rawQuota = interaction.options.getString('quota');
    const reportChannel = interaction.options.getChannel('report_channel');
    const alertChannel = interaction.options.getChannel('alert_channel');
    const active = interaction.options.getBoolean('active');
    const period = parsePeriod(interaction.options.getString('period'));
    if (rawQuota === null && period === null && !reportChannel && !alertChannel && active === null) {
        await reply(interaction, errorEmbed('Give at least one setting to change.'));
        return;
    }

    let quota: number | null = null;
    if (rawQuota !== null) {
        quota = parseQuota(rawQuota);
        if (quota === null || quota <= 0) {
            await reply(interaction, errorEmbed('Quota must be a positive amount like `80M`, `500K` or `1.2B`.'));
            return;
        }
    }

    const updated = await prisma.trackedCircle.update({
        where: { id: circle.id },
        data: {
            ...(quota !== null ? { quota: BigInt(quota) } : {}),
            ...(period !== null ? { quotaPeriod: period } : {}),
            ...(reportChannel ? { reportChannelId: reportChannel.id } : {}),
            ...(alertChannel ? { alertChannelId: alertChannel.id } : {}),
            ...(active !== null ? { active } : {}),
        },
    });

    const lines = [
        `Quota: **${describeQuota(toSafeNumber(updated.quota), updated.quotaPeriod)}** per member`,
        `Reports: ${updated.reportChannelId ? `<#${updated.reportChannelId}>` : 'not set'}`,
        `Alerts: ${updated.alertChannelId ? `<#${updated.alertChannelId}>` : 'not set'}`,
        `Syncing: ${updated.active ? 'active' : 'paused'}`,
    ];

    await reply(interaction, successEmbed(`${updated.name} updated`, lines.join('\n')));
}

async function handleCircleList(interaction: ChatInputCommandInteraction) {
    const circles = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId!, ...TRACKED },
        orderBy: { name: 'asc' },
    });

    if (circles.length === 0) {
        await reply(interaction, infoEmbed('Tracked circles', 'None yet. Add one with `/fans circle add`.'));
        return;
    }

    const embed = infoEmbed(`Tracked circles (${circles.length})`).addFields(
        circles.map((c) => ({
            name: `${c.name}${c.active ? '' : ' — paused'}`,
            value:
                `ID \`${c.circleId}\` · Quota **${describeQuota(toSafeNumber(c.quota), c.quotaPeriod)}**\n` +
                `Reports: ${c.reportChannelId ? `<#${c.reportChannelId}>` : 'not set'} · ` +
                `Last sync: ${c.lastSyncedAt ? `<t:${Math.floor(c.lastSyncedAt.getTime() / 1000)}:R>` : 'never'}`,
        })),
    );

    await reply(interaction, embed);
}

async function handleCircleSearch(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await requireApiKey(interaction))) return;

    const name = interaction.options.getString('name', true);
    const circles = (await searchCircles(name, 10)).circles ?? [];

    if (circles.length === 0) {
        await reply(interaction, errorEmbed(`No circles on uma.moe matched **${name}**.`));
        return;
    }

    const lines = circles.map(
        (c) =>
            `\`${c.circle_id}\` — **${c.name}** · ${c.member_count ?? '?'} members` +
            (c.monthly_rank ? ` · rank #${c.monthly_rank}` : ''),
    );

    await reply(
        interaction,
        infoEmbed(`uma.moe circles matching "${name}"`, `${lines.join('\n')}\n\nAdd one with \`/fans circle add\`.`),
    );
}

async function handleCircleSync(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await requireApiKey(interaction))) return;

    const named = interaction.options.getString('circle');
    const circles = named
        ? await prisma.trackedCircle.findMany({ where: { id: named, guildId: interaction.guildId!, ...TRACKED } })
        : await prisma.trackedCircle.findMany({ where: { guildId: interaction.guildId!, active: true, ...TRACKED } });

    if (circles.length === 0) {
        await reply(interaction, errorEmbed('No circles to sync.'));
        return;
    }

    const lines: string[] = [];
    for (const circle of circles) {
        try {
            const result = await syncCircle(circle);
            lines.push(`**${result.name}** — ${result.membersSeen} members, ${result.daysWritten} day records`);
        } catch (e) {
            lines.push(`**${circle.name}** — failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    try {
        const tiers = await syncBenchmark();
        if (tiers.length > 0) lines.push(`Benchmark updated for top ${tiers.map((t) => t.tier).join(' / ')}.`);
    } catch (e) {
        lines.push(`Benchmark sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    await reply(interaction, successEmbed('Sync complete', lines.join('\n')));
}

/** Re-exported for the scheduled job, which posts to the same channels. */
export type { TextBasedChannel };
