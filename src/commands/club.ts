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
import { guildClubs, homeChannelsOf, listToStore, matchedHomeChannelIds, matchedStaffRoleIds, staffRolesOf, type LinkableGuild, type Links } from '../lib/clubLinks';
import { autoCompleteClubName } from "../lib/clubAutocomplete";
import { successEmbed, errorEmbed, infoEmbed } from "../lib/embeds";
import { renderClubList, type ClubSummary } from "../lib/image/renderClubList";
import { renderClubView } from "../lib/image/renderClubView";
import type { TrackedCircle, ClubMember, ClubRank, ClubMemberRole, FanCountPeriod, QuotaPeriod } from '@prisma/client';
import { backfillOnce, syncCircle } from '../lib/fans/ingest';
import { currentCircleProgress } from '../lib/fans/reports';
import { describeQuota, toSafeNumber } from '../lib/fans/metrics';
import { parseQuota } from './fans';

/**
 * A club is a `TrackedCircle` row: clubs and tracked uma.moe circles were
 * merged on 2026-10-04. `circleId` is set when the club's fans are tracked.
 */
type Club = TrackedCircle;

// ================================================================================

const RANK_CHOICES: { name: string; value: ClubRank }[]= [
    { name: 'Casual', value: 'CASUAL'},
    { name: 'B', value: 'B'},
    { name: 'B+', value: 'B_PLUS'},
    { name: 'A', value: 'A'},
    { name: 'A+', value: 'A_PLUS'},
    { name: 'S', value: 'S'},
    { name: 'S+', value: 'S_PLUS'},
];

const MEMBER_ROLE_CHOICES: {name: string; value: ClubMemberRole }[] = [
    { name: 'Trainer', value: 'TRAINER' },
    { name: 'Assistant', value: 'ASSISTANT' }
];

const PERIOD_CHOICES: { name: string; value: FanCountPeriod }[] = [
    { name: 'Day', value: 'DAY' },
    { name: 'Week', value: 'WEEK' },
    { name: 'Biweekly', value: 'BIWEEKLY' },
    { name: 'Month', value: 'MONTH' },
];

const MAX_HEADCOUNT = 30;

// ================================================================================

function formatRank(rank: ClubRank | null): string {
    if (rank === null) return 'Not set';
    return RANK_CHOICES.find((r) => r.value === rank)?.name ?? rank;
}

function formatMemberRole(role: ClubMemberRole): string {
    return MEMBER_ROLE_CHOICES.find((r) => r.value === role)?.name ?? role;
}

function formatPeriod(period: FanCountPeriod): string {
    return PERIOD_CHOICES.find((p)  => p.value === period)?.name.toLowerCase() ?? period.toLowerCase();
}

function formatFanCount(amount: number | null, period: FanCountPeriod | null): string {
    if (amount === null) return 'Not set';
    const amountLabel = `${amount}M`;
    return period ? `${amountLabel}/${formatPeriod(period)}` : amountLabel;
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

/**
 * The club's fan quota as text. Clubs and circles share one quota since the
 * merge; an old club fan count is shown only if no quota was ever set.
 */
function clubQuotaText(club: Club): string {
    const quota = toSafeNumber(club.quota);
    if (quota > 0) return describeQuota(quota, club.quotaPeriod);
    return club.fanCountAmount === null ? 'Not set' : formatFanCount(club.fanCountAmount, club.fanCountPeriod);
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
            .setName('edit')
            .setDescription("Edit a club's info in a form (Club Managers; the club's staff for its quota).")
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
    .addSubcommand((sub) => sub.setName('links').setDescription("Show each club's staff roles and home channels, and which were matched by name."))
    .addSubcommand((sub) =>
        sub
            .setName('fancount')
            .setDescription("Set a club's quota per member. Club trainers/assistants or Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to update').setRequired(true).setAutocomplete(true))
            .addStringOption((opt) => opt.setName('amount').setDescription('Per member, in millions, e.g. 50M, 0.5M').setRequired(true))
            .addStringOption((opt) => opt.setName('period').setDescription('Per day, week, 2 weeks or month (default month)').setRequired(false).addChoices(...PERIOD_CHOICES))
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
        return;
    }

    switch (sub) {
        case 'create':
            await handleCreate(interaction, member);
            break;
        case 'edit':
            await handleEdit(interaction, member);
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
        case 'fancount':
            await handleFancount(interaction, member);
            break;
    }
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

// ─── Edit form ────────────────────────────────────────────────────────────────

/**
 * `/club edit` opens a form pre-filled with the club's current info. Club
 * Managers get the expected rank and the quota, plus the name for a club
 * without uma.moe tracking (a tracked club's name comes from uma.moe and is
 * refreshed on every sync) or its home channels for a tracked one. A club's
 * own staff (Trainers and Assistants) get the quota only, as `/club fancount`
 * allowed. Headcount is not a field: it is worked out from uma.moe.
 *
 * The quota is the same one `/fans` measures against (clubs and circles are
 * one row), so the form shows and changes the real quota. The custom ID
 * carries the club and which form it is, and the submit checks permission
 * again.
 */
const CLUB_MODAL_PREFIX = 'club:edit:';
const EDIT_FIELD = {
    name: 'club:name',
    rank: 'club:rank',
    quota: 'club:quota',
    period: 'club:period',
    home: 'club:home',
    roles: 'club:roles',
} as const;
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
 * The home channels and staff roles the form should show: the stored lists,
 * or what matches the club's name when they are empty, so the form shows what
 * the bot actually uses.
 */
async function formLinks(club: Club, guild: LinkableGuild | null): Promise<ClubFormLinks> {
    if (!guild) return { home: club.homeChannelIds, roles: club.staffRoleIds };
    const clubs = await guildClubs(club.guildId);
    // A role or channel deleted since it was stored cannot be pre-selected.
    const roleIds = new Set([...guild.roles.cache.values()].map((r) => r.id));
    const channelIds = new Set([...guild.channels.cache.values()].map((c) => c.id));
    return {
        home: homeChannelsOf(club, clubs, guild).ids.filter((id) => channelIds.has(id)),
        roles: staffRolesOf(club, clubs, guild).ids.filter((id) => roleIds.has(id)),
    };
}

/** True for a modal this module owns. */
export function isClubModal(customId: string): boolean {
    return customId.startsWith(CLUB_MODAL_PREFIX);
}

/**
 * Builds the edit form for a club. `full` is the Club Manager form. `links`
 * pre-fills the home channels and staff roles; it defaults to the stored
 * lists.
 */
export function buildClubEditModal(
    club: Club,
    full: boolean,
    links: ClubFormLinks = { home: club.homeChannelIds, roles: club.staffRoleIds },
): ModalBuilder {
    const labels: LabelBuilder[] = [];
    if (full && club.circleId === null) {
        labels.push(
            new LabelBuilder()
                .setLabel('Name')
                .setTextInputComponent(new TextInputBuilder().setCustomId(EDIT_FIELD.name).setStyle(TextInputStyle.Short).setValue(club.name).setMaxLength(100)),
        );
    }
    if (full) {
        labels.push(
            new LabelBuilder().setLabel('Expected rank').setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId(EDIT_FIELD.rank)
                    .setPlaceholder('Not set')
                    .addOptions(RANK_CHOICES.map((r) => ({ label: r.name, value: r.value, default: r.value === club.rank }))),
            ),
        );
    }
    const quotaValue = quotaInputValue(club);
    const quota = new TextInputBuilder().setCustomId(EDIT_FIELD.quota).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20);
    if (quotaValue) quota.setValue(quotaValue);
    labels.push(
        new LabelBuilder()
            .setLabel('Quota per member')
            .setDescription('Fans each member owes per period, e.g. 90M, 500K or 1.2B. Empty to clear.')
            .setTextInputComponent(quota),
        new LabelBuilder().setLabel('Quota period').setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
                .setCustomId(EDIT_FIELD.period)
                .addOptions(PERIOD_CHOICES.map((p) => ({ label: p.name, value: p.value, default: p.value === club.quotaPeriod }))),
        ),
    );
    if (full && club.circleId !== null) {
        const home = new ChannelSelectMenuBuilder()
            .setCustomId(EDIT_FIELD.home)
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(MAX_HOME_CHANNELS);
        if (links.home.length > 0) home.setDefaultChannels(...links.home.slice(0, MAX_HOME_CHANNELS));
        labels.push(
            new LabelBuilder()
                .setLabel('Home channels')
                .setDescription("The club's own channels; threads inside count too. Empty: channels named after the club.")
                .setChannelSelectMenuComponent(home),
        );
    }
    if (full) {
        const roles = new RoleSelectMenuBuilder()
            .setCustomId(EDIT_FIELD.roles)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(MAX_STAFF_ROLES);
        if (links.roles.length > 0) roles.setDefaultRoles(...links.roles.slice(0, MAX_STAFF_ROLES));
        labels.push(
            new LabelBuilder()
                .setLabel('Staff roles')
                .setDescription(`Holders count as ${club.name}'s staff. Empty: its Trainer and Assistant roles by name.`.slice(0, 100))
                .setRoleSelectMenuComponent(roles),
        );
    }
    return new ModalBuilder()
        .setCustomId(`${CLUB_MODAL_PREFIX}${club.id}:${full ? 'full' : 'stats'}`)
        .setTitle(`Edit ${club.name}`.slice(0, 45))
        .addLabelComponents(...labels);
}

async function handleEdit(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    const full = isOfficer(member);
    if (!full && !(await canManageClubStats(member, club))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)] });
        return;
    }
    // A modal must answer within 3 seconds; this is two quick reads.
    await interaction.showModal(buildClubEditModal(club, full, await formLinks(club, interaction.guild as LinkableGuild | null)));
}

/** Handles the submitted edit form. */
export async function handleClubModal(interaction: ModalSubmitInteraction) {
    const [clubId, kind] = interaction.customId.slice(CLUB_MODAL_PREFIX.length).split(':');
    const refuse = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

    const club = clubId ? await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId ?? '' } }) : null;
    if (!club) return void (await refuse('That club no longer exists.'));

    const member = interaction.member as GuildMember;
    const full = kind === 'full';
    if (full ? !isOfficer(member) : !(await canManageClubStats(member, club))) {
        return void (await refuse(full ? 'Only Club Managers can change a club\'s name, rank or channels.' : `You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`));
    }

    // The quota replaces the old club fan count, which is cleared so it
    // never shows as a second, stale number.
    const data: {
        name?: string;
        rank?: ClubRank;
        homeChannelIds?: string[];
        staffRoleIds?: string[];
        quota: bigint;
        quotaPeriod: QuotaPeriod;
        fanCountAmount: null;
        fanCountPeriod: null;
    } = { quota: BigInt(0), quotaPeriod: club.quotaPeriod, fanCountAmount: null, fanCountPeriod: null };

    if (full && club.circleId === null) {
        const name = interaction.fields.getTextInputValue(EDIT_FIELD.name).trim();
        if (!name) return void (await refuse('The club needs a name.'));
        const taken = await prisma.trackedCircle.findFirst({
            where: { guildId: club.guildId, name: { equals: name, mode: 'insensitive' }, NOT: { id: club.id } },
        });
        if (taken) return void (await refuse(`A club named **${name}** already exists.`));
        data.name = name;
    }
    // A list equal to the name matches is stored empty, so the club keeps
    // following its name (a channel or role added later is picked up).
    const guild = interaction.guild as LinkableGuild | null;
    const clubs = guild ? await guildClubs(club.guildId) : [];
    if (full && club.circleId !== null) {
        const picked = interaction.fields.getSelectedChannels(EDIT_FIELD.home, false);
        const matched = guild ? matchedHomeChannelIds(club, clubs, guild.channels.cache.values()) : [];
        data.homeChannelIds = listToStore(picked ? [...picked.keys()] : [], matched);
    }
    if (full) {
        const picked = interaction.fields.getSelectedRoles(EDIT_FIELD.roles, false);
        const matched = guild ? matchedStaffRoleIds(club, clubs, guild.roles.cache.values()) : [];
        data.staffRoleIds = listToStore(picked ? [...picked.keys()] : [], matched);
    }
    if (full) {
        const rank = interaction.fields.getStringSelectValues(EDIT_FIELD.rank)[0] as ClubRank | undefined;
        if (rank && RANK_CHOICES.some((r) => r.value === rank)) data.rank = rank;
    }

    const rawQuota = interaction.fields.getTextInputValue(EDIT_FIELD.quota).trim();
    if (rawQuota) {
        const quota = parseQuota(rawQuota);
        if (quota === null || quota <= 0) return void (await refuse('Quota must be an amount like 90M, 500K, 1.2B or 80,000,000, or empty.'));
        data.quota = BigInt(quota);
    }
    const period = interaction.fields.getStringSelectValues(EDIT_FIELD.period)[0];
    if (period && PERIOD_CHOICES.some((p) => p.value === period)) data.quotaPeriod = period as QuotaPeriod;

    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data });
    const headcount = await clubHeadcount(updated);
    const after = guild ? await guildClubs(club.guildId) : [];
    const home: Links = guild ? homeChannelsOf(updated, after, guild) : { ids: updated.homeChannelIds, matched: false };
    const roles: Links = guild ? staffRolesOf(updated, after, guild) : { ids: updated.staffRoleIds, matched: false };
    await interaction.reply({
        embeds: [
            successEmbed(
                'Club updated',
                [
                    `**${updated.name}** · expected rank **${formatRank(updated.rank)}**`,
                    `Headcount: **${headcount === null ? '—' : `${headcount}/${MAX_HEADCOUNT}`}** (from uma.moe)`,
                    `Quota: **${clubQuotaText(updated)}** per member`,
                    ...(updated.circleId !== null ? [`Home channels: ${linksText(home, (id) => `<#${id}>`)}`] : []),
                    ...(full ? [`Staff roles: ${linksText(roles, (id) => `<@&${id}>`)}`] : []),
                ].join('\n'),
            ),
        ],
    });
}

/** A list of roles or channels as text, saying when it was matched by name. */
function linksText(links: Links, mention: (id: string) => string): string {
    if (links.ids.length === 0) return links.matched ? 'none found by name' : 'none';
    return `${links.ids.map(mention).join(' ')}${links.matched ? ' (matched by name)' : ''}`;
}

/**
 * `/club links`: each club's staff roles and home channels, as the bot reads
 * them from the server, so a Club Manager can see what was matched by name
 * and fix it with `/club edit`. Role and channel mentions in an embed do not
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
        const home = guild ? homeChannelsOf(club, clubs, guild) : { ids: club.homeChannelIds, matched: false };
        return [
            `**${club.name}**${club.circleId === null ? ' (no uma.moe circle)' : ''}`,
            `Staff roles: ${linksText(roles, (id) => `<@&${id}>`)}`,
            `Home channels: ${linksText(home, (id) => `<#${id}>`)}`,
        ].join('\n');
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