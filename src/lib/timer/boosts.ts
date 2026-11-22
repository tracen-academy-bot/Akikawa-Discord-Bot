import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { EARLY_START, PAUSED_SETS, setLinesPool, PERSONAL_BOOSTS, RARE_OPENER_CHANCE, effectiveChance, SEASONAL_BUFFS, SPECIAL_SETS, activeSeasonals, boostPool, isOpenAt, guestSlice, outcomeBoostByKey, outcomeBoostLabel, outcomeBoostPool, rarePoolFor, specialById, type SeasonalBuff } from './openers';
import { fortuneButton, fortuneToday, hasTent } from './fortune';
import { activeBoosts, foundSpecialIds, lockedSetsFor, trainerPool, type ExtraChance } from './rares';
import { getUserSettings, type UserSettings } from './userSettings';
import { weeklyTierOf } from './rewards';

/**
 * Boosts: everything that adds special chance to a trainer's ping on top of
 * the base `RARE_OPENER_CHANCE`, and the panel's Boosts view of them.
 */

/** Custom ID of the Boosts view's On/Off button. Starts with `timer:` so the panel's handler gets it. */
export const BOOSTS_TOGGLE_ID = 'timer:boosts:toggle';

/** A chance as a percentage, e.g. 0.06 -> "6%", 0.105 -> "10.5%". */
function percent(chance: number): string {
    return `${Math.round(chance * 1000) / 10}%`;
}

/**
 * The extra special chances on one trainer's ping, when their Boosts are on:
 *
 *   - each set boost they hold, for a set they have on and unlocked: its
 *     chance, drawn from that set's lines with the boost's tag;
 *   - each outcome boost they hold (`OutcomeBoost`, e.g. Ramonu's lesson),
 *     for a set they have on and unlocked: its own chance, drawn from its one
 *     special or the set's lines (its extras left out);
 *   - early start, when the run was one: its chance, drawn from their usual
 *     special pool;
 *   - their personal boost (`PERSONAL_BOOSTS`), if they have one: its chance,
 *     drawn from their usual special pool;
 *   - their weekly tier (`WEEKLY_TIERS`: Abusers, Enjoyers, Regulars), from
 *     their place in the latest awarded week: its chance, drawn from their
 *     usual special pool, until the next week's results;
 *   - each seasonal buff running at `now`, when its special's set is on and
 *     unlocked for them: its chance, drawn from that one special. A buff on
 *     a set's prerequisite (Curren Chan) stops once that set is unlocked:
 *     it has done its job, and the set's unlock bonus takes over;
 *   - each set with an `unlockBonus` they have unlocked and on: its bonus,
 *     drawn from that set's lines;
 *   - today's Fortune Tent blessing (`fortuneToday`), until the daily reset:
 *     its chance, drawn from their usual special pool. A curse is not an
 *     extra: it lowers the base (`fortuneBaseAdjust`), Boosts on or off.
 *
 * And, Boosts on or off, the guest slice (`guestSlice`): content, not a
 * boost (`content: true`), so it is the only extra left with Boosts off.
 */
export async function extraChances(
    guildId: string,
    discordUserId: string,
    settings: UserSettings,
    lockedSets: readonly string[],
    earlyStart: boolean,
    pool: readonly string[],
    now: Date = new Date(),
    buffs: readonly SeasonalBuff[] = SEASONAL_BUFFS,
): Promise<ExtraChance[]> {
    const guests = guestSlice(await foundSpecialIds(guildId, discordUserId), settings.disabledSets, lockedSets);
    if (!settings.boosts) return guests ? [guests] : [];
    // A paused set (SpecialSet.paused) gives no new finds, so no boost draws on it.
    const usable = (setId: string) => !settings.disabledSets.includes(setId) && !lockedSets.includes(setId) && !PAUSED_SETS.includes(setId);
    // Turned off by the trainer (not locked or paused): listed as inactive, giving nothing (owner, 2026-11-20).
    const turnedOff = (setId: string) => settings.disabledSets.includes(setId) && !lockedSets.includes(setId) && !PAUSED_SETS.includes(setId);
    const extras: ExtraChance[] = [];
    // Adds a set-tied boost: whole while its set is usable, inactive while turned off, nothing otherwise.
    const add = (setId: string, e: ExtraChance) => {
        if (usable(setId)) extras.push(e);
        else if (turnedOff(setId)) extras.push({ ...e, pool: [], inactive: true });
    };
    for (const held of await activeBoosts(guildId, discordUserId)) {
        if (!usable(held.setId) && !turnedOff(held.setId)) continue;
        if (held.key) {
            const set = SPECIAL_SETS.find((s) => s.id === held.setId);
            const known = outcomeBoostByKey(held.key);
            const target = held.specialId ? specialById(held.specialId)?.name : `${set?.name ?? held.setId}: any of its lines`;
            const label = known ? outcomeBoostLabel(known, held.runsLeft) : `${target}, ${held.runsLeft} run${held.runsLeft === 1 ? '' : 's'} left.`;
            add(held.setId, { chance: held.chance ?? 0, pool: outcomeBoostPool({ set: held.setId, ...(held.specialId ? { special: held.specialId } : {}) }), label });
            continue;
        }
        const set = SPECIAL_SETS.find((s) => s.id === held.setId);
        const boost = set?.openers.find((o) => o.boost)?.boost;
        if (set && boost) {
            add(held.setId, {
                chance: boost.chance,
                pool: boostPool(held.setId, boost.tag),
                label: `${set.name} ${boost.tag} lines, ${held.runsLeft} run${held.runsLeft === 1 ? '' : 's'} left.`,
            });
        }
    }
    if (earlyStart) extras.push({ chance: EARLY_START.chance, pool, label: 'Early Start: you started this run quickly!' });
    for (const personal of PERSONAL_BOOSTS) {
        if (personal.owner === discordUserId) extras.push({ chance: personal.chance, pool, label: personal.label });
    }
    const tier = await weeklyTierOf(guildId, discordUserId);
    if (tier) extras.push({ chance: tier.chance, pool, label: `${tier.label} Until next week's results.` });
    for (const buff of activeSeasonals(now, buffs)) {
        // A set-wide buff (Mejiro week): that set's lines, while it is usable.
        if (buff.setId) {
            add(buff.setId, { chance: buff.chance, pool: setLinesPool(buff.setId), label: `${buff.label} Ends <t:${Math.floor(buff.until.getTime() / 1000)}:R>.` });
            continue;
        }
        const special = buff.specialId ? specialById(buff.specialId) : undefined;
        if (!special || (!usable(special.set) && !turnedOff(special.set))) continue;
        // Ends with the server's first Ramonu's Second Love; its end is never shown.
        if (buff.endsOnSecondLove) {
            if (await prisma.timerSecondLove.findUnique({ where: { guildId } })) continue;
            add(special.set, { chance: buff.chance, pool: [special.text], label: buff.label });
            continue;
        }
        const unlocksDone = SPECIAL_SETS.some((s) => s.requires === buff.specialId && !lockedSets.includes(s.id));
        if (unlocksDone) continue;
        add(special.set, { chance: buff.chance, pool: [special.text], label: `${buff.label} Ends <t:${Math.floor(buff.until.getTime() / 1000)}:R>.` });
    }
    for (const set of SPECIAL_SETS) {
        if (!set.unlockBonus || !set.requires || (!usable(set.id) && !turnedOff(set.id))) continue;
        if (set.unlockBonusUntil && now.getTime() >= set.unlockBonusUntil.getTime()) continue;
        const ends = set.unlockBonusUntil ? ` Ends <t:${Math.floor(set.unlockBonusUntil.getTime() / 1000)}:R>.` : '';
        add(set.id, { chance: set.unlockBonus, pool: set.openers.filter((o) => !o.extra && isOpenAt(o, now)).map((o) => o.text), label: `${set.unlockBonusLabel ?? `${set.name} unlocked: any of its lines.`}${ends}` });
    }
    const fortune = await fortuneToday(guildId, discordUserId, now);
    if (fortune && fortune.tier.delta > 0) extras.push({ chance: fortune.tier.delta, pool, label: fortune.tier.label });
    // Each boost keeps its rate per line (owner, 2026-11-19): it shrinks by the
    // share of its lines out of the trainer's pool (`trainerPool`: resting,
    // held). So "any Mejiro line" on a resting Estate with only Ramonu left is
    // a ninth of its chance on Ramonu, not all of it. Boosts on the trainer's
    // own pool lose nothing; the guest slice keeps its own math.
    // Boosts on the usual pool (`pool`, already the trainer's) are left whole.
    const scaled = await Promise.all(extras.map((e) => (e.pool === pool ? e : perLine(guildId, discordUserId, e))));
    if (guests) scaled.push(guests);
    return scaled;
}

/** A boost with its pool narrowed to the trainer's (`trainerPool`) and its chance cut by the share of lines left out. */
async function perLine(guildId: string, discordUserId: string, e: ExtraChance): Promise<ExtraChance> {
    if (e.pool.length === 0) return e;
    const left = await trainerPool(guildId, discordUserId, e.pool);
    // Nothing left: it gives nothing either way; keep its own chance for the Boosts view ("inactive").
    if (left.length === 0) return { ...e, pool: left };
    return left.length === e.pool.length ? { ...e, pool: left } : { ...e, pool: left, chance: (e.chance * left.length) / e.pool.length };
}

/**
 * How much today's Fortune Tent curse lowers a trainer's base special
 * chance (e.g. -0.01), or 0. Not a boost: Boosts off does not pause it.
 */
export async function fortuneBaseAdjust(guildId: string, discordUserId: string, now: Date = new Date()): Promise<number> {
    const fortune = await fortuneToday(guildId, discordUserId, now);
    return fortune && fortune.tier.delta < 0 ? fortune.tier.delta : 0;
}

/**
 * The Boosts view, only to the trainer: the base chance, each boost that
 * applies to their next ping, how to get early start, and the total chance
 * of a special on their next ping. With Boosts off, the boosts are listed as
 * paused and the total is the base. A button turns Boosts on or off.
 */
export async function boostsView(guildId: string, discordUserId: string, now: Date = new Date()) {
    const [settings, lockedSets, timer] = await Promise.all([
        getUserSettings(guildId, discordUserId),
        lockedSetsFor(guildId, discordUserId),
        prisma.trainingTimer.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } }),
    ]);
    const pool = await trainerPool(guildId, discordUserId, rarePoolFor(settings.disabledSets, lockedSets, now));
    // Listed as if Boosts were on, so paused ones still show.
    const all = await extraChances(guildId, discordUserId, { ...settings, boosts: true }, lockedSets, timer?.earlyStart ?? false, pool, now);
    // Every set they could have on is turned off (owner, 2026-11-20): boosts on
    // the usual pool (personal, tier, Fortune, early start) are inactive too.
    const openSets = SPECIAL_SETS.filter((s) => !lockedSets.includes(s.id) && !PAUSED_SETS.includes(s.id));
    const allOff = openSets.length > 0 && openSets.every((s) => settings.disabledSets.includes(s.id));
    // Inactive (owner, 2026-11-20): what the trainer turned off (its set, or
    // every set), listed at its own chance, "(inactive)". A boost with nothing
    // to land on for other reasons (e.g. Ramonu held for a lesson) is a hidden
    // thing: not shown.
    const isInactive = (e: ExtraChance) => e.inactive === true || (allOff && e.pool === pool && !e.content);
    const inactive = all.filter(isInactive);
    const extras = all.filter((e) => !isInactive(e) && e.pool.length > 0 && e.chance > 0);
    // Nothing anywhere: no line on, no boost or slice with anything to find.
    const nothing = pool.length === 0 && extras.length === 0;
    // Fortune Tent: a curse lowers the base, Boosts on or off; the button once they have the tent.
    const fortune = await fortuneToday(guildId, discordUserId, now);
    const curse = fortune && fortune.tier.delta < 0 ? fortune : null;
    const tent = await hasTent(guildId, discordUserId, now);
    const base = pool.length > 0 ? Math.max(0, RARE_OPENER_CHANCE + (curse?.tier.delta ?? 0)) : 0;
    // The guest slice is content, not a boost: it counts with Boosts off too.
    const rawTotal = base + extras.filter((e) => settings.boosts || e.content).reduce((sum, e) => sum + e.chance, 0);
    const total = base > 0 ? effectiveChance(rawTotal) : rawTotal;

    const lines = allOff
        ? ['**All sets have been disabled. Enable one to find specials!**', '']
        : nothing
          ? ["**Nothing left to find.** Everything you have on is found or waiting, so your pings can't be specials right now. Turn a set back on in Specials to find repeats.", '']
          : [];
    lines.push(`**Base:** ${percent(RARE_OPENER_CHANCE)} on every ping${pool.length === 0 ? ' (nothing to find in your sets)' : ''}.`);
    if (curse) lines.push(`**-${percent(-curse.tier.delta)}** ${curse.tier.label}`);
    if (extras.length === 0 && inactive.length === 0) lines.push('No boosts right now.');
    for (const e of extras) lines.push(`**+${percent(e.chance)}** ${e.label ?? ''}${settings.boosts || e.content ? '' : ' (paused)'}`);
    for (const e of inactive) lines.push(`**+${percent(e.chance)}** ${e.label ?? ''} (inactive)`);
    if (!timer?.earlyStart && !nothing) {
        lines.push(
            `-# Early Start: start your next run quickly for +${percent(EARLY_START.chance)} overall!`,
        );
    }
    lines.push('', `**Your next ping: ${percent(total)} chance of a special.**`);
    if (total < rawTotal - 1e-9) lines.push(`-# Raw ${percent(rawTotal)} before the soft caps: raw over 20% counts at half, raw over 30% at a quarter, 30% at most.`);
    if (!settings.boosts) lines.push('Boosts are off, so they are paused. Turn them on below.');

    const embed = new EmbedBuilder().setColor(0xf2a87a).setTitle('Your boosts').setDescription(lines.join('\n'));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(BOOSTS_TOGGLE_ID)
            .setLabel(`Boosts: ${settings.boosts ? 'On' : 'Off'}`)
            .setStyle(settings.boosts ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    if (tent) row.addComponents(fortuneButton(fortune !== null));
    return { embeds: [embed], components: [row] };
}
