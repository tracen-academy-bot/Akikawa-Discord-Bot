import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    GuildMember,
    AttachmentBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { prisma } from '../db/prisma';
import { canManageClubStats, isOfficer } from "../lib/permissions";
import { guildClubs, listToStore, matchedStaffRoleIds, staffRolesOf, type LinkableGuild, type Links } from '../lib/clubLinks';
import { autoCompleteClubName } from "../lib/clubAutocomplete";
import { successEmbed, errorEmbed, infoEmbed } from "../lib/embeds";
import { renderClubList, type ClubSummary } from "../lib/image/renderClubList";
import { renderClubView } from "../lib/image/renderClubView";
import type { TrackedCircle, ClubMember, ClubRank, ClubMemberRole, FanCountPeriod, QuotaPeriod } from '@prisma/client';
import { backfillOnce, syncCircle } from '../lib/fans/ingest';
import { currentCircleProgress } from '../lib/fans/reports';
import { toSafeNumber } from '../lib/fans/metrics';
import { PERIOD_CHOICES, RANK_CHOICES, clubQuotaText, formatRank } from '../lib/clubFormat';
import { cutoffDetail, cutoffForRank, cutoffLine } from '../lib/fans/cutoff';
import { publishDirectory, refreshDirectory, type DirectoryChannel, type DirectoryGuild } from '../lib/clubDirectory';
import { buildProfileModal } from './clubProfile';
import { parseQuota } from './fans';
import {
    COMMON_ZONES,
    JAPAN_TIME_ZONE,
    describeZone,
    formatTimeOfDay,
    hasOwnReportTime,
    isTimeZone,
    nextReportAt,
    parseTimeOfDay,
    reportTimeOf,
    utcOffsetLabel,
} from '../lib/fans/reportTime';

/**
 * A club is a `TrackedCircle` row: clubs and tracked uma.moe circles were
 * merged on 2026-10-04. `circleId` is set when the club's fans are tracked.
 */
type Club = TrackedCircle;

// ================================================================================

const MEMBER_ROLE_CHOICES: {name: string; value: ClubMemberRole }[] = [
    { name: 'Trainer', value: 'TRAINER' },
    { name: 'Assistant', value: 'ASSISTANT' }
];

const MAX_HEADCOUNT = 30;

// ================================================================================

function formatMemberRole(role: ClubMemberRole): string {
    return MEMBER_ROLE_CHOICES.find((r) => r.value === role)?.name ?? role;
}

/**
 * Headcount is not typed in: for a tracked club it is uma.moe's current
 * members, by the same rule the fan reports use (so it matches their member
 * count). Null for a club without a uma.moe circle, or before any data.
 */
async function clubHeadcount(club: Club): Promise<number | null> {
    if (club.circleId === null) return null;
    return (await currentCircleProgress(club))?.members.length ?? null;
}

/** What the club directory and club card show for a club. */
async function clubSummary(club: Club): Promise<ClubSummary> {
    return { id: club.id, name: club.name, rank: club.rank, headcount: await clubHeadcount(club), quotaText: clubQuotaText(club) };
}

/**
 * The quota as the form's text field shows it, exactly, so saving the form
 * unchanged keeps the same number: 90000000 is "90M", 2500000 is "2500K".
 * An old club fan count (in millions) stands in when no quota was set.
 */
function quotaInputValue(club: Club): string {
    const quota = toSafeNumber(club.quota);
    if (quota === 0) return club.fanCountAmount === null ? '' : `${club.fanCountAmount}M`;
    if (quota % 1_000_000_000 === 0) return `${quota / 1_000_000_000}B`;
    if (quota % 1_000_000 === 0) return `${quota / 1_000_000}M`;
    if (quota % 1_000 === 0) return `${quota / 1_000}K`;
    return String(quota);
}

async function findClubOrReply(interaction: ChatInputCommandInteraction, clubId: string): Promise<Club | null> {
    const club = await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId! } });
    if (!club) {
        await interaction.reply({ embeds: [errorEmbed('That club could not be found.')]});
        return null;
    }
    return club;
}

// ================================================================================

export const data = new SlashCommandBuilder()
    .setName('club')
    .setDescription('Manage clubs.')
    .addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription('Create a new club. Club Managers only.')
            .addStringOption((opt) => opt.setName('name').setDescription('Club name').setRequired(true))
            .addStringOption((opt) => opt.setName('rank').setDescription('Expected rank').setRequired(true).setChoices(...RANK_CHOICES))
            .addStringOption((opt) => opt.setName('circle_id').setDescription('uma.moe circle ID, to track its fans (from uma.moe/circles)'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('admin')
            .setDescription("Set a club's name or home channels, staff roles, and report channels. Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to edit').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) => 
        sub
            .setName('delete')
            .setDescription('Delete a club and its fan history. Club Managers only.')
            .addStringOption((opt) => opt.setName('club').setDescription('Club to delete').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
        sub
            .setName('view')
            .setDescription("View a club's info.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to view').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all clubs.'))
    .addSubcommand((sub) => sub.setName('links').setDescription("Show each club's staff roles, and which were matched by name."))
    .addSubcommand((sub) =>
        sub
            .setName('profile')
            .setDescription("Edit a club's bio, rules and banner (its staff; Club Managers also set its tier).")
            .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
        sub
            .setName('directory')
            .setDescription('Post or refresh the club directory. Club Managers only.')
            .addChannelOption((opt) =>
                opt
                    .setName('channel')
                    .setDescription('Where to post it. Leave empty to refresh it where it is.')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('fancount')
            .setDescription("Set a club's quota per member. Club trainers/assistants or Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to update').setRequired(true).setAutocomplete(true))
            .addStringOption((opt) => opt.setName('amount').setDescription('Per member, in millions, e.g. 50M, 0.5M').setRequired(true))
            .addStringOption((opt) => opt.setName('period').setDescription('Per day, week, 2 weeks or month (default month)').setRequired(false).addChoices(...PERIOD_CHOICES))
    )
    .addSubcommand((sub) =>
        sub
            .setName('reports')
            .setDescription("Set a club's expected rank, quota and report time (its staff or Club Managers).")
            .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
    )
    .addSubcommandGroup((group) =>
        group
            .setName('member')
            .setDescription("Manage a club's trainer and assistants. Club Managers only.")
            .addSubcommand((sub) =>
                sub
                    .setName('add')
                    .setDescription('Add a trainer or assistant to a club.')
                    .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
                    .addUserOption((opt) => opt.setName('member').setDescription('Member to add').setRequired(true))
                    .addStringOption((opt) => opt.setName('role').setDescription('Role in the club').setRequired(true).addChoices(...MEMBER_ROLE_CHOICES))
            )
            .addSubcommand((sub) =>
                sub
                    .setName('edit')
                    .setDescription('Change the role between club members (Trainers > Assistants or vice versa).')
                    .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
                    .addUserOption((opt) => opt.setName('member').setDescription('Member to edit').setRequired(true))
                    .addStringOption((opt) => opt.setName('role').setDescription('New role in the club').setRequired(true).addChoices(...MEMBER_ROLE_CHOICES))
            )
            .addSubcommand((sub) =>
                sub
                    .setName('remove')
                    .setDescription('Remove a trainer or assistant from a club.')
                    .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
                    .addUserOption((opt) => opt.setName('member').setDescription('Member to remove').setRequired(true))
            )
            .addSubcommand((sub) =>
                sub
                    .setName('list')
                    .setDescription("List a club's trainers and assistants")
                    .addStringOption((opt) => opt.setName('club').setDescription('Club').setRequired(true).setAutocomplete(true))
            )
    );


export async function autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'club') await autoCompleteClubName(interaction);
}

// ================================================================================

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    const member = interaction.member as GuildMember;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'member') {
        await handleMemberSubcommand(interaction, member, sub);
        // Staff are listed on the directory cards.
        if (sub !== 'list') void refreshDirectory(interaction.guild as unknown as DirectoryGuild | null);
        return;
    }

    switch (sub) {
        case 'create':
            await handleCreate(interaction, member);
            break;
        case 'admin':
            await handleAdmin(interaction, member);
            break;
        case 'delete':
            await handleDelete(interaction, member);
            break;
        case 'view':
            await handleView(interaction);
            break;
        case 'list':
            await handleList(interaction);
            break;
        case 'links':
            await handleLinks(interaction);
            break;
        case 'profile':
            await handleProfile(interaction, member);
            break;
        case 'directory':
            await handleDirectory(interaction, member);
            break;
        case 'fancount':
            await handleFancount(interaction, member);
            break;
        case 'reports':
            await handleReports(interaction, member);
            break;
    }
    // A club's card shows its name, rank and quota; create and delete change the list.
    if (['create', 'delete', 'fancount'].includes(sub)) void refreshDirectory(interaction.guild as unknown as DirectoryGuild | null);
}

// ================================================================================

async function handleCreate(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can create clubs.')] });
        return;
    }

    const guildId = interaction.guildId!;
    const name = interaction.options.getString('name', true).trim();
    const rank = interaction.options.getString('rank', true) as ClubRank;
    const rawCircleId = interaction.options.getString('circle_id')?.trim() ?? null;

    if (await prisma.trackedCircle.findFirst({ where: { guildId, name: { equals: name, mode: 'insensitive' } } })) {
        await interaction.reply({ embeds: [errorEmbed(`A club named **${name}** already exists.`)] });
        return;
    }
    if (rawCircleId !== null && !/^\d+$/.test(rawCircleId)) {
        await interaction.reply({ embeds: [errorEmbed('A uma.moe circle ID is a number. Find it at uma.moe/circles.')] });
        return;
    }
    const circleId = rawCircleId === null ? null : BigInt(rawCircleId);
    if (circleId !== null) {
        const tracked = await prisma.trackedCircle.findFirst({ where: { guildId, circleId } });
        if (tracked) {
            await interaction.reply({ embeds: [errorEmbed(`That uma.moe circle is already **${tracked.name}**.`)] });
            return;
        }
    }

    // Tracking needs a uma.moe round trip, which can outlast the 3-second reply window.
    await interaction.deferReply();
    const club = await prisma.trackedCircle.create({ data: { guildId, name, rank, circleId } });
    if (circleId === null) {
        await interaction.editReply({ embeds: [successEmbed('Club created', `**${club.name}** was created at expected rank **${formatRank(club.rank)}**.`)] });
        return;
    }

    try {
        const result = await syncCircle(club);
        // Past months import in the background, as with /fans circle add.
        void backfillOnce(club);
        await interaction.editReply({
            embeds: [
                successEmbed(
                    'Club created',
                    `**${result.name}** was created at expected rank **${formatRank(club.rank)}** and its fans are tracked ` +
                        `(${result.membersSeen} members). Set its quota with \`/fans circle config\`.` +
                        (result.name !== name ? ` Its name comes from uma.moe, so it is **${result.name}** rather than **${name}**.` : ''),
                ),
            ],
        });
    } catch (e) {
        // A bad circle ID must not leave a half-made club behind.
        await prisma.trackedCircle.delete({ where: { id: club.id } });
        await interaction.editReply({ embeds: [errorEmbed(`Could not track that circle: ${e instanceof Error ? e.message : String(e)}`)] });
    }
}

// ─── Forms ────────────────────────────────────────────────────────────────────

/**
 * A club's settings live in three forms, split by who may change them and by
 * Discord's limit of five fields per form:
 *
 *   /club reports  the club's staff and Club Managers: expected rank, quota,
 *                  quota period, and for a tracked club its report time and
 *                  time zone.
 *   /club profile  the club's staff (Club Managers also set the tier): bio,
 *                  rules, banner. See `clubProfile.ts`.
 *   /club admin    Club Managers only: who and where. The name (a club
 *                  without uma.moe tracking; a tracked club's name comes from
 *                  uma.moe) or the home channels (a tracked club), the staff
 *                  roles, and for a tracked club the report and alert channels.
 *
 * Headcount is not a field: it is worked out from uma.moe. The quota is the
 * same one `/fans` measures against (clubs and circles are one row). A form's
 * custom ID carries the club, and the submit checks permission again.
 */
const REPORTS_MODAL_PREFIX = 'club:reports:';
const ADMIN_MODAL_PREFIX = 'club:admin:';
const FIELD = {
    name: 'club:name',
    rank: 'club:rank',
    quota: 'club:quota',
    period: 'club:period',
    time: 'club:report-time',
    zone: 'club:report-zone',
    home: 'club:home',
    roles: 'club:roles',
    reportChannel: 'club:report-channel',
    alertChannel: 'club:alert-channel',
} as const;
/** Where reports and alerts may go: channels and threads. */
const REPORT_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
] as const;
/** Home channels a club may list. Threads inside them count without listing. */
const MAX_HOME_CHANNELS = 10;
/** Staff roles a club may list. */
const MAX_STAFF_ROLES = 10;

/** A club's home channels and staff roles as the form shows them. */
export interface ClubFormLinks {
    home: string[];
    roles: string[];
}

/**
 * The home channels and staff roles the form should show: the stored home
 * channels, and the stored staff roles or, when none are stored, the roles
 * matching the club's name, so the form shows what the bot actually uses.
 */
async function formLinks(club: Club, guild: LinkableGuild | null): Promise<ClubFormLinks> {
    if (!guild) return { home: club.homeChannelIds, roles: club.staffRoleIds };
    const clubs = await guildClubs(club.guildId);
    // A role deleted since it was stored cannot be pre-selected.
    const roleIds = new Set([...guild.roles.cache.values()].map((r) => r.id));
    return { home: club.homeChannelIds, roles: staffRolesOf(club, clubs, guild).ids.filter((id) => roleIds.has(id)) };
}

/** True for a modal this module owns. */
export function isClubModal(customId: string): boolean {
    return customId.startsWith(REPORTS_MODAL_PREFIX) || customId.startsWith(ADMIN_MODAL_PREFIX);
}

/** Handles a submitted `/club reports` or `/club admin` form. */
export async function handleClubModal(interaction: ModalSubmitInteraction) {
    if (interaction.customId.startsWith(ADMIN_MODAL_PREFIX)) return handleAdminModal(interaction);
    return handleReportsModal(interaction);
}

/** A single-channel picker for reports or alerts, pre-set to `current`. */
function reportChannelSelect(id: string, current: string | null): ChannelSelectMenuBuilder {
    const select = new ChannelSelectMenuBuilder().setCustomId(id).setChannelTypes(...REPORT_CHANNEL_TYPES).setRequired(false).setMinValues(0).setMaxValues(1);
    if (current) select.setDefaultChannels(current);
    return select;
}

// ─── /club reports ────────────────────────────────────────────────────────────

/**
 * Builds the `/club reports` form: expected rank, quota and period, and for a
 * tracked club its report time and time zone. The same form for the club's
 * staff and Club Managers.
 */
export function buildReportsModal(club: Club, now = new Date()): ModalBuilder {
    const labels: LabelBuilder[] = [
        new LabelBuilder().setLabel('Expected rank').setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
                .setCustomId(FIELD.rank)
                .setPlaceholder('Not set')
                .addOptions(
                    RANK_CHOICES.map((r) => ({
                        label: r.name,
                        value: r.value,
                        default: r.value === club.rank,
                        // A form cannot change as it is filled in, so each
                        // rank carries its own cutoff's figures beneath it.
                        ...(cutoffLine(cutoffForRank(r.value)) ? { description: cutoffLine(cutoffForRank(r.value))! } : {}),
                    })),
                ),
        ),
    ];
    const quotaValue = quotaInputValue(club);
    const quota = new TextInputBuilder().setCustomId(FIELD.quota).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20);
    if (quotaValue) quota.setValue(quotaValue);
    labels.push(
        new LabelBuilder()
            .setLabel('Quota per member')
            .setDescription('Fans each member owes per period, e.g. 90M, 500K or 1.2B. Empty to clear.')
            .setTextInputComponent(quota),
        new LabelBuilder().setLabel('Quota period').setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
                .setCustomId(FIELD.period)
                .addOptions(PERIOD_CHOICES.map((p) => ({ label: p.name, value: p.value, default: p.value === club.quotaPeriod }))),
        ),
    );

    // A club without uma.moe tracking has no report to time.
    if (club.circleId !== null) {
        const own = hasOwnReportTime(club);
        const time = new TextInputBuilder().setCustomId(FIELD.time).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setPlaceholder('21:00');
        if (own) time.setValue(formatTimeOfDay(club.reportMinute!));
        const current = own ? club.reportTimeZone! : JAPAN_TIME_ZONE;
        const zones = COMMON_ZONES.some((z) => z.zone === current) ? COMMON_ZONES : [...COMMON_ZONES, { label: current, zone: current }];
        labels.push(
            new LabelBuilder()
                .setLabel('Report time')
                .setDescription('When the daily report posts, e.g. 21:00 or 9pm. Empty: the daily reset, 00:00 JST.')
                .setTextInputComponent(time),
            new LabelBuilder().setLabel('Time zone').setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId(FIELD.zone)
                    .addOptions(
                        zones.map((z) => ({
                            label: z.label.slice(0, 100),
                            description: `${z.zone} · now ${utcOffsetLabel(z.zone, now)}`.slice(0, 100),
                            value: z.zone,
                            default: z.zone === current,
                        })),
                    ),
            ),
        );
    }
    return new ModalBuilder()
        .setCustomId(`${REPORTS_MODAL_PREFIX}${club.id}`)
        .setTitle(`${club.name} reports`.slice(0, 45))
        .addLabelComponents(...labels);
}

/** `/club reports`: opens the form for the club's staff or a Club Manager. */
async function handleReports(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const club = await findClubOrReply(interaction, interaction.options.getString('club', true));
    if (!club) return;
    if (!(await canManageClubStats(member, club))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)] });
        return;
    }
    await interaction.showModal(buildReportsModal(club));
}

/** Handles a submitted `/club reports` form. */
async function handleReportsModal(interaction: ModalSubmitInteraction) {
    const clubId = interaction.customId.slice(REPORTS_MODAL_PREFIX.length);
    const refuse = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

    const club = clubId ? await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId ?? '' } }) : null;
    if (!club) return void (await refuse('That club no longer exists.'));
    if (!(await canManageClubStats(interaction.member as GuildMember, club))) {
        return void (await refuse(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`));
    }

    // The quota replaces the old club fan count, which is cleared so it
    // never shows as a second, stale number.
    const data: {
        rank?: ClubRank;
        quota: bigint;
        quotaPeriod: QuotaPeriod;
        fanCountAmount: null;
        fanCountPeriod: null;
        reportMinute?: number | null;
        reportTimeZone?: string | null;
    } = { quota: BigInt(0), quotaPeriod: club.quotaPeriod, fanCountAmount: null, fanCountPeriod: null };

    const rank = interaction.fields.getStringSelectValues(FIELD.rank)[0] as ClubRank | undefined;
    if (rank && RANK_CHOICES.some((r) => r.value === rank)) data.rank = rank;
    const rawQuota = interaction.fields.getTextInputValue(FIELD.quota).trim();
    if (rawQuota) {
        const quota = parseQuota(rawQuota);
        if (quota === null || quota <= 0) return void (await refuse('Quota must be an amount like 90M, 500K, 1.2B or 80,000,000, or empty.'));
        data.quota = BigInt(quota);
    }
    const period = interaction.fields.getStringSelectValues(FIELD.period)[0];
    if (period && PERIOD_CHOICES.some((p) => p.value === period)) data.quotaPeriod = period as QuotaPeriod;

    if (club.circleId !== null) {
        const rawTime = interaction.fields.getTextInputValue(FIELD.time).trim();
        data.reportMinute = null;
        data.reportTimeZone = null;
        if (rawTime) {
            const minute = parseTimeOfDay(rawTime);
            if (minute === null) return void (await refuse(`**${rawTime}** is not a time. Try 21:00, 9pm or 9:30 pm.`));
            const zone = interaction.fields.getStringSelectValues(FIELD.zone)[0] ?? JAPAN_TIME_ZONE;
            if (!isTimeZone(zone)) return void (await refuse('That time zone is not available. Pick another.'));
            data.reportMinute = minute;
            data.reportTimeZone = zone;
        }
    }

    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data });
    const headcount = await clubHeadcount(updated);
    const lines = [
        `**${updated.name}** · expected rank **${formatRank(updated.rank)}**`,
        `Headcount: **${headcount === null ? '—' : `${headcount}/${MAX_HEADCOUNT}`}** (from uma.moe)`,
        `Quota: **${clubQuotaText(updated)}** per member`,
        // What the expected rank is up against, next to the quota it informs.
        ...(cutoffDetail(cutoffForRank(updated.rank)) ? [cutoffDetail(cutoffForRank(updated.rank))!] : []),
        ...(updated.circleId !== null ? ['', reportSummary(updated)] : []),
    ];
    await interaction.reply({ embeds: [successEmbed('Club updated', lines.join('\n'))] });
    void refreshDirectory(interaction.guild as unknown as DirectoryGuild | null);
}

/**
 * A club's report settings as text. The next report is a Discord timestamp,
 * which every reader sees in their own local time.
 */
export function reportSummary(club: Club, now = new Date()): string {
    const time = reportTimeOf(club);
    const next = Math.floor(nextReportAt(time, now).getTime() / 1000);
    const lines = [
        `Fan report: daily at **${formatTimeOfDay(time.minute)} ${describeZone(time.zone, now)}**${hasOwnReportTime(club) ? '' : ' (the default: the daily reset)'}`,
        `Next: <t:${next}:F> (<t:${next}:R>), shown in your own time.`,
    ];
    if (!club.reportChannelId) lines.push('No report channel yet, so nothing posts; a Club Manager sets one with `/club admin`.');
    if (!club.active) lines.push('Syncing is paused, so nothing posts until it is resumed.');
    return lines.join('\n');
}

// ─── /club admin ──────────────────────────────────────────────────────────────

/**
 * Builds the `/club admin` form, for Club Managers: the name (untracked club)
 * or home channels (tracked club), the staff roles, and for a tracked club
 * its report and alert channels. `links` pre-fills the home channels and
 * staff roles; it defaults to the stored lists.
 */
export function buildAdminModal(club: Club, links: ClubFormLinks = { home: club.homeChannelIds, roles: club.staffRoleIds }): ModalBuilder {
    const labels: LabelBuilder[] = [];
    if (club.circleId === null) {
        labels.push(
            new LabelBuilder()
                .setLabel('Name')
                .setTextInputComponent(new TextInputBuilder().setCustomId(FIELD.name).setStyle(TextInputStyle.Short).setValue(club.name).setMaxLength(100)),
        );
    } else {
        const home = new ChannelSelectMenuBuilder()
            .setCustomId(FIELD.home)
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(MAX_HOME_CHANNELS);
        if (links.home.length > 0) home.setDefaultChannels(...links.home.slice(0, MAX_HOME_CHANNELS));
        labels.push(
            new LabelBuilder()
                .setLabel('Home channels')
                .setDescription("The club's own channels. Threads inside them count too.")
                .setChannelSelectMenuComponent(home),
        );
    }
    const roles = new RoleSelectMenuBuilder().setCustomId(FIELD.roles).setRequired(false).setMinValues(0).setMaxValues(MAX_STAFF_ROLES);
    if (links.roles.length > 0) roles.setDefaultRoles(...links.roles.slice(0, MAX_STAFF_ROLES));
    labels.push(
        new LabelBuilder()
            .setLabel('Staff roles')
            .setDescription(`Holders count as ${club.name}'s staff. Empty: its Trainer and Assistant roles by name.`.slice(0, 100))
            .setRoleSelectMenuComponent(roles),
    );
    if (club.circleId !== null) {
        labels.push(
            new LabelBuilder()
                .setLabel('Report channel')
                .setDescription('Where the daily report image posts. Empty: no report.')
                .setChannelSelectMenuComponent(reportChannelSelect(FIELD.reportChannel, club.reportChannelId)),
            new LabelBuilder()
                .setLabel('Alert channel')
                .setDescription('Where trainers behind quota are pinged. Empty: no alerts.')
                .setChannelSelectMenuComponent(reportChannelSelect(FIELD.alertChannel, club.alertChannelId)),
        );
    }
    return new ModalBuilder()
        .setCustomId(`${ADMIN_MODAL_PREFIX}${club.id}`)
        .setTitle(`${club.name} admin`.slice(0, 45))
        .addLabelComponents(...labels);
}

/** `/club admin`: opens the Club Manager form. */
async function handleAdmin(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed("Only Club Managers can change a club's name, channels or staff roles.")] });
        return;
    }
    const club = await findClubOrReply(interaction, interaction.options.getString('club', true));
    if (!club) return;
    // A modal must answer within 3 seconds; this is two quick reads.
    await interaction.showModal(buildAdminModal(club, await formLinks(club, interaction.guild as LinkableGuild | null)));
}

/** Handles a submitted `/club admin` form. */
async function handleAdminModal(interaction: ModalSubmitInteraction) {
    const clubId = interaction.customId.slice(ADMIN_MODAL_PREFIX.length);
    const refuse = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

    const club = clubId ? await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId ?? '' } }) : null;
    if (!club) return void (await refuse('That club no longer exists.'));
    if (!isOfficer(interaction.member as GuildMember)) return void (await refuse("Only Club Managers can change a club's name, channels or staff roles."));

    const data: { name?: string; homeChannelIds?: string[]; staffRoleIds: string[]; reportChannelId?: string | null; alertChannelId?: string | null } = { staffRoleIds: [] };
    if (club.circleId === null) {
        const name = interaction.fields.getTextInputValue(FIELD.name).trim();
        if (!name) return void (await refuse('The club needs a name.'));
        const taken = await prisma.trackedCircle.findFirst({
            where: { guildId: club.guildId, name: { equals: name, mode: 'insensitive' }, NOT: { id: club.id } },
        });
        if (taken) return void (await refuse(`A club named **${name}** already exists.`));
        data.name = name;
    } else {
        const picked = interaction.fields.getSelectedChannels(FIELD.home, false);
        data.homeChannelIds = picked ? [...picked.keys()] : [];
        data.reportChannelId = interaction.fields.getSelectedChannels(FIELD.reportChannel, false)?.first()?.id ?? null;
        data.alertChannelId = interaction.fields.getSelectedChannels(FIELD.alertChannel, false)?.first()?.id ?? null;
    }
    // A role list equal to the name matches is stored empty, so the club keeps
    // following its name (a role made later is picked up).
    const guild = interaction.guild as LinkableGuild | null;
    const clubs = guild ? await guildClubs(club.guildId) : [];
    const pickedRoles = interaction.fields.getSelectedRoles(FIELD.roles, false);
    const matched = guild ? matchedStaffRoleIds(club, clubs, guild.roles.cache.values()) : [];
    data.staffRoleIds = listToStore(pickedRoles ? [...pickedRoles.keys()] : [], matched);

    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data });
    const after = guild ? await guildClubs(club.guildId) : [];
    const home: Links = { ids: updated.homeChannelIds, matched: false };
    const roles: Links = guild ? staffRolesOf(updated, after, guild) : { ids: updated.staffRoleIds, matched: false };
    const lines = [
        `**${updated.name}**`,
        ...(updated.circleId !== null ? [`Home channels: ${linksText(home, (id) => `<#${id}>`)}`] : []),
        `Staff roles: ${linksText(roles, (id) => `<@&${id}>`)}`,
        ...(updated.circleId !== null
            ? [
                  `Report channel: ${updated.reportChannelId ? `<#${updated.reportChannelId}>` : 'none, so no report posts'}`,
                  `Alert channel: ${updated.alertChannelId ? `<#${updated.alertChannelId}>` : 'none'}`,
              ]
            : []),
    ];
    await interaction.reply({ embeds: [successEmbed('Club updated', lines.join('\n'))] });
    void refreshDirectory(interaction.guild as unknown as DirectoryGuild | null);
}

/** A list of roles or channels as text, saying when it was matched by name. */
function linksText(links: Links, mention: (id: string) => string): string {
    if (links.ids.length === 0) return links.matched ? 'none found by name' : 'none';
    return `${links.ids.map(mention).join(' ')}${links.matched ? ' (matched by name)' : ''}`;
}

/**
 * `/club links`: each club's staff roles, as the bot reads them from the
 * server, so a Club Manager can see which were matched by name and fix them
 * with `/club admin`. Role and channel mentions in an embed do not
 * ping anyone.
 */
async function handleLinks(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild as LinkableGuild | null;
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId: interaction.guildId! }, orderBy: { name: 'asc' } });
    if (clubs.length === 0) {
        await interaction.reply({ embeds: [infoEmbed('Club links', 'No clubs yet.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const lines = clubs.map((club) => {
        const roles = guild ? staffRolesOf(club, clubs, guild) : { ids: club.staffRoleIds, matched: false };
        return `**${club.name}**${club.circleId === null ? ' (no uma.moe circle)' : ''}\nStaff roles: ${linksText(roles, (id) => `<@&${id}>`)}`;
    });
    // An embed description holds 4096 characters; split across embeds if needed.
    const embeds = [];
    let chunk = '';
    for (const line of lines) {
        if (chunk && chunk.length + line.length + 2 > 4000) {
            embeds.push(infoEmbed(embeds.length === 0 ? 'Club links' : 'Club links (cont.)', chunk));
            chunk = '';
        }
        chunk = chunk ? `${chunk}\n\n${line}` : line;
    }
    if (chunk) embeds.push(infoEmbed(embeds.length === 0 ? 'Club links' : 'Club links (cont.)', chunk));
    await interaction.reply({ embeds: embeds.slice(0, 10), flags: MessageFlags.Ephemeral });
}

/**
 * `/club profile`: opens the profile form for the club's staff and Club
 * Managers (see `clubProfile.ts`).
 */
async function handleProfile(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const club = await findClubOrReply(interaction, interaction.options.getString('club', true));
    if (!club) return;
    const full = isOfficer(member);
    if (!full && !(await canManageClubStats(member, club))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)], flags: MessageFlags.Ephemeral });
        return;
    }
    const hasBanner = (await prisma.clubBanner.count({ where: { clubId: club.id } })) > 0;
    await interaction.showModal(buildProfileModal(club, full, hasBanner));
}

/**
 * `/club directory`: posts the club directory in a channel, or refreshes it
 * where it is. Club Managers only. After this, club changes refresh it on
 * their own.
 */
async function handleDirectory(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can post the club directory.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const existing = await prisma.clubDirectory.findUnique({ where: { guildId: interaction.guildId! } });
    const channelId = interaction.options.getChannel('channel')?.id ?? existing?.channelId ?? null;
    if (!channelId) {
        await interaction.reply({ embeds: [errorEmbed('Pick a channel to post the directory in.')], flags: MessageFlags.Ephemeral });
        return;
    }

    // Posting a card per club takes longer than Discord's 3-second reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fetchChannel = async (id: string) => {
        const channel = await interaction.client.channels.fetch(id).catch(() => null);
        return channel && 'send' in channel && 'messages' in channel ? (channel as unknown as DirectoryChannel) : null;
    };
    const channel = await fetchChannel(channelId);
    if (!channel) {
        await interaction.editReply({ embeds: [errorEmbed(`Akikawa cannot post in <#${channelId}>.`)] });
        return;
    }
    try {
        // Every message is rewritten, which also finds any deleted by hand.
        const result = await publishDirectory(interaction.guild as unknown as DirectoryGuild, channel, fetchChannel, { force: true });
        const lines = [
            `${result.mode === 'edited' ? 'Updated' : 'Posted'} the directory in <#${channel.id}> with ${result.listed} club${result.listed === 1 ? '' : 's'}.`,
            ...(result.untiered.length > 0
                ? [`Not listed, with no tier yet: ${result.untiered.map((n) => `**${n}**`).join(', ')}. Set one with \`/club profile\`.`]
                : []),
            'It updates itself when a club changes.',
        ];
        await interaction.editReply({ embeds: [successEmbed('Club directory', lines.join('\n'))] });
    } catch (e) {
        await interaction.editReply({
            embeds: [errorEmbed(`Could not post the directory in <#${channel.id}>: ${e instanceof Error ? e.message : String(e)}. Check Akikawa can send messages, embed links and attach files there.`)],
        });
    }
}

async function handleDelete(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can delete clubs.')] });
        return;
    }

    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    // Fan snapshots and staff go with it (cascade); the old Club backup table is untouched.
    await prisma.trackedCircle.delete({ where: { id: club.id } });
    await interaction.reply({ embeds: [successEmbed('Club deleted', `**${club.name}**, its staff and its fan history were removed.`)] });
}

async function handleView(interaction: ChatInputCommandInteraction) {
    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    await interaction.deferReply();

    const members: ClubMember[] = await prisma.clubMember.findMany({ where: { clubId: club.id } });
    // await interaction.reply({ embeds: [clubEmbed(club, members)] });

    const staffNames = new Map<string, string>();
    for (const m of members) {
        try {
            const guildMember = await interaction.guild!.members.fetch(m.discordUserId);
            staffNames.set(m.discordUserId, guildMember.displayName);
        } catch {
            staffNames.set(m.discordUserId, 'Unknown Member');
        }
    }
    
    const buffer = await renderClubView({ ...(await clubSummary(club)), members }, staffNames);
    const attachment = new AttachmentBuilder(buffer, { name: `club-view-${club.name}.png` });
    await interaction.editReply({ files: [attachment] });
}

async function handleList(interaction: ChatInputCommandInteraction) {
    // const clubs = await prisma.club.findMany({ orderBy: { name: 'asc' } });

    // const embed = infoEmbed(`Clubs (${clubs.length})`).addFields(
    //     clubs.map((c: Club) => ({
    //         name: c.name,
    //         value: `Rank: **${formatRank(c.rank)}** | Headcount: **${c.headcount}/${MAX_HEADCOUNT}** | Fans: **${formatFanCount(c.fanCountAmount, c.fanCountPeriod)}**`,
    //     })),
    // );

    // await interaction.reply({ embeds: [embed] });

    await interaction.deferReply();
    
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId: interaction.guildId! }, orderBy: { name: 'asc' } });
    const buffer = await renderClubList(await Promise.all(clubs.map(clubSummary)));
    const attachment = new AttachmentBuilder(buffer, { name: 'club-directory.png' });
    await interaction.editReply({ files: [attachment] });
}

/**
 * Parses a club fan count into millions, the unit it is stored and shown in.
 *
 * The option says "in millions", so a bare number is millions ("50" is 50M).
 * K, M and B are also accepted, in either case and with or without a space,
 * as are thousands separators ("1,500M"). Only "50M" with no space used to
 * pass, which rejected ordinary input like "50" or "50 m".
 *
 * @returns The amount in millions, or null when it is not a positive amount.
 */
export function parseClubFanAmount(input: string): number | null {
    const cleaned = /^\s*\d{1,3}(,\d{3})+(\.\d+)?\s*[kmb]?\s*$/i.test(input) ? input.replace(/,/g, '') : input;
    const match = /^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(cleaned);
    if (!match) return null;
    const value = Number(match[1]);
    const perMillion = { k: 0.001, m: 1, b: 1000 }[match[2]?.toLowerCase() ?? ''] ?? 1;
    const amount = value * perMillion;
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function handleFancount(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    if (!(await canManageClubStats(member, club))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)] });
        return;
    }

    const rawAmount = interaction.options.getString('amount', true).trim();
    const period = interaction.options.getString('period') as FanCountPeriod | null;

    const amount = parseClubFanAmount(rawAmount);
    if (amount === null) {
        await interaction.reply({ embeds: [errorEmbed("Amount must be a number like '50', '50M', '0.25M', '500K' or '1.2B'.")] });
        return;
    }

    // The club fan count is the quota now; amounts here are in millions.
    const updated = await prisma.trackedCircle.update({
        where: { id: club.id },
        data: { quota: BigInt(Math.round(amount * 1_000_000)), quotaPeriod: (period ?? 'MONTH') as QuotaPeriod, fanCountAmount: null, fanCountPeriod: null },
    });
    await interaction.reply({ embeds: [successEmbed('Quota Updated', `**${updated.name}** quota is now **${clubQuotaText(updated)}** per member.`)] });
}

async function handleMemberSubcommand(interaction: ChatInputCommandInteraction, member: GuildMember, sub: string) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can manage club trainers/assistants.')] });
        return;
    }

    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    switch(sub) {
        case 'add': {
            const target = interaction.options.getUser('member', true);
            const role = interaction.options.getString('role', true) as ClubMemberRole;

            const existing = await prisma.clubMember.findUnique({ where: { clubId_discordUserId: { clubId: club.id, discordUserId: target.id } } });
            if (existing) {
                await interaction.reply({ embeds: [errorEmbed(`<@${target.id}> is already **${formatMemberRole(existing.role).toLowerCase()}** of **${club.name}**. Use \`/club member edit\` to change their role.`)] });
                return;
            }

            await prisma.clubMember.create({ data: { clubId: club.id, discordUserId: target.id, role } });
            await interaction.reply({ embeds: [successEmbed('Club Staff Added', `<@${target.id}> is now a **${formatMemberRole(role)}** of **${club.name}**.`)] });
            break;
        }
        case 'edit': {
            const target = interaction.options.getUser('member', true);
            const role = interaction.options.getString('role', true) as ClubMemberRole;

            const existing = await prisma.clubMember.findUnique({ where: { clubId_discordUserId: { clubId: club.id, discordUserId: target.id } } });
            if (!existing) {
                await interaction.reply({ embeds: [errorEmbed(`<@${target.id}> is not staff of **${club.name}**.`)] });
                return;
            }

            await prisma.clubMember.update({ where: { clubId_discordUserId: { clubId: club.id, discordUserId: target.id } }, data: { role } });
            await interaction.reply({ embeds: [successEmbed('Club Staff Updated', `<@${target.id}> is now a **${formatMemberRole(role)}** of **${club.name}**.`)]});
            break;
        }
        case 'remove': {
            const target = interaction.options.getUser('member', true);

            const existing = await prisma.clubMember.findUnique({ where: { clubId_discordUserId: { clubId: club.id, discordUserId: target.id } } });
            if (!existing) {
                await interaction.reply({ embeds: [errorEmbed(`<@${target.id}> is not staff of **${club.name}**.`)] });
                return;
            }

            await prisma.clubMember.delete({ where: { clubId_discordUserId: { clubId: club.id, discordUserId: target.id } } });
            await interaction.reply({ embeds: [successEmbed('Club Staff Removed', `<@${target.id}> is no longer staff of **${club.name}**.`)] });
            break;
        }
        case 'list': {
            const members: ClubMember[] = await prisma.clubMember.findMany({ where: { clubId: club.id } });
            const trainers = members.filter((m) => m.role === 'TRAINER');
            const assistants = members.filter((m) => m.role === 'ASSISTANT');

            const embed = infoEmbed(`${club.name} - Staff`).addFields(
                { name: `Trainers`, value: trainers.length ? trainers.map((m) => `<@${m.discordUserId}>`).join('\n') : 'None assigned' },
                { name: `Assistants (${assistants.length})`, value: assistants.length ? assistants.map((m) => `<@${m.discordUserId}>`).join('\n') : 'None assigned'},
            );

            await interaction.reply({ embeds: [embed] });
            break;
        }
    }
}