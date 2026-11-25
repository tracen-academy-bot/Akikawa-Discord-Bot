import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getUserSettings } from './userSettings';
import { FORTUNE_LINES, TENT_INTRO, TENT_PAIR, fortuneLineById, tentIsOpen } from './fortuneLines';
import { prisma } from '../../db/prisma';
import { COMMON_NO_REPEAT, PING_OPENERS, RARE_OPENERS, claimOpener, countsAsSet, setNumber, closedSpecials, redirectOpener, unlockedGuests, RARE_PING_OPENERS, RARE_OPENER_CHANCE, effectiveChance, isOpenAt, PAUSED_SETS, SPECIAL_LOCKS, SPECIAL_SETS, boostOf, fillOpener, pickOpener, specialById, specialByText, specialIdOf, specialMediaPath, type OutcomeBoost, type RolledOutcome } from './openers';

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
    /** An extra (`Special.extra`): listed after its set's lines, not counted in its totals. */
    extra: boolean;
    /** A guest (`Special.guest`, always an extra): listed last, as "Guest.". */
    guest: boolean;
}

/**
 * Every rare line, in list order, with its tally in a guild, or for one trainer when `discordUserId` is given.
 * The guild's tally takes its first finder from `TimerFirstFinder` when that is earlier than any remaining find (or there is none).
 */
export async function rareTally(guildId: string, discordUserId?: string): Promise<RareTally[]> {
    const hits = await prisma.rareOpenerHit.findMany({ where: { guildId, ...(discordUserId ? { discordUserId } : {}) }, orderBy: { at: 'asc' } });
    const overrides = discordUserId ? [] : await prisma.timerFirstFinder.findMany({ where: { guildId } });
    return RARE_OPENERS.map(({ id, name, text: opener, set, extra, guest }) => {
        const mine = hits.filter((h) => h.specialId === id);
        let firstUserId = mine[0]?.discordUserId ?? null;
        let firstAt = mine[0]?.at ?? null;
        const kept = overrides.find((o) => o.specialId === id);
        if (kept && (!firstAt || kept.at.getTime() < firstAt.getTime())) {
            firstUserId = kept.discordUserId;
            firstAt = kept.at;
        }
        return { id, name, opener, set, count: mine.length, firstUserId, firstAt, extra: (extra ?? false) || (guest ?? false), guest: guest ?? false };
    });
}

/**
 * Removes all of a trainer's finds of one special (in every guild, or only
 * `guildId`), first keeping their earliest as the guild's first-finder
 * override (`TimerFirstFinder`) unless one is kept already. The same SQL as
 * migration `20261116000000_first_finder_grandmother_reset` (Tylina's
 * Grandmother reset), so the tests can run it. Returns the finds removed.
 */
export async function resetFinds(discordUserId: string, specialId: string, guildId?: string): Promise<number> {
    const [, removed] = await prisma.$transaction([
        prisma.$executeRaw`
            INSERT INTO "TimerFirstFinder" ("guildId", "specialId", "discordUserId", "at")
            SELECT DISTINCT ON ("guildId") "guildId", "specialId", "discordUserId", "at"
            FROM "RareOpenerHit"
            WHERE "discordUserId" = ${discordUserId} AND "specialId" = ${specialId} AND (${guildId ?? null}::text IS NULL OR "guildId" = ${guildId ?? null})
            ORDER BY "guildId", "at" ASC
            ON CONFLICT ("guildId", "specialId") DO NOTHING`,
        prisma.$executeRaw`
            DELETE FROM "RareOpenerHit"
            WHERE "discordUserId" = ${discordUserId} AND "specialId" = ${specialId} AND (${guildId ?? null}::text IS NULL OR "guildId" = ${guildId ?? null})`,
    ]);
    return removed;
}

/** What a trainer's own Specials pages add: their locks, sets turned off, and boosts. */
export interface PersonalExtras {
    lockedSets: readonly string[];
    disabledSets: readonly string[];
    /** Sets whose completion was handled (auto-off); see `restingLines`. */
    autoOffSets?: readonly string[];
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

/**
 * The Specials list's pages, in order: Set 0 (the reminders), then each
 * special set, and right after a set with extras (`Special.extra`: the
 * Remedial Rehearsal, guests) a page of its own for them, "Set <n>.5"
 * (owner, 2026-11-15). From `TENT_OPENS`, a last page: Set 4, Fuku-chan's
 * Fortune Tent (its fortunes, drawn from the Boosts view; not a pool).
 */
type SpecialsPage = { kind: 'reminders' } | { kind: 'set'; set: number } | { kind: 'extras'; set: number } | { kind: 'fortune' };
// Pages follow the sets' numbers (Set 1, Set 1.2, Set 2, ...), not their place in SPECIAL_SETS.
const SET_PAGES: readonly SpecialsPage[] = [
    { kind: 'reminders' },
    ...SPECIAL_SETS.map((s, i) => ({ s, i }))
        .sort((a, b) => Number(setNumber(a.s)) - Number(setNumber(b.s)))
        .flatMap(({ s, i }): SpecialsPage[] =>
            RARE_OPENERS.some((o) => o.set === s.id && o.extra) ? [{ kind: 'set', set: i }, { kind: 'extras', set: i }] : [{ kind: 'set', set: i }],
        ),
];

/** The pages at `now`: the Fortune Tent's page only once it is open. */
function pagesAt(now: Date): readonly SpecialsPage[] {
    // A set with no line open yet (Set 1.2 before the tent) has no page.
    const shown = SET_PAGES.filter((p) => p.kind === 'reminders' || p.kind === 'fortune' || SPECIAL_SETS[p.set]!.openers.some((o) => isOpenAt(o, now)));
    return tentIsOpen(now) ? [...shown, { kind: 'fortune' }] : shown;
}

/** The Fortune Tent's set number and name, after the special sets. */
export const FORTUNE_SET_TITLE = "Set 4: Fuku-chan's Fortune Tent";

/** A page's heading: "Set <n>: <name>", or "Set <n>.5: <name> Extras". */
function pageTitle(pages: readonly SpecialsPage[], page: number): string {
    const pg = pages[page]!;
    if (pg.kind === 'reminders') return 'Set 0: Reminders';
    if (pg.kind === 'fortune') return FORTUNE_SET_TITLE;
    const set = SPECIAL_SETS[pg.set]!;
    return pg.kind === 'set' ? `Set ${setNumber(set)}: ${set.name}` : `Set ${setNumber(set)}.5: ${set.name} Extras`;
}

/** The Back/Next row of a Specials page, with `middle` (the set's toggle) between them. */
function navRow(mode: 'mine' | 'all', page: number, pageCount: number, middle?: ButtonBuilder): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${page - 1}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    );
    if (middle) row.addComponents(middle);
    return row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${SPECIALS_PAGE_PREFIX}${mode}:${page + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= pageCount - 1),
    );
}

/**
 * Set 0: the usual ping lines, in full (they are not secret), with the
 * mention shown as "@trainer". Always on; nothing to find or turn off.
 */
function remindersPage(mode: 'mine' | 'all', footerHead: string, pages: readonly SpecialsPage[]) {
    const lines = PING_OPENERS.map((o, n) => `**${n + 1}.** ${o.replaceAll('{user}', '@trainer')}`);
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(pageTitle(pages, 0))
        .setDescription(['The usual ping lines. Always on.', '', ...lines].join('\n').slice(0, 4096))
        .setFooter({ text: `${footerHead}\nPage 1 of ${pages.length}` });
    return { embeds: [embed], components: [navRow(mode, 0, pages.length)] as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] };
}

/** One fortune's tally (Set 4): how often it was drawn, and who drew it first. */
export interface FortuneTally {
    id: string;
    name: string;
    count: number;
    firstUserId: string | null;
    firstAt: Date | null;
}

/** Every fortune, in Set 4 order, with its draws in a guild, or for one trainer when `discordUserId` is given. */
export async function fortuneTally(guildId: string, discordUserId?: string): Promise<FortuneTally[]> {
    const draws = await prisma.timerFortuneDraw.findMany({ where: { guildId, ...(discordUserId ? { discordUserId } : {}) }, orderBy: { drawnAt: 'asc' } });
    return FORTUNE_LINES.map(({ id, name }) => {
        const mine = draws.filter((d) => d.lineId === id);
        return { id, name, count: mine.length, firstUserId: mine[0]?.discordUserId ?? null, firstAt: mine[0]?.drawnAt ?? null };
    });
}

/** The read menu's value for a fortune: `fortune:<line id>`. */
export const FORTUNE_READ_PREFIX = 'fortune:';

/** What a Specials view adds beyond the specials' tally. */
export interface SpecialsViewMore {
    /** Set 4's tally (`fortuneTally`); none: every fortune "???". */
    fortunes?: readonly FortuneTally[];
    /** The server's first Ramonu's Second Love (`TimerSecondLove`), shown on Set 3.5; null or none: nobody yet. */
    firstVictor?: { userId: string; at: Date } | null;
    /** The tent's intro was seen (personal: by them; server: by anyone). Shown on Set 4, never counted. */
    introSeen?: boolean;
    /** Personal: the Matikanes they still need for the tent (`TENT_PAIR`); empty or none: they have both. */
    tentMissing?: readonly string[];
}

/** The read menu's value for the tent's intro, and its row's name on Set 4 (owner, 2026-11-22: listed, not counted). */
export const INTRO_READ_ID = 'fortune:intro';
export const INTRO_NAME = 'Welcome to the Matikane Fortune Tent';

/** Whether the tent's intro was seen: by `discordUserId`, or by anyone in the guild. */
async function introSeenBy(guildId: string, discordUserId?: string): Promise<boolean> {
    const n = await prisma.timerUserSettings.count({ where: { guildId, ...(discordUserId ? { discordUserId } : {}), tentUnlocked: true, tentIntroOwed: false } });
    return n > 0;
}

/** The set whose extras page shows the First Victor: The Mejiro Estate (Ramonu's Remedial Rehearsal). */
const FIRST_VICTOR_SET = 'mejiro-estate';

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
 *   - From `TENT_OPENS`, Set 4 (the Fortune Tent): its 13 fortunes, "???"
 *     until drawn, with no toggle; they count in the "N of M" totals.
 *
 * `page` is clamped to the pages there are. Never shows a special's text.
 * A special not open yet at `now` (`Special.opensAt`) is left out of every
 * row and count, as if it did not exist.
 */
export function specialsView(allTally: RareTally[], page: number, extras?: PersonalExtras, now: Date = new Date(), more: SpecialsViewMore = {}) {
    const tally = allTally.filter((t) => isOpenAt(specialById(t.id) ?? {}, now));
    const pages = pagesAt(now);
    const tentOpen = tentIsOpen(now);
    const fortunes: readonly FortuneTally[] = tentOpen ? (more.fortunes ?? FORTUNE_LINES.map(({ id, name }) => ({ id, name, count: 0, firstUserId: null, firstAt: null }))) : [];
    const personal = extras !== undefined;
    const mode = personal ? 'mine' : 'all';
    const pg = Math.max(0, Math.min(pages.length - 1, Number.isInteger(page) ? page : SPECIALS_FIRST_PAGE));
    const total = tally.reduce((sum, t) => sum + t.count, 0);
    const pings = `${total} special ping${total === 1 ? '' : 's'}`;
    const tallyLine = `${personal ? `${pings} for you so far` : `${pings} on the server so far`}.`;
    const page_ = pages[pg]!;
    if (page_.kind === 'reminders') return remindersPage(mode, tallyLine, pages);
    // The fortunes count like a set's lines in the totals (owner, 2026-11-15).
    const counted = tally.filter((t) => !t.extra);
    const found = counted.filter((t) => t.count > 0).length + fortunes.filter((f) => f.count > 0).length;
    const countedAll = counted.length + fortunes.length;
    const title = personal ? `Your specials: ${found} of ${countedAll}` : `Specials found: ${found} of ${countedAll}`;
    const footer = [`${tallyLine} Each ping has a ${Math.round(RARE_OPENER_CHANCE * 100)}% chance of a special line.`];
    for (const b of extras?.boosts ?? []) {
        const boostSet = SPECIAL_SETS.find((s) => s.id === b.setId);
        // An outcome boost has its own chance and target; a set boost takes its set's.
        const chance = b.key ? b.chance : boostSet?.openers.find((o) => o.boost)?.boost?.chance;
        if (!boostSet || chance === undefined) continue;
        const target = b.specialId ? (specialById(b.specialId)?.name ?? boostSet.name) : boostSet.name;
        footer.push(`Boost: +${Math.round(chance * 100)}% ${target} for ${b.runsLeft} more run${b.runsLeft === 1 ? '' : 's'}${extras!.boostsOn ? '' : ' (paused: Boosts are off)'}.`);
    }
    footer.push(`Page ${pg + 1} of ${pages.length}`);
    const when = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:R>`;

    if (page_.kind === 'fortune') {
        const drawnHere = fortunes.filter((f) => f.count > 0).length;
        const embed = new EmbedBuilder()
            .setColor(0xf2a87a)
            .setTitle(title)
            // Locked like a set (owner, 2026-11-25): which Matikanes to find.
            .setDescription(
                `**${FORTUNE_SET_TITLE}**: ${drawnHere} of ${fortunes.length} drawn` +
                    (more.tentMissing && more.tentMissing.length > 0 ? `\nLocked: find ${more.tentMissing.map((n) => `**${n}**`).join(' and ')} to open it.` : ''),
            )
            .addFields(
                // The intro heads the list, unnumbered and never counted (owner, 2026-11-22).
                { name: 'Fortune', value: [`**Intro.** ${more.introSeen ? INTRO_NAME : '???'}`, ...fortunes.map((f, n) => `**${n + 1}.** ${f.count > 0 ? f.name : '???'}`)].join('\n').slice(0, 1024), inline: true },
                { name: 'Times', value: ['—', ...fortunes.map((f) => (f.count > 0 ? `**×${f.count}**` : '—'))].join('\n').slice(0, 1024), inline: true },
                {
                    name: personal ? 'First drawn' : 'First drawn by',
                    value: ['—', ...fortunes.map((f) => (f.count > 0 && f.firstUserId && f.firstAt ? (personal ? when(f.firstAt) : `<@${f.firstUserId}> ${when(f.firstAt)}`) : '—'))].join('\n').slice(0, 1024),
                    inline: true,
                },
            )
            .setFooter({ text: footer.join('\n') });
        // No On/Off: the tent is not a pool.
        const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [navRow(mode, pg, pages.length)];
        const drawnOptions = personal ? fortunes.map((f, n) => ({ f, n })).filter(({ f }) => f.count > 0).map(({ f, n }) => ({ label: `${n + 1}. ${f.name}`.slice(0, 100), value: `${FORTUNE_READ_PREFIX}${f.id}` })) : [];
        const options = personal && more.introSeen ? [{ label: `Intro. ${INTRO_NAME}`.slice(0, 100), value: INTRO_READ_ID }, ...drawnOptions] : drawnOptions;
        if (options.length > 0) {
            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(READ_MENU_ID).setPlaceholder("Read a fortune from Fuku-chan's Fortune Tent").addOptions(options)));
        }
        return { embeds: [embed], components };
    }

    const set = SPECIAL_SETS[page_.set]!;
    // A set page lists its lines; its extras page lists its extras (the
    // Rehearsal, then the guests), counted on their own, never in the set's
    // or the overall totals.
    const inSet = tally.map((t, i) => ({ t, i })).filter(({ t }) => t.set === set.id);
    const rows = page_.kind === 'set' ? inSet.filter(({ t }) => !t.extra) : [...inSet.filter(({ t }) => t.extra && !t.guest), ...inSet.filter(({ t }) => t.guest)];
    const foundHere = rows.filter(({ t }) => t.count > 0).length;
    /** A row's number on a set page ("3."); an extras page lists names only (owner, 2026-11-15). */
    const extrasPage = page_.kind === 'extras';
    const num = (_t: RareTally, n: number) => (extrasPage ? '' : `${n + 1}.`);
    const lead = (t: RareTally, n: number) => (extrasPage ? '' : `**${num(t, n)}** `);
    const locked = extras?.lockedSets.includes(set.id) ?? false;
    const off = extras?.disabledSets.includes(set.id) ?? false;
    const resting = !off && isResting(set.id, extras?.autoOffSets ?? []);

    const status = locked
        ? `\nLocked: find **${(set.requires && specialById(set.requires)?.name) ?? 'its special'}** to open it.`
        : off
          ? '\nOff: these never come up for you.'
          : resting
            ? '\nResting: every line found, so they rest; only what its extras still need comes up.'
            : '';
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle(title)
        .setDescription(`**${pageTitle(pages, pg)}**: ${foundHere} of ${rows.length} found${status}`);
    if (!locked) {
        // Found, or (server list) a kept first finder with no find left (TimerFirstFinder).
        const seen = (t: RareTally) => t.count > 0 || (t.firstUserId !== null && t.firstAt !== null);
        const names = rows.map(({ t }, n) => `${lead(t, n)}${seen(t) ? t.name : '???'}`);
        const counts = rows.map(({ t }) => (t.count > 0 ? `**×${t.count}**` : '—'));
        const firsts = rows.map(({ t }) => (seen(t) && t.firstUserId && t.firstAt ? (personal ? when(t.firstAt) : `<@${t.firstUserId}> ${when(t.firstAt)}`) : '—'));
        embed.addFields(
            { name: 'Special', value: names.join('\n').slice(0, 1024), inline: true },
            { name: 'Times', value: counts.join('\n').slice(0, 1024), inline: true },
            { name: personal ? 'First got' : 'First found by', value: firsts.join('\n').slice(0, 1024), inline: true },
        );
        // Under the Set 3.5 table, once someone has won (owner, 2026-11-15).
        if (extrasPage && set.id === FIRST_VICTOR_SET && more.firstVictor) {
            embed.addFields({ name: '\u200b', value: `First Victor (Ramonu's Second Love): <@${more.firstVictor.userId}> ${when(more.firstVictor.at)}` });
        }
    }
    embed.setFooter({ text: footer.join('\n') });

    const toggle = personal
        ? new ButtonBuilder()
              .setCustomId(`${SPECIALS_SET_PREFIX}${set.id}`)
              .setLabel(`${set.name}: ${locked ? 'Locked' : off ? 'Off' : resting ? 'Resting' : 'On'}`)
              .setStyle(!locked && !off && !resting ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(locked)
        : undefined;
    const nav = navRow(mode, pg, pages.length, toggle);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [nav];
    // Reading in full is for a trainer's own finds, a set's worth at a time.
    const options = personal
        ? rows.map(({ t, i }, n) => ({ t, i, n })).filter(({ t }) => t.count > 0).slice(0, 25).map(({ t, n }) => ({ label: `${extrasPage ? '' : `${num(t, n)} `}${t.name}`.slice(0, 100), value: t.id }))
        : [];
    if (options.length > 0) {
        components.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId(READ_MENU_ID).setPlaceholder(`Read a special from ${page_.kind === 'extras' ? `${set.name} Extras` : set.name}`).addOptions(options),
            ),
        );
    }
    return { embeds: [embed], components };
}

/** The server's first Ramonu's Second Love, or null while nobody has won. */
async function firstVictor(guildId: string): Promise<{ userId: string; at: Date } | null> {
    const row = await prisma.timerSecondLove.findUnique({ where: { guildId } });
    return row ? { userId: row.firstUserId, at: row.firstAt } : null;
}

/** A trainer's own Specials page `page`, from the database. */
export async function mySpecialsView(guildId: string, discordUserId: string, page: number, now: Date = new Date()) {
    const [tally, lockedSets, boosts, settings, fortunes] = await Promise.all([
        rareTally(guildId, discordUserId),
        lockedSetsFor(guildId, discordUserId),
        activeBoosts(guildId, discordUserId),
        getUserSettings(guildId, discordUserId),
        fortuneTally(guildId, discordUserId),
    ]);
    const found = await foundSpecialIds(guildId, discordUserId);
    const tentMissing = TENT_PAIR.filter((id) => !found.has(id)).map((id) => specialById(id)?.name ?? id);
    return specialsView(tally, page, { lockedSets, disabledSets: settings.disabledSets, autoOffSets: settings.autoOffSets ?? [], boosts, boostsOn: settings.boosts }, now, { fortunes, firstVictor: await firstVictor(guildId), introSeen: await introSeenBy(guildId, discordUserId), tentMissing });
}

/** The server's Specials page `page` (Club Managers), from the database. */
export async function serverSpecialsView(guildId: string, page: number, now: Date = new Date()) {
    const [tally, fortunes, victor] = await Promise.all([rareTally(guildId), fortuneTally(guildId), firstVictor(guildId)]);
    return specialsView(tally, page, undefined, now, { fortunes, firstVictor: victor, introSeen: await introSeenBy(guildId) });
}

/** The page of `setId` in the Specials list (Set 1 is page 1), or the first page. */
export function pageOfSet(setId: string, now: Date = new Date()): number {
    const i = SPECIAL_SETS.findIndex((s) => s.id === setId);
    const page = pagesAt(now).findIndex((p) => p.kind === 'set' && p.set === i);
    return page === -1 ? SPECIALS_FIRST_PAGE : page;
}

/**
 * A special's full text for a trainer who unlocked it, with the mention
 * filled in as them, or null when they have not (or the choice is not a
 * special). Checked against their own finds, so a forged choice cannot
 * reveal a line they have not had. A fortune (`fortune:<id>`) reads as its
 * result box: the tier heading, the scene, the effect line; only if drawn.
 */
export async function readSpecial(guildId: string, discordUserId: string, choice: string): Promise<{ name: string; text: string; media: string | null; credit: string | null } | null> {
    // The tent's intro, once seen (listed on Set 4, not counted).
    if (choice === INTRO_READ_ID) {
        if (!(await introSeenBy(guildId, discordUserId))) return null;
        return { name: INTRO_NAME, text: TENT_INTRO.replaceAll('{user}', `<@${discordUserId}>`), media: null, credit: null };
    }
    if (choice.startsWith(FORTUNE_READ_PREFIX)) {
        const fortune = fortuneLineById(choice.slice(FORTUNE_READ_PREFIX.length));
        if (!fortune) return null;
        const drawn = await prisma.timerFortuneDraw.findFirst({ where: { guildId, discordUserId, lineId: fortune.line.id } });
        if (!drawn) return null;
        return { name: fortune.tier.heading, text: `${fortune.line.text.replaceAll('{user}', `<@${discordUserId}>`)}\n${fortune.tier.effect}`, media: null, credit: null };
    }
    const special = specialById(choice);
    if (!special) return null;
    const found = await prisma.rareOpenerHit.findFirst({ where: { guildId, discordUserId, specialId: special.id } });
    if (!found) return null;
    return { name: special.name, text: fillOpener(special.text, discordUserId), media: specialMediaPath(special.text), credit: special.credit ?? null };
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

/**
 * The specials a trainer is done with, for auto-off (owner, 2026-11-19):
 * their finds, except a special with a forced success (the Remedial
 * Rehearsal) until they have earned it (`TimerUserSettings.secondLove`).
 * So a resting Estate keeps Ramonu, and its extras are not finished, until
 * the role is won.
 */
export async function doneSpecialIds(guildId: string, discordUserId: string, found?: Set<string>): Promise<Set<string>> {
    const done = new Set(found ?? (await foundSpecialIds(guildId, discordUserId)));
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { secondLove: true } });
    if (!row?.secondLove) for (const o of RARE_OPENERS) if (o.forcedSuccess) done.delete(o.id);
    return done;
}

/** The specials still closed to a trainer (see `Special.after`): out of their pool and boosts. */
export async function closedSpecialsFor(guildId: string, discordUserId: string): Promise<string[]> {
    if (!RARE_OPENERS.some((o) => o.after)) return [];
    return closedSpecials(await foundSpecialIds(guildId, discordUserId));
}

/**
 * A trainer's special pool with every closed special redirected to what it
 * waits on (`redirectOpener`): before Grandmother's welcome, every Mejiro
 * line in the pool is her line. Lines held until a special is passed
 * (`Special.heldUntilPassed`) are left out while the trainer owes it. Then
 * a set's claiming special takes its lines (`claimOpener`): with all eight
 * found and no photo, every Mejiro Estate line left is the Family Photograph.
 */
export async function trainerPool(guildId: string, discordUserId: string, pool: readonly string[]): Promise<string[]> {
    const found = await foundSpecialIds(guildId, discordUserId);
    const state = await outcomeState(guildId, discordUserId);
    const autoOffSets = (await getUserSettings(guildId, discordUserId)).autoOffSets ?? [];
    const done = await doneSpecialIds(guildId, discordUserId, found);
    const resting = new Set(SPECIAL_SETS.flatMap((s) => restingLines(s.id, done, autoOffSets)));
    // The special owed: scheduled or guaranteed, or mid losing streak (a streak belongs to the special with a forced success).
    const streakOn = RARE_OPENERS.find((o) => o.forcedSuccess)?.id ?? null;
    const owed = state.guaranteedSpecialId ?? (state.losingStreak.length > 0 ? streakOn : null);
    const held = (t: string) => {
        const holder = RARE_OPENERS.find((o) => o.text === t)?.heldUntilPassed;
        return holder !== undefined && holder === owed;
    };
    // A guest still locked (its counterpart not found) is left out, not redirected.
    const lockedGuest = (t: string) => {
        const o = RARE_OPENERS.find((x) => x.text === t);
        return o?.guest === true && (o.after ?? []).some((id) => !found.has(id));
    };
    return pool
        .filter((t) => !lockedGuest(t))
        .map((t) => redirectOpener(t, found))
        .filter((t) => !held(t))
        .map((t) => claimOpener(t, found))
        .filter((t) => !resting.has(t));
}

/**
 * Wakes a trainer's sets that auto-off turned off (`<set>:all`, not kept)
 * once they gain a line the trainer has not found (a `Special.opensAt`
 * passing, e.g. Matikanefukukitaru in Set 1 at TENT_OPENS). The set is on
 * again and resting: found lines stay out, the new line is live, and
 * finding it completes the set again (and turns it off). Returns the sets
 * woken. Called before each ping and the Boosts view.
 */
export async function wakeForNewLines(guildId: string, discordUserId: string, now: Date = new Date()): Promise<string[]> {
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } });
    if (!row) return [];
    const auto = row.autoOffSets ?? [];
    const candidates = SPECIAL_SETS.filter((s) => auto.includes(`${s.id}:all`) && !auto.includes(`${s.id}:kept`) && row.disabledSets.includes(s.id));
    if (candidates.length === 0) return [];
    const found = await foundSpecialIds(guildId, discordUserId);
    const woken = candidates.filter((s) => s.openers.some((o) => !o.extra && isOpenAt(o, now) && !found.has(o.id))).map((s) => s.id);
    if (woken.length === 0) return [];
    await prisma.timerUserSettings.update({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        data: {
            disabledSets: row.disabledSets.filter((id) => !woken.includes(id)),
            autoOffSets: [...new Set([...auto.filter((k) => !woken.some((id) => k === `${id}:all`)), ...woken])],
        },
    });
    return woken;
}

/** True when a set is resting for a trainer: auto-off with extras left, not turned back on. */
export function isResting(setId: string, autoOffSets: readonly string[]): boolean {
    return autoOffSets.includes(setId) && !autoOffSets.includes(`${setId}:all`) && !autoOffSets.includes(`${setId}:kept`);
}

/**
 * The texts of a resting set's lines that stay out of a trainer's pools
 * (owner, 2026-11-15): every found line of the set, except those an extra
 * not yet found still needs (its `after`, e.g. Ramonu for the Rehearsal;
 * not a guest's counterpart, since guests come from the guest slice).
 * Empty when the set is not resting.
 */
export function restingLines(setId: string, found: ReadonlySet<string>, autoOffSets: readonly string[]): string[] {
    if (!isResting(setId, autoOffSets)) return [];
    const inSet = RARE_OPENERS.filter((o) => o.set === setId);
    // Only an extra that comes from rolling a line keeps it (the Rehearsal
    // from Ramonu). A guest comes from the guest slice once its counterpart
    // is found, so its counterpart can rest.
    const needed = new Set(inSet.filter((o) => o.extra && !o.guest && !found.has(o.id)).flatMap((o) => o.after ?? []));
    // Found guests rest too (they are in the usual pool); the Rehearsal never is.
    return inSet.filter((o) => (!o.extra || o.guest) && found.has(o.id) && !needed.has(o.id)).map((o) => o.text);
}

/**
 * What finding `opener` completes for a trainer, if anything new (owner,
 * 2026-11-15): every line of its set (its found lines rest, except what its
 * extras still need), or every line and extra (the set turns off). Returns
 * the ping's line and `record`, to call once the find is saved; null when
 * nothing new is completed or the set was handled before.
 */
export async function completionNotice(guildId: string, discordUserId: string, opener: string): Promise<{ line: string; record: () => Promise<void> } | null> {
    const special = specialByText(opener);
    if (!special) return null;
    const set = SPECIAL_SETS.find((s) => s.id === special.set);
    // A growing set (`SpecialSet.countsFrom`) has no completion yet.
    if (!set || !countsAsSet(set)) return null;
    const found = await doneSpecialIds(guildId, discordUserId);
    // This ping's special is found now; a forced-success special only once earned (granted before this runs).
    if (!special.forcedSuccess || (await doneSpecialIds(guildId, discordUserId, new Set([special.id]))).has(special.id)) found.add(special.id);
    // A special not open yet (Special.opensAt) does not hold up a completion.
    const inSet = RARE_OPENERS.filter((o) => o.set === set.id && isOpenAt(o));
    const mainDone = inSet.filter((o) => !o.extra).every((o) => found.has(o.id));
    const allDone = mainDone && inSet.every((o) => found.has(o.id));
    const settings = await getUserSettings(guildId, discordUserId);
    const handled = settings.autoOffSets ?? [];
    if (handled.includes(`${set.id}:kept`)) return null;
    const save = (autoOffSets: string[], disabledSets: string[]) =>
        prisma.timerUserSettings.upsert({
            where: { guildId_discordUserId: { guildId, discordUserId } },
            create: { guildId, discordUserId, autoOffSets, disabledSets },
            update: { autoOffSets, disabledSets },
        });
    if (allDone && !handled.includes(`${set.id}:all`)) {
        return {
            // Owner, 2026-11-19: the completion wording. The extras get their own
            // when the main lines' notice already went out; one find finishing
            // both at once (or a set without extras) gets the set's.
            line: handled.includes(set.id)
                ? `Congratulations on finishing the extras in ${set.name}! The extras have been disabled, but you can re-enable them anytime.`
                : `Congratulations on finishing ${set.name}! The set has been disabled, but you can re-enable it anytime.`,
            record: async () => {
                const now = await getUserSettings(guildId, discordUserId);
                const auto = [...new Set([...(now.autoOffSets ?? []), set.id, `${set.id}:all`])];
                const disabled = now.disabledSets.includes(set.id) ? now.disabledSets : [...now.disabledSets, set.id];
                await save(auto, disabled);
            },
        };
    }
    if (mainDone && !allDone && !handled.includes(set.id)) {
        return {
            line: `Congratulations on finishing the main set in ${set.name}! The main set has been disabled, but you can re-enable it anytime. Enjoy the extras!`,
            record: async () => {
                const now = await getUserSettings(guildId, discordUserId);
                await save([...new Set([...(now.autoOffSets ?? []), set.id])], now.disabledSets);
            },
        };
    }
    return null;
}

/**
 * A boost a trainer holds: a set boost (just `setId` and `runsLeft`), or an
 * outcome boost (`OutcomeBoost`), which also has its `key`, `chance`, its
 * one special if it has one, and whether it ends when that comes up.
 */
export interface ActiveBoost {
    setId: string;
    runsLeft: number;
    key?: string;
    specialId?: string;
    chance?: number;
    endsOnHit?: boolean;
}

/** A trainer's boosts with runs left, set boosts first, in the order they were stored. */
export async function activeBoosts(guildId: string, discordUserId: string): Promise<ActiveBoost[]> {
    const rows = await prisma.timerSpecialBoost.findMany({ where: { guildId, discordUserId, runsLeft: { gt: 0 } }, orderBy: [{ key: 'asc' }, { setId: 'asc' }] });
    return rows.map((r) =>
        r.key
            ? { setId: r.setId, runsLeft: r.runsLeft, key: r.key, ...(r.specialId ? { specialId: r.specialId } : {}), chance: r.chance ?? 0, endsOnHit: r.endsOnHit }
            : { setId: r.setId, runsLeft: r.runsLeft },
    );
}

/**
 * Gives a trainer an outcome boost. Outcome boosts do not stack (owner,
 * 2026-11-15): getting the same one again (by key) only tops it back up to
 * its full run count, never past it.
 */
export async function grantOutcomeBoost(guildId: string, discordUserId: string, boost: OutcomeBoost): Promise<void> {
    const where = { guildId_discordUserId_setId_key: { guildId, discordUserId, setId: boost.set, key: boost.key } };
    const held = await prisma.timerSpecialBoost.findUnique({ where });
    await prisma.timerSpecialBoost.upsert({
        where,
        create: { guildId, discordUserId, setId: boost.set, key: boost.key, specialId: boost.special ?? null, chance: boost.chance, endsOnHit: boost.endsOnHit ?? false, runsLeft: boost.runs },
        update: { runsLeft: Math.max(held?.runsLeft ?? 0, boost.runs), chance: boost.chance, endsOnHit: boost.endsOnHit ?? false, specialId: boost.special ?? null },
    });
}

/** Ends a trainer's one-time boosts on `opener`'s special (`OutcomeBoost.endsOnHit`): it has come up. */
export async function endBoostsHitBy(guildId: string, discordUserId: string, opener: string): Promise<void> {
    const specialId = specialIdOf(opener);
    if (!specialId) return;
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId, discordUserId, specialId, endsOnHit: true } });
}

/**
 * A trainer's outcome state: the special a coming ping is guaranteed to be,
 * how many runs until it (1: the next ping), and their losing streak.
 */
export interface OutcomeState {
    guaranteedSpecialId: string | null;
    guaranteedInRuns: number;
    losingStreak: string[];
}

export async function outcomeState(guildId: string, discordUserId: string): Promise<OutcomeState> {
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { guaranteedSpecialId: true, guaranteedInRuns: true, losingStreak: true } });
    return { guaranteedSpecialId: row?.guaranteedSpecialId ?? null, guaranteedInRuns: row?.guaranteedInRuns ?? 1, losingStreak: row?.losingStreak ?? [] };
}

/**
 * Counts one run down on a trainer's pending guarantee, after a ping that
 * was not it (`opener`): it never drops below 1, so a guarantee that could
 * not fire (its set off, locked or paused) stays due on the next ping.
 */
export async function tickGuarantee(guildId: string, discordUserId: string, opener: string): Promise<void> {
    const state = await outcomeState(guildId, discordUserId);
    if (!state.guaranteedSpecialId || specialIdOf(opener) === state.guaranteedSpecialId || state.guaranteedInRuns <= 1) return;
    await prisma.timerUserSettings.update({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        data: { guaranteedInRuns: state.guaranteedInRuns - 1 },
    });
}

/**
 * The text of the special a trainer's next ping is guaranteed to be, or
 * undefined: none is pending, its set is locked or paused for them, or it
 * is still closed for them (`closed`, from `closedSpecials`: its `after` not
 * all found). It then waits, due, until it can come up. A set the trainer
 * turned off does not hold it (owner, 2026-11-19): an owed lesson is a debt
 * from a roll already made, and it fires, ending Ramonu's hold.
 */
export function guaranteedOpener(state: OutcomeState, lockedSets: readonly string[], closed: readonly string[] = []): string | undefined {
    if (state.guaranteedInRuns > 1) return undefined;
    const special = state.guaranteedSpecialId ? specialById(state.guaranteedSpecialId) : undefined;
    if (!special || lockedSets.includes(special.set) || PAUSED_SETS.includes(special.set)) return undefined;
    if (closed.includes(special.text)) return undefined;
    return special.text;
}

/**
 * After a ping with the special `opener` was posted: clears a guarantee it
 * fulfilled, then applies what it rolled (`rolled`, if anything): its boost;
 * a win or forced success resets the losing streak; a loss adds its mishap
 * to the streak and guarantees the trainer's next ping is this special again.
 */
export async function applyOutcome(
    guildId: string,
    discordUserId: string,
    opener: string,
    rolled: RolledOutcome | null,
    random: () => number = Math.random,
): Promise<void> {
    const specialId = specialIdOf(opener);
    if (!specialId) return;
    const state = await outcomeState(guildId, discordUserId);
    const fulfilled = state.guaranteedSpecialId === specialId;
    let guaranteedSpecialId = fulfilled ? null : state.guaranteedSpecialId;
    let guaranteedInRuns: number | null = fulfilled ? null : state.guaranteedInRuns;
    let losingStreak = state.losingStreak;
    if (rolled?.boost) await grantOutcomeBoost(guildId, discordUserId, rolled.boost);
    if (rolled?.win || rolled?.forced) losingStreak = [];
    if (rolled?.lose) {
        losingStreak = [...losingStreak, rolled.mishap ?? rolled.outcome];
        guaranteedSpecialId = specialId;
        guaranteedInRuns = 1;
    }
    // A schedule never stacks (not while that special is owed: scheduled,
    // guaranteed, or a losing streak runs), but it overrides any other
    // pending guarantee: Ramonu's lesson always wins (owner, 2026-11-15).
    if (rolled?.schedule && guaranteedSpecialId !== rolled.schedule.special && losingStreak.length === 0) {
        guaranteedSpecialId = rolled.schedule.special;
        guaranteedInRuns = 1 + Math.min(rolled.schedule.within - 1, Math.floor(random() * rolled.schedule.within));
    }
    // Helios's introductions: the next run is an unlocked guest not yet met
    // (any unlocked guest once those are met), never the one that rolled it;
    // nothing when no other guest is unlocked, or something else is pending.
    if (rolled?.guaranteeGuest && !guaranteedSpecialId && losingStreak.length === 0) {
        const found = await foundSpecialIds(guildId, discordUserId);
        const guests = unlockedGuests(found).filter((o) => o.id !== specialId);
        const unmet = guests.filter((o) => !found.has(o.id));
        const from = unmet.length > 0 ? unmet : guests;
        if (from.length > 0) {
            guaranteedSpecialId = from[Math.min(from.length - 1, Math.floor(random() * from.length))]!.id;
            guaranteedInRuns = 1;
        }
    }
    const sameRuns = (guaranteedInRuns ?? 1) === state.guaranteedInRuns;
    if (guaranteedSpecialId === state.guaranteedSpecialId && sameRuns && JSON.stringify(losingStreak) === JSON.stringify(state.losingStreak)) return;
    await prisma.timerUserSettings.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, discordUserId, guaranteedSpecialId, guaranteedInRuns, losingStreak },
        update: { guaranteedSpecialId, guaranteedInRuns, losingStreak },
    });
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
        where: { guildId_discordUserId_setId_key: { guildId, discordUserId, setId: granted.set, key: '' } },
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
    /** Content, not a boost (the guest slice): Boosts off does not pause it. */
    content?: boolean;
    /**
     * Its set is turned off by the trainer (owner, 2026-11-20): listed in the
     * Boosts view as "(inactive)" at its own chance, with an empty pool so it
     * gives nothing.
     */
    inactive?: boolean;
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
 * A locked special never comes up from an extra. `guaranteed` (a special's
 * text, from `guaranteedOpener`: a lost Remedial Rehearsal) is the trainer's
 * own guarantee: it comes up whatever the roll, after a lock's guarantee.
 * `baseAdjust` (a Fortune Tent curse, e.g. -0.01) changes the usual special
 * share for this ping: 6% becomes 5%; it is never below 0.
 */
export async function chooseOpener(
    guildId: string,
    discordUserId: string,
    r: number,
    pool: readonly string[],
    extras: readonly ExtraChance[] = [],
    commons: readonly string[] = PING_OPENERS,
    guaranteed?: string,
    baseAdjust = 0,
): Promise<string> {
    const p = Math.max(0, RARE_OPENER_CHANCE + baseAdjust);
    const locks = await activeLocks(guildId);
    const locked = locks.map((l) => l.text);
    const mine = locks.find((l) => l.owner === discordUserId);
    // A guarantee: the owner's next ping is theirs, whatever the roll.
    if (mine && mine.ownerChance >= 1) return mine.text;
    if (guaranteed) return guaranteed;

    const raw = extras.map((e) => ({ chance: e.chance, pool: e.pool.filter((t) => !locked.includes(t)) })).filter((e) => e.chance > 0 && e.pool.length > 0);
    // The soft caps: when base plus boosts passes 20%, the boost slices
    // shrink in proportion so the total is exactly `effectiveChance`; the
    // base slice stays whole.
    const rawExtra = raw.reduce((sum, e) => sum + e.chance, 0);
    const keptExtra = Math.max(0, effectiveChance(p + rawExtra) - p);
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
    const u = r - start;
    const rest = u < p ? u : p + ((u - p) * (1 - p)) / (1 - start - p);

    const others = pool.filter((t) => !locked.includes(t));
    if (mine && rest < p) {
        if (rest < mine.ownerChance) return mine.text;
        if (others.length === 0) return pickCommon(() => (rest - mine.ownerChance) / (p - mine.ownerChance), commons);
        const share = (rest - mine.ownerChance) / (p - mine.ownerChance);
        return others[Math.min(others.length - 1, Math.floor(share * others.length))]!;
    }
    return pickOpener(rest, others, commons, p);
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
    /** Distinct specials they have found, extras left out (they still score). */
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
export async function specialsBoard(guildId: string, limit = 15, now: Date = new Date()): Promise<SpecialsBoard> {
    // Only specials that exist and are open at `now` (Special.opensAt) count.
    const ids = new Set(RARE_OPENERS.filter((o) => isOpenAt(o, now)).map((o) => o.id));
    const hits = (await prisma.rareOpenerHit.findMany({ where: { guildId, specialId: { not: null } }, orderBy: { at: 'asc' }, select: { discordUserId: true, specialId: true, at: true } })).filter(
        (h) => ids.has(h.specialId!),
    );
    // The Fortune Tent's fortunes score like a set (owner, 2026-11-15): 15 a
    // new fortune, 3 a repeat draw, 100 for all of them; they count as finds.
    const tentOpen = tentIsOpen(now);
    if (tentOpen) {
        const draws = await prisma.timerFortuneDraw.findMany({ where: { guildId }, select: { discordUserId: true, lineId: true, drawnAt: true } });
        const lines = new Set(FORTUNE_LINES.map((l) => l.id));
        hits.push(...draws.filter((d) => lines.has(d.lineId)).map((d) => ({ discordUserId: d.discordUserId, specialId: `${FORTUNE_READ_PREFIX}${d.lineId}`, at: d.drawnAt })));
        hits.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
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
        // Extras score as finds but never count toward a set, or the found count.
        // A special not open yet (Special.opensAt) does not count toward its set until it opens.
        const fortuneSet = tentOpen && FORTUNE_LINES.every((l) => u.found.has(`${FORTUNE_READ_PREFIX}${l.id}`)) ? 1 : 0;
        const setsComplete = SPECIAL_SETS.filter((s) => countsAsSet(s, now) && s.openers.some((o) => !o.extra) && s.openers.every((o) => o.extra || !isOpenAt(o, now) || u.found.has(o.id))).length + fortuneSet;
        const distinct = u.found.size;
        const points = distinct * SPECIAL_POINTS.found + (u.pings - distinct) * SPECIAL_POINTS.repeat + setsComplete * SPECIAL_POINTS.set;
        const found = [...u.found].filter((id) => !specialById(id)?.extra).length;
        return { discordUserId, points, setsComplete, found, pings: u.pings, reachedAt: u.reachedAt };
    });
    rows.sort((a, b) => b.points - a.points || a.reachedAt.getTime() - b.reachedAt.getTime());
    return {
        rows: rows.slice(0, limit),
        specialCount: RARE_OPENERS.filter((o) => !o.extra && isOpenAt(o, now)).length + (tentOpen ? FORTUNE_LINES.length : 0),
        setCount: SPECIAL_SETS.filter((s) => countsAsSet(s, now)).length + (tentOpen ? 1 : 0),
        totalPings: hits.length,
        trainers: rows.length,
    };
}
