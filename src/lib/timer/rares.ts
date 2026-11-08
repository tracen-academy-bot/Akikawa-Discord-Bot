import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getUserSettings } from './userSettings';
import { prisma } from '../../db/prisma';
import { PING_OPENERS, RARE_OPENERS, RARE_PING_OPENERS, RARE_OPENER_CHANCE, SPECIAL_LOCKS, SPECIAL_SETS, boostOf, fillOpener, pickOpener } from './openers';

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
    /** The id of the special's set. */
    set: string;
    count: number;
    firstUserId: string | null;
    firstAt: Date | null;
}

/** Every rare line, in list order, with its tally in a guild, or for one trainer when `discordUserId` is given. */
export async function rareTally(guildId: string, discordUserId?: string): Promise<RareTally[]> {
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, ...(discordUserId ? { discordUserId } : {}) }, orderBy: { at: 'asc' } });
    return RARE_OPENERS.map(({ name, text: opener, set }) => {
        const mine = hits.filter((h) => h.opener === opener);
        return { name, opener, set, count: mine.length, firstUserId: mine[0]?.discordUserId ?? null, firstAt: mine[0]?.at ?? null };
    });
}

/** What a trainer's own Specials pages add: their locks, sets turned off, and boosts. */
export interface PersonalExtras {
    lockedSets: readonly string[];
    disabledSets: readonly string[];
    boosts: readonly ActiveBoost[];
    /** False when the trainer turned Boosts off. */
    boostsOn: boolean;
}

/** Custom ID prefix of the Specials Back/Next buttons: `<prefix><mine|all>:<page>`. */
export const SPECIALS_PAGE_PREFIX = 'timer:specials:page:';

/** Custom ID prefix of the On/Off button on a trainer's Specials page: `<prefix><set id>`. */
export const SPECIALS_SET_PREFIX = 'timer:specials:set:';

/** The "Read a special" menu's custom ID; `index.ts` routes it to `handleSpecialRead`. */
export const READ_MENU_ID = 'timer:specials:read';

/**
 * One page of the Specials list: one set per page, with Back and Next.
 *
 *   - Three columns (the special's name, how many times it came up, who
 *     found it first, or when for a trainer's own list), one row per
 *     special, numbered within the set. A special not found yet is "???".
 *   - On a trainer's own page (`extras` given): the set's On/Off button,
 *     greyed out and "Locked" while the set is locked (its rows are then
 *     hidden), and a menu to read the specials they found in this set.
 *   - The footer has the ping count, the base chance, the trainer's boosts,
 *     and the page number.
 *
 * `page` is clamped to the sets there are. Never shows a line's text.
 */
export function specialsView(tally: RareTally[], page: number, extras?: PersonalExtras) {
    const personal = extras !== undefined;
    const p = Math.max(0, Math.min(SPECIAL_SETS.length - 1, Number.isInteger(page) ? page : 0));
    const set = SPECIAL_SETS[p]!;
    const rows = tally.map((t, i) => ({ t, i })).filter(({ t }) => t.set === set.id);
    const found = tally.filter((t) => t.count > 0).length;
    const foundHere = rows.filter(({ t }) => t.count > 0).length;
    const total = tally.reduce((sum, t) => sum + t.count, 0);
    const locked = extras?.lockedSets.includes(set.id) ?? false;
    const off = extras?.disabledSets.includes(set.id) ?? false;

    const status = locked ? `\nLocked: find **${set.requires ?? 'its special'}** to open it.` : off ? '\nOff: these never come up for you.' : '';
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(personal ? `Your specials: ${found} of ${tally.length}` : `Specials found: ${found} of ${tally.length}`)
        .setDescription(`**${set.name}**: ${foundHere} of ${rows.length} found${status}`);
    if (!locked) {
        const when = (t: RareTally) => `<t:${Math.floor(t.firstAt!.getTime() / 1000)}:R>`;
        const names = rows.map(({ t }, n) => `**${n + 1}.** ${t.count > 0 ? t.name : '???'}`);
        const counts = rows.map(({ t }) => (t.count > 0 ? `**×${t.count}**` : '—'));
        const firsts = rows.map(({ t }) => (t.count > 0 && t.firstUserId && t.firstAt ? (personal ? when(t) : `<@${t.firstUserId}> ${when(t)}`) : '—'));
        embed.addFields(
            { name: 'Special', value: names.join('\n').slice(0, 1024), inline: true },
            { name: 'Times', value: counts.join('\n').slice(0, 1024), inline: true },
            { name: personal ? 'First got' : 'First found by', value: firsts.join('\n').slice(0, 1024), inline: true },
        );
    }

    const pings = `${total} special ping${total === 1 ? '' : 's'}`;
    const footer = [`${personal ? `${pings} for you so far` : `${pings} on the server so far`}. Each ping has a ${Math.round(RARE_OPENER_CHANCE * 100)}% chance of a special line.`];
    for (const b of extras?.boosts ?? []) {
        const boostSet = SPECIAL_SETS.find((s) => s.id === b.setId);
        const boost = boostSet?.openers.find((o) => o.boost)?.boost;
        if (!boostSet || !boost) continue;
        footer.push(`Boost: +${Math.round(boost.chance * 100)}% ${boostSet.name} for ${b.runsLeft} more run${b.runsLeft === 1 ? '' : 's'}${extras!.boostsOn ? '' : ' (paused: Boosts are off)'}.`);
    }
    footer.push(`Page ${p + 1} of ${SPECIAL_SETS.length}`);
    embed.setFooter({ text: footer.join('\n') });

    const mode = personal ? 'mine' : 'all';
    const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${p - 1}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    );
    if (personal) {
        nav.addComponents(
            new ButtonBuilder()
                .setCustomId(`${SPECIALS_SET_PREFIX}${set.id}`)
                .setLabel(`${set.name}: ${locked ? 'Locked' : off ? 'Off' : 'On'}`)
                .setStyle(!locked && !off ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(locked),
        );
    }
    nav.addComponents(
        new ButtonBuilder()
            .setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${p + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(p >= SPECIAL_SETS.length - 1),
    );
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [nav];
    // Reading in full is for a trainer's own finds, a set's worth at a time.
    const options = personal
        ? rows.map(({ t, i }, n) => ({ t, i, n })).filter(({ t }) => t.count > 0).slice(0, 25).map(({ t, i, n }) => ({ label: `${n + 1}. ${t.name}`.slice(0, 100), value: String(i) }))
        : [];
    if (options.length > 0) {
        components.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId(READ_MENU_ID).setPlaceholder(`Read a special from ${set.name}`).addOptions(options),
            ),
        );
    }
    return { embeds: [embed], components };
}

/** A trainer's own Specials page `page`, from the database. */
export async function mySpecialsView(guildId: string, discordUserId: string, page: number) {
    const [tally, lockedSets, boosts, settings] = await Promise.all([
        rareTally(guildId, discordUserId),
        lockedSetsFor(guildId, discordUserId),
        activeBoosts(guildId, discordUserId),
        getUserSettings(guildId, discordUserId),
    ]);
    return specialsView(tally, page, { lockedSets, disabledSets: settings.disabledSets, boosts, boostsOn: settings.boosts });
}

/** The page of `setId` in the Specials list, or 0. */
export function pageOfSet(setId: string): number {
    return Math.max(0, SPECIAL_SETS.findIndex((s) => s.id === setId));
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
    return { name: special.name, text: fillOpener(special.text, discordUserId) };
}

/** The embed showing one special in full. */
export function specialEmbed(special: { name: string; text: string }): EmbedBuilder {
    return new EmbedBuilder().setColor(0xf2a87a).setTitle(special.name).setDescription(special.text);
}

/** The locks still on: their special, owner and owner's chance, while the owner has not found it. */
async function activeLocks(guildId: string): Promise<{ text: string; owner: string; ownerChance: number }[]> {
    const active: { text: string; owner: string; ownerChance: number }[] = [];
    for (const lock of SPECIAL_LOCKS) {
        const text = RARE_OPENERS.find((o) => o.name === lock.name)?.text;
        if (!text) continue;
        const ownerHasIt = await prisma.rareOpenerHit.findFirst({ where: { guildId, discordUserId: lock.owner, opener: text } });
        if (!ownerHasIt) active.push({ text, owner: lock.owner, ownerChance: lock.ownerChance });
    }
    return active;
}

/**
 * The sets still locked for a trainer: those whose `requires` special they
 * have not found.
 */
export async function lockedSetsFor(guildId: string, discordUserId: string): Promise<string[]> {
    const gated = SPECIAL_SETS.filter((s) => s.requires);
    if (gated.length === 0) return [];
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, discordUserId }, select: { opener: true } });
    const found = new Set(hits.map((h) => h.opener));
    return gated
        .filter((s) => {
            const text = RARE_OPENERS.find((o) => o.name === s.requires)?.text;
            return !text || !found.has(text);
        })
        .map((s) => s.id);
}

/** A set boost a trainer holds. */
export interface ActiveBoost {
    setId: string;
    runsLeft: number;
}

/** A trainer's set boosts with runs left. */
export async function activeBoosts(guildId: string, discordUserId: string): Promise<ActiveBoost[]> {
    const rows = await prisma.timerSpecialBoost.findMany({ where: { guildId, discordUserId, runsLeft: { gt: 0 } } });
    return rows.map((r) => ({ setId: r.setId, runsLeft: r.runsLeft }));
}

/** Uses up one run of each of a trainer's set boosts; a boost at zero is removed. */
export async function spendBoosts(guildId: string, discordUserId: string): Promise<void> {
    await prisma.timerSpecialBoost.updateMany({ where: { guildId, discordUserId, runsLeft: { gt: 0 } }, data: { runsLeft: { decrement: 1 } } });
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId, discordUserId, runsLeft: { lte: 0 } } });
}

/** Gives a trainer the boost `opener` grants, if it grants one, with its full run count. */
export async function grantBoost(guildId: string, discordUserId: string, opener: string): Promise<boolean> {
    const granted = boostOf(opener);
    if (!granted) return false;
    const runsLeft = granted.boost.runs;
    await prisma.timerSpecialBoost.upsert({
        where: { guildId_discordUserId_setId: { guildId, discordUserId, setId: granted.set } },
        create: { guildId, discordUserId, setId: granted.set, runsLeft },
        update: { runsLeft },
    });
    return true;
}

/** An extra slice of special chance on one ping, drawn evenly from `pool`. */
export interface ExtraChance {
    chance: number;
    pool: readonly string[];
}

/**
 * Picks a trainer's ping opener from one random number `r` and `pool` (the
 * specials in their enabled, unlocked sets), applying `extras` (boosts) and
 * `SPECIAL_LOCKS`.
 *
 * The range of `r` is cut in order:
 *
 *   - one slice per extra, of width `chance`, each picking evenly from its
 *     own pool (an extra whose pool is empty gets no slice);
 *   - then the usual special share, `RARE_OPENER_CHANCE` (4%);
 *   - then the common lines.
 *
 * So the chances add: with extras $c_1, \dots, c_k$, a ping is special with
 * probability $c_1 + \dots + c_k + 0.04$. Within the usual 4%, the locks work
 * as before:
 *
 *   - a locked special is out of everyone's pool but its owner's, so the
 *     4% is spread evenly over the rest;
 *   - the owner gets it below `ownerChance` (2%), and the rest of the 4% is
 *     spread evenly over the other specials.
 *
 * A locked special never comes up from an extra.
 */
export async function chooseOpener(
    guildId: string,
    discordUserId: string,
    r: number,
    pool: readonly string[],
    extras: readonly ExtraChance[] = [],
): Promise<string> {
    const locks = await activeLocks(guildId);
    const locked = locks.map((l) => l.text);

    const slices = extras.map((e) => ({ chance: e.chance, pool: e.pool.filter((t) => !locked.includes(t)) })).filter((e) => e.chance > 0 && e.pool.length > 0);
    let start = 0;
    for (const slice of slices) {
        if (r < start + slice.chance) {
            const share = (r - start) / slice.chance;
            return slice.pool[Math.min(slice.pool.length - 1, Math.floor(share * slice.pool.length))]!;
        }
        start += slice.chance;
    }
    // Past the extras: map what is left back onto [0, 1), keeping the usual
    // 4% exactly 4% wide and stretching only the common part.
    const p = RARE_OPENER_CHANCE;
    const u = r - start;
    const rest = u < p ? u : p + ((u - p) * (1 - p)) / (1 - start - p);

    const others = pool.filter((t) => !locked.includes(t));
    const mine = locks.find((l) => l.owner === discordUserId);
    if (mine && rest < p) {
        if (rest < mine.ownerChance) return mine.text;
        if (others.length === 0) return pickCommon(() => (rest - mine.ownerChance) / (p - mine.ownerChance));
        const share = (rest - mine.ownerChance) / (p - mine.ownerChance);
        return others[Math.min(others.length - 1, Math.floor(share * others.length))]!;
    }
    return pickOpener(rest, others);
}

/** A common opener at random, for when a locked special has no other special to become. */
function pickCommon(random: () => number): string {
    return PING_OPENERS[Math.min(PING_OPENERS.length - 1, Math.floor(random() * PING_OPENERS.length))]!;
}
