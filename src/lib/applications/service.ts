import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    type Client,
    type ForumChannel,
    type Message,
    type ThreadChannel,
} from 'discord.js';
import type { ClubApplication, TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { isConfigured, UmaMoeError, getProfile } from '../umamoe/client';
import { formatCompactFans, quotaPerDayFor, toSafeNumber } from '../fans/metrics';
import { currentGameMonth } from '../fans/ingest';
import { TIERS, TIER_ORDER } from '../clubDirectory';
import { renderApplicantCard } from '../image/renderApplicant';
import { clubFits, daysInMonth, extractTrainerId, type ClubFit, type FitClub } from './history';
import { headlinePace, scoutTrainer, type ScoutReport } from './scout';

/**
 * Club applications: the posts in the application forum.
 *
 * When a post opens, the bot finds the trainer ID in it. With none, it pings
 * the applicant to send it and picks it up from their reply in the post.
 * Once it has an ID, it scouts the trainer on uma.moe, and then:
 *
 *   - posts the trainer's card (30 days, 3 and 6 months) in the post;
 *   - posts an entry in the recruitment channel (status, destination, pace),
 *     edited in place as the application moves on;
 *   - posts the card in the staff discussion channel with the clubs whose
 *     quota the trainer's pace clears, pinging the council and recruiting
 *     roles of the post's tier tags.
 *
 * Decisions are made with `/resolve` (a club, or Rejected), which tags the
 * post and locks it; it needs the trainer ID first. Once the applicant joins,
 * they (or staff) close it with the Close button or `/close`, which archives
 * it and links the applicant's Discord to their trainer (as `/uma-id` does).
 */

/** The application forum. */
export const FORUM_ID = process.env.FORUM_CHANNEL_ID ?? '';

/** Where each application's entry is posted. Set to `off` to stop posting. */
export const RECRUITMENT_CHANNEL_ID = channelSetting('RECRUITMENT_CHANNEL_ID', '1523241207600386188');

/** Where staff are told about new applications. Set to `off` to stop posting. */
export const STAFF_CHANNEL_ID = channelSetting('STAFF_DISCUSSION_CHANNEL_ID', '1522409298456613025');

/** Forum tag put on accepted posts. */
const TAG_ACCEPTED_ID = process.env.TAG_CLUB_APP_ACCEPTED_ID ?? '';

/** Forum tag put on rejected posts; when unset, the forum's tag named "Rejected". */
const TAG_REJECTED_ID = process.env.TAG_REJECTED_ID ?? '';

/** Button on the decision message that closes the post. */
export const CLOSE_BUTTON_ID = 'application:close';

/** Value `/resolve` uses for Rejected, beside club IDs. */
export const REJECTED = '__rejected__';

/** Discord's limit on tags per forum post. */
const MAX_TAGS = 5;

/** A channel ID from the environment, the default when unset, or null for `off`. */
function channelSetting(name: string, fallback: string): string | null {
    const value = (process.env[name] ?? '').trim();
    if (value.toLowerCase() === 'off') return null;
    return value || fallback;
}

/** Council roles pinged for a post's tier tags, as before applications moved here. */
const TIER_ROLES: { tags: string[]; role: string | undefined; label: string }[] = [
    { tags: ['s+', 's'], role: process.env.COMP_COUNCIL_ROLE_ID, label: 'competitive' },
    { tags: ['a+', 'a'], role: process.env.SEMI_COMP_COUNCIL_ROLE_ID, label: 'semi-competitive' },
    { tags: ['b+', 'casual'], role: process.env.CASUAL_COUNCIL_ROLE_ID, label: 'casual' },
];

/** The council roles and labels for a set of tag names. */
export function tierRolesFor(tagNames: string[]): { roles: string[]; labels: string[] } {
    const lower = tagNames.map((t) => t.toLowerCase());
    const roles: string[] = [];
    const labels: string[] = [];
    for (const tier of TIER_ROLES) {
        if (!tier.tags.some((t) => lower.includes(t))) continue;
        labels.push(tier.label);
        if (tier.role && !roles.includes(tier.role)) roles.push(tier.role);
    }
    return { roles, labels };
}

/**
 * Recruiting roles, held by the people who run clubs at each tier, found by
 * name in the server. Pinged with the council roles when an application
 * opens with a matching tier tag. S covers S+ (there is no S+ role); B+
 * goes with Casual, as the council pings do.
 */
const RECRUITING_ROLES: { tags: string[]; name: string }[] = [
    { tags: ['s+', 's'], name: 's recruiting' },
    { tags: ['a+'], name: 'a+ recruiting' },
    { tags: ['a'], name: 'a recruiting' },
    { tags: ['b+', 'casual'], name: 'casual recruiting' },
];

/** The IDs of the recruiting roles for a set of tag names, among `roles`. */
export function recruitingRolesFor(tagNames: string[], roles: Iterable<{ id: string; name: string }>): string[] {
    const lower = tagNames.map((t) => t.trim().toLowerCase());
    const wanted = new Set(RECRUITING_ROLES.filter((r) => r.tags.some((t) => lower.includes(t))).map((r) => r.name));
    return [...roles].filter((r) => wanted.has(r.name.trim().toLowerCase())).map((r) => r.id);
}

/** True when the thread is a post in the application forum. */
export function isApplicationThread(thread: { parentId: string | null; parent?: { type: ChannelType } | null }): boolean {
    return Boolean(FORUM_ID) && thread.parentId === FORUM_ID;
}

/** The names of a post's tags. */
function tagNames(thread: ThreadChannel): string[] {
    const forum = thread.parent as ForumChannel | null;
    if (!forum || forum.type !== ChannelType.GuildForum) return [];
    return thread.appliedTags.map((id) => forum.availableTags.find((t) => t.id === id)?.name).filter((n): n is string => Boolean(n));
}

/** The rejection tag's ID: `TAG_REJECTED_ID`, else the forum's tag named "Rejected". */
function rejectedTagId(thread: ThreadChannel): string | null {
    if (TAG_REJECTED_ID) return TAG_REJECTED_ID;
    const forum = thread.parent as ForumChannel | null;
    return forum?.availableTags?.find((t) => t.name.trim().toLowerCase() === 'rejected')?.id ?? null;
}

/**
 * A post's tags with `add` put on and `remove` taken off. The status tag
 * comes first, so when the post already has five tags the applicant's last
 * tag gives way rather than the decision.
 */
export function withStatusTag(applied: string[], add: string | null, remove: (string | null)[]): string[] {
    const kept = applied.filter((id) => id !== add && !remove.includes(id));
    return (add ? [add, ...kept] : kept).slice(0, MAX_TAGS);
}

/** The post's opening message. Right after a post is created it can 404 for a moment. */
async function starterMessage(thread: ThreadChannel): Promise<Message | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await thread.fetchStarterMessage();
        } catch {
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
    return null;
}

/** Scouting's outcome: a report, or why there is none. */
export type ScoutOutcome = { report: ScoutReport } | { report: null; reason: string };

/** Scouts a trainer, turning every failure into a reason for the post. */
export async function tryScout(viewerId: string | null): Promise<ScoutOutcome> {
    if (!viewerId) return { report: null, reason: 'No trainer ID was found in the post.' };
    if (!isConfigured()) return { report: null, reason: 'uma.moe is not set up on this bot (EXTERNAL_API_KEY).' };
    try {
        const report = await scoutTrainer(viewerId);
        return report ? { report } : { report: null, reason: `uma.moe has no trainer with ID \`${viewerId}\`.` };
    } catch (e) {
        console.error(`Scouting ${viewerId} failed:`, e);
        return { report: null, reason: e instanceof UmaMoeError ? 'uma.moe could not be reached; try `/scout` again later.' : 'Scouting failed; try `/scout` again later.' };
    }
}

/** The card for a report, as an attachment. */
export async function cardFile(report: ScoutReport, tags: string[]): Promise<AttachmentBuilder> {
    const png = await renderApplicantCard({ ...report, trainerName: report.trainerName ?? report.viewerId, tags });
    return new AttachmentBuilder(png, { name: `applicant-${report.viewerId}.png` });
}

/** The pace fields stored on an application. */
function paceFields(report: ScoutReport | null) {
    const big = (v: number | null) => (v === null ? null : BigInt(Math.round(v)));
    return {
        trainerName: report?.trainerName ?? null,
        pace30: big(report?.recent.perDay ?? null),
        pace3m: big(report?.threeMonths.perDay ?? null),
        pace6m: big(report?.sixMonths.perDay ?? null),
    };
}

/**
 * Links a Discord account to a trainer, the link `/uma-id` sets, unless
 * either side is already linked: an existing link is never overwritten.
 * Returns true when a link was made.
 */
export async function linkApplicant(guildId: string, discordUserId: string, viewerId: bigint, trainerName: string | null): Promise<boolean> {
    if (!/^\d+$/.test(discordUserId)) return false;
    const made = await prisma.trainerLink.createMany({ data: [{ guildId, discordUserId, viewerId, trainerName }], skipDuplicates: true });
    return made.count > 0;
}

/** A guild's clubs with their quota per calendar day. */
export async function clubsWithQuota(guildId: string): Promise<(FitClub & { tier: TrackedCircle['tier'] })[]> {
    const now = currentGameMonth();
    const days = daysInMonth(now.year, now.month);
    const clubs = await prisma.trackedCircle.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
    return clubs.map((c) => ({ id: c.id, name: c.name, tier: c.tier, quotaPerDay: quotaPerDayFor(c.quotaPeriod, toSafeNumber(c.quota), days) }));
}

/** "First (12.0M/day), Rose (8.0M/day)" for the clubs a pace clears. */
export function fitsText(fits: ClubFit<FitClub & { tier?: TrackedCircle['tier'] }>[]): { clears: string; highestTier: string | null } {
    const met = fits.filter((f) => f.meets);
    if (fits.length === 0) return { clears: 'No club has a quota set.', highestTier: null };
    if (met.length === 0) return { clears: `None (lowest quota: ${fits.at(-1)!.club.name}, ${formatCompactFans(fits.at(-1)!.club.quotaPerDay)}/day)`, highestTier: null };
    const tier = TIER_ORDER.find((t) => met.some((f) => f.club.tier === t)) ?? null;
    return {
        clears: met.map((f) => `${f.club.name} (${formatCompactFans(f.club.quotaPerDay)}/day)`).join(', '),
        highestTier: tier ? TIERS[tier].title : null,
    };
}

/** The pace line: "7.8M/day (30d) · 6.0M (3 mo) · 6.0M (6 mo)". */
export function paceLine(app: Pick<ClubApplication, 'pace30' | 'pace3m' | 'pace6m'>): string {
    const f = (v: bigint | null) => (v === null ? '—' : formatCompactFans(toSafeNumber(v)));
    if (app.pace30 === null && app.pace3m === null && app.pace6m === null) return 'No uma.moe data';
    return `**${f(app.pace30)}/day** (30d) · ${f(app.pace3m)} (3 mo) · ${f(app.pace6m)} (6 mo)`;
}

/** Status line and colour of an application. */
export function statusOf(app: Pick<ClubApplication, 'status' | 'clubName' | 'resolvedById'> & { viewerId?: bigint | null }): { text: string; color: number } {
    const by = app.resolvedById ? ` by <@${app.resolvedById}>` : '';
    switch (app.status) {
        case 'OPEN':
            return { text: app.viewerId === null ? 'Open, waiting for the trainer ID' : 'Open, waiting for a decision', color: 0x5865f2 };
        case 'ACCEPTED':
            return { text: `Accepted into **${app.clubName ?? 'a club'}**${by}, not joined yet`, color: 0x57f287 };
        case 'JOINED':
            return { text: `Joined **${app.clubName ?? 'a club'}**`, color: 0x2d7d46 };
        case 'REJECTED':
            return { text: `Rejected${by}`, color: 0xed4245 };
        case 'WITHDRAWN':
            return { text: 'Closed before a decision', color: 0x80848e };
        case 'CLOSED':
            return { text: 'Closed (from before the bot; outcome not recorded)', color: 0x80848e };
    }
}

/** The application's entry in the recruitment channel. */
export function recruitmentEmbed(app: ClubApplication, threadUrl: string): EmbedBuilder {
    const status = statusOf(app);
    const lines = [
        `**Status**: ${status.text}`,
        `**Applicant**: <@${app.applicantId}>`,
        `**Looking for**: ${app.tags.length > 0 ? app.tags.join(' · ') : 'no tags'}`,
        `**Pace**: ${paceLine(app)}`,
        `**Post**: ${threadUrl}`,
        `**Opened**: <t:${Math.floor(app.createdAt.getTime() / 1000)}:R>`,
    ];
    if (app.note) lines.push(`**Note**: ${app.note}`);
    return new EmbedBuilder()
        .setColor(status.color)
        .setTitle(`${app.trainerName ?? 'Unknown trainer'} · ${app.viewerId !== null ? app.viewerId.toString() : 'no ID'}`)
        .setURL(threadUrl)
        .setDescription(lines.join('\n'));
}

/** A text channel the bot can post in, or null. */
async function textChannel(client: Client, id: string | null) {
    if (!id) return null;
    const channel = await client.channels.fetch(id).catch(() => null);
    return channel?.isSendable() ? channel : null;
}

/** Posts the recruitment entry, or edits it in place. Never throws. */
export async function syncRecruitmentEntry(client: Client, app: ClubApplication, threadUrl: string): Promise<void> {
    try {
        const embed = recruitmentEmbed(app, threadUrl);
        const payload = { embeds: [embed], allowedMentions: { parse: [] as never[] } };
        if (app.recruitmentChannelId && app.recruitmentMessageId) {
            const channel = await textChannel(client, app.recruitmentChannelId);
            const message = channel && 'messages' in channel ? await channel.messages.fetch(app.recruitmentMessageId).catch(() => null) : null;
            if (message) {
                await message.edit(payload);
                return;
            }
        }
        const channel = await textChannel(client, RECRUITMENT_CHANNEL_ID);
        if (!channel) return;
        const sent = await channel.send(payload);
        await prisma.clubApplication.update({
            where: { threadId: app.threadId },
            data: { recruitmentChannelId: channel.id, recruitmentMessageId: sent.id },
        });
    } catch (e) {
        console.error(`Recruitment entry for ${app.threadId} failed:`, e);
    }
}

/** Tells staff about a new application. Never throws. */
async function notifyStaff(client: Client, app: ClubApplication, thread: ThreadChannel, outcome: ScoutOutcome): Promise<void> {
    try {
        const channel = await textChannel(client, STAFF_CHANNEL_ID);
        if (!channel) return;
        const tier = tierRolesFor(app.tags);
        const labels = tier.labels;
        const roles = [...new Set([...tier.roles, ...recruitingRolesFor(app.tags, thread.guild.roles.cache.values())])];
        const pace = outcome.report ? headlinePace(outcome.report) : null;
        const fits = fitsText(clubFits(pace?.perDay ?? null, await clubsWithQuota(app.guildId)));
        const lines = [
            `**Looking for**: ${app.tags.length > 0 ? app.tags.join(' · ') : 'no tags'}`,
            `**Pace**: ${paceLine(app)}`,
            `**Clears the quota of**: ${pace ? fits.clears : 'unknown, no pace'}`,
        ];
        if (pace && fits.highestTier) lines.push(`**Highest tier cleared**: ${fits.highestTier}`);
        if (pace) lines.push(`-# Judged on the ${pace.basis}, per calendar day.`);
        if (!outcome.report) lines.push(`-# ${outcome.reason}`);
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`New application: ${app.trainerName ?? thread.name}`.slice(0, 256))
            .setURL(thread.url)
            .setDescription(lines.join('\n'));
        const files = outcome.report ? [await cardFile(outcome.report, app.tags)] : [];
        if (files[0]) embed.setImage(`attachment://${files[0].name}`);
        const who = labels.length > 0 ? ` (${labels.join(' and ')})` : '';
        await channel.send({
            content: `${roles.map((r) => `<@&${r}>`).join(' ')} <@${app.applicantId}> applied${who}: ${thread.url}`.trim(),
            embeds: [embed],
            files,
            allowedMentions: { roles },
        });
    } catch (e) {
        console.error(`Staff notice for ${app.threadId} failed:`, e);
    }
}

/** Posts the card (or why there is none) in the application post. */
async function postCardInThread(thread: ThreadChannel, outcome: ScoutOutcome, tags: string[]): Promise<void> {
    if (outcome.report) {
        await thread.send({
            content: `uma.moe history for **${outcome.report.trainerName ?? outcome.report.viewerId}** (\`${outcome.report.viewerId}\`). Staff will review this post.`,
            files: [await cardFile(outcome.report, tags)],
            allowedMentions: { parse: [] },
        });
        return;
    }
    await thread.send({
        content: `${outcome.reason} Check it and send your trainer ID (9 to 12 digits) here again, so staff can see your fan history.`,
        allowedMentions: { parse: [] },
    });
}

/** Asks the applicant, by ping, for their trainer ID. */
export function askForIdMessage(applicantId: string): { content: string; allowedMentions: { users: string[] } } {
    return {
        content:
            `<@${applicantId}>, please send your trainer ID here (the 9 to 12 digit number on your in-game profile). ` +
            'Staff can decide on this application once it is in.',
        allowedMentions: { users: [applicantId] },
    };
}

/**
 * The application row for a post, made from the post when it has none (a
 * post from before this feature, or one whose create event was missed).
 */
export async function ensureApplication(thread: ThreadChannel): Promise<{ app: ClubApplication; created: boolean }> {
    const existing = await prisma.clubApplication.findUnique({ where: { threadId: thread.id } });
    if (existing) return { app: existing, created: false };
    const starter = await starterMessage(thread);
    const viewerId = extractTrainerId(thread.name, starter?.content);
    const app = await prisma.clubApplication.upsert({
        where: { threadId: thread.id },
        create: {
            threadId: thread.id,
            guildId: thread.guildId,
            applicantId: thread.ownerId ?? starter?.author.id ?? 'unknown',
            viewerId: viewerId ? BigInt(viewerId) : null,
            tags: tagNames(thread),
        },
        update: {},
    });
    return { app, created: true };
}

/** Handles a new post in the application forum. Never throws. */
export async function openApplication(thread: ThreadChannel): Promise<void> {
    try {
        if (!isApplicationThread(thread)) return;
        const fresh = await thread.fetch();
        const { app, created } = await ensureApplication(fresh);
        if (!created) return;
        if (app.viewerId === null) {
            // No ID yet: ask for it. Staff hear about the application when it
            // arrives (`takeIdFromMessage` or `/scout`).
            await fresh.send(askForIdMessage(app.applicantId)).catch((e) => console.error(`Asking ${app.threadId} for an ID failed:`, e));
            await syncRecruitmentEntry(fresh.client, app, fresh.url);
            return;
        }
        await announceWithId(fresh, app, app.viewerId.toString());
    } catch (e) {
        console.error(`Opening application ${thread.id} failed:`, e);
    }
}

/**
 * Scouts an application's trainer, stores the pace, posts the card (or why
 * there is none) in the post, updates the recruitment entry and tells staff.
 * Used once per application, when its ID first becomes known.
 */
async function announceWithId(thread: ThreadChannel, app: ClubApplication, viewerId: string): Promise<{ app: ClubApplication; outcome: ScoutOutcome }> {
    const outcome = await tryScout(viewerId);
    const updated = await prisma.clubApplication.update({
        where: { threadId: app.threadId },
        data: { viewerId: BigInt(viewerId), ...paceFields(outcome.report) },
    });
    await postCardInThread(thread, outcome, updated.tags).catch((e) => console.error(`Card for ${app.threadId} failed:`, e));
    await syncRecruitmentEntry(thread.client, updated, thread.url);
    await notifyStaff(thread.client, updated, thread, outcome);
    return { app: updated, outcome };
}

/**
 * Picks up a trainer ID the applicant sends in their post after being asked.
 * Only the applicant's own messages, and only while the application has no
 * ID. Needs the Message Content intent; without it the content is empty and
 * `/scout id:` in the post does the same. Never throws.
 */
export async function takeIdFromMessage(message: {
    author: { id: string; bot: boolean };
    content: string;
    channel: unknown;
}): Promise<void> {
    try {
        if (message.author.bot) return;
        const thread = message.channel as ThreadChannel;
        if (!thread || typeof (thread as { isThread?: () => boolean }).isThread !== 'function' || !thread.isThread() || !isApplicationThread(thread)) return;
        const app = await prisma.clubApplication.findUnique({ where: { threadId: thread.id } });
        if (!app || app.viewerId !== null || app.status !== 'OPEN' || message.author.id !== app.applicantId) return;
        const id = extractTrainerId(message.content);
        if (!id) return;
        await announceWithId(thread, app, id);
    } catch (e) {
        console.error('Reading a trainer ID from a message failed:', e);
    }
}

/**
 * Re-scouts an application, with a new trainer ID when given, and updates its
 * recruitment entry. Returns the outcome for the caller to show. When this
 * gives the application its first ID, staff are told, as when the ID comes
 * in a message.
 */
export async function rescoutApplication(thread: ThreadChannel, viewerId: string | null): Promise<{ app: ClubApplication; outcome: ScoutOutcome }> {
    const { app } = await ensureApplication(thread);
    const id = viewerId ?? app.viewerId?.toString() ?? null;
    if (id && app.viewerId === null && app.status === 'OPEN') return announceWithId(thread, app, id);
    const outcome = await tryScout(id);
    const updated = await prisma.clubApplication.update({
        where: { threadId: app.threadId },
        data: { viewerId: id ? BigInt(id) : null, ...paceFields(outcome.report) },
    });
    await syncRecruitmentEntry(thread.client, updated, thread.url);
    return { app: updated, outcome };
}

/** The decision message's Close button. */
export function closeRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Close post').setStyle(ButtonStyle.Secondary),
    );
}

/**
 * Records a decision, tags the post and locks it. `club` is null for
 * Rejected. Returns the updated application.
 */
export async function resolveApplication(
    thread: ThreadChannel,
    club: Pick<TrackedCircle, 'id' | 'name'> | null,
    actorId: string,
    note: string | null,
): Promise<ClubApplication> {
    const { app } = await ensureApplication(thread);
    let current = app;
    // A post from before this feature has no pace yet; the entry needs it.
    if (app.pace30 === null && app.pace3m === null && app.viewerId !== null) {
        const outcome = await tryScout(app.viewerId.toString());
        current = await prisma.clubApplication.update({ where: { threadId: app.threadId }, data: paceFields(outcome.report) });
    }
    const updated = await prisma.clubApplication.update({
        where: { threadId: current.threadId },
        data: {
            status: club ? 'ACCEPTED' : 'REJECTED',
            clubId: club?.id ?? null,
            clubName: club?.name ?? null,
            note,
            resolvedById: actorId,
            resolvedAt: new Date(),
        },
    });

    const rejected = rejectedTagId(thread);
    const accepted = TAG_ACCEPTED_ID || null;
    const tags = club ? withStatusTag(thread.appliedTags, accepted, [rejected]) : withStatusTag(thread.appliedTags, rejected, [accepted]);
    const reason = club ? `Accepted into ${club.name}` : 'Rejected';
    await thread.setAppliedTags(tags, reason).catch((e) => console.warn(`Tagging ${thread.id} failed:`, e instanceof Error ? e.message : e));
    await thread.setLocked(true, reason);
    await syncRecruitmentEntry(thread.client, updated, thread.url);
    return updated;
}

/** The decision message posted in the post. */
export function decisionMessage(app: ClubApplication): { content: string; components: ActionRowBuilder<ButtonBuilder>[]; allowedMentions: { users: string[] } } {
    const note = app.note ? `\n> ${app.note.split('\n').join('\n> ')}` : '';
    const content =
        app.status === 'ACCEPTED'
            ? `<@${app.applicantId}>, you have been accepted into **${app.clubName}**! Join the club in game, then press **Close post** below.${note}`
            : `<@${app.applicantId}>, this application was not accepted this time. Press **Close post** below when you have read this.${note}`;
    return { content, components: [closeRow()], allowedMentions: { users: [app.applicantId] } };
}

/**
 * Whether the applicant is now in the club's uma.moe circle: true or false
 * when it could be checked, null when it could not (club not tracked, no ID,
 * uma.moe down). uma.moe updates about once a day, so a fresh join can read
 * false.
 */
async function joinedOnUmaMoe(app: ClubApplication): Promise<boolean | null> {
    if (!app.clubId || app.viewerId === null || !isConfigured()) return null;
    const club = await prisma.trackedCircle.findUnique({ where: { id: app.clubId } });
    if (!club?.circleId) return null;
    try {
        const profile = await getProfile(app.viewerId.toString());
        if (!profile) return null;
        return BigInt(profile.circle?.circle_id ?? 0) === club.circleId;
    } catch {
        return null;
    }
}

/**
 * Closes a post: Accepted becomes Joined, Open becomes Withdrawn, Rejected
 * stays. The caller replies before archiving, since an archived post takes
 * no new messages. Returns the updated application and a line for the reply.
 */
export async function closeApplication(thread: ThreadChannel): Promise<{ app: ClubApplication; line: string }> {
    const { app } = await ensureApplication(thread);
    const status = app.status === 'ACCEPTED' ? 'JOINED' : app.status === 'OPEN' ? 'WITHDRAWN' : app.status;
    let line = 'Closing this post.';
    let note = app.note;
    if (app.status === 'ACCEPTED') {
        const joined = await joinedOnUmaMoe(app);
        line = `Welcome to **${app.clubName}**! Closing this post.`;
        if (joined === false) note = [app.note, 'Not in the club on uma.moe yet when closed (uma.moe updates daily).'].filter(Boolean).join('\n');
        if (joined === true) note = [app.note, 'Seen in the club on uma.moe.'].filter(Boolean).join('\n');
    }
    const updated = await prisma.clubApplication.update({ where: { threadId: app.threadId }, data: { status, note, closedAt: new Date() } });
    // The applicant's Discord is tied to their trainer only once the post
    // closes, and only to a trainer uma.moe knows (a name was found).
    if (updated.viewerId !== null && updated.trainerName !== null) {
        await linkApplicant(updated.guildId, updated.applicantId, updated.viewerId, updated.trainerName).catch((e) => console.error(`Linking ${updated.threadId} failed:`, e));
    }
    await syncRecruitmentEntry(thread.client, updated, thread.url);
    return { app: updated, line };
}

/** Locks and archives a post. Never throws. */
export async function archivePost(thread: ThreadChannel, reason: string): Promise<void> {
    try {
        if (!thread.locked) await thread.setLocked(true, reason);
        await thread.setArchived(true, reason);
    } catch (e) {
        console.warn(`Archiving ${thread.id} failed:`, e instanceof Error ? e.message : e);
    }
}
