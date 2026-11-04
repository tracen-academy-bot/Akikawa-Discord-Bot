import type { GuildMember, Role } from 'discord.js';
import { clubsForName, isStaffRoleName, nameWords, type LinkableClub, type NamedThing } from '../clubLinks';
import { assignRole, isClubRole } from '../roleAssignment';

/**
 * Giving an accepted applicant their club's role.
 *
 * A club's member role is the club role (one of `CLUB_ROLE_IDS`) whose name
 * matches the club, by the same name matching as staff roles ("Rose" for
 * Rose). Staff roles (Trainer, Assistant) and visas are never it. Giving it
 * goes through `assignRole`, the `/role` rule: every other club role and the
 * Tracen Applicant role come off, and anything else (visas included) stays.
 */

/** True when a role name says it is a visa. */
export function isVisaRoleName(name: string): boolean {
    return nameWords(name).some((w) => w === 'visa' || w === 'visas');
}

/**
 * The club's member role among `roles`, or null when none, or more than one,
 * matches. `isClub` says which roles are club roles.
 */
export function clubMemberRole<R extends NamedThing>(club: LinkableClub, clubs: LinkableClub[], roles: Iterable<R>, isClub: (id: string) => boolean): R | null {
    const matches = [...roles].filter(
        (r) =>
            isClub(r.id) &&
            !isStaffRoleName(r.name) &&
            !isVisaRoleName(r.name) &&
            clubsForName(clubs, r.name).length === 1 &&
            clubsForName(clubs, r.name)[0]!.id === club.id,
    );
    return matches.length === 1 ? matches[0]! : null;
}

/** What giving the role did, for the staff who resolved. */
export type ClubRoleResult = { ok: true; role: Role } | { ok: false; reason: string };

/**
 * Gives `member` the club's member role, taking off their other club roles
 * and the Tracen Applicant role. Never throws.
 */
export async function giveClubRole(member: GuildMember, club: LinkableClub, clubs: LinkableClub[]): Promise<ClubRoleResult> {
    try {
        const role = clubMemberRole(club, clubs, member.guild.roles.cache.values(), isClubRole);
        if (!role) {
            return {
                ok: false,
                reason: `no club role matches **${club.name}** (club roles are the ones in CLUB_ROLE_IDS, matched by name), so no roles were changed.`,
            };
        }
        const me = member.guild.members.me;
        if (me && role.comparePositionTo(me.roles.highest) >= 0) {
            return { ok: false, reason: `\`${role.name}\` is at or above my highest role. Move my role above it.` };
        }
        await assignRole(member, role, `Accepted into ${club.name} via /resolve`);
        return { ok: true, role };
    } catch (e) {
        return { ok: false, reason: `the roles could not be changed: ${e instanceof Error ? e.message : String(e)}.` };
    }
}
