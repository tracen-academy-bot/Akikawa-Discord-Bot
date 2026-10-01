import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { successEmbed, errorEmbed } from '../lib/embeds';
import { assignRole, unassignRole, checkRoleHierarchy } from '../lib/roleAssignment';

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
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;

    const subcommand = interaction.options.getSubcommand();
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
