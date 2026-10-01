import { GuildMember, Role } from 'discord.js';

/**
 * Shared club-role logic used by both `/role` (slash) and `;role` (prefix).
 *
 * Rules (unchanged from the original slash command):
 *   - Adding a club role (or the default "Tracen Applicant" role) strips every
 *     other club role and the default role first, so a member holds at most one.
 *   - Removing a club role gives the default role back if the member has no
 *     club role left.
 *   - Any other role is added / removed with no side effects.
 */

const CLUB_ROLE_IDS: string[] = (process.env.CLUB_ROLE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
const DEFAULT_ROLE_ID = process.env.DEFAULT_ROLE_ID ?? '';

export function isClubRole(roleId: string): boolean {
    return CLUB_ROLE_IDS.includes(roleId);
}

/**
 * Returns an error message if `actor` should not be allowed to hand out `role`,
 * or `null` if it is fine.
 *
 * Mirrors Discord's own rule: you can only manage roles strictly below your
 * highest role (the server owner bypasses this). The bot's own position is
 * checked too, so we fail with a readable message instead of a raw API 403.
 */
export function checkRoleHierarchy(actor: GuildMember, role: Role): string | null {
    const guild = role.guild;
    const me = guild.members.me;

    if (role.managed) {
        return `\`${role.name}\` is managed by an integration and cannot be assigned manually.`;
    }
    if (role.id === guild.id) {
        return 'The @everyone role cannot be assigned.';
    }
    if (actor.id !== guild.ownerId && role.comparePositionTo(actor.roles.highest) >= 0) {
        return `\`${role.name}\` is at or above your highest role, so you cannot manage it.`;
    }
    if (me && role.comparePositionTo(me.roles.highest) >= 0) {
        return `\`${role.name}\` is at or above my highest role. Move my role above it first.`;
    }
    return null;
}

/** Adds `role` to `member`, applying the club-role exclusivity rule. */
export async function assignRole(member: GuildMember, role: Role, reason?: string): Promise<void> {
    if (isClubRole(role.id) || role.id === DEFAULT_ROLE_ID) {
        const otherClubRoles = member.roles.cache.filter((r) => isClubRole(r.id) && r.id !== role.id);
        if (otherClubRoles.size > 0) { await member.roles.remove(otherClubRoles, reason) }

        if (member.roles.cache.has(DEFAULT_ROLE_ID)) { await member.roles.remove(DEFAULT_ROLE_ID, reason) }
    }

    await member.roles.add(role.id, reason);
}

/** Removes `role` from `member`, restoring the default role if no club role is left. */
export async function unassignRole(member: GuildMember, role: Role, reason?: string): Promise<void> {
    await member.roles.remove(role.id, reason);

    if (isClubRole(role.id) && DEFAULT_ROLE_ID) {
        const otherClubRoles = member.roles.cache.filter((r) => isClubRole(r.id) && r.id !== role.id);
        if (otherClubRoles.size === 0) { await member.roles.add(DEFAULT_ROLE_ID, reason) }
    }
}
