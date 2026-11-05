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

/**
 * The Member role: held by exactly the members who hold a club role. The
 * bot keeps it in sync on every role change (see `syncMemberRole`), so it
 * cannot be given or taken by hand. Set MEMBER_ROLE_ID to change it; an
 * empty value turns the sync off.
 */
const MEMBER_ROLE_ID = (process.env.MEMBER_ROLE_ID ?? '1567786901140807730').trim();

/**
 * What the Member role needs on someone with these roles: `add` when they
 * hold a club role but not Member, `remove` when they hold Member but no
 * club role, `null` when it is right already.
 *
 * @param roleIds      The member's roles.
 * @param memberRoleId The Member role; empty means no sync.
 * @param clubRoleIds  The club roles; defaults to `CLUB_ROLE_IDS`.
 */
export function memberRoleChange(roleIds: readonly string[], memberRoleId: string = MEMBER_ROLE_ID, clubRoleIds: readonly string[] = CLUB_ROLE_IDS): 'add' | 'remove' | null {
    // With no club roles configured, everyone would lose Member.
    if (!memberRoleId || clubRoleIds.length === 0) return null;
    const inClub = roleIds.some((r) => clubRoleIds.includes(r));
    const hasMember = roleIds.includes(memberRoleId);
    if (inClub && !hasMember) return 'add';
    if (!inClub && hasMember) return 'remove';
    return null;
}

/**
 * Puts the Member role right on `member` after a role change. The change
 * this makes fires another update, which then needs nothing, so it does
 * not loop. Bots are skipped. Never throws.
 */
export async function syncMemberRole(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const change = memberRoleChange([...member.roles.cache.keys()]);
    if (!change) return;
    try {
        if (change === 'add') await member.roles.add(MEMBER_ROLE_ID, 'Member role follows club roles');
        else await member.roles.remove(MEMBER_ROLE_ID, 'Member role follows club roles: no club role left');
    } catch (e) {
        console.error(`Syncing the Member role on ${member.id} failed:`, e);
    }
}
