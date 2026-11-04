import { EmbedBuilder, type GuildMember } from 'discord.js';
import { prisma } from '../db/prisma';

/**
 * The welcome message for new members.
 *
 * When someone joins the server, the bot posts in the channel set with
 * `/welcome`: a ping, then an embed with the welcome text and their avatar.
 * Bots are not welcomed. Needs the Server Members intent, which delivers
 * join events; without it nothing is posted.
 *
 * The text takes placeholders:
 *
 *   {user}    the new member, as a mention
 *   {server}  the server's name
 *   {count}   the member count, so the newcomer is "member #{count}"
 *   {apply}   the club application forum (FORUM_CHANNEL_ID)
 *   {clubs}   the channel the club directory is posted in
 */

/**
 * The text used until one is set, in the voice of the academy's chairwoman,
 * Yayoi Akikawa: short, emphatic declarations, each opened by a bold word,
 * the way she addresses her trainers.
 */
export const DEFAULT_WELCOME =
    '**Welcome!** {user}, I, Chairwoman Akikawa, welcome you to **{server}**! You are trainer #{count}!\n\n' +
    '**Instruction!** Find your club! Read about ours in {clubs}, then open a post in {apply} with your trainer ID, ' +
    'the number on your in-game Trainer Card!\n\n' +
    '**Expectation!** Train hard, run your best, and let your Umamusume shine! This academy is counting on you!';

/** Longest welcome text accepted, well inside an embed's 4096 characters. */
export const WELCOME_MAX_LENGTH = 2000;

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

/** The welcome as a message: a ping that notifies, and the text in an embed. */
export function welcomePayload(template: string, ctx: WelcomeContext, avatarUrl: string | null) {
    const embed = new EmbedBuilder().setColor(0xf2a87a).setDescription(renderWelcome(template, ctx).slice(0, 4096));
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return {
        content: `<@${ctx.userId}>`,
        embeds: [embed],
        // Only the newcomer is pinged, whatever the text mentions.
        allowedMentions: { users: [ctx.userId] },
    };
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

/** Posts the welcome for a new member, if welcomes are on. Never throws. */
export async function welcomeMember(member: GuildMember): Promise<void> {
    try {
        if (member.user.bot) return;
        const settings = await prisma.welcomeSettings.findUnique({ where: { guildId: member.guild.id } });
        if (!settings?.channelId) return;
        const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
        if (!channel?.isSendable()) {
            console.warn(`Welcome channel ${settings.channelId} in ${member.guild.name} is missing or not sendable.`);
            return;
        }
        await channel.send(welcomePayload(settings.message ?? DEFAULT_WELCOME, await welcomeContext(member), member.displayAvatarURL({ size: 256 })));
    } catch (e) {
        console.error(`Welcoming ${member.id} failed:`, e);
    }
}
