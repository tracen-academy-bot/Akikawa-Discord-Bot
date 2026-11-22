import { createHash } from 'node:crypto';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { clubDailyRequirement, clubQuotaText } from './clubFormat';
import { guildClubs, nameWords, staffRolesOf, type LinkableClub, type NamedThing } from './clubLinks';

/**
 * The club directory: a channel listing every club by expected rank, posted and kept
 * up to date by the bot.
 *
 * It is modelled on the server's old hand-made directory, which kept each
 * tier in a thread. In order:
 *
 *   1. A "<Club> Goals/Rules" thread for each listed club whose Rules field
 *      is not already a link, made once and kept across reposts (its ID is
 *      `TrackedCircle.rulesThreadId`). People post there; only the club's
 *      staff and Club Managers may (`clubRulesThreads.ts` removes the rest).
 *      The club's post links to it.
 *   2. A thread per rank group with clubs (`clubGroups.ts`: S, A+, A, B+,
 *      Casual), named after it: "Current S Clubs", each club's post (a plain
 *      message with its banner, see `clubCard`), then a rule of hyphens and
 *      "Directory", a link to each post in the thread.
 *   3. In the channel itself: a box per group, how to apply, and the poster
 *      (`renderClubPoster`), last because Discord opens a channel at its
 *      newest message.
 *
 * Threads are stored in the layout as `thread:<place>` with the thread's ID;
 * messages as `<place>|<key>`, where `place` is `main` or a group. Rules
 * threads are not in the layout, so a repost never deletes them. A thread
 * archives itself after a week without new messages; an edit reopens it
 * first. Every thread the directory makes is locked (only members with
 * Manage Threads, and the bot, post there; rules threads are guarded too);
 * a refresh locks any it finds unlocked.
 *
 * Clubs with no expected rank are left out. `/club directory` posts it; after that
 * any change to a club (`/club reports`, `/club profile`, `/club admin`, staff, create, delete)
 * refreshes it, and so does every fan sync, since the poster shows each
 * club's headcount and uma.moe rank. When the same messages still fit (same clubs, same order)
 * they are edited in place, and only those whose content changed (each
 * message's content is fingerprinted), so one club's edit does not re-upload
 * every banner. Otherwise the old ones are deleted and the run is posted
 * again, since Discord cannot insert a message between two others.
 * `/club directory` itself edits every message, which also finds any deleted
 * by hand.
 */

import { GROUPS, GROUP_ORDER, rankGroup, type RankGroup } from './clubGroups';
import { currentCircleProgress } from './fans/reports';
import { renderClubPoster, type PosterClub } from './image/renderClubPoster';
import { JP_SECTION } from './jpClubs';

export { GROUPS, GROUP_ORDER, rankGroup, type RankGroup } from './clubGroups';

/** A role as the directory reads it: its holders, when the member list is loaded. */
export interface DirectoryRole extends NamedThing {
    members?: { keys(): Iterable<string> };
}

/** The parts of a guild the directory reads; a discord.js `Guild` fits. */
export interface DirectoryGuild {
    id: string;
    roles: { cache: { values(): Iterable<DirectoryRole> } };
    /** Loads every member, so role holders can be listed. Needs the Server Members intent. */
    members?: { fetch(): Promise<unknown>; cache?: { size: number } };
    /** How many members the server has, to tell when the member cache is already complete. */
    memberCount?: number;
    channels?: { fetch(id: string): Promise<unknown> };
}

/** A message the directory posted, as it reads it back. */
export interface DirectoryMessage {
    id: string;
    edit(payload: unknown): Promise<unknown>;
    delete(): Promise<unknown>;
}

/** Somewhere the directory posts: the channel itself, or one of its threads. */
export interface DirectoryTarget {
    id: string;
    send(payload: unknown): Promise<{ id: string }>;
    messages: { fetch(id: string): Promise<DirectoryMessage> };
}

/** A thread the directory made; a discord.js thread channel fits. */
export interface DirectoryThread extends DirectoryTarget {
    archived?: boolean | null;
    locked?: boolean | null;
    setArchived(archived: boolean): Promise<unknown>;
    setLocked(locked: boolean): Promise<unknown>;
    delete(): Promise<unknown>;
}

/** The parts of a channel the directory posts to; a discord.js text channel fits. */
export interface DirectoryChannel extends DirectoryTarget {
    threads: {
        create(options: { name: string; autoArchiveDuration?: number }): Promise<DirectoryThread>;
        fetch(id: string): Promise<DirectoryThread | null>;
    };
}

/** A week, the longest Discord lets a thread sit before it archives itself. */
const THREAD_ARCHIVE_MINUTES = 10080;

/** One message's content. */
interface Payload {
    content?: string;
    embeds: EmbedBuilder[];
    files: AttachmentBuilder[];
}

/** A fingerprint of a message's content, files included. */
export function payloadSignature(p: Payload): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify({ content: p.content ?? '', embeds: p.embeds.map((e) => e.toJSON()) }));
    for (const file of p.files) {
        hash.update(file.name ?? '');
        hash.update(file.attachment as Buffer);
    }
    return hash.digest('hex');
}

/** A club's staff as mentions: members, or a role when its holders cannot be listed. */
export interface StaffMentions {
    trainers: string[];
    assistants: string[];
}

/**
 * Loads the guild's member list so staff roles can be listed by holder.
 * False when that is not possible (no Server Members intent), in which case
 * cards mention the role itself.
 */
export async function loadMembers(guild: DirectoryGuild): Promise<boolean> {
    if (!guild.members) return false;
    // With the intent, the cache stays complete once loaded; skip the round trip.
    if (guild.memberCount !== undefined && (guild.members.cache?.size ?? 0) >= guild.memberCount) return true;
    try {
        await guild.members.fetch();
        return true;
    } catch {
        return false;
    }
}

/**
 * A club's Trainers and Assistants: its `/club member` entries and the
 * holders of its staff roles (an "Assistant" role's holders are Assistants,
 * any other staff role's are Trainers). Someone listed as both is a Trainer.
 */
export async function clubStaff(
    club: LinkableClub,
    clubs: LinkableClub[],
    guild: DirectoryGuild,
    membersLoaded: boolean,
): Promise<StaffMentions> {
    const trainers = new Set<string>();
    const assistants = new Set<string>();
    for (const row of await prisma.clubMember.findMany({ where: { clubId: club.id }, orderBy: { createdAt: 'asc' } })) {
        (row.role === 'ASSISTANT' ? assistants : trainers).add(`<@${row.discordUserId}>`);
    }
    const roles = new Map([...guild.roles.cache.values()].map((r) => [r.id, r]));
    for (const id of staffRolesOf(club, clubs, guild).ids) {
        const role = roles.get(id);
        if (!role) continue;
        const into = nameWords(role.name).some((w) => w.startsWith('assistant')) ? assistants : trainers;
        if (membersLoaded && role.members) {
            for (const userId of role.members.keys()) into.add(`<@${userId}>`);
        } else {
            into.add(`<@&${role.id}>`);
        }
    }
    for (const t of trainers) assistants.delete(t);
    return { trainers: [...trainers], assistants: [...assistants] };
}

/** True when the rules are just a link, shown as one. */
function isLink(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text);
}

/** A banner's file name in the message, so the embed can point at it. */
function bannerFileName(clubId: string, fileName: string): string {
    const ext = /\.(png|jpe?g|gif|webp)$/i.exec(fileName)?.[1]?.toLowerCase() ?? 'png';
    return `banner-${clubId}.${ext}`;
}

/** Longest plain message Discord accepts. */
const MESSAGE_LIMIT = 2000;

/**
 * Splits text into chunks of at most `room` characters at line breaks. A
 * line is only broken when it alone is longer than `room`. `firstRoom` limits
 * the first chunk; it may come out empty when not even one line fits.
 */
export function splitByLines(text: string, firstRoom: number, room = MESSAGE_LIMIT): string[] {
    const lines = text.split('\n').flatMap((line) => {
        if (line.length <= room) return [line];
        const pieces: string[] = [];
        for (let i = 0; i < line.length; i += room) pieces.push(line.slice(i, i + room));
        return pieces;
    });
    const chunks: string[] = [];
    let current: string[] = [];
    let length = 0;
    let limit = Math.max(0, firstRoom);
    for (const line of lines) {
        const added = current.length > 0 ? line.length + 1 : line.length;
        if (length + added > limit) {
            chunks.push(current.join('\n'));
            current = [line];
            length = line.length;
            limit = room;
            continue;
        }
        current.push(line);
        length += added;
    }
    chunks.push(current.join('\n'));
    return chunks;
}

/** A club's banner, as stored. */
export interface Banner {
    data: Uint8Array;
    fileName: string;
}

/**
 * A club's directory post, laid out like the server's old hand-made
 * directory: a plain message (no embed) with the banner attached, then
 *
 *   **★ ─── Spica ─── ★**          (the club's `symbol`, else ★)
 *   **Trainers**: @a, @b - **Assistants**: @c
 *   **Requirements**: 9.0M/day
 *
 *   [Link to Spica Goals/Rules](...)   (or the rules as text)
 *   > the bio, quoted
 *
 * A message holds 2000 characters, so text past that continues in
 * `followUps`, and a rules file follows in messages of its own after that.
 * The rules link is the club's own when its Rules field is a link (Spica's
 * points at the thread its staff made), else `rulesThread`, the club's
 * Goals/Rules thread from `ensureRulesThreads`.
 */
export function clubCard(
    club: TrackedCircle,
    staff: StaffMentions,
    banner: Banner | null,
    rulesThread: string | null = null,
): Payload & { followUps: string[] } {
    const files: AttachmentBuilder[] = [];
    if (banner) files.push(new AttachmentBuilder(Buffer.from(banner.data), { name: bannerFileName(club.id, banner.fileName) }));

    const symbol = club.symbol?.trim() || '\u2605';
    const lines: string[] = [`**${symbol} \u2500\u2500\u2500 ${club.name} \u2500\u2500\u2500 ${symbol}**`];
    const who = (one: string, many: string, list: string[]) => (list.length > 0 ? `**${list.length === 1 ? one : many}**: ${list.join(', ')}` : null);
    const staffLine = [who('Trainer', 'Trainers', staff.trainers), who('Assistant', 'Assistants', staff.assistants)].filter(Boolean).join(' - ');
    if (staffLine) lines.push(staffLine);
    const quota = clubQuotaText(club);
    if (quota !== 'Not set') lines.push(`**Requirements**: ${quota}`);
    // The rules link: the club's own (a link in Rules), else its Goals/Rules thread.
    const ownLink = club.rules && isLink(club.rules) ? club.rules : null;
    const link = ownLink ?? rulesThread;
    if (link) lines.push('', `[Link to ${club.name} Goals/Rules](${link})`);
    if (club.rules && !ownLink) lines.push('', `**Rules**\n${club.rules}`);
    if (club.rulesFile) lines.push('', '**Rules and goals**: in the messages below.');
    if (club.bio) lines.push('', club.bio.split('\n').map((l) => `> ${l}`).join('\n'));

    const [content = '', ...overflow] = splitByLines(lines.join('\n'), MESSAGE_LIMIT);
    // A rules file follows as plain text, so all of its Markdown renders.
    const rulesFile = club.rulesFile ? splitByLines(club.rulesFile, MESSAGE_LIMIT) : [];
    return { content, embeds: [], files, followUps: [...overflow, ...rulesFile] };
}

/** One message after a club's post: its overflow, or a piece of its rules file. */
export function rulesMessage(chunk: string): Payload {
    return { content: chunk, embeds: [], files: [] };
}

/** The how-to-apply message, just above the poster. */
export function howToApply(): string {
    const forumId = process.env.FORUM_CHANNEL_ID;
    const forum = forumId ? `<#${forumId}>` : '#apply-for-club';
    return [
        '## How to apply',
        `Open a post in ${forum} with your trainer ID (the 9 to 12 digits on your in-game profile).`,
        'Say which club you want, or that you are open to any. Club staff look at your fan numbers and answer in your post.',
    ].join('\n');
}

/** A message link. */
function jumpLink(guildId: string, channelId: string, messageId?: string): string {
    return `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`;
}

/**
 * A directory message: its layout key, where it goes (`main`, the channel,
 * or a rank group's thread), and how to build it once the IDs of the
 * messages and threads before it are known.
 */
interface Part {
    key: string;
    /** `main`, or a rank group (its thread). */
    place: string;
    build(ids: Map<string, string>): Payload;
}

/** A thread the directory opens, one per rank group, before the messages placed in it. */
interface ThreadPart {
    key: string;
    place: string;
    name: string;
}

/** The layout key of a part or thread. */
function layoutKey(part: Part | ThreadPart): string {
    return 'name' in part ? part.key : `${part.place}|${part.key}`;
}

/** Current members on uma.moe; null when the club is not tracked or has no data yet. */
export async function clubHeadcount(club: TrackedCircle): Promise<number | null> {
    if (club.circleId === null) return null;
    return (await currentCircleProgress(club))?.members.length ?? null;
}

/** The clubs with an expected rank, as the poster draws them. */
export async function posterClubs(clubs: TrackedCircle[]): Promise<PosterClub[]> {
    return Promise.all(
        clubs
            .filter((c) => rankGroup(c.rank) !== null)
            .map(async (c) => ({
                id: c.id,
                name: c.name,
                group: rankGroup(c.rank)!,
                rank: c.rank,
                headcount: await clubHeadcount(c),
                quotaText: clubQuotaText(c),
                dailyRequirement: clubDailyRequirement(c),
                monthlyRank: c.circleId !== null ? c.monthlyRank : null,
            })),
    );
}

/** The result of posting or refreshing. */
export interface DirectoryResult {
    /** Whether the existing messages were edited or a fresh run was posted. */
    mode: 'edited' | 'posted';
    /** Clubs on the directory. */
    listed: number;
    /** Clubs left out for having no expected rank. */
    untiered: string[];
}

/** The directory's messages for a guild, in order. */
async function directoryParts(guild: DirectoryGuild, rulesThreads: Map<string, string>): Promise<{ parts: (Part | ThreadPart)[]; listed: number; untiered: string[] }> {
    const all = await prisma.trackedCircle.findMany({ where: { guildId: guild.id }, include: { banner: true }, orderBy: { name: 'asc' } });
    const linkable = await guildClubs(guild.id);
    const membersLoaded = await loadMembers(guild);
    const untiered = all.filter((c) => rankGroup(c.rank) === null).map((c) => c.name);

    const parts: (Part | ThreadPart)[] = [];

    // One thread per rank group, as the old directory had one per tier: the
    // heading, each club's post, then a link to each post in the thread.
    let listed = 0;
    for (const group of GROUP_ORDER) {
        const clubs = all.filter((c) => rankGroup(c.rank) === group);
        if (clubs.length === 0) continue;
        parts.push({ key: `thread:${group}`, place: group, name: GROUPS[group].label });
        parts.push({ key: 'heading', place: group, build: () => ({ content: `## __Current ${GROUPS[group].label} Clubs__`, embeds: [], files: [] }) });
        const posts: { key: string; name: string }[] = [];
        for (const club of clubs) {
            const staff = await clubStaff(club, linkable, guild, membersLoaded);
            const key = `club:${club.id}`;
            const thread = rulesThreads.get(club.id);
            const card = clubCard(club, staff, club.banner, thread ? jumpLink(guild.id, thread) : null);
            parts.push({ key, place: group, build: () => card });
            // Overflow and a rules file follow the post in messages of their own.
            card.followUps.forEach((chunk, i) => parts.push({ key: `${key}:rules:${i + 1}`, place: group, build: () => rulesMessage(chunk) }));
            posts.push({ key: `${group}|${key}`, name: club.name });
            listed += 1;
        }
        parts.push({
            key: 'index',
            place: group,
            build: (ids) => {
                const thread = ids.get(`thread:${group}`) ?? '';
                const links = posts.map((c) => (ids.has(c.key) ? `[${c.name}](${jumpLink(guild.id, thread, ids.get(c.key))})` : c.name));
                return { content: `${'-'.repeat(88)}\n__**Directory**__\n${links.join('\n')}`, embeds: [], files: [] };
            },
        });
    }
    // In the channel itself, under the threads: what each group means, a box
    // each, how to apply, and the poster.
    parts.push({
        key: 'groups',
        place: 'main',
        build: () => ({
            embeds: GROUP_ORDER.map((g) => new EmbedBuilder().setColor(GROUPS[g].color).setTitle(GROUPS[g].title).setDescription(GROUPS[g].blurb)),
            files: [],
        }),
    });
    parts.push({ key: 'apply', place: 'main', build: () => ({ content: howToApply(), embeds: [], files: [] }) });
    // The poster also carries the hand-written JP clubs, so it is posted even
    // when no tracked club is listed.
    if (listed > 0 || JP_SECTION.clubs.length > 0) {
        const poster = new AttachmentBuilder(await renderClubPoster(await posterClubs(all), { updatedAt: new Date(), extra: [JP_SECTION] }), { name: 'clubs.jpg' });
        parts.push({ key: 'poster', place: 'main', build: () => ({ embeds: [], files: [poster] }) });
    }
    return { parts, listed, untiered };
}

/** No directory message may ping anyone; mentions in embeds never do, and content has none. */
const NO_PINGS = { parse: [] as never[] };

/**
 * Posts the directory in `channel`, or refreshes it there. `oldChannel`
 * resolves the channel the previous run is in, so a move deletes it.
 * `force` edits every message rather than only those that changed.
 */
export async function publishDirectory(
    guild: DirectoryGuild,
    channel: DirectoryChannel,
    oldChannel: (id: string) => Promise<DirectoryChannel | null> = async () => null,
    { force = false }: { force?: boolean } = {},
): Promise<DirectoryResult> {
    const existing = await prisma.clubDirectory.findUnique({ where: { guildId: guild.id } });
    // Every listed club needs its Goals/Rules thread. A missing one is made
    // only on a fresh post, before the rest, so the poster stays last.
    const rules = await rulesThreadPlan(guild.id, channel);
    let { parts, listed, untiered } = await directoryParts(guild, rules.threads);
    let layout = parts.map(layoutKey);

    const send = (to: DirectoryTarget, p: Payload) => to.send({ ...(p.content ? { content: p.content } : {}), embeds: p.embeds, files: p.files, allowedMentions: NO_PINGS });
    const edit = async (to: DirectoryTarget, id: string, p: Payload) =>
        (await to.messages.fetch(id)).edit({ content: p.content ?? '', embeds: p.embeds, files: p.files, attachments: [], allowedMentions: NO_PINGS });

    if (rules.missing.length === 0 && existing && existing.channelId === channel.id && sameList(existing.layout, layout)) {
        const ids = new Map(layout.map((key, i) => [key, existing.messageIds[i]!]));
        const signatures: string[] = [];
        const threads = new Map<string, DirectoryThread>();
        try {
            for (const [i, part] of parts.entries()) {
                if ('name' in part) {
                    signatures.push(part.name);
                    continue;
                }
                const p = part.build(ids);
                const signature = payloadSignature(p);
                signatures.push(signature);
                if (!force && existing.signatures[i] === signature) continue;
                let target: DirectoryTarget = channel;
                if (part.place !== 'main') {
                    const threadId = ids.get(`thread:${part.place}`)!;
                    // (a rules thread is locked; the bot may still edit in it)
                    let thread = threads.get(threadId);
                    if (!thread) {
                        thread = (await channel.threads.fetch(threadId)) ?? undefined;
                        if (!thread) throw new Error('thread gone');
                        // A quiet thread archives itself after a week; its messages cannot be edited until it is opened again.
                        if (thread.archived) await thread.setArchived(false);
                        await lock(thread);
                        threads.set(threadId, thread);
                    }
                    target = thread;
                }
                await edit(target, existing.messageIds[i]!, p);
            }
            await prisma.clubDirectory.update({ where: { guildId: guild.id }, data: { layout, messageIds: existing.messageIds, signatures } });
            return { mode: 'edited', listed, untiered };
        } catch {
            // A message or thread was deleted by hand, or cannot be edited: post afresh.
        }
    }

    if (existing) {
        // Deleting a thread takes its messages with it; the channel's own are deleted one by one.
        const from = existing.channelId === channel.id ? channel : await oldChannel(existing.channelId);
        for (const [i, key] of existing.layout.entries()) {
            const id = existing.messageIds[i]!;
            if (key.startsWith('thread:')) {
                await from?.threads
                    .fetch(id)
                    .then((t) => t?.delete())
                    .catch(() => undefined);
            } else if (!key.includes('|') || key.startsWith('main|')) {
                await from?.messages
                    .fetch(id)
                    .then((m) => m.delete())
                    .catch(() => undefined);
            }
        }
    }

    if (rules.missing.length > 0) {
        for (const club of rules.missing) rules.threads.set(club.id, await openRulesThread(channel, club));
        ({ parts, listed, untiered } = await directoryParts(guild, rules.threads));
        layout = parts.map(layoutKey);
    }

    const ids = new Map<string, string>();
    const messageIds: string[] = [];
    const signatures: string[] = [];
    const threads = new Map<string, DirectoryThread>();
    for (const part of parts) {
        if ('name' in part) {
            const thread = await channel.threads.create({ name: part.name, autoArchiveDuration: THREAD_ARCHIVE_MINUTES });
            await lock(thread);
            threads.set(part.place, thread);
            ids.set(part.key, thread.id);
            messageIds.push(thread.id);
            signatures.push(part.name);
            continue;
        }
        const p = part.build(ids);
        const sent = await send(part.place === 'main' ? channel : threads.get(part.place)!, p);
        ids.set(layoutKey(part), sent.id);
        messageIds.push(sent.id);
        signatures.push(payloadSignature(p));
    }
    await prisma.clubDirectory.upsert({
        where: { guildId: guild.id },
        create: { guildId: guild.id, channelId: channel.id, layout, messageIds, signatures },
        update: { channelId: channel.id, layout, messageIds, signatures },
    });
    return { mode: 'posted', listed, untiered };
}

/**
 * Each listed club's Goals/Rules thread under `channel`: the ones it has,
 * and the clubs still without one. A club whose Rules field is a link needs
 * none; its own link is used (and guarded, see `clubRulesThreads.ts`).
 */
async function rulesThreadPlan(guildId: string, channel: DirectoryChannel): Promise<{ threads: Map<string, string>; missing: { id: string; name: string }[] }> {
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId, rank: { not: null } }, select: { id: true, name: true, rules: true, rulesThreadId: true } });
    const threads = new Map<string, string>();
    const missing: { id: string; name: string }[] = [];
    for (const club of clubs) {
        if (club.rules && isLink(club.rules)) continue;
        const thread = club.rulesThreadId ? await channel.threads.fetch(club.rulesThreadId).catch(() => null) : null;
        if (thread) {
            await lock(thread);
            threads.set(club.id, thread.id);
        }
        else missing.push(club);
    }
    return { threads, missing };
}

/** Opens a club's Goals/Rules thread, says who may post there, and keeps its ID. */
async function openRulesThread(channel: DirectoryChannel, club: { id: string; name: string }): Promise<string> {
    const thread = await channel.threads.create({ name: `${club.name} Goals/Rules`.slice(0, 100), autoArchiveDuration: THREAD_ARCHIVE_MINUTES });
    await thread.send({ content: rulesThreadOpening(club.name), allowedMentions: NO_PINGS });
    await lock(thread);
    await prisma.trackedCircle.update({ where: { id: club.id }, data: { rulesThreadId: thread.id } });
    return thread.id;
}

/**
 * Locks a thread the directory made, if it is not already. A locked thread
 * takes posts only from members with Manage Threads (and the bot); everyone
 * can still read it. Rules threads are also guarded (`clubRulesThreads.ts`).
 * Never fails the directory: without the permission the thread stays open.
 */
async function lock(thread: DirectoryThread): Promise<void> {
    if (!thread.locked) await thread.setLocked(true).catch(() => undefined);
}

/** The first message in a club's Goals/Rules thread. */
export function rulesThreadOpening(clubName: string): string {
    return `**${clubName} Goals/Rules**\nOnly ${clubName}'s trainers and assistants (and Club Managers) can post here. Anyone else's message is removed.`;
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Refreshes in flight, per guild, so two changes in a row do not post over each other. */
const pending = new Map<string, Promise<unknown>>();

/**
 * Refreshes a guild's directory, if it has one, after a club changed. Runs
 * after any refresh already under way. Never throws: a failure is logged and
 * the next change or `/club directory` tries again.
 */
export function refreshDirectory(guild: DirectoryGuild | null): Promise<void> {
    if (!guild) return Promise.resolve();
    const run = (pending.get(guild.id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            const existing = await prisma.clubDirectory.findUnique({ where: { guildId: guild.id } });
            if (!existing || !guild.channels) return;
            const channel = (await guild.channels.fetch(existing.channelId).catch(() => null)) as DirectoryChannel | null;
            if (!channel || typeof channel.send !== 'function') return;
            await publishDirectory(guild, channel);
        })
        .catch((e: unknown) => console.error('Club directory refresh failed:', e));
    pending.set(guild.id, run);
    return run;
}
