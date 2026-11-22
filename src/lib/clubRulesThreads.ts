import type { Message } from 'discord.js';
import { prisma } from '../db/prisma';
import { isClubStaff, isOfficer, type StaffCandidate } from './permissions';

/**
 * Club Goals/Rules threads: people post in them, but only the club's own
 * trainers and assistants (and Club Managers) may. Discord cannot limit who
 * posts in one thread (threads take the parent channel's permissions), so
 * the bot removes anyone else's message and tells them why by DM.
 *
 * A club's rules thread is the one the directory made for it
 * (`TrackedCircle.rulesThreadId`), or the thread its Rules field links to
 * (Spica's points at the "Spica Goals/Rules" thread its staff made).
 */

/** The thread ID a Discord link points to: the channel part of `/channels/<guild>/<channel>[/<message>]`. */
export function linkedChannelId(link: string | null): string | null {
    return link ? (/discord(?:app)?\.com\/channels\/\d+\/(\d+)/.exec(link)?.[1] ?? null) : null;
}

/** The club whose rules thread `threadId` is, if any. */
export async function clubOfRulesThread(guildId: string, threadId: string) {
    const byId = await prisma.trackedCircle.findFirst({ where: { guildId, rulesThreadId: threadId } });
    if (byId) return byId;
    const linked = await prisma.trackedCircle.findMany({ where: { guildId, rules: { contains: `/${threadId}` } } });
    return linked.find((c) => linkedChannelId(c.rules) === threadId) ?? null;
}

/** The parts of a message the guard reads; a discord.js `Message` fits. */
export interface GuardedMessage {
    guildId: string | null;
    channelId: string;
    channel: { isThread(): boolean };
    author: { bot: boolean; send(text: string): Promise<unknown> };
    member: StaffCandidate | null;
    system?: boolean;
    delete(): Promise<unknown>;
}

/**
 * Removes a message posted in a club's rules thread by someone who is not
 * that club's staff or a Club Manager. True when it removed one.
 */
export async function guardRulesThread(message: GuardedMessage | Message): Promise<boolean> {
    const m = message as GuardedMessage;
    if (!m.guildId || m.author.bot || m.system || !m.channel.isThread() || !m.member) return false;
    const club = await clubOfRulesThread(m.guildId, m.channelId);
    if (!club) return false;
    if (isOfficer(m.member) || (await isClubStaff(m.member, club))) return false;
    await m.delete().catch(() => undefined);
    await m.author.send(`Only **${club.name}**'s trainers and assistants can post in its Goals/Rules thread, so your message there was removed.`).catch(() => undefined);
    return true;
}
