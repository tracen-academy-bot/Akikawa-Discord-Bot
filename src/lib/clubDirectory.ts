import { createHash } from 'node:crypto';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { ClubTier, TrackedCircle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { COLORS } from './embeds';
import { clubQuotaText, formatRank } from './clubFormat';
import { guildClubs, nameWords, staffRolesOf, type LinkableClub, type NamedThing } from './clubLinks';

/**
 * The club directory: a channel listing every club by tier, posted and kept
 * up to date by the bot.
 *
 * It is a run of messages, in order:
 *
 *   1. `tiers`: what each tier means (four embeds).
 *   2. For each tier with clubs, `tier:<tier>` ("Current G1 Clubs"), then one
 *      `club:<id>` card per club in it, by name. A card is the club's banner
 *      (if it has one) above an embed with its staff, requirements, expected
 *      rank, rules and bio.
 *   3. `index`: jump links to every card.
 *
 * Clubs without a tier are left out. `/club directory` posts it; after that
 * any change to a club (its profile, `/club edit`, staff, create, delete)
 * refreshes it. When the same messages still fit (same clubs, same order)
 * they are edited in place, and only those whose content changed (each
 * message's content is fingerprinted), so one club's edit does not re-upload
 * every banner. Otherwise the old ones are deleted and the run is posted
 * again, since Discord cannot insert a message between two others.
 * `/club directory` itself edits every message, which also finds any deleted
 * by hand.
 */

/** What a tier means, as the directory's first message explains it. */
export interface TierInfo {
    label: string;
    title: string;
    blurb: string;
    ranks: string;
    color: number;
}

export const TIERS: Record<ClubTier, TierInfo> = {
    G1: {
        label: 'G1',
        title: 'G1 [Competitive]',
        blurb: 'The top clubs in our network, pushing for gold!',
        ranks: 'S to S+ (Top 100)',
        color: 0xf5c84c,
    },
    G2: {
        label: 'G2',
        title: 'G2 [Semi Competitive+]',
        blurb: 'Our more intense and active semi-competitive clubs that aim for strong monthly results.',
        ranks: 'A to A+ (Top 300~500)',
        color: 0xa7d8f5,
    },
    G3: {
        label: 'G3',
        title: 'G3 [Semi-Competitive]',
        blurb: 'Our mid-range clubs that offer a good balance between activity and commitment!',
        ranks: 'B+ to A',
        color: 0xd9784a,
    },
    DEBUT: {
        label: 'Debut',
        title: 'Debut [Casual]',
        blurb: 'Our clubs for trainers who just want to relax and have fun!',
        ranks: 'C+ to B+',
        color: 0x4ade80,
    },
};

/** Tiers in directory order. */
export const TIER_ORDER: ClubTier[] = ['G1', 'G2', 'G3', 'DEBUT'];

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

/** A club's banner, as stored. */
export interface Banner {
    data: Uint8Array;
    fileName: string;
}

/**
 * A club's directory card: its banner (when it has one) as an image-only
 * embed above the card, so it reads as a header, then the card itself.
 */
export function clubCard(club: TrackedCircle, staff: StaffMentions, banner: Banner | null): Payload {
    const color = club.tier ? TIERS[club.tier].color : COLORS.info;
    const embeds: EmbedBuilder[] = [];
    const files: AttachmentBuilder[] = [];
    if (banner) {
        const name = bannerFileName(club.id, banner.fileName);
        files.push(new AttachmentBuilder(Buffer.from(banner.data), { name }));
        embeds.push(new EmbedBuilder().setColor(color).setImage(`attachment://${name}`));
    }

    const lines: string[] = [];
    const list = (one: string, many: string, who: string[]) => {
        if (who.length > 0) lines.push(`**${who.length === 1 ? one : many}**: ${who.join(', ')}`);
    };
    list('Trainer', 'Trainers', staff.trainers);
    list('Assistant', 'Assistants', staff.assistants);
    const quota = clubQuotaText(club);
    if (quota !== 'Not set') lines.push(`**Requirements**: ${quota}`);
    if (club.rank) lines.push(`**Expected rank**: ${formatRank(club.rank)}`);
    if (club.rules) {
        lines.push('', isLink(club.rules) ? `[${club.name} goals and rules](${club.rules})` : `**Rules**\n${club.rules}`);
    }
    if (club.bio) lines.push('', club.bio.split('\n').map((l) => `> ${l}`).join('\n'));

    const card = new EmbedBuilder().setColor(color).setTitle(club.name);
    const description = lines.join('\n').trim();
    if (description) card.setDescription(description.slice(0, 4096));
    embeds.push(card);
    return { embeds, files };
}

/** The tier explainer: one embed per tier. */
function tiersPayload(): Payload {
    return {
        embeds: TIER_ORDER.map((t) =>
            new EmbedBuilder().setColor(TIERS[t].color).setTitle(TIERS[t].title).setDescription(`${TIERS[t].blurb}\n**Estimated Ranks:** ${TIERS[t].ranks}`),
        ),
        files: [],
    };
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

/** The result of posting or refreshing. */
export interface DirectoryResult {
    /** Whether the existing messages were edited or a fresh run was posted. */
    mode: 'edited' | 'posted';
    /** Clubs on the directory. */
    listed: number;
    /** Clubs left out for having no tier. */
    untiered: string[];
}

/** The directory's messages for a guild, in order. */
async function directoryParts(guild: DirectoryGuild, channelId: string): Promise<{ parts: Part[]; listed: number; untiered: string[] }> {
    const all = await prisma.trackedCircle.findMany({ where: { guildId: guild.id }, include: { banner: true }, orderBy: { name: 'asc' } });
    const linkable = await guildClubs(guild.id);
    const membersLoaded = await loadMembers(guild);
    const untiered = all.filter((c) => c.tier === null).map((c) => c.name);

    const parts: Part[] = [{ key: 'tiers', build: tiersPayload }];
    const sections: { tier: ClubTier; clubs: { key: string; name: string }[] }[] = [];
    let listed = 0;
    for (const tier of TIER_ORDER) {
        const clubs = all.filter((c) => c.tier === tier);
        if (clubs.length === 0) continue;
        parts.push({ key: `tier:${tier}`, build: () => ({ content: `## Current ${TIERS[tier].label} Clubs`, embeds: [], files: [] }) });
        const section = { tier, clubs: [] as { key: string; name: string }[] };
        for (const club of clubs) {
            const staff = await clubStaff(club, linkable, guild, membersLoaded);
            const key = `club:${club.id}`;
            parts.push({ key, build: () => clubCard(club, staff, club.banner) });
            section.clubs.push({ key, name: club.name });
            listed += 1;
        }
        sections.push(section);
    }
    parts.push({
        key: 'index',
        build: (ids) => {
            const lines = sections.map(
                (s) => `**${TIERS[s.tier].label}**: ${s.clubs.map((c) => (ids.has(c.key) ? `[${c.name}](${jumpLink(guild.id, channelId, ids.get(c.key)!)})` : c.name)).join(' · ')}`,
            );
            return {
                embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Directory').setDescription(lines.join('\n') || 'No clubs are listed yet.')],
                files: [],
            };
        },
    });
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
