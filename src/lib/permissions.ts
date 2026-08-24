import { GuildMember } from 'discord.js';
import { prisma } from '../db/prisma';

const OFFICER_ROLE_IDS = (process.env.OFFICER_ROLE_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);

export function isOfficer(member: GuildMember): boolean {
    return OFFICER_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

export async function getClubMembership(clubId: string, discordUserId: string) {
    return prisma.clubMember.findUnique({ where: { clubId_discordUserId: { clubId, discordUserId } } });
}

export async function canManageClubStats(member: GuildMember, clubId: string) {
    if (isOfficer(member)) return true;
    const membership = await getClubMembership(clubId, member.id);
    return membership !== null;
}