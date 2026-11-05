import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { RARE_OPENERS, RARE_PING_OPENERS, RARE_OPENER_CHANCE } from './openers';

/**
 * Rare timer-ping openers: which have come up, how often, and who found each
 * first. Recorded when a ping with a rare opener is posted; shown by
 * `/timer specials` by name (never the line itself), with lines nobody has had
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

/** Every rare line, in list order, with its tally in a guild, or for one trainer when `discordUserId` is given. */
export async function rareTally(guildId: string, discordUserId?: string): Promise<RareTally[]> {
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, ...(discordUserId ? { discordUserId } : {}) }, orderBy: { at: 'asc' } });
    return RARE_OPENERS.map(({ name, text: opener }) => {
        const mine = hits.filter((h) => h.opener === opener);
        return { name, opener, count: mine.length, firstUserId: mine[0]?.discordUserId ?? null, firstAt: mine[0]?.at ?? null };
    });
}

/**
 * The `/timer specials` embed: three columns (the special's name, how many
 * times it came up, who found it first, or when for a trainer's own list),
 * one row per special. A special
 * nobody has had yet shows as "???". Names are short, so the columns stay
 * lined up.
 */
export function raresEmbed(tally: RareTally[], personal = false): EmbedBuilder {
    const found = tally.filter((t) => t.count > 0).length;
    const total = tally.reduce((sum, t) => sum + t.count, 0);
    const names = tally.map((t, i) => `**${i + 1}.** ${t.count > 0 ? t.name : '???'}`);
    const counts = tally.map((t) => (t.count > 0 ? `**×${t.count}**` : '—'));
    const when = (t: RareTally) => `<t:${Math.floor(t.firstAt!.getTime() / 1000)}:R>`;
    const firsts = tally.map((t) => (t.count > 0 && t.firstUserId && t.firstAt ? (personal ? when(t) : `<@${t.firstUserId}> ${when(t)}`) : '—'));
    const pings = `${total} special ping${total === 1 ? '' : 's'}`;
    return new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(personal ? `Your specials: ${found} of ${tally.length}` : `Specials found: ${found} of ${tally.length}`)
        .addFields(
            { name: 'Special', value: names.join('\n').slice(0, 1024), inline: true },
            { name: 'Times', value: counts.join('\n').slice(0, 1024), inline: true },
            { name: personal ? 'First got' : 'First found by', value: firsts.join('\n').slice(0, 1024), inline: true },
        )
        .setFooter({
            text: `${personal ? `${pings} for you so far` : `${pings} on the server so far`}. Each ping has a ${Math.round(RARE_OPENER_CHANCE * 100)}% chance of a special line.`,
        });
}

/** The "Read a special" menu's custom ID; `index.ts` routes it to `handleSpecialRead`. */
export const READ_MENU_ID = 'timer:specials:read';

/**
 * A menu of the specials in `tally` that were found (a trainer's own tally:
 * those they unlocked), to read in full. Null when none are. Each option's
 * value is the special's place in `RARE_OPENERS`.
 */
export function readMenuRow(tally: RareTally[]): ActionRowBuilder<StringSelectMenuBuilder> | null {
    const options = tally
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.count > 0)
        .slice(0, 25)
        .map(({ t, i }) => ({ label: `${i + 1}. ${t.name}`.slice(0, 100), value: String(i) }));
    if (options.length === 0) return null;
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(READ_MENU_ID).setPlaceholder('Read a special').addOptions(options),
    );
}

/**
 * A special's full text for a trainer who unlocked it, with the mention
 * filled in as them, or null when they have not (or the choice is not a
 * special). Checked against their own finds, so a forged choice cannot
 * reveal a line they have not had.
 */
export async function readSpecial(guildId: string, discordUserId: string, choice: string): Promise<{ name: string; text: string } | null> {
    const index = Number(choice);
    const special = Number.isInteger(index) ? RARE_OPENERS[index] : undefined;
    if (!special) return null;
    const found = await prisma.rareOpenerHit.findFirst({ where: { guildId, discordUserId, opener: special.text } });
    if (!found) return null;
    return { name: special.name, text: special.text.replace('{user}', `<@${discordUserId}>`) };
}

/** The embed showing one special in full. */
export function specialEmbed(special: { name: string; text: string }): EmbedBuilder {
    return new EmbedBuilder().setColor(0xf2a87a).setTitle(special.name).setDescription(special.text);
}
