import { ChannelFlags, type ForumChannel, type ThreadChannel } from 'discord.js';
import type { ApplicationStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { idInPost, refreshBoard, rescoutApplication } from './service';

/**
 * Tidy: brings the applications in line with the forum as it is now.
 *
 * The posts still open in the forum (active and not locked) are the live
 * applications: each is set back to Open, so it is on the recruitment
 * board's Available list; one with no stored ID is read again, and an ID
 * found is announced like a new post's. Every other imported application is closed, so
 * an old accepted post no longer sits under "Going to". Applications decided
 * with `/resolve` are the bot's own and are left as they are. Pinned posts
 * (the forum's guide and example) are removed.
 */

/** An application as tidying reads it. */
export interface TidyRow {
    threadId: string;
    status: ApplicationStatus;
    resolvedById: string | null;
    closedAt: Date | null;
}

/** What tidying does to one application. */
export type TidyAction = 'keep' | 'reopen' | 'close' | 'remove';

/**
 * Decides one application's fate.
 *
 * @param openPosts   Posts active and not locked in the forum now.
 * @param pinnedPosts Pinned posts in the forum.
 */
export function tidyAction(row: TidyRow, openPosts: Set<string>, pinnedPosts: Set<string>): TidyAction {
    if (pinnedPosts.has(row.threadId)) return 'remove';
    // Decided by the bot: it knows the state, and the post is locked anyway.
    if (row.resolvedById !== null) return 'keep';
    if (openPosts.has(row.threadId)) return row.status === 'OPEN' && row.closedAt === null ? 'keep' : 'reopen';
    return row.status === 'OPEN' || row.closedAt === null ? 'close' : 'keep';
}

/** What tidying did. */
export interface TidyReport {
    reopened: number;
    closed: number;
    removed: number;
    /** Open applications whose pace was missing and was filled in. */
    rescouted: number;
    /** Open applications with no stored ID whose post, read again, had one. */
    idsFound: number;
}

/** Tidies a forum's applications. See the module comment. */
export async function tidyApplications(forum: ForumChannel): Promise<TidyReport> {
    const active = await forum.threads.fetchActive();
    const threads = [...active.threads.values()].filter((t) => t.parentId === forum.id) as ThreadChannel[];
    const pinned = new Set(threads.filter((t) => t.flags?.has(ChannelFlags.Pinned)).map((t) => t.id));
    const open = new Map(threads.filter((t) => !t.locked && !pinned.has(t.id)).map((t) => [t.id, t]));
    const rows = await prisma.clubApplication.findMany({ where: { guildId: forum.guildId } });

    const report: TidyReport = { reopened: 0, closed: 0, removed: 0, rescouted: 0, idsFound: 0 };
    const now = new Date();
    for (const row of rows) {
        const action = tidyAction(row, new Set(open.keys()), pinned);
        if (action === 'remove') {
            await prisma.clubApplication.delete({ where: { threadId: row.threadId } });
            report.removed += 1;
        } else if (action === 'reopen') {
            await prisma.clubApplication.update({ where: { threadId: row.threadId }, data: { status: 'OPEN', clubId: null, clubName: null, closedAt: null } });
            report.reopened += 1;
        } else if (action === 'close') {
            await prisma.clubApplication.update({
                where: { threadId: row.threadId },
                // An accepted post keeps its status, so it still reads as accepted;
                // closing it is what takes it off "Going to".
                data: { status: row.status === 'OPEN' ? 'CLOSED' : row.status, closedAt: row.closedAt ?? now },
            });
            report.closed += 1;
        }
    }

    for (const [threadId, thread] of open) {
        const app = await prisma.clubApplication.findUnique({ where: { threadId } });
        if (!app || app.status !== 'OPEN') continue;
        if (app.viewerId === null) {
            // No ID stored: the post may have been read while its text was
            // unreadable. Read it again; an ID found is announced like a new one.
            const id = await idInPost(thread).catch(() => null);
            if (!id) continue;
            await rescoutApplication(thread, id).catch((e) => console.error(`Re-reading ${threadId} failed:`, e));
            report.idsFound += 1;
            continue;
        }
        // Open applications imported without daily data have no 30-day pace.
        if (app.pace30 !== null) continue;
        await rescoutApplication(thread, null).catch((e) => console.error(`Re-scouting ${threadId} failed:`, e));
        report.rescouted += 1;
    }

    await refreshBoard(forum.client, forum.guildId);
    return report;
}
