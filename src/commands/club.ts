import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    GuildMember,
    EmbedBuilder,
    AttachmentBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { prisma } from '../db/prisma';
import { canManageClubStats, isOfficer } from "../lib/permissions";
import { autoCompleteClubName } from "../lib/clubAutocomplete";
import { successEmbed, errorEmbed, infoEmbed, COLORS } from "../lib/embeds";
import { renderClubList  } from "../lib/image/renderClubList";
import { renderClubView } from "../lib/image/renderClubView";
import type { TrackedCircle, ClubMember, ClubRank, ClubMemberRole, FanCountPeriod } from '@prisma/client';
import { backfillOnce, syncCircle } from '../lib/fans/ingest';

/**
 * A club is a `TrackedCircle` row: clubs and tracked uma.moe circles were
 * merged on 2026-10-04. `circleId` is set when the club's fans are tracked.
 */
type Club = TrackedCircle;

// ================================================================================

const RANK_CHOICES: { name: string; value: ClubRank }[]= [
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

function clubEmbed(club: Club, members: ClubMember[]): EmbedBuilder {
    const trainers = members.filter((m) => m.role === 'TRAINER');
    const assistants = members.filter((m) => m.role === 'ASSISTANT');

    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(club.name)
        .addFields(
            { name: 'Rank', value: formatRank(club.rank), inline: true },
            { name: 'Headcount', value: `${club.headcount}/${MAX_HEADCOUNT}`, inline: true},
            { name: 'Fan Count', value: formatFanCount(club.fanCountAmount, club.fanCountPeriod), inline: true},
            { name: 'Trainer', value: trainers.length ? trainers.map((m) => `<@${m.discordUserId}>`).join('\n') : 'None assigned', inline: true},
            { name: `Assistants (${assistants.length})`, value: assistants.length ? assistants.map((m) => `<@${m.discordUserId}>`).join('\n') : 'None assigned', inline: true},
        )
        .setFooter({ text: `CLUB ID: ${club.id}` })
        .setTimestamp(club.updatedAt);
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
            .addStringOption((opt) => opt.setName('rank').setDescription('Intended rank').setRequired(true).setChoices(...RANK_CHOICES))
            .addStringOption((opt) => opt.setName('circle_id').setDescription('uma.moe circle ID, to track its fans (from uma.moe/circles)'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('edit')
            .setDescription("Edit a club's info in a form (Club Managers; the club's staff for headcount and fan count).")
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
    .addSubcommand((sub) =>
        sub
            .setName('headcount')
            .setDescription("Set a club's headcount (max 30). Club trainers/assistants or Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to update').setRequired(true).setAutocomplete(true))
            .addIntegerOption((opt) => opt.setName('count').setDescription('New headcount').setRequired(true).setMinValue(0).setMaxValue(30))
    )
    .addSubcommand((sub) =>
        sub
            .setName('fancount')
            .setDescription("Set a club's fancount. Club trainers/assistants or Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to update').setRequired(true).setAutocomplete(true))
            .addStringOption((opt) => opt.setName('amount').setDescription('Amount in millions, e.g. 50M, 0.5M').setRequired(true))
            .addStringOption((opt) => opt.setName('period').setDescription('Leave empty for a flat total').setRequired(false).addChoices(...PERIOD_CHOICES))
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
        case 'headcount':
            await handleHeadcount(interaction, member);
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
        await interaction.editReply({ embeds: [successEmbed('Club created', `**${club.name}** was created at intended rank **${formatRank(club.rank)}**.`)] });
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
                    `**${result.name}** was created at intended rank **${formatRank(club.rank)}** and its fans are tracked ` +
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
 * Managers get rank, headcount, fan count and period, plus the name for a
 * club without uma.moe tracking (a tracked club's name comes from uma.moe and
 * is refreshed on every sync) or its home channels for a tracked one: a modal
 * holds five fields at most. A club's own staff (Trainers and Assistants) get
 * headcount and fan count only, the same split as `/club headcount` and
 * `/club fancount`. The custom ID carries the club and which form it is, and
 * the submit checks permission again.
 */
const CLUB_MODAL_PREFIX = 'club:edit:';
const EDIT_FIELD = {
    name: 'club:name',
    rank: 'club:rank',
    headcount: 'club:headcount',
    fanCount: 'club:fancount',
    period: 'club:period',
    home: 'club:home',
} as const;
/** Home channels a club may list. Threads inside them count without listing. */
const MAX_HOME_CHANNELS = 10;
/** The period choice meaning "a flat total, not per period". */
const FLAT_TOTAL = 'NONE';

/** True for a modal this module owns. */
export function isClubModal(customId: string): boolean {
    return customId.startsWith(CLUB_MODAL_PREFIX);
}

/** Builds the edit form for a club. `full` adds name and rank (Club Managers). */
export function buildClubEditModal(club: Club, full: boolean): ModalBuilder {
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
            new LabelBuilder().setLabel('Rank').setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId(EDIT_FIELD.rank)
                    .addOptions(RANK_CHOICES.map((r) => ({ label: r.name, value: r.value, default: r.value === club.rank }))),
            ),
        );
    }
    labels.push(
        new LabelBuilder()
            .setLabel('Headcount')
            .setDescription(`0 to ${MAX_HEADCOUNT}.`)
            .setTextInputComponent(
                new TextInputBuilder().setCustomId(EDIT_FIELD.headcount).setStyle(TextInputStyle.Short).setValue(String(club.headcount)).setMaxLength(2),
            ),
        new LabelBuilder()
            .setLabel('Fan count')
            .setDescription('In millions, e.g. 50M, 0.5M or 500K. Leave empty to clear it.')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId(EDIT_FIELD.fanCount)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(20)
                    .setValue(club.fanCountAmount === null ? '' : `${club.fanCountAmount}M`),
            ),
        new LabelBuilder().setLabel('Fan count period').setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
                .setCustomId(EDIT_FIELD.period)
                .addOptions(
                    { label: 'Flat total', value: FLAT_TOTAL, default: club.fanCountPeriod === null },
                    ...PERIOD_CHOICES.map((p) => ({ label: p.name, value: p.value, default: p.value === club.fanCountPeriod })),
                ),
        ),
    );
    if (full && club.circleId !== null) {
        const home = new ChannelSelectMenuBuilder()
            .setCustomId(EDIT_FIELD.home)
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(MAX_HOME_CHANNELS);
        if (club.homeChannelIds.length > 0) home.setDefaultChannels(...club.homeChannelIds.slice(0, MAX_HOME_CHANNELS));
        labels.push(
            new LabelBuilder()
                .setLabel('Home channels')
                .setDescription("The club's own channels. Threads inside them count too.")
                .setChannelSelectMenuComponent(home),
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
    if (!full && !(await canManageClubStats(member, club.id))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)] });
        return;
    }
    await interaction.showModal(buildClubEditModal(club, full));
}

/** Handles the submitted edit form. */
export async function handleClubModal(interaction: ModalSubmitInteraction) {
    const [clubId, kind] = interaction.customId.slice(CLUB_MODAL_PREFIX.length).split(':');
    const refuse = (text: string) => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

    const club = clubId ? await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId ?? '' } }) : null;
    if (!club) return void (await refuse('That club no longer exists.'));

    const member = interaction.member as GuildMember;
    const full = kind === 'full';
    if (full ? !isOfficer(member) : !(await canManageClubStats(member, club.id))) {
        return void (await refuse(full ? 'Only Club Managers can rename a club or change its rank.' : `You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`));
    }

    const data: {
        name?: string;
        rank?: ClubRank;
        homeChannelIds?: string[];
        headcount: number;
        fanCountAmount: number | null;
        fanCountPeriod: FanCountPeriod | null;
    } = {
        headcount: 0,
        fanCountAmount: null,
        fanCountPeriod: null,
    };

    if (full && club.circleId === null) {
        const name = interaction.fields.getTextInputValue(EDIT_FIELD.name).trim();
        if (!name) return void (await refuse('The club needs a name.'));
        const taken = await prisma.trackedCircle.findFirst({
            where: { guildId: club.guildId, name: { equals: name, mode: 'insensitive' }, NOT: { id: club.id } },
        });
        if (taken) return void (await refuse(`A club named **${name}** already exists.`));
        data.name = name;
    }
    if (full && club.circleId !== null) {
        const picked = interaction.fields.getSelectedChannels(EDIT_FIELD.home, false);
        data.homeChannelIds = picked ? [...picked.keys()] : [];
    }
    if (full) {
        const rank = interaction.fields.getStringSelectValues(EDIT_FIELD.rank)[0] as ClubRank | undefined;
        if (rank && RANK_CHOICES.some((r) => r.value === rank)) data.rank = rank;
    }

    const rawHeadcount = interaction.fields.getTextInputValue(EDIT_FIELD.headcount).trim();
    const headcount = Number(rawHeadcount);
    if (!/^\d+$/.test(rawHeadcount) || headcount > MAX_HEADCOUNT) {
        return void (await refuse(`Headcount must be a whole number from 0 to ${MAX_HEADCOUNT}.`));
    }
    data.headcount = headcount;

    const rawFans = interaction.fields.getTextInputValue(EDIT_FIELD.fanCount).trim();
    if (rawFans) {
        const amount = parseClubFanAmount(rawFans);
        if (amount === null) return void (await refuse("Fan count must be a number like '50', '50M', '0.25M', '500K' or '1.2B', or empty."));
        data.fanCountAmount = amount;
        const period = interaction.fields.getStringSelectValues(EDIT_FIELD.period)[0];
        data.fanCountPeriod = period && period !== FLAT_TOTAL ? (period as FanCountPeriod) : null;
    }

    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data });
    await interaction.reply({
        embeds: [
            successEmbed(
                'Club updated',
                [
                    `**${updated.name}** · rank **${formatRank(updated.rank)}**`,
                    `Headcount: **${updated.headcount}/${MAX_HEADCOUNT}**`,
                    `Fan count: **${formatFanCount(updated.fanCountAmount, updated.fanCountPeriod)}**`,
                    ...(updated.circleId !== null
                        ? [`Home channels: ${updated.homeChannelIds.length > 0 ? updated.homeChannelIds.map((id) => `<#${id}>`).join(' ') : 'none'}`]
                        : []),
                ].join('\n'),
            ),
        ],
    });
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
    
    const buffer = await renderClubView({ ...club, members }, staffNames);
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
    const buffer = await renderClubList(clubs);
    const attachment = new AttachmentBuilder(buffer, { name: 'club-directory.png' });
    await interaction.editReply({ files: [attachment] });
}

async function handleHeadcount(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    if (!(await canManageClubStats(member, club.id))) {
        await interaction.reply({ embeds: [errorEmbed(`You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`)] });
        return;
    }

    const count = interaction.options.getInteger('count', true);
    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data: { headcount: count } });

    await interaction.reply({ embeds: [successEmbed('Headcount Updated', `**${updated.name}** headcount is now **${updated.headcount}/${MAX_HEADCOUNT}**.`)] });
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

    if (!(await canManageClubStats(member, club.id))) {
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

    const updated = await prisma.trackedCircle.update({
        where: { id: club.id }, data: { fanCountAmount: amount, fanCountPeriod: period },
    });
    await interaction.reply({ embeds: [successEmbed('Fan Count Updated', `**${updated.name}** fan count is now **${formatFanCount(updated.fanCountAmount, updated.fanCountPeriod)}**.`)] });
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