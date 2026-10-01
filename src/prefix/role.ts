import { Message, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../lib/embeds';
import { resolveMember, resolveRole } from '../lib/resolvers';
import { assignRole, unassignRole, checkRoleHierarchy } from '../lib/roleAssignment';

/**
 * Prefix version of `/role`, matching Dyno's old syntax:
 *
 *   ;role add <member> <role>
 *   ;role remove <member> <role>
 *
 * <member>  mention, ID, username, display name, or the start of one.
 *           Wrap in quotes if it contains spaces: ;role add "Mara M" alkes
 * <role>    mention, ID, or a full / partial role name. Everything after the
 *           member is the role, so spaces need no quotes.
 */

export const name = 'role';

export const usage = (prefix: string) =>
    `\`${prefix}role add <member> <role>\`\n\`${prefix}role remove <member> <role>\``;

export async function execute(message: Message<true>, args: string[], prefix: string): Promise<void> {
    const reply = (embed: ReturnType<typeof successEmbed>) =>
        message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

    const author = message.member ?? (await message.guild.members.fetch(message.author.id));
    if (!author.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await reply(errorEmbed('You need the **Manage Roles** permission to use this.'));
        return;
    }

    const [sub, memberQuery, ...roleParts] = args;
    const subcommand = sub?.toLowerCase();
    const roleQuery = roleParts.join(' ').trim();

    if ((subcommand !== 'add' && subcommand !== 'remove') || !memberQuery || !roleQuery) {
        await reply(errorEmbed(`Usage:\n${usage(prefix)}`));
        return;
    }

    const memberResult = await resolveMember(message.guild, memberQuery);
    if (!memberResult.ok) { await reply(errorEmbed(memberResult.error)); return; }
    const member = memberResult.value;

    const roleResult = resolveRole(message.guild, roleQuery);
    if (!roleResult.ok) { await reply(errorEmbed(roleResult.error)); return; }
    const role = roleResult.value;

    const hierarchyError = checkRoleHierarchy(author, role);
    if (hierarchyError) { await reply(errorEmbed(hierarchyError)); return; }

    const auditReason = `${subcommand === 'add' ? 'Added' : 'Removed'} by ${message.author.username} via ${prefix}role`;

    if (subcommand === 'add') {
        if (member.roles.cache.has(role.id)) {
            await reply(errorEmbed(`\`${member.displayName}\` already has the \`${role.name}\` role.`));
            return;
        }
        await assignRole(member, role, auditReason);
        await reply(successEmbed('Role Assigned', `Gave \`${member.displayName}\` the \`${role.name}\` role.`));
    } else {
        if (!member.roles.cache.has(role.id)) {
            await reply(errorEmbed(`\`${member.displayName}\` does not have the \`${role.name}\` role.`));
            return;
        }
        await unassignRole(member, role, auditReason);
        await reply(successEmbed('Role Removed', `Removed \`${role.name}\` from \`${member.displayName}\`.`));
    }
}
