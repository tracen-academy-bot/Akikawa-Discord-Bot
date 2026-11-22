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
 * It is a run of messages, in order, modelled on the server's old hand-made
 * directory:
 *
 *   1. For each rank group with clubs (`clubGroups.ts`: S, A+, A, B+, Casual),
 *      `group:<group>` ("Current S Clubs"), then one `club:<id>` post per
 *      club in it, by name: a plain message with the banner attached (see
 *      `clubCard`). Overflow and a rules file follow in `club:<id>:rules:<n>`.
 *   2. `index`: a rule, then "Directory" and a link to each post.
 *   3. `groups`: what each group means, a box each.
 *   4. `apply`: how to apply.
 *   5. `poster`: every club on one picture (`renderClubPoster`). It is last
 *      because Discord opens a channel at its newest message.
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

/** The parts of a channel the directory posts to; a discord.js text channel fits. */
export interface DirectoryChannel {
    id: string;
    send(payload: unknown): Promise<{ id: string }>;
    messages: { fetch(id: string): Promise<DirectoryMessage> };
}

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
 *   **★ ─── Spica ─── ★**
 *   **Trainers**: @a, @b - **Assistants**: @c
 *   **Requirements**: 9.0M/day
 *
 *   [Link to Spica Goals/Rules](...)   (or the rules as text)
 *   > the bio, quoted
 *
 * A message holds 2000 characters, so text past that continues in
 * `followUps`, and a rules file follows in messages of its own after that.
 */
export function clubCard(club: TrackedCircle, staff: StaffMentions, banner: Banner | null): Payload & { followUps: string[] } {
    const files: AttachmentBuilder[] = [];
    if (banner) files.push(new AttachmentBuilder(Buffer.from(banner.data), { name: bannerFileName(club.id, banner.fileName) }));

    const lines: string[] = [`**\u2605 \u2500\u2500\u2500 ${club.name} \u2500\u2500\u2500 \u2605**`];
    const who = (one: string, many: string, list: string[]) => (list.length > 0 ? `**${list.length === 1 ? one : many}**: ${list.join(', ')}` : null);
    const staffLine = [who('Trainer', 'Trainers', staff.trainers), who('Assistant', 'Assistants', staff.assistants)].filter(Boolean).join(' - ');
    if (staffLine) lines.push(staffLine);
    const quota = clubQuotaText(club);
    if (quota !== 'Not set') lines.push(`**Requirements**: ${quota}`);
    if (club.rules) {
        lines.push('', isLink(club.rules) ? `[Link to ${club.name} Goals/Rules](${club.rules})` : `**Rules**\n${club.rules}`);
    }
    if (club.rulesFile) lines.push('', '**Rules and goals**: in the messages below.');
    if (club.bio) lines.push('', club.bio.split('\n').map((l) => `> ${l}`).join('\n'));

    const [content = '', ...overflow] = splitByLines(lines.join('\n'), MESSAGE_LIMIT);
    // A rules file as plain text, so all of its Markdown renders.
    const rulesFile = club.rulesFile ? splitByLines(`## ${club.name}: rules and goals\n${club.rulesFile}`, MESSAGE_LIMIT) : [];
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
function jumpLink(guildId: string, channelId: string, messageId: string): string {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** A directory message: its layout key, and how to build it once earlier messages' IDs are known. */
interface Part {
    key: string;
    build(ids: Map<string, string>): Payload;
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
async function directoryParts(guild: DirectoryGuild, channelId: string): Promise<{ parts: Part[]; listed: number; untiered: string[] }> {
    const all = await prisma.trackedCircle.findMany({ where: { guildId: guild.id }, include: { banner: true }, orderBy: { name: 'asc' } });
    const linkable = await guildClubs(guild.id);
    const membersLoaded = await loadMembers(guild);
    const untiered = all.filter((c) => rankGroup(c.rank) === null).map((c) => c.name);

    const parts: Part[] = [];
    const sections: { group: RankGroup; clubs: { key: string; name: string }[] }[] = [];
    let listed = 0;
    for (const group of GROUP_ORDER) {
        const clubs = all.filter((c) => rankGroup(c.rank) === group);
        if (clubs.length === 0) continue;
        parts.push({ key: `group:${group}`, build: () => ({ content: `## __Current ${GROUPS[group].label} Clubs__`, embeds: [], files: [] }) });
        const section = { group, clubs: [] as { key: string; name: string }[] };
        for (const club of clubs) {
            const staff = await clubStaff(club, linkable, guild, membersLoaded);
            const key = `club:${club.id}`;
            const card = clubCard(club, staff, club.banner);
            parts.push({ key, build: () => card });
            // Overflow and a rules file follow the post in messages of their own.
            card.followUps.forEach((chunk, i) => parts.push({ key: `${key}:rules:${i + 1}`, build: () => rulesMessage(chunk) }));
            section.clubs.push({ key, name: club.name });
            listed += 1;
        }
        sections.push(section);
    }
    // After the posts, as in the old directory: a rule, then a link to each.
    parts.push({
        key: 'index',
        build: (ids) => {
            const links = sections.flatMap((s) => s.clubs.map((c) => (ids.has(c.key) ? `[${c.name}](${jumpLink(guild.id, channelId, ids.get(c.key)!)})` : c.name)));
            return { content: `${'-'.repeat(88)}\n__**Directory**__\n${links.length > 0 ? links.join('\n') : 'No clubs are listed yet.'}`, embeds: [], files: [] };
        },
    });
    // What each group means, one box each, as the old directory opened with.
    parts.push({
        key: 'groups',
        build: () => ({
            embeds: GROUP_ORDER.map((g) => new EmbedBuilder().setColor(GROUPS[g].color).setTitle(GROUPS[g].title).setDescription(GROUPS[g].blurb)),
            files: [],
        }),
    });
    parts.push({ key: 'apply', build: () => ({ content: howToApply(), embeds: [], files: [] }) });
    // The poster also carries the hand-written JP clubs, so it is posted even
    // when no tracked club is listed.
    if (listed > 0 || JP_SECTION.clubs.length > 0) {
        const poster = new AttachmentBuilder(await renderClubPoster(await posterClubs(all), { updatedAt: new Date(), extra: [JP_SECTION] }), { name: 'clubs.jpg' });
        parts.push({ key: 'poster', build: () => ({ embeds: [], files: [poster] }) });
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
    const { parts, listed, untiered } = await directoryParts(guild, channel.id);
    const layout = parts.map((p) => p.key);
    const existing = await prisma.clubDirectory.findUnique({ where: { guildId: guild.id } });

    if (existing && existing.channelId === channel.id && sameList(existing.layout, layout)) {
        const ids = new Map(layout.map((key, i) => [key, existing.messageIds[i]!]));
        const signatures: string[] = [];
        try {
            for (const [i, part] of parts.entries()) {
                const p = part.build(ids);
                const signature = payloadSignature(p);
                signatures.push(signature);
                if (!force && existing.signatures[i] === signature) continue;
                const message = await channel.messages.fetch(existing.messageIds[i]!);
                await message.edit({ content: p.content ?? '', embeds: p.embeds, files: p.files, attachments: [], allowedMentions: NO_PINGS });
            }
            await prisma.clubDirectory.update({ where: { guildId: guild.id }, data: { layout, messageIds: existing.messageIds, signatures } });
            return { mode: 'edited', listed, untiered };
        } catch {
            // A message was deleted by hand, or cannot be edited: post afresh.
        }
    }

    if (existing) {
        const from = existing.channelId === channel.id ? channel : await oldChannel(existing.channelId);
        for (const id of existing.messageIds) {
            await from?.messages
                .fetch(id)
                .then((m) => m.delete())
                .catch(() => undefined);
        }
    }

    const ids = new Map<string, string>();
    const messageIds: string[] = [];
    const signatures: string[] = [];
    for (const part of parts) {
        const p = part.build(ids);
        const sent = await channel.send({ ...(p.content ? { content: p.content } : {}), embeds: p.embeds, files: p.files, allowedMentions: NO_PINGS });
        ids.set(part.key, sent.id);
        messageIds.push(sent.id);
        signatures.push(payloadSignature(p));
    }
    // A message that links to later ones (the index, first) was posted before
    // they existed; now that every ID is known, fill those links in.
    for (const [i, part] of parts.entries()) {
        const p = part.build(ids);
        const signature = payloadSignature(p);
        if (signature === signatures[i]) continue;
        const message = await channel.messages.fetch(messageIds[i]!);
        await message.edit({ content: p.content ?? '', embeds: p.embeds, files: p.files, attachments: [], allowedMentions: NO_PINGS });
        signatures[i] = signature;
    }
    await prisma.clubDirectory.upsert({
        where: { guildId: guild.id },
        create: { guildId: guild.id, channelId: channel.id, layout, messageIds, signatures },
        update: { channelId: channel.id, layout, messageIds, signatures },
    });
    return { mode: 'posted', listed, untiered };
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
