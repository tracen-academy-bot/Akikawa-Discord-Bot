import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, GuildMember, MembershipScreeningFieldType } from 'discord.js';
import { successEmbed } from '../lib/embeds';

const CLUB_ROLE_IDS: string[] = (process.env.CLUB_ROLE_IDS!)?.split(',').map((id) => id.trim()).filter(Boolean);
const DEFAULT_ROLE_ID = process.env.DEFAULT_ROLE_ID!;

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
    if (!interaction.inGuild()) return;

    const subcommand = interaction.options.getSubcommand();
    const targetMember = interaction.options.getUser('member', true);
    const role = interaction.options.getRole('role', true);
    const isClubRole = CLUB_ROLE_IDS.includes(role.id);

    const member = (await interaction.guild!.members.fetch(targetMember.id)) as GuildMember;

    if (subcommand === 'add') {
        if (isClubRole || role.id === DEFAULT_ROLE_ID) {
            const otherClubRoles = member.roles.cache.filter((r) => CLUB_ROLE_IDS.includes(r.id) && r.id !== role.id);
            if (otherClubRoles.size > 0) { await member.roles.remove(otherClubRoles) }
            
            if (member.roles.cache.has(DEFAULT_ROLE_ID)) { await member.roles.remove(DEFAULT_ROLE_ID) }
        }
        
        await member.roles.add(role.id);

        await interaction.reply({
            embeds: [successEmbed('Role Assigned', `Gave \`${member.displayName}\` the \`${role.name}\` role.`)]
        });
    } else {
        await member.roles.remove(role.id);

        if (isClubRole) {
            const otherClubRoles = member.roles.cache.filter((r) => CLUB_ROLE_IDS.includes(r.id) && r.id !== role.id);
            if (otherClubRoles.size == 0) { await member.roles.add(DEFAULT_ROLE_ID) }
        }
        
        await interaction.reply({
            embeds: [successEmbed('Role Removed', `Removed \`${role.name}\` from \`${member.displayName}\`.`)]
        });
    }
}