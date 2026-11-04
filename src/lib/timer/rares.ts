import { EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { RARE_OPENERS, RARE_PING_OPENERS, RARE_OPENER_CHANCE } from './openers';

/**
 * Rare timer-ping openers: which have come up, how often, and who found each
 * first. Recorded when a ping with a rare opener is posted; shown by
 * `/timer rares` by name (never the line itself), with lines nobody has had
 * yet as "???".
 */

/** True when `opener` (a template, with `{user}`) is one of the rare lines. */
export function isRareOpener(opener: string): boolean {
    return RARE_PING_OPENERS.includes(opener);
}

/** Records that `discordUserId` got the rare `opener`. Never throws. */
export async function recordRareOpener(guildId: string, discordUserId: string, opener: string): Promise<void> {
    try {
        await prisma.rareOpenerHit.create({ data: { guildId, discordUserId, opener } });
    } catch (e) {
        console.error('Recording a rare opener failed:', e);
    }
}

/** One rare line's tally. */
export interface RareTally {
    /** The line's name, shown instead of the line itself. */
    name: string;
    opener: string;
    count: number;
    firstUserId: string | null;
    firstAt: Date | null;
}

/** Every rare line, in list order, with its tally in a guild. */
export async function rareTally(guildId: string): Promise<RareTally[]> {
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId }, orderBy: { at: 'asc' } });
    return RARE_OPENERS.map(({ name, text: opener }) => {
        const mine = hits.filter((h) => h.opener === opener);
        return { name, opener, count: mine.length, firstUserId: mine[0]?.discordUserId ?? null, firstAt: mine[0]?.at ?? null };
    });
}

/** The `/timer rares` embed. */
export function raresEmbed(tally: RareTally[]): EmbedBuilder {
    const found = tally.filter((t) => t.count > 0).length;
    const total = tally.reduce((sum, t) => sum + t.count, 0);
    const lines = tally.map((t, i) =>
        t.count > 0 && t.firstUserId && t.firstAt
            ? `**${i + 1}.** ${t.name} · ×${t.count} · first: <@${t.firstUserId}> <t:${Math.floor(t.firstAt.getTime() / 1000)}:R>`
            : `**${i + 1}.** ???`,
    );
    return new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(`Rare lines found: ${found} of ${tally.length}`)
        .setDescription(lines.join('\n').slice(0, 4096))
        .setFooter({ text: `${total} rare ping${total === 1 ? '' : 's'} so far. Each ping has a ${Math.round(RARE_OPENER_CHANCE * 100)}% chance of a rare line.` });
}
