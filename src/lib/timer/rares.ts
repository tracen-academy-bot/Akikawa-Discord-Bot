import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getUserSettings } from './userSettings';
import { prisma } from '../../db/prisma';
import { COMMON_NO_REPEAT, PING_OPENERS, RARE_OPENERS, closedSpecials, redirectOpener, RARE_PING_OPENERS, RARE_OPENER_CHANCE, effectiveChance, SPECIAL_LOCKS, SPECIAL_SETS, boostOf, fillOpener, pickOpener, specialById, specialIdOf, specialMediaPath } from './openers';

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

/**
 * Records that `discordUserId` got the rare `opener` (its current text): the
 * special's id, which every lookup uses, and the text as posted, for
 * history. Never throws.
 */
export async function recordRareOpener(guildId: string, discordUserId: string, opener: string): Promise<void> {
    try {
        await prisma.rareOpenerHit.create({ data: { guildId, discordUserId, opener, specialId: specialIdOf(opener) ?? null } });
    } catch (e) {
        console.error('Recording a rare opener failed:', e);
    }
}

/** One rare line's tally. */
export interface RareTally {
    /** The special's stable id. */
    id: string;
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
    return RARE_OPENERS.map(({ id, name, text: opener, set }) => {
        const mine = hits.filter((h) => h.specialId === id);
        return { id, name, opener, set, count: mine.length, firstUserId: mine[0]?.discordUserId ?? null, firstAt: mine[0]?.at ?? null };
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

/** The page the Specials list opens on: Set 1, the first special set. Page 0 is Set 0, the reminders. */
export const SPECIALS_FIRST_PAGE = 1;

/** How many pages the Specials list has: Set 0 (the reminders) and one per special set. */
const PAGE_COUNT = SPECIAL_SETS.length + 1;

/** A page's heading: "Set <n>: <name>". */
function pageTitle(page: number): string {
    return page === 0 ? 'Set 0: Reminders' : `Set ${page}: ${SPECIAL_SETS[page - 1]!.name}`;
}

/** The Back/Next row of a Specials page, with `middle` (the set's toggle) between them. */
function navRow(mode: 'mine' | 'all', page: number, middle?: ButtonBuilder): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${page - 1}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    );
    if (middle) row.addComponents(middle);
    return row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${page + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= PAGE_COUNT - 1),
    );
}

/**
 * Set 0: the usual ping lines, in full (they are not secret), with the
 * mention shown as "@trainer". Always on; nothing to find or turn off.
 */
function remindersPage(mode: 'mine' | 'all', footerHead: string) {
    const lines = PING_OPENERS.map((o, n) => `**${n + 1}.** ${o.replaceAll('{user}', '@trainer')}`);
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(pageTitle(0))
        .setDescription(['The usual ping lines. Always on.', '', ...lines].join('\n').slice(0, 4096))
        .setFooter({ text: `${footerHead}\nPage 1 of ${PAGE_COUNT}` });
    return { embeds: [embed], components: [navRow(mode, 0)] as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] };
}

/**
 * One page of the Specials list: Set 0 (the reminders), then one special
 * set per page, with Back and Next.
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
 * `page` is clamped to the pages there are. Never shows a special's text.
 */
export function specialsView(tally: RareTally[], page: number, extras?: PersonalExtras) {
    const personal = extras !== undefined;
    const mode = personal ? 'mine' : 'all';
    const pg = Math.max(0, Math.min(PAGE_COUNT - 1, Number.isInteger(page) ? page : SPECIALS_FIRST_PAGE));
    const total = tally.reduce((sum, t) => sum + t.count, 0);
    const pings = `${total} special ping${total === 1 ? '' : 's'}`;
    const tallyLine = `${personal ? `${pings} for you so far` : `${pings} on the server so far`}.`;
    if (pg === 0) return remindersPage(mode, tallyLine);
    const p = pg - 1;
    const set = SPECIAL_SETS[p]!;
    const rows = tally.map((t, i) => ({ t, i })).filter(({ t }) => t.set === set.id);
    const found = tally.filter((t) => t.count > 0).length;
    const foundHere = rows.filter(({ t }) => t.count > 0).length;
    const locked = extras?.lockedSets.includes(set.id) ?? false;
    const off = extras?.disabledSets.includes(set.id) ?? false;

    const status = locked ? `\nLocked: find **${(set.requires && specialById(set.requires)?.name) ?? 'its special'}** to open it.` : off ? '\nOff: these never come up for you.' : '';
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(personal ? `Your specials: ${found} of ${tally.length}` : `Specials found: ${found} of ${tally.length}`)
        .setDescription(`**${pageTitle(pg)}**: ${foundHere} of ${rows.length} found${status}`);
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

    const footer = [`${tallyLine} Each ping has a ${Math.round(RARE_OPENER_CHANCE * 100)}% chance of a special line.`];
    for (const b of extras?.boosts ?? []) {
        const boostSet = SPECIAL_SETS.find((s) => s.id === b.setId);
        const boost = boostSet?.openers.find((o) => o.boost)?.boost;
        if (!boostSet || !boost) continue;
        footer.push(`Boost: +${Math.round(boost.chance * 100)}% ${boostSet.name} for ${b.runsLeft} more run${b.runsLeft === 1 ? '' : 's'}${extras!.boostsOn ? '' : ' (paused: Boosts are off)'}.`);
    }
    footer.push(`Page ${pg + 1} of ${PAGE_COUNT}`);
    embed.setFooter({ text: footer.join('\n') });

    const toggle = personal
        ? new ButtonBuilder()
              .setCustomId(`${SPECIALS_SET_PREFIX}${set.id}`)
              .setLabel(`${set.name}: ${locked ? 'Locked' : off ? 'Off' : 'On'}`)
              .setStyle(!locked && !off ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(locked)
        : undefined;
    const nav = navRow(mode, pg, toggle);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [nav];
    // Reading in full is for a trainer's own finds, a set's worth at a time.
    const options = personal
        ? rows.map(({ t, i }, n) => ({ t, i, n })).filter(({ t }) => t.count > 0).slice(0, 25).map(({ t, n }) => ({ label: `${n + 1}. ${t.name}`.slice(0, 100), value: t.id }))
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

/** The page of `setId` in the Specials list (Set 1 is page 1), or the first page. */
export function pageOfSet(setId: string): number {
    const i = SPECIAL_SETS.findIndex((s) => s.id === setId);
    return i === -1 ? SPECIALS_FIRST_PAGE : i + 1;
}

/**
 * A special's full text for a trainer who unlocked it, with the mention
 * filled in as them, or null when they have not (or the choice is not a
 * special). Checked against their own finds, so a forged choice cannot
 * reveal a line they have not had.
 */
export async function readSpecial(guildId: string, discordUserId: string, choice: string): Promise<{ name: string; text: string; media: string | null; credit: string | null } | null> {
    const special = specialById(choice);
    if (!special) return null;
    const found = await prisma.rareOpenerHit.findFirst({ where: { guildId, discordUserId, specialId: special.id } });
    if (!found) return null;
    return { name: special.name, text: fillOpener(special.text, discordUserId), media: specialMediaPath(special.text), credit: special.credit ?? null };
}

/** The embed showing one special in full. */
export function specialEmbed(special: { name: string; text: string }): EmbedBuilder {
    return new EmbedBuilder().setColor(0xf2a87a).setTitle(special.name).setDescription(special.text);
}

/** The locks still on: their special, owner and owner's chance, while the owner has not found it. */
async function activeLocks(guildId: string): Promise<{ text: string; owner: string; ownerChance: number }[]> {
    const active: { text: string; owner: string; ownerChance: number }[] = [];
    for (const lock of SPECIAL_LOCKS) {
        const text = specialById(lock.id)?.text;
        if (!text) continue;
        const ownerHasIt = await prisma.rareOpenerHit.findFirst({ where: { guildId, discordUserId: lock.owner, specialId: lock.id } });
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
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, discordUserId }, select: { specialId: true } });
    const found = new Set(hits.map((h) => h.specialId));
    return gated.filter((s) => !found.has(s.requires!)).map((s) => s.id);
}

/** The ids of the specials a trainer has found. */
export async function foundSpecialIds(guildId: string, discordUserId: string): Promise<Set<string>> {
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, discordUserId }, select: { specialId: true } });
    return new Set(hits.flatMap((h) => (h.specialId ? [h.specialId] : [])));
}

/** The specials still closed to a trainer (see `Special.after`): out of their pool and boosts. */
export async function closedSpecialsFor(guildId: string, discordUserId: string): Promise<string[]> {
    if (!RARE_OPENERS.some((o) => o.after)) return [];
    return closedSpecials(await foundSpecialIds(guildId, discordUserId));
}

/**
 * A trainer's special pool with every closed special redirected to what it
 * waits on (`redirectOpener`): before Grandmother's welcome, every Mejiro
 * line in the pool is her line.
 */
export async function trainerPool(guildId: string, discordUserId: string, pool: readonly string[]): Promise<string[]> {
    const found = await foundSpecialIds(guildId, discordUserId);
    return pool.map((t) => redirectOpener(t, found));
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

/**
 * Gives a trainer the boost `opener` grants, if it grants one: its run count,
 * added to whatever is left of the same set's boost (boosts stack runs, so
 * 37 left plus another 50 is 87; the chance stays the same).
 */
export async function grantBoost(guildId: string, discordUserId: string, opener: string): Promise<boolean> {
    const granted = boostOf(opener);
    if (!granted) return false;
    const runsLeft = granted.boost.runs;
    await prisma.timerSpecialBoost.upsert({
        where: { guildId_discordUserId_setId: { guildId, discordUserId, setId: granted.set } },
        create: { guildId, discordUserId, setId: granted.set, runsLeft },
        update: { runsLeft: { increment: runsLeft } },
    });
    return true;
}

/** An extra slice of special chance on one ping, drawn evenly from `pool`. */
export interface ExtraChance {
    chance: number;
    pool: readonly string[];
    /** What it is, for the Boosts view. */
    label?: string;
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
 *   - then the usual special share, `RARE_OPENER_CHANCE` (6%);
 *   - then the common lines.
 *
 * So the chances add: with extras $c_1, \dots, c_k$, a ping is special with
 * probability $c_1 + \dots + c_k + 0.06$, before the soft caps (`effectiveChance`),
 * which shrink the extras' slices, never the base. Within the usual 6%, the locks work
 * as before:
 *
 *   - a locked special is out of everyone's pool but its owner's, so the
 *     6% is spread evenly over the rest;
 *   - the owner gets it below `ownerChance`, and the rest of the 6% is
 *     spread evenly over the other specials;
 *   - an `ownerChance` of 1 or more is a guarantee: the owner's next ping is
 *     that special, whatever the roll and before any extra.
 *
 * A locked special never comes up from an extra.
 */
export async function chooseOpener(
    guildId: string,
    discordUserId: string,
    r: number,
    pool: readonly string[],
    extras: readonly ExtraChance[] = [],
    commons: readonly string[] = PING_OPENERS,
): Promise<string> {
    const locks = await activeLocks(guildId);
    const locked = locks.map((l) => l.text);
    const mine = locks.find((l) => l.owner === discordUserId);
    // A guarantee: the owner's next ping is theirs, whatever the roll.
    if (mine && mine.ownerChance >= 1) return mine.text;

    const raw = extras.map((e) => ({ chance: e.chance, pool: e.pool.filter((t) => !locked.includes(t)) })).filter((e) => e.chance > 0 && e.pool.length > 0);
    // The soft caps: when base plus boosts passes 20%, the boost slices
    // shrink in proportion so the total is exactly `effectiveChance`; the
    // base slice stays whole.
    const rawExtra = raw.reduce((sum, e) => sum + e.chance, 0);
    const keptExtra = Math.max(0, effectiveChance(RARE_OPENER_CHANCE + rawExtra) - RARE_OPENER_CHANCE);
    const scale = rawExtra > 0 ? keptExtra / rawExtra : 1;
    const slices = raw.map((e) => ({ ...e, chance: e.chance * scale }));
    let start = 0;
    for (const slice of slices) {
        if (r < start + slice.chance) {
            const share = (r - start) / slice.chance;
            return slice.pool[Math.min(slice.pool.length - 1, Math.floor(share * slice.pool.length))]!;
        }
        start += slice.chance;
    }
    // Past the extras: map what is left back onto [0, 1), keeping the usual
    // special share exactly its width and stretching only the common part.
    const p = RARE_OPENER_CHANCE;
    const u = r - start;
    const rest = u < p ? u : p + ((u - p) * (1 - p)) / (1 - start - p);

    const others = pool.filter((t) => !locked.includes(t));
    if (mine && rest < p) {
        if (rest < mine.ownerChance) return mine.text;
        if (others.length === 0) return pickCommon(() => (rest - mine.ownerChance) / (p - mine.ownerChance), commons);
        const share = (rest - mine.ownerChance) / (p - mine.ownerChance);
        return others[Math.min(others.length - 1, Math.floor(share * others.length))]!;
    }
    return pickOpener(rest, others, commons);
}

/** A common opener at random, for when a locked special has no other special to become. */
function pickCommon(random: () => number, commons: readonly string[] = PING_OPENERS): string {
    return commons[Math.min(commons.length - 1, Math.floor(random() * commons.length))]!;
}

/** A trainer's latest reminder lines, newest last (at most `COMMON_NO_REPEAT`). */
export async function recentCommons(guildId: string, discordUserId: string): Promise<string[]> {
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { recentOpeners: true } });
    return row?.recentOpeners ?? [];
}

/** Remembers that a trainer just got the reminder line `opener`, keeping the latest `COMMON_NO_REPEAT`. */
export async function rememberCommon(guildId: string, discordUserId: string, opener: string): Promise<void> {
    const recentOpeners = [...(await recentCommons(guildId, discordUserId)), opener].slice(-COMMON_NO_REPEAT);
    await prisma.timerUserSettings.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, discordUserId, recentOpeners },
        update: { recentOpeners },
    });
}

// ─── Specials leaderboard ─────────────────────────────────────────────────────

/**
 * Specials leaderboard points: for each special found for the first time,
 * for each repeat, and for each set completed (every special in it found).
 * A full set is worth about 6.7 new finds; five repeats make one new find.
 */
export const SPECIAL_POINTS = { found: 15, repeat: 3, set: 100 } as const;

/** One trainer's row on the specials leaderboard. */
export interface SpecialsBoardRow {
    discordUserId: string;
    /** Their score: see `SPECIAL_POINTS`. */
    points: number;
    /** Sets whose every special they have found. */
    setsComplete: number;
    /** Distinct specials they have found. */
    found: number;
    /** Special pings they have had, repeats included. */
    pings: number;
    /** When they found their latest new special; earlier wins a tie. */
    reachedAt: Date;
}

/** The specials leaderboard: ranked rows and the server's totals. */
export interface SpecialsBoard {
    rows: SpecialsBoardRow[];
    /** How many specials and sets exist, for "12 of 25". */
    specialCount: number;
    setCount: number;
    /** Special pings on the server, and trainers with at least one. */
    totalPings: number;
    trainers: number;
}

/**
 * Ranks trainers by their specials points, all time (`SPECIAL_POINTS`: new
 * finds, repeats, completed sets); a tie goes to whoever found their latest
 * new special first. Only finds of specials that still exist count. `limit`
 * caps the rows; the totals cover everyone.
 */
export async function specialsBoard(guildId: string, limit = 15): Promise<SpecialsBoard> {
    const ids = new Set(RARE_OPENERS.map((o) => o.id));
    const hits = (await prisma.rareOpenerHit.findMany({ where: { guildId, specialId: { not: null } }, orderBy: { at: 'asc' }, select: { discordUserId: true, specialId: true, at: true } })).filter(
        (h) => ids.has(h.specialId!),
    );
    const byUser = new Map<string, { found: Set<string>; pings: number; reachedAt: Date }>();
    for (const h of hits) {
        const u = byUser.get(h.discordUserId) ?? { found: new Set<string>(), pings: 0, reachedAt: h.at };
        u.pings += 1;
        if (!u.found.has(h.specialId!)) {
            u.found.add(h.specialId!);
            u.reachedAt = h.at;
        }
        byUser.set(h.discordUserId, u);
    }
    const rows: SpecialsBoardRow[] = [...byUser].map(([discordUserId, u]) => {
        const setsComplete = SPECIAL_SETS.filter((s) => s.openers.length > 0 && s.openers.every((o) => u.found.has(o.id))).length;
        const found = u.found.size;
        const points = found * SPECIAL_POINTS.found + (u.pings - found) * SPECIAL_POINTS.repeat + setsComplete * SPECIAL_POINTS.set;
        return { discordUserId, points, setsComplete, found, pings: u.pings, reachedAt: u.reachedAt };
    });
    rows.sort((a, b) => b.points - a.points || a.reachedAt.getTime() - b.reachedAt.getTime());
    return { rows: rows.slice(0, limit), specialCount: RARE_OPENERS.length, setCount: SPECIAL_SETS.length, totalPings: hits.length, trainers: rows.length };
}
