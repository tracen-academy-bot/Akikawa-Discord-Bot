import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type GuildMember } from 'discord.js';
import { prisma } from '../db/prisma';

/**
 * The bot's own take on Discord's system messages, in the voice of the
 * academy's chairwoman, Yayoi Akikawa: short, emphatic declarations, each
 * opened by a bold word.
 *
 *   - Welcome: when someone joins, a greeting picked at random, posted in
 *     the channel set with `/welcome`, pinging only the newcomer.
 *   - Say hi: a button under the welcome. Each member who presses it posts
 *     a line greeting the newcomer, once per welcome. (Discord's own
 *     "wave with a sticker" prompt is not available to bots.)
 *   - Boosts: a thank-you in the same channel when a member starts boosting.
 *     Discord tells bots when a member begins boosting, not when someone
 *     already boosting adds another, so only the first boost is thanked.
 *
 * Bots are never welcomed. Join and boost events need the Server Members
 * intent; without it nothing is posted.
 *
 * Welcome texts take placeholders:
 *
 *   {user}    the new member, as a mention
 *   {server}  the server's name
 *   {count}   the member count, so the newcomer is "trainer #{count}"
 *   {apply}   the club application forum (FORUM_CHANNEL_ID)
 *   {clubs}   the channel the club directory is posted in
 */

/** The built-in welcomes, one picked at random. */
export const DEFAULT_WELCOMES: readonly string[] = [
    '**Welcome!** {user}, I, Chairwoman Akikawa, welcome you to **{server}**! You are trainer #{count}!\n\n' +
        '**Instruction!** Find your club! Read about ours in {clubs}, then open a post in {apply} with your trainer ID, ' +
        'the number on your in-game Trainer Card!\n\n' +
        '**Expectation!** Train hard, run your best, and let your Umamusume shine! This academy is counting on you!',
    '**Arrival!** {user} has entered **{server}**! Trainer #{count}, your journey begins today!\n\n' +
        '**Directive!** Survey our clubs in {clubs}! When one calls to you, apply in {apply} with your trainer ID!\n\n' +
        '**Resolve!** The track is long, but every champion started exactly here!',
    '**Splendid!** A new trainer stands at our gates! {user}, welcome to **{server}**, as trainer #{count}!\n\n' +
        '**Guidance!** Our clubs await in {clubs}. Choose well, then post in {apply} with your trainer ID!\n\n' +
        '**Encouragement!** I have high hopes for you! Do not disappoint the academy!',
    '**Approved!** {user}, your enrollment at **{server}** is accepted! You are trainer #{count}!\n\n' +
        '**Next!** Read about our clubs in {clubs}, then apply in {apply} with the trainer ID on your Trainer Card!\n\n' +
        '**Spirit!** Run with all your heart! The academy welcomes you with open arms!',
];

/** The built-in welcomes as one text, variants split by `---` lines, for the edit form. */
export const DEFAULT_WELCOME = DEFAULT_WELCOMES.join('\n---\n');

/** Built-in boost thank-yous; {user} is the booster, {server} the server. */
export const BOOST_LINES: readonly string[] = [
    '**Gratitude!** {user} has boosted **{server}**! The academy thanks you for your generous support!',
    '**Magnificent!** {user} has boosted **{server}**! Your contribution will not be forgotten!',
    '**Outstanding!** Thanks to {user}, **{server}** grows stronger! The chairwoman salutes you!',
];

/** Lines a member's "Say hi!" posts; {from} waves to {to}. */
export const WAVE_LINES: readonly string[] = [
    '**Friendship!** {from} waves hello to {to}!',
    '**Camaraderie!** {from} welcomes {to} to the academy!',
    '**Warmth!** {from} greets {to}! Welcome, welcome!',
];

/** Longest welcome text accepted (all variants together), well inside a modal's 4000. */
export const WELCOME_MAX_LENGTH = 3800;

/** What the placeholders stand for. */
export interface WelcomeContext {
    userId: string;
    serverName: string;
    memberCount: number;
    /** The application forum's channel ID, if known. */
    applyChannelId: string | null;
    /** The club directory's channel ID, if posted. */
    clubsChannelId: string | null;
}

/** A text's variants: split at lines of just `---`, blanks dropped. */
export function welcomeVariants(text: string): string[] {
    return text
        .split(/^\s*---\s*$/m)
        .map((v) => v.trim())
        .filter(Boolean);
}

/** One item at random. `random` is injectable for tests. */
export function pick<T>(items: readonly T[], random: () => number = Math.random): T {
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/** Fills in a welcome text's placeholders. Unknown placeholders are left as written. */
export function renderWelcome(template: string, ctx: WelcomeContext): string {
    const values: Record<string, string> = {
        user: `<@${ctx.userId}>`,
        server: ctx.serverName,
        count: ctx.memberCount.toLocaleString('en-US'),
        apply: ctx.applyChannelId ? `<#${ctx.applyChannelId}>` : 'the club application forum',
        clubs: ctx.clubsChannelId ? `<#${ctx.clubsChannelId}>` : 'the club list',
    };
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key.toLowerCase()] ?? whole);
}

/** Custom ID prefix of the "Say hi!" button; the newcomer's ID follows. */
const WAVE_PREFIX = 'welcome:wave:';

/** True for a "Say hi!" button. */
export function isWaveButton(customId: string): boolean {
    return customId.startsWith(WAVE_PREFIX);
}

/** The newcomer a "Say hi!" button greets. */
export function waveTarget(customId: string): string {
    return customId.slice(WAVE_PREFIX.length);
}

/**
 * The welcome as a message: a ping that notifies, the text in an embed,
 * and the "Say hi!" button when `wave` is on. `text` may hold several
 * variants; one is picked.
 */
export function welcomePayload(text: string, ctx: WelcomeContext, avatarUrl: string | null, wave = false, random: () => number = Math.random) {
    const variants = welcomeVariants(text);
    const chosen = variants.length > 0 ? pick(variants, random) : pick(DEFAULT_WELCOMES, random);
    const embed = new EmbedBuilder().setColor(0xf2a87a).setDescription(renderWelcome(chosen, ctx).slice(0, 4096));
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    const components = wave
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${WAVE_PREFIX}${ctx.userId}`).setLabel('Say hi!').setStyle(ButtonStyle.Primary))]
        : [];
    return {
        content: `<@${ctx.userId}>`,
        embeds: [embed],
        components,
        // Only the newcomer is pinged, whatever the text mentions.
        allowedMentions: { users: [ctx.userId] },
    };
}

/** A "Say hi!" line; mentions show but ping nobody. */
export function wavePayload(fromId: string, toId: string, random: () => number = Math.random) {
    return {
        content: pick(WAVE_LINES, random).replace('{from}', `<@${fromId}>`).replace('{to}', `<@${toId}>`),
        allowedMentions: { parse: [] as never[] },
    };
}

/** A boost thank-you; pings the booster only. */
export function boostPayload(userId: string, serverName: string, random: () => number = Math.random) {
    return {
        content: pick(BOOST_LINES, random).replace('{user}', `<@${userId}>`).replace('{server}', serverName),
        allowedMentions: { users: [userId] },
    };
}

/** True when a member update is a member starting to boost. */
export function startedBoosting(before: { premiumSinceTimestamp: number | null }, after: { premiumSinceTimestamp: number | null }): boolean {
    return before.premiumSinceTimestamp === null && after.premiumSinceTimestamp !== null;
}

/** The placeholders' values for a member of a guild. */
export async function welcomeContext(member: GuildMember): Promise<WelcomeContext> {
    const directory = await prisma.clubDirectory.findUnique({ where: { guildId: member.guild.id } });
    return {
        userId: member.id,
        serverName: member.guild.name,
        memberCount: member.guild.memberCount,
        applyChannelId: process.env.FORUM_CHANNEL_ID?.trim() || null,
        clubsChannelId: directory?.channelId ?? null,
    };
}

/** The welcome channel of a guild, when welcomes are on and it can be posted in. */
async function welcomeChannel(member: GuildMember) {
    const settings = await prisma.welcomeSettings.findUnique({ where: { guildId: member.guild.id } });
    if (!settings?.channelId) return null;
    const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
    if (!channel?.isSendable()) {
        console.warn(`Welcome channel ${settings.channelId} in ${member.guild.name} is missing or not sendable.`);
        return null;
    }
    return { settings, channel };
}

/** Posts the welcome for a new member, if welcomes are on. Never throws. */
export async function welcomeMember(member: GuildMember): Promise<void> {
    try {
        if (member.user.bot) return;
        const found = await welcomeChannel(member);
        if (!found) return;
        const { settings, channel } = found;
        await channel.send(welcomePayload(settings.message ?? DEFAULT_WELCOME, await welcomeContext(member), member.displayAvatarURL({ size: 256 }), settings.wave));
    } catch (e) {
        console.error(`Welcoming ${member.id} failed:`, e);
    }
}

/** Thanks a member who started boosting, if welcomes and boost thank-yous are on. Never throws. */
export async function thankBooster(member: GuildMember): Promise<void> {
    try {
        if (member.user.bot) return;
        const found = await welcomeChannel(member);
        if (!found || !found.settings.boosts) return;
        await found.channel.send(boostPayload(member.id, member.guild.name));
    } catch (e) {
        console.error(`Thanking booster ${member.id} failed:`, e);
    }
}

/** Who has waved under which welcome, so each member waves once. Kept in memory: a restart forgets. */
const waved = new Map<string, Set<string>>();

/** Most welcomes remembered for waves; the oldest are forgotten first. */
const WAVE_MEMORY = 500;

/**
 * Records that `fromId` waved under welcome `messageId`. False when they
 * already had.
 */
export function recordWave(messageId: string, fromId: string): boolean {
    let who = waved.get(messageId);
    if (!who) {
        who = new Set();
        waved.set(messageId, who);
        if (waved.size > WAVE_MEMORY) waved.delete(waved.keys().next().value!);
    }
    if (who.has(fromId)) return false;
    who.add(fromId);
    return true;
}
