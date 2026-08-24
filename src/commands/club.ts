import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, GuildMember, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { prisma } from '../db/prisma';
import { canManageClubStats, isOfficer } from "../lib/permissions";
import { autoCompleteClubName } from "../lib/clubAutocomplete";
import { successEmbed, errorEmbed, infoEmbed, COLORS } from "../lib/embeds";
import { renderClubList  } from "../lib/image/renderClubList";
import { renderClubView } from "../lib/image/renderClubView";
import type { Club, ClubMember, ClubRank, ClubMemberRole, FanCountPeriod } from '@prisma/client';

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

const FAN_AMOUNT_PATTERN = /^\d+(\.\d+)?M$/i;
const MAX_HEADCOUNT = 30;

// ================================================================================

function formatRank(rank: ClubRank): string {
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
    const club = await prisma.club.findUnique({ where: {id: clubId} });
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
    )
    .addSubcommand((sub) =>
        sub
            .setName('edit')
            .setDescription("Edit an existing club's info. Club Managers only.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to edit').setRequired(true).setAutocomplete(true))
            .addStringOption((opt) => opt.setName('name').setDescription(' New club name').setRequired(false))
            .addStringOption((opt) => opt.setName('rank').setDescription('New intended rank').setRequired(false).setChoices(...RANK_CHOICES))
    )
    .addSubcommand((sub) => 
        sub
            .setName('delete')
            .setDescription('Delete a club. Club Managers only.')
            .addStringOption((opt) => opt.setName('club').setDescription('Club to delete').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
        sub
            .setName('view')
            .setDescription("View a club's info.")
            .addStringOption((opt) => opt.setName('club').setDescription('Club to delete').setRequired(true).setAutocomplete(true))
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

    const name = interaction.options.getString('name', true).trim();
    const rank = interaction.options.getString('rank', true) as ClubRank;

    const existing = await prisma.club.findUnique({ where: { name } });
    if (existing) {
        await interaction.reply({ embeds: [errorEmbed(`A club named **${name}** already exists.`)] });
        return;
    }

    const club = await prisma.club.create({ data: {name, rank} });
    await interaction.reply({ embeds: [successEmbed('Club created', `**${club.name}** was created at intended rank **${formatRank(club.rank)}**.`)] });
}

async function handleEdit(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can edit clubs.')] });
        return;
    }

    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    const name = interaction.options.getString('name');
    const rank = interaction.options.getString('rank') as ClubRank | null;

    if (!name && !rank) {
        await interaction.reply({ embeds: [errorEmbed('Provide a new name and/or a new rank to edit.')] });
        return;
    }

    if (name) {
        const nameTaken = await prisma.club.findFirst({ where: { name, NOT: { id: club.id } } });
        if (nameTaken) {
            await interaction.reply({ embeds: [errorEmbed(`A club named **${name}** already exists.`)] });
            return;
        }
    }

    const updated = await prisma.club.update({ where: { id: club.id }, data: { ...(name ? { name } : {}), ...(rank ? { rank } : {}) }});
    await interaction.reply({ embeds: [successEmbed('Club updated', `Name of the club is **${updated.name}** and the rank of the club is **${formatRank(updated.rank)}**.`)] });
}

async function handleDelete(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!isOfficer(member)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can delete clubs.')] });
        return;
    }

    const clubId = interaction.options.getString('club', true);
    const club = await findClubOrReply(interaction, clubId);
    if (!club) return;

    await prisma.club.delete({ where: { id: club.id } });
    await interaction.reply({ embeds: [successEmbed('Club deleted', `**${club.name}** and its records were removed.`)] });
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
    
    const clubs = await prisma.club.findMany({ orderBy: { name: 'asc' } });
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
    const updated = await prisma.club.update({ where: { id: club.id }, data: { headcount: count } });

    await interaction.reply({ embeds: [successEmbed('Headcount Updated', `**${updated.name}** headcount is now **${updated.headcount}/${MAX_HEADCOUNT}**.`)] });
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

    if (!FAN_AMOUNT_PATTERN.test(rawAmount)) {
        await interaction.reply({ embeds: [errorEmbed("Amount must be a number ending in 'M', e.g. '50M' or '0.25M'.")] });
        return;
    }

    const amount = parseFloat(rawAmount.slice(0, -1));

    const updated = await prisma.club.update({
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