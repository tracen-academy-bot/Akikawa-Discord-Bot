import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { EARLY_START, RARE_OPENER_CHANCE, SEASONAL_BUFFS, SPECIAL_SETS, activeSeasonals, boostPool, rarePoolFor, specialById, type SeasonalBuff } from './openers';
import { activeBoosts, lockedSetsFor, type ExtraChance } from './rares';
import { getUserSettings, type UserSettings } from './userSettings';

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
 *   - early start, when the run was one: its chance, drawn from their usual
 *     special pool;
 *   - each seasonal buff running at `now`, when its special's set is on and
 *     unlocked for them: its chance, drawn from that one special;
 *   - each set with an `unlockBonus` they have unlocked and on: its bonus,
 *     drawn from that set's lines.
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
    if (!settings.boosts) return [];
    const usable = (setId: string) => !settings.disabledSets.includes(setId) && !lockedSets.includes(setId);
    const extras: ExtraChance[] = [];
    for (const held of await activeBoosts(guildId, discordUserId)) {
        if (!usable(held.setId)) continue;
        const set = SPECIAL_SETS.find((s) => s.id === held.setId);
        const boost = set?.openers.find((o) => o.boost)?.boost;
        if (set && boost) {
            extras.push({
                chance: boost.chance,
                pool: boostPool(held.setId, boost.tag),
                label: `${set.name} ${boost.tag} lines, ${held.runsLeft} run${held.runsLeft === 1 ? '' : 's'} left`,
            });
        }
    }
    if (earlyStart) extras.push({ chance: EARLY_START.chance, pool, label: 'Early start, on your current run' });
    for (const buff of activeSeasonals(now, buffs)) {
        const special = specialById(buff.specialId);
        if (!special || !usable(special.set)) continue;
        extras.push({ chance: buff.chance, pool: [special.text], label: `${buff.label}: ${special.name} only, ends <t:${Math.floor(buff.until.getTime() / 1000)}:R>` });
    }
    for (const set of SPECIAL_SETS) {
        if (!set.unlockBonus || !set.requires || !usable(set.id)) continue;
        extras.push({ chance: set.unlockBonus, pool: set.openers.map((o) => o.text), label: `${set.name} unlocked: any of its lines` });
    }
    return extras;
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
    const pool = rarePoolFor(settings.disabledSets, lockedSets);
    // Listed as if Boosts were on, so paused ones still show.
    const extras = (await extraChances(guildId, discordUserId, { ...settings, boosts: true }, lockedSets, timer?.earlyStart ?? false, pool, now)).filter(
        (e) => e.pool.length > 0,
    );
    const base = pool.length > 0 ? RARE_OPENER_CHANCE : 0;
    const total = base + (settings.boosts ? extras.reduce((sum, e) => sum + e.chance, 0) : 0);

    const lines = [`**Base:** ${percent(RARE_OPENER_CHANCE)} on every ping${pool.length === 0 ? ' (every special set is off for you)' : ''}.`];
    if (extras.length === 0) lines.push('No boosts right now.');
    for (const e of extras) lines.push(`**+${percent(e.chance)}** ${e.label ?? ''}${settings.boosts ? '' : ' (paused)'}`);
    if (!timer?.earlyStart) {
        lines.push(
            `-# Early start: start your next run within ${EARLY_START.windowMinutes} minutes of a ping (${EARLY_START.earlyRiserWindowMinutes} as an early riser) for +${percent(EARLY_START.chance)} on it.`,
        );
    }
    lines.push('', `**Your next ping: ${percent(total)} chance of a special.**`);
    if (!settings.boosts) lines.push('Boosts are off, so they are paused. Turn them on below.');

    const embed = new EmbedBuilder().setColor(0xf2a87a).setTitle('Your boosts').setDescription(lines.join('\n'));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(BOOSTS_TOGGLE_ID)
            .setLabel(`Boosts: ${settings.boosts ? 'On' : 'Off'}`)
            .setStyle(settings.boosts ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
}
