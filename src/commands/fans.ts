import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    AttachmentBuilder,
    ChannelType,
    GuildMember,
    MessageFlags,
    type TextBasedChannel,
} from 'discord.js';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { isOfficer } from '../lib/permissions';
import { errorEmbed, successEmbed, infoEmbed } from '../lib/embeds';
import { autocompleteTrackedCircle } from '../lib/fans/circleAutocomplete';
import { currentGameMonth, syncBenchmark, syncCircle } from '../lib/fans/ingest';
import { buildBenchmark, buildTrainerReport, currentCircleProgress, formatReportDate } from '../lib/fans/reports';
import { formatCompactFans, toSafeNumber } from '../lib/fans/metrics';
import { isConfigured, searchCircles } from '../lib/umamoe/client';
import { renderFanReport } from '../lib/image/renderFanReport';
import { renderTrainerReport } from '../lib/image/renderTrainerReport';
import { renderBenchmark } from '../lib/image/renderBenchmark';

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
        sub
            .setName('trainer')
            .setDescription("Show one trainer's fan report.")
            .addUserOption((opt) => opt.setName('member').setDescription('Discord member (defaults to you)'))
            .addStringOption((opt) =>
                opt.setName('circle').setDescription('Tracked circle (defaults to the only one)').setAutocomplete(true),
            ),
    )
    .addSubcommand((sub) =>
        sub.setName('benchmark').setDescription('Show what it takes to sit in the top 10 / 30 / 100 circles.'),
    )
    .addSubcommand((sub) =>
        sub
            .setName('link')
            .setDescription('Link a Discord member to a uma.moe trainer ID.')
            .addStringOption((opt) =>
                opt.setName('viewer_id').setDescription('uma.moe viewer ID (found on your trainer profile)').setRequired(true),
            )
            .addUserOption((opt) => opt.setName('member').setDescription('Member to link (Club Managers only)')),
    )
    .addSubcommand((sub) =>
        sub
            .setName('unlink')
            .setDescription('Remove a trainer link.')
            .addUserOption((opt) => opt.setName('member').setDescription('Member to unlink (Club Managers only)')),
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
                        opt.setName('quota').setDescription('Monthly fan quota per member, e.g. 80M').setRequired(true),
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
                    .addStringOption((opt) => opt.setName('quota').setDescription('Monthly fan quota per member, e.g. 80M'))
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
                    .setName('sync')
                    .setDescription('Pull the latest fan data from uma.moe now.')
                    .addStringOption((opt) =>
                        opt.setName('circle').setDescription('Tracked circle (defaults to all)').setAutocomplete(true),
                    ),
            ),
    );

export async function autocomplete(interaction: AutocompleteInteraction) {
    if (interaction.options.getFocused(true).name === 'circle') {
        await autocompleteTrackedCircle(interaction);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses "80M", "80m", "1.5B" or a bare number into whole fans. */
export function parseQuota(input: string): number | null {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(input);
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
        const circle = await prisma.trackedCircle.findFirst({ where: { id, guildId } });
        if (!circle) {
            await reply(interaction, errorEmbed('That tracked circle could not be found.'));
            return null;
        }
        return circle;
    }

    const circles = await prisma.trackedCircle.findMany({ where: { guildId } });
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
        case 'trainer':
            await handleTrainer(interaction);
            break;
        case 'benchmark':
            await handleBenchmark(interaction);
            break;
        case 'link':
            await handleLink(interaction);
            break;
        case 'unlink':
            await handleUnlink(interaction);
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
        monthlyRank: null,
        memberCount: progress.members.length,
        dateLabel: formatReportDate(year, month, progress.daysElapsed),
    });

    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `fan-report-${circle.circleId}.png` })],
    });
}

async function handleTrainer(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const circle = await resolveCircle(interaction, false);
    if (!circle) return;

    const target = interaction.options.getUser('member') ?? interaction.user;
    const link = await prisma.trainerLink.findUnique({
        where: { guildId_discordUserId: { guildId: interaction.guildId!, discordUserId: target.id } },
    });

    if (!link) {
        await reply(
            interaction,
            errorEmbed(
                target.id === interaction.user.id
                    ? 'You are not linked to a uma.moe trainer yet. Use `/fans link` with your viewer ID.'
                    : `<@${target.id}> is not linked to a uma.moe trainer yet.`,
            ),
        );
        return;
    }

    const report = await buildTrainerReport(circle, link.viewerId);
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
    const buffer = await renderBenchmark(await buildBenchmark());
    await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'benchmark.png' })] });
}

// ─── Trainer links ────────────────────────────────────────────────────────────

async function handleLink(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('member');

    // Linking someone else is a moderation action; linking yourself is not.
    if (target && target.id !== interaction.user.id && !(await requireOfficer(interaction, 'link other members'))) {
        return;
    }

    const subject = target ?? interaction.user;
    const raw = interaction.options.getString('viewer_id', true).trim();

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

async function handleUnlink(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser('member');
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
    }
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
        await reply(interaction, errorEmbed("Quota must be a positive amount like `80M`, `2.5M` or `80000000`."));
        return;
    }

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
        data: { guildId, circleId, name: `Circle ${rawId}`, monthlyQuota: BigInt(quota) },
    });

    try {
        const result = await syncCircle(circle);
        await reply(
            interaction,
            successEmbed(
                'Circle tracked',
                `Now tracking **${result.name}** with a quota of **${formatCompactFans(quota)}** per member per month.\n` +
                    `Ingested ${result.daysWritten} day records across ${result.membersSeen} members.`,
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

    if (rawQuota === null && !reportChannel && !alertChannel && active === null) {
        await reply(interaction, errorEmbed('Give at least one setting to change.'));
        return;
    }

    let quota: number | null = null;
    if (rawQuota !== null) {
        quota = parseQuota(rawQuota);
        if (quota === null || quota <= 0) {
            await reply(interaction, errorEmbed("Quota must be a positive amount like `80M`."));
            return;
        }
    }

    const updated = await prisma.trackedCircle.update({
        where: { id: circle.id },
        data: {
            ...(quota !== null ? { monthlyQuota: BigInt(quota) } : {}),
            ...(reportChannel ? { reportChannelId: reportChannel.id } : {}),
            ...(alertChannel ? { alertChannelId: alertChannel.id } : {}),
            ...(active !== null ? { active } : {}),
        },
    });

    const lines = [
        `Quota: **${formatCompactFans(toSafeNumber(updated.monthlyQuota))}** per member per month`,
        `Reports: ${updated.reportChannelId ? `<#${updated.reportChannelId}>` : 'not set'}`,
        `Alerts: ${updated.alertChannelId ? `<#${updated.alertChannelId}>` : 'not set'}`,
        `Syncing: ${updated.active ? 'active' : 'paused'}`,
    ];

    await reply(interaction, successEmbed(`${updated.name} updated`, lines.join('\n')));
}

async function handleCircleList(interaction: ChatInputCommandInteraction) {
    const circles = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId! },
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
                `ID \`${c.circleId}\` · Quota **${formatCompactFans(toSafeNumber(c.monthlyQuota))}**\n` +
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
    const response = await searchCircles(name, 10);

    if (response.circles.length === 0) {
        await reply(interaction, errorEmbed(`No circles on uma.moe matched **${name}**.`));
        return;
    }

    const lines = response.circles.map(
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
        ? await prisma.trackedCircle.findMany({ where: { id: named, guildId: interaction.guildId! } })
        : await prisma.trackedCircle.findMany({ where: { guildId: interaction.guildId!, active: true } });

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
