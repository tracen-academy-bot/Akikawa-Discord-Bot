import { EmbedBuilder, type Client } from 'discord.js';
import type { ClubApplication } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { formatCompactFans, toSafeNumber } from '../fans/metrics';

/**
 * The recruitment board: one live message in the recruitment channel,
 * edited in place whenever an application changes.
 *
 *   - Available: open applications, oldest first. Each line is the
 *     applicant, their 30-day pace, how long the post has been open, and
 *     the post.
 *   - Going to: accepted applicants who have not closed their post yet,
 *     grouped by club.
 *
 * Rejected, withdrawn, closed and joined applications are not on it.
 */

/** Longest embed description Discord accepts, less room for a "+N more" line. */
const SECTION_LIMIT = 3900;

/** A section's lines, cut to fit, with how many were left out. */
function fit(lines: string[]): string {
    const kept: string[] = [];
    let length = 0;
    for (const [i, line] of lines.entries()) {
        if (length + line.length + 1 > SECTION_LIMIT) {
            kept.push(`*+${lines.length - i} more*`);
            break;
        }
        kept.push(line);
        length += line.length + 1;
    }
    return kept.join('\n');
}

/** Unix seconds, for Discord's relative timestamps. */
function unix(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

/** One open application's line: applicant, 30-day pace, time open, post. */
export function availableLine(app: Pick<ClubApplication, 'applicantId' | 'threadId' | 'viewerId' | 'pace30' | 'createdAt'>): string {
    const pace = app.viewerId === null ? 'no ID yet' : app.pace30 === null ? 'no 30d data' : `${formatCompactFans(toSafeNumber(app.pace30))}/day`;
    return `<@${app.applicantId}> · ${pace} · <t:${unix(app.createdAt)}:R> · <#${app.threadId}>`;
}

/** The board's two embeds, from a guild's applications (any status). */
export function boardEmbeds(apps: ClubApplication[]): EmbedBuilder[] {
    const open = apps.filter((a) => a.status === 'OPEN').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // Accepted and still open: an old post accepted long ago and archived is not on its way anywhere.
    const accepted = apps.filter((a) => a.status === 'ACCEPTED' && a.closedAt === null);

    const clubs = new Map<string, ClubApplication[]>();
    for (const app of accepted) {
        const name = app.clubName ?? 'Unknown club';
        clubs.set(name, [...(clubs.get(name) ?? []), app]);
    }
    const going: string[] = [];
    for (const name of [...clubs.keys()].sort((a, b) => a.localeCompare(b))) {
        going.push(`**${name}**`);
        const members = clubs.get(name)!.sort((a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0));
        for (const app of members) {
            const when = app.resolvedAt ? ` · accepted <t:${unix(app.resolvedAt)}:R>` : '';
            going.push(`<@${app.applicantId}>${when} · <#${app.threadId}>`);
        }
    }

    return [
        new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`Available (${open.length})`)
            .setDescription(open.length > 0 ? fit(open.map(availableLine)) : 'Nobody is waiting.'),
        new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`Going to (${accepted.length})`)
            .setDescription(going.length > 0 ? fit(going) : 'Nobody is on their way.')
            .setFooter({ text: 'Pace is fans per day over the last 30 days. Updates itself.' })
            .setTimestamp(new Date()),
    ];
}

/** The parts of a channel the board uses; a discord.js text channel fits. */
interface BoardChannel {
    id: string;
    send(payload: unknown): Promise<{ id: string }>;
    messages: { fetch(id: string): Promise<{ edit(payload: unknown): Promise<unknown>; delete(): Promise<unknown> }> };
}

/** A channel the board can live in, or null. */
async function boardChannel(client: Client, id: string | null): Promise<BoardChannel | null> {
    if (!id) return null;
    const channel = (await client.channels.fetch(id).catch(() => null)) as unknown as (BoardChannel & { isSendable?: () => boolean }) | null;
    return channel && typeof channel.send === 'function' && 'messages' in channel ? channel : null;
}

/** Refreshes in flight, per guild, so two changes in a row do not post two boards. */
const pending = new Map<string, Promise<unknown>>();

/**
 * Brings the guild's board up to date: edits the board message, or posts it
 * when there is none (or it was deleted, or the channel changed). Also
 * deletes the per-application entries older versions posted. Runs after any
 * refresh under way. Never throws.
 */
export function refreshRecruitmentBoard(client: Client, guildId: string, channelId: string | null): Promise<void> {
    const run = (pending.get(guildId) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            const channel = await boardChannel(client, channelId);
            if (!channel) return;
            const apps = await prisma.clubApplication.findMany({ where: { guildId } });
            const payload = { content: '', embeds: boardEmbeds(apps), allowedMentions: { parse: [] as never[] } };

            const board = await prisma.recruitmentBoard.findUnique({ where: { guildId } });
            if (board && board.channelId === channel.id) {
                const message = await channel.messages.fetch(board.messageId).catch(() => null);
                // A message posted by another bot (after moving to a new bot
                // account) can be fetched but not edited: post a fresh board.
                const edited = message ? await message.edit(payload).then(() => true, () => false) : false;
                if (edited) {
                    await clearOldEntries(client, apps);
                    return;
                }
            } else if (board) {
                const old = await boardChannel(client, board.channelId);
                await old?.messages
                    .fetch(board.messageId)
                    .then((m) => m.delete())
                    .catch(() => undefined);
            }
            const sent = await channel.send(payload);
            await prisma.recruitmentBoard.upsert({
                where: { guildId },
                create: { guildId, channelId: channel.id, messageId: sent.id },
                update: { channelId: channel.id, messageId: sent.id },
            });
            await clearOldEntries(client, apps);
        })
        .catch((e: unknown) => console.error(`Recruitment board for ${guildId} failed:`, e));
    pending.set(guildId, run);
    return run;
}

/** Deletes the per-application entries an older version posted, once. */
async function clearOldEntries(client: Client, apps: ClubApplication[]): Promise<void> {
    for (const app of apps) {
        if (!app.recruitmentChannelId || !app.recruitmentMessageId) continue;
        const channel = await boardChannel(client, app.recruitmentChannelId);
        await channel?.messages
            .fetch(app.recruitmentMessageId)
            .then((m) => m.delete())
            .catch(() => undefined);
        await prisma.clubApplication.update({ where: { threadId: app.threadId }, data: { recruitmentChannelId: null, recruitmentMessageId: null } });
    }
}
