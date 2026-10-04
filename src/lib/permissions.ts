import { GuildMember } from 'discord.js';
import { prisma } from '../db/prisma';
import { guildClubs, staffRolesOf, type LinkableClub, type LinkableGuild } from './clubLinks';

const OFFICER_ROLE_IDS = (process.env.OFFICER_ROLE_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/** The parts of a member the permission checks read; a discord.js `GuildMember` fits. */
export interface StaffCandidate {
    id: string;
    roles: { cache: { has(id: string): boolean } };
    guild?: LinkableGuild;
}

export function isOfficer(member: GuildMember | StaffCandidate): boolean {
    return OFFICER_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

export async function getClubMembership(clubId: string, discordUserId: string) {
    return prisma.clubMember.findUnique({ where: { clubId_discordUserId: { clubId, discordUserId } } });
}

/**
 * True when `member` holds one of the club's staff roles: the roles set with
 * `/club edit`, or else the Trainer and Assistant roles named after the club
 * ("Cosmos Trainer"). `clubs` is every club in the guild, for name matching;
 * it is loaded when not given.
 */
export async function hasClubStaffRole(member: StaffCandidate, club: LinkableClub, clubs?: LinkableClub[]): Promise<boolean> {
    if (!member.guild) return false;
    const all = club.staffRoleIds.length > 0 ? [] : clubs ?? (await guildClubs(member.guild.id));
    return staffRolesOf(club, all, member.guild).ids.some((id) => member.roles.cache.has(id));
}

/**
 * True when `member` is one of the club's staff: added with `/club member`,
 * or holding one of its staff roles.
 */
export async function isClubStaff(member: StaffCandidate, club: LinkableClub, clubs?: LinkableClub[]): Promise<boolean> {
    if (await getClubMembership(club.id, member.id)) return true;
    return hasClubStaffRole(member, club, clubs);
}

/** True for a Club Manager or one of the club's staff. */
export async function canManageClubStats(member: GuildMember | StaffCandidate, club: LinkableClub) {
    if (isOfficer(member)) return true;
    return isClubStaff(member, club);
}
