import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { isClubStaff, isOfficer } from '../permissions';
import { guildClubs } from '../clubLinks';

/**
 * Who may decide on and close applications.
 *
 * Club Managers and members with Manage Threads may do anything. A club's
 * staff may accept into their own club, and reject or close any post: a
 * rejection is not tied to one club.
 */

/** True for Club Managers and members with Manage Threads. */
function isModerator(member: GuildMember): boolean {
    return isOfficer(member) || member.permissions.has(PermissionFlagsBits.ManageThreads);
}

/** True when `member` may accept into `club`, or reject when `club` is null. */
export async function canDecide(member: GuildMember, club: TrackedCircle | null): Promise<boolean> {
    if (isModerator(member)) return true;
    if (club) return isClubStaff(member, club);
    return isAnyClubStaff(member);
}

/** True when `member` is staff of at least one club. */
export async function isAnyClubStaff(member: GuildMember): Promise<boolean> {
    if (isModerator(member)) return true;
    const linkable = await guildClubs(member.guild.id);
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId: member.guild.id } });
    for (const club of clubs) {
        if (await isClubStaff(member, club, linkable)) return true;
    }
    return false;
}
