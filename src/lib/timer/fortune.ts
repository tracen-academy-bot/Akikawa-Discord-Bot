import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { foundSpecialIds } from './rares';
import { dayKey } from './service';
import { pingBox } from './pingBox';
import { specialIdOf } from './openers';
import { TENT_INTRO, TENT_PAIR, TENT_UNLOCK_LINE, fortuneTier, lineForRoll, tentIsOpen, tierForRoll, type FortuneLine, type FortuneTier } from './fortuneLines';

/**
 * Fuku-chan's Fortune Tent (docs/special-sets/fortune-tent.md; owner's
 * decisions of 2026-11-15). Once a trainer has found both Matikanes
 * (Tannhauser and Fukukitaru), and from `TENT_OPENS`, they can draw one
 * omikuji a day from the Boosts view. A blessing is an extra slice of
 * special chance (a boost: paused with Boosts off); a curse lowers the base
 * chance (never paused). Both last until the daily reset (`dayKey`).
 *
 * Not a special pool: its fortunes are listed and scored as Set 4 on the
 * Specials pages (owner, 2026-11-15; see `rares.ts`). Texts and tiers live
 * in `fortuneLines.ts`.
 */

export * from './fortuneLines';

/** True when `found` (special ids) holds both Matikanes. */
export function hasPair(found: ReadonlySet<string>): boolean {
    return TENT_PAIR.every((id) => found.has(id));
}

/** Whether a trainer has the tent at `now`: it is open, and they have found both Matikanes. */
export async function hasTent(guildId: string, discordUserId: string, now: Date = new Date()): Promise<boolean> {
    if (!tentIsOpen(now)) return false;
    if (!hasPair(await foundSpecialIds(guildId, discordUserId))) return false;
    // Owner, 2026-11-22: the Fortune button (and draws) wait for the unlock line and the intro.
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { tentUnlocked: true, tentIntroOwed: true } });
    return (row?.tentUnlocked ?? false) && !(row?.tentIntroOwed ?? false);
}

/** A draw as stored, with its tier and line resolved. */
export interface FortuneDraw {
    day: string;
    tier: FortuneTier;
    line: FortuneLine;
}

function resolve(row: { day: string; tier: string; lineId: string } | null): FortuneDraw | null {
    if (!row) return null;
    const tier = fortuneTier(row.tier);
    const line = tier?.lines.find((l) => l.id === row.lineId);
    return tier && line ? { day: row.day, tier, line } : null;
}

/** A trainer's draw for the day of `now` (until the daily reset), or null. */
export async function fortuneToday(guildId: string, discordUserId: string, now: Date = new Date()): Promise<FortuneDraw | null> {
    if (!tentIsOpen(now)) return null;
    return resolve(await prisma.timerFortuneDraw.findUnique({ where: { guildId_discordUserId_day: { guildId, discordUserId, day: dayKey(now) } } }));
}

/**
 * Draws today's omikuji for a trainer: null when they do not have the tent.
 * `fresh` is false when they had already drawn today (that draw comes back
 * unchanged; one per day, even across a redeploy or a double press). Two
 * random numbers: the tier, then the line within it.
 */
export async function drawFortune(
    guildId: string,
    discordUserId: string,
    now: Date = new Date(),
    random: () => number = Math.random,
): Promise<{ draw: FortuneDraw; fresh: boolean } | null> {
    if (!(await hasTent(guildId, discordUserId, now))) return null;
    const day = dayKey(now);
    const existing = await fortuneToday(guildId, discordUserId, now);
    if (existing) return { draw: existing, fresh: false };
    const previous = await prisma.timerFortuneDraw.findFirst({ where: { guildId, discordUserId }, orderBy: { drawnAt: 'desc' } });
    const tier = tierForRoll(random());
    const line = lineForRoll(tier, random(), previous?.lineId ?? null);
    try {
        await prisma.timerFortuneDraw.create({ data: { guildId, discordUserId, day, tier: tier.id, lineId: line.id, drawnAt: now } });
    } catch (e) {
        // A second press raced the first: theirs stands.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const won = await fortuneToday(guildId, discordUserId, now);
            if (won) return { draw: won, fresh: false };
        }
        throw e;
    }
    return { draw: { day, tier, line }, fresh: true };
}

/** A draw's result box, only to the trainer: the tier heading, the scene with `{user}` filled, then its effect line. */
export function fortuneBox(draw: FortuneDraw, discordUserId: string) {
    const box = pingBox({ heading: draw.tier.heading, text: `${draw.line.text.replaceAll('{user}', `<@${discordUserId}>`)}\n${draw.tier.effect}` });
    return { ...box, flags: box.flags | MessageFlags.Ephemeral, allowedMentions: { parse: [] as [] } };
}

/** The introduction ping's text, `{user}` filled. */
export function tentIntroText(discordUserId: string): string {
    return TENT_INTRO.replaceAll('{user}', `<@${discordUserId}>`);
}

/** Custom ID of the Boosts view's Fortune button. Starts with `timer:` so the panel's handler gets it. */
export const FORTUNE_BUTTON_ID = 'timer:boosts:fortune';

/** The Fortune button: "Fortune", or "Drawn today" and greyed out once drawn. */
export function fortuneButton(drawn: boolean): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(FORTUNE_BUTTON_ID)
        .setLabel(drawn ? 'Drawn today' : 'Fortune')
        .setStyle(drawn ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(drawn);
}

/**
 * The tent's line for a ping, if it is the one that announces the unlock:
 * from `TENT_OPENS`, the first ping on which the trainer has both Matikanes
 * (`opener`, this ping's line, counts as found). `record` marks the unlock
 * announced and the introduction owed; call it once the ping is posted.
 */
export async function tentUnlockNotice(guildId: string, discordUserId: string, opener: string, now: Date = new Date()): Promise<{ line: string; record: () => Promise<void> } | null> {
    if (!tentIsOpen(now)) return null;
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { tentUnlocked: true } });
    if (row?.tentUnlocked) return null;
    const found = await foundSpecialIds(guildId, discordUserId);
    const id = specialIdOf(opener);
    if (id) found.add(id);
    if (!hasPair(found)) return null;
    return {
        line: TENT_UNLOCK_LINE,
        record: async () => {
            await prisma.timerUserSettings.upsert({
                where: { guildId_discordUserId: { guildId, discordUserId } },
                create: { guildId, discordUserId, tentUnlocked: true, tentIntroOwed: true },
                update: { tentUnlocked: true, tentIntroOwed: true },
            });
        },
    };
}

/**
 * Whether this run's ping is the tent's introduction: it is owed, the tent
 * is open, and no guarantee fires on this run (`guaranteeDue`: Ramonu's
 * Remedial Rehearsal, a Helios guest), which wins; the intro then waits.
 */
export async function tentIntroDue(guildId: string, discordUserId: string, guaranteeDue: boolean, now: Date = new Date()): Promise<boolean> {
    if (guaranteeDue || !tentIsOpen(now)) return false;
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { tentIntroOwed: true } });
    return row?.tentIntroOwed ?? false;
}

/** The introduction was posted: never again. */
export async function tentIntroShown(guildId: string, discordUserId: string): Promise<void> {
    await prisma.timerUserSettings.updateMany({ where: { guildId, discordUserId }, data: { tentIntroOwed: false } });
}
