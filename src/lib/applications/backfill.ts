import type { ApplicationStatus } from '@prisma/client';
import type { ForumChannel, ThreadChannel } from 'discord.js';
import { prisma } from '../../db/prisma';
import { getProfile, isConfigured } from '../umamoe/client';
import type { UmaProfileResponse } from '../umamoe/types';
import { currentGameMonth } from '../fans/ingest';
import { extractTrainerId, monthsAverage, monthSummaries } from './history';
import { linkApplicant, refreshBoard } from './service';

/**
 * Backfill: every post already in the application forum, open or archived,
 * matched against uma.moe and the server's clubs.
 *
 * For each post without an application row, it finds the trainer ID, reads
 * the trainer's uma.moe profile once (no daily data, to keep it to one
 * request per trainer), and works out from the post's tags and the profile
 * where the application ended up (`matchApplication`). It writes the row
 * without posting anything per post; old posts still open show up on the
 * recruitment board, which is refreshed once at the end. For
 * posts already done (not open) whose trainer uma.moe knows, it links the
 * applicant's Discord to the trainer, as `/uma-id` does, never overwriting a
 * link either side already has.
 */

/** A club as matching reads it. */
export interface MatchClub {
    id: string;
    name: string;
    circleId: bigint | null;
}

/** What matching reads from a post. */
export interface MatchInput {
    tagNames: string[];
    archived: boolean;
    locked: boolean;
    /** The game month the post was opened in. */
    postedIn: { year: number; month: number };
    /** The trainer's current circle and circle per month; null without a profile. */
    profile: { currentCircleId: number | null; history: { year: number; month: number; circleId: number | null }[] } | null;
    clubs: MatchClub[];
}

/** Where an old application ended up. */
export interface MatchResult {
    status: ApplicationStatus;
    /** The club the status refers to, if any. */
    club: MatchClub | null;
    /** The server's club the trainer is in now, if any. */
    nowIn: MatchClub | null;
    /** The server's clubs the trainer was in from the post's month on, oldest first. */
    since: MatchClub[];
    /** A line for the application's note, or null. */
    note: string | null;
}

/** True when a tag name says the application was accepted ("Club App Accepted"). */
function isAcceptedTag(name: string): boolean {
    return /accepted/i.test(name);
}

/** True when a tag name says the application was rejected. */
function isRejectedTag(name: string): boolean {
    return /rejected|denied|declined/i.test(name);
}

/**
 * Works out an old application's status.
 *
 *   - In one of the server's clubs now: JOINED, that club.
 *   - Accepted tag: ACCEPTED, with the latest of the server's clubs they
 *     were in since posting, if any (they joined and left, or never joined).
 *   - Rejected tag: REJECTED.
 *   - Archived or locked with no decision tag: CLOSED, outcome unknown.
 *   - Otherwise: OPEN.
 */
export function matchApplication(input: MatchInput): MatchResult {
    const byCircle = new Map(input.clubs.filter((c) => c.circleId !== null).map((c) => [c.circleId!.toString(), c]));
    const club = (id: number | null) => (id ? (byCircle.get(String(id)) ?? null) : null);
    const nowIn = input.profile ? club(input.profile.currentCircleId) : null;

    const from = input.postedIn.year * 12 + input.postedIn.month;
    const since: MatchClub[] = [];
    for (const h of [...(input.profile?.history ?? [])].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))) {
        if (h.year * 12 + h.month < from) continue;
        const c = club(h.circleId);
        if (c && since.at(-1)?.id !== c.id) since.push(c);
    }
    const left = since.filter((c) => c.id !== nowIn?.id);
    const leftNote = left.length > 0 ? `Was in ${left.map((c) => c.name).join(', ')} after posting; not any more.` : null;

    if (nowIn) return { status: 'JOINED', club: nowIn, nowIn, since, note: leftNote };
    if (input.tagNames.some(isAcceptedTag)) return { status: 'ACCEPTED', club: since.at(-1) ?? null, nowIn, since, note: leftNote };
    if (input.tagNames.some(isRejectedTag)) return { status: 'REJECTED', club: null, nowIn, since, note: leftNote };
    if (input.archived || input.locked) return { status: 'CLOSED', club: null, nowIn, since, note: leftNote };
    return { status: 'OPEN', club: null, nowIn, since, note: leftNote };
}

/** One post's line in the backfill's CSV. */
export interface BackfillRow {
    threadUrl: string;
    title: string;
    applicantId: string;
    openedAt: Date;
    tags: string[];
    trainerId: string | null;
    trainerName: string | null;
    umaCircle: string | null;
    status: ApplicationStatus;
    club: string | null;
    nowIn: string | null;
    since: string[];
    pace3m: number | null;
    pace6m: number | null;
    problem: string | null;
    /** A Discord account was newly linked to this trainer. */
    linked: boolean;
}

/** What the backfill did. */
export interface BackfillReport {
    scanned: number;
    alreadyTracked: number;
    imported: number;
    withId: number;
    foundOnUma: number;
    byStatus: Record<string, number>;
    /** Imported trainers now in each of the server's clubs. */
    nowInClub: Record<string, number>;
    /** Discord accounts newly linked to their trainer. */
    linked: number;
    rows: BackfillRow[];
}

/** A CSV field, quoted when it needs to be. */
function csvField(value: unknown): string {
    const text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows as CSV, one post per line. */
export function backfillCsv(rows: BackfillRow[]): string {
    const header = ['post', 'title', 'applicant_discord_id', 'opened', 'tags', 'trainer_id', 'trainer_name', 'uma_circle_now', 'status', 'club', 'in_our_club_now', 'our_clubs_since_post', 'pace_3m_per_day', 'pace_6m_per_day', 'problem', 'linked'];
    const lines = rows.map((r) =>
        [r.threadUrl, r.title, r.applicantId, r.openedAt, r.tags.join(' | '), r.trainerId, r.trainerName, r.umaCircle, r.status, r.club, r.nowIn, r.since.join(' > '), r.pace3m === null ? '' : Math.round(r.pace3m), r.pace6m === null ? '' : Math.round(r.pace6m), r.problem, r.linked ? 'yes' : '']
            .map(csvField)
            .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
}

/** Every post in the forum: active ones, then archived ones, newest first. */
export async function forumPosts(forum: ForumChannel): Promise<ThreadChannel[]> {
    const posts = new Map<string, ThreadChannel>();
    const active = await forum.threads.fetchActive();
    for (const t of active.threads.values()) if (t.parentId === forum.id) posts.set(t.id, t as ThreadChannel);
    let before: ThreadChannel | undefined;
    for (;;) {
        const page = await forum.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) });
        const threads = [...page.threads.values()] as ThreadChannel[];
        for (const t of threads) posts.set(t.id, t);
        if (!page.hasMore || threads.length === 0) break;
        before = threads.at(-1);
    }
    return [...posts.values()];
}

/** Waits between uma.moe requests, so a few hundred posts do not trip its rate limit. */
const UMA_GAP_MS = 300;

/**
 * Imports every post in `forum` that has no application row yet.
 *
 * @param onProgress     Called now and then with posts done and total.
 */
export async function backfillApplications(
    forum: ForumChannel,
    { onProgress }: { onProgress?: (done: number, total: number) => Promise<void> | void } = {},
): Promise<BackfillReport> {
    const posts = await forumPosts(forum);
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId: forum.guildId }, select: { id: true, name: true, circleId: true } });
    const existing = new Set(
        (await prisma.clubApplication.findMany({ where: { threadId: { in: posts.map((p) => p.id) } }, select: { threadId: true } })).map((a) => a.threadId),
    );
    const now = currentGameMonth();
    const profiles = new Map<string, UmaProfileResponse | null | Error>();

    const report: BackfillReport = { scanned: posts.length, alreadyTracked: existing.size, imported: 0, withId: 0, foundOnUma: 0, byStatus: {}, nowInClub: {}, linked: 0, rows: [] };
    let done = 0;
    for (const thread of posts) {
        done += 1;
        if (done % 25 === 0) await onProgress?.(done, posts.length);
        if (existing.has(thread.id)) continue;

        const tagNames = thread.appliedTags.map((id) => forum.availableTags.find((t) => t.id === id)?.name).filter((n): n is string => Boolean(n));
        // An old post's opening message may be gone; the title still counts.
        const starter = await thread.fetchStarterMessage().catch(() => null);
        const trainerId = extractTrainerId(thread.name, starter?.content);
        let profile: UmaProfileResponse | null = null;
        let problem: string | null = trainerId ? null : 'no trainer ID in the post';
        if (trainerId && isConfigured()) {
            if (!profiles.has(trainerId)) {
                profiles.set(trainerId, await getProfile(trainerId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))));
                await new Promise((r) => setTimeout(r, UMA_GAP_MS));
            }
            const got = profiles.get(trainerId)!;
            if (got instanceof Error) problem = `uma.moe: ${got.message}`;
            else if (!got) problem = 'not found on uma.moe';
            else profile = got;
        } else if (trainerId) {
            problem = 'uma.moe not set up (EXTERNAL_API_KEY)';
        }

        const opened = thread.createdAt ?? new Date();
        const match = matchApplication({
            tagNames,
            archived: Boolean(thread.archived),
            locked: Boolean(thread.locked),
            postedIn: currentGameMonth(opened),
            profile: profile
                ? {
                      currentCircleId: profile.circle?.circle_id ?? null,
                      history: (profile.circle_history ?? [])
                          .filter((h) => typeof h.year === 'number' && typeof h.month === 'number')
                          .map((h) => ({ year: h.year!, month: h.month!, circleId: h.circle_id ?? null })),
                  }
                : null,
            clubs,
        });
        const months = profile
            ? monthSummaries(
                  (profile.fan_history?.monthly ?? [])
                      .filter((m) => typeof m.year === 'number' && typeof m.month === 'number' && typeof m.monthly_gain === 'number')
                      .map((m) => ({ year: m.year!, month: m.month!, gain: m.monthly_gain!, activeDays: m.active_days ?? null })),
                  now,
                  7,
              )
            : [];
        const pace3m = monthsAverage(months, 3).perDay;
        const pace6m = monthsAverage(months, 6).perDay;

        const app = await prisma.clubApplication.create({
            data: {
                threadId: thread.id,
                guildId: forum.guildId,
                applicantId: thread.ownerId ?? starter?.author.id ?? 'unknown',
                viewerId: trainerId ? BigInt(trainerId) : null,
                trainerName: profile?.trainer?.name ?? null,
                tags: tagNames,
                status: match.status,
                clubId: match.club?.id ?? null,
                clubName: match.club?.name ?? null,
                note: match.note,
                pace3m: pace3m === null ? null : BigInt(Math.round(pace3m)),
                pace6m: pace6m === null ? null : BigInt(Math.round(pace6m)),
                createdAt: opened,
                closedAt: match.status === 'OPEN' ? null : (thread.archivedAt ?? null),
            },
        });
        // As with new posts, the applicant is linked to their trainer only
        // once the post is done: not while it is still open.
        let linked = false;
        if (app.status !== 'OPEN' && app.viewerId !== null && profile) {
            linked = await linkApplicant(forum.guildId, app.applicantId, app.viewerId, app.trainerName).catch(() => false);
        }
        if (linked) report.linked += 1;

        report.imported += 1;
        if (trainerId) report.withId += 1;
        if (profile) report.foundOnUma += 1;
        report.byStatus[match.status] = (report.byStatus[match.status] ?? 0) + 1;
        if (match.nowIn) report.nowInClub[match.nowIn.name] = (report.nowInClub[match.nowIn.name] ?? 0) + 1;
        report.rows.push({
            threadUrl: thread.url,
            title: thread.name,
            applicantId: app.applicantId,
            openedAt: opened,
            tags: tagNames,
            trainerId,
            trainerName: app.trainerName,
            umaCircle: profile?.circle?.name ?? null,
            status: match.status,
            club: match.club?.name ?? null,
            nowIn: match.nowIn?.name ?? null,
            since: match.since.map((c) => c.name),
            pace3m,
            pace6m,
            problem,
            linked,
        });
    }
    // Old posts still open belong on the board.
    if (report.imported > 0) await refreshBoard(forum.client, forum.guildId);
    await onProgress?.(posts.length, posts.length);
    return report;
}
