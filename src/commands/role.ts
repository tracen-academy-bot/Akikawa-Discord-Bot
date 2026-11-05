import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, type GuildMember, type Role } from 'discord.js';
import { successEmbed, errorEmbed } from '../lib/embeds';
import { isOfficer } from '../lib/permissions';
import { assignRole, unassignRole, checkRoleHierarchy, hasClubRoles, isClubRole, isDefaultRole, membersToGrant } from '../lib/roleAssignment';

export const data = new SlashCommandBuilder()
    .setName('role')
    .setDescription('Assign or remove a club role from a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) => 
        sub
            .setName('add')
            .setDescription('Assign a club role to a member (override the old club role or Tracen Applicant role.)')
            .addUserOption((opt) => opt.setName('member').setDescription('The member to assign the role to').setRequired(true))
            .addRoleOption((opt) => opt.setName('role').setDescription('The club role to assign').setRequired(true))
    )
    .addSubcommand((sub) =>
        sub    
            .setName('remove')
            .setDescription('Remove a club role from a member (automatically assigns Tracen Applicant role).')
            .addUserOption((opt) => opt.setName('member').setDescription('The member to remove the role from').setRequired(true))
            .addRoleOption((opt) => opt.setName('role').setDescription('The club role to assign').setRequired(true))
    )
    .addSubcommand((sub) =>
        sub
            .setName('give-club-members')
            .setDescription('Give a role to everyone who has any club role. Club Managers only.')
            .addRoleOption((opt) => opt.setName('role').setDescription('The role to give every club member').setRequired(true))
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'give-club-members') {
        await giveClubMembers(interaction, interaction.options.getRole('role', true));
        return;
    }
    const targetUser = interaction.options.getUser('member', true);
    const role = interaction.options.getRole('role', true);

    const member = await interaction.guild.members.fetch(targetUser.id);

    const hierarchyError = checkRoleHierarchy(interaction.member, role);
    if (hierarchyError) {
        await interaction.reply({ embeds: [errorEmbed(hierarchyError)] });
        return;
    }

    const auditReason = `${subcommand === 'add' ? 'Added' : 'Removed'} by ${interaction.user.username} via /role`;

    if (subcommand === 'add') {
        await assignRole(member, role, auditReason);

        await interaction.reply({
            embeds: [successEmbed('Role Assigned', `Gave \`${member.displayName}\` the \`${role.name}\` role.`)]
        });
    } else {
        await unassignRole(member, role, auditReason);

        await interaction.reply({
            embeds: [successEmbed('Role Removed', `Removed \`${role.name}\` from \`${member.displayName}\`.`)]
        });
    }
}

/**
 * `/role give-club-members`: adds `role` to every member holding any club
 * role (`CLUB_ROLE_IDS`). It only adds: nobody loses a role, and members
 * who already have it are skipped. Club Managers only.
 */
async function giveClubMembers(interaction: ChatInputCommandInteraction<'cached'>, role: Role) {
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can give a role to every club member.')] });
        return;
    }
    if (!hasClubRoles()) {
        await interaction.reply({ embeds: [errorEmbed('No club roles are set (CLUB_ROLE_IDS is empty), so there is nobody to give it to.')] });
        return;
    }
    // A club role or the default role would be handed to members of other
    // clubs, against the one-club-role rule.
    if (isClubRole(role.id) || isDefaultRole(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`\`${role.name}\` is a club role or the default role. Pick a role outside the club roles.`)] });
        return;
    }
    const hierarchyError = checkRoleHierarchy(interaction.member, role);
    if (hierarchyError) {
        await interaction.reply({ embeds: [errorEmbed(hierarchyError)] });
        return;
    }

    await interaction.deferReply();
    // The full member list needs the Server Members intent.
    const members = await interaction.guild.members.fetch().catch(() => null);
    if (!members) {
        await interaction.editReply({ embeds: [errorEmbed('I could not load the member list. Turn on the Server Members intent in the Developer Portal and restart me.')] });
        return;
    }
    const targets = membersToGrant(
        [...members.values()].map((m) => ({ id: m.id, bot: m.user.bot, roleIds: [...m.roles.cache.keys()] })),
        role.id,
    );
    const holders = members.filter((m) => m.roles.cache.has(role.id)).size;
    await interaction.editReply({ embeds: [successEmbed('Giving roles', `Giving \`${role.name}\` to ${targets.length} club member${targets.length === 1 ? '' : 's'}...`)] });

    const reason = `Given to club members by ${interaction.user.username} via /role give-club-members`;
    const failed: string[] = [];
    // One at a time: discord.js waits out rate limits between calls.
    for (const id of targets) {
        await members.get(id)!.roles.add(role.id, reason).catch(() => failed.push(id));
    }

    const given = targets.length - failed.length;
    const lines = [
        `Gave \`${role.name}\` to **${given}** club member${given === 1 ? '' : 's'}.`,
        `${holders} already had it before.`,
        ...(failed.length > 0 ? [`Failed for ${failed.length}: ${failed.slice(0, 20).map((id) => `<@${id}>`).join(' ')}${failed.length > 20 ? ' ...' : ''}`] : []),
    ];
    const text = lines.join('\n');
    const embed = failed.length > 0 ? errorEmbed(text) : successEmbed('Role given', text);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
