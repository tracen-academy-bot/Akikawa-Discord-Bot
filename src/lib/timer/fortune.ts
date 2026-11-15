import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { TENT_OPENS, specialIdOf } from './openers';
import { foundSpecialIds } from './rares';
import { dayKey } from './service';
import { pingBox } from './pingBox';

/**
 * Fuku-chan's Fortune Tent (docs/special-sets/fortune-tent.md; owner's
 * decisions of 2026-11-15). Once a trainer has found both Matikanes
 * (Tannhauser and Fukukitaru), and from `TENT_OPENS`, they can draw one
 * omikuji a day from the Boosts view. A blessing is an extra slice of
 * special chance (a boost: paused with Boosts off); a curse lowers the base
 * chance (never paused). Both last until the daily reset (`dayKey`).
 *
 * Not a special set: no page, no completion, no points for draws.
 */

export { TENT_OPENS } from './openers';

/** The two specials that open the tent. */
export const TENT_PAIR = ['set1.matikane', 'set1.fukukitaru'] as const;

/** Added to the ping that completes the pair (or a trainer's first ping after the tent opens, if they had both). */
export const TENT_UNLOCK_LINE = "**Congrats!** Fuku-chan's Fortune Tent unlocked!";

/** The introduction: the trainer's next run's ping after the unlock, once ever. `{user}` is the trainer's mention. */
export const TENT_INTRO = [
    'Machitan: "Babaan! {user}, welcome to the Matikane Fortune Tent! Every morning, Fuku-chan senpai reads my fortune before breakfast... and this morning it said a very special visitor was coming. Uhihi, and here you are!"',
    'Fuku: "Mumu! Shiraoki-sama\'s oracles are never wrong! Machitan carries my charm, I carry the crystal ball, and together we are... the Matikanes! ...Not sisters, by the way. Just roommates."',
    'Machitan: "Totally ordinary roommates! But I\'m ordinary at everything, and meeting you was the one lucky thing that\'s special. So I want to share the luck back. Ei, ei, mun!"',
    'Fuku: "One omikuji a day, Trainer-san. Great blessing or great curse, Shiraoki-sama decides! Namu, namu!"',
    "-# Fuku-chan's Fortune Tent is open: draw one omikuji a day from **Boosts**. Blessings raise your special chance for the day; curses lower it.",
].join('\n');

/** One result line of a tier. Stable `id`, stored with the draw. */
export interface FortuneLine {
    id: string;
    text: string;
}

/** One tier of the omikuji. The weights are never shown to trainers. */
export interface FortuneTier {
    /** Stable id, stored with the draw. */
    id: string;
    /** The result box's heading (`pingBox` adds the "### "). */
    heading: string;
    /** The "-#" effect line under the scene. */
    effect: string;
    /** Special chance for the day: positive is a blessing slice, negative lowers the base. */
    delta: number;
    /** Chance of drawing it, in percent (the weights add up to 100). */
    weight: number;
    /** The Boosts view's label after the chance. */
    label: string;
    lines: readonly FortuneLine[];
}

/** The tiers, in order (owner, 2026-11-15). */
export const FORTUNE_TIERS: readonly FortuneTier[] = [
    {
        id: 'oracle',
        heading: "Shiraoki-sama's Oracle",
        effect: "-# Shiraoki-sama's Oracle: +5% chance of a special line until the daily reset.",
        delta: 0.05,
        weight: 1,
        label: "Fortune: Shiraoki-sama's Oracle, until the daily reset.",
        lines: [
            {
                id: 'oracle.sky',
                text: [
                    'Fuku: "N-nyaa-san...?! {user}-san, don\'t move! Sky-san dozed off on the table, every cat in Tracen followed her in, and now Shiraoki-sama\'s own messenger is sitting on the crystal ball! This isn\'t a fortune, it\'s an ORACLE! Namu, namu, namu!"',
                    'Sky: "Nyahaha... Sei-chan\'s just napping. Don\'t mind me~"',
                    'Machitan: "B-babaaan?! That\'s good, right?! Ei, ei, MUN!"',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'super',
        heading: '超吉 Super blessing',
        effect: "-# Today's fortune: +3% chance of a special line until the daily reset.",
        delta: 0.03,
        weight: 4,
        label: 'Fortune: Super blessing, until the daily reset.',
        lines: [
            {
                id: 'super.rickey',
                text: [
                    'Rickey: "Rikkii Rakkii! I turned the whole tent to face today\'s lucky direction. Go on, draw!"',
                    'Fuku: "Th-this is beyond great blessing... a SUPER blessing! {user}-san, for today you\'re invincible!"',
                    'Rickey: "Daikisshou! See? Feng shui is basically statistics!"',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'great',
        heading: '大吉 Great blessing',
        effect: "-# Today's fortune: +2% chance of a special line until the daily reset.",
        delta: 0.02,
        weight: 15,
        label: 'Fortune: Great blessing, until the daily reset.',
        lines: [
            {
                id: 'great.tea',
                text: [
                    'Fuku: "Daikichi! {user}-san, three tea stalks stood up in my cup this morning, and not one of them sank! Grab that good fortune before it runs off!"',
                    'Machitan: "Uhihi, that beats mine! I got a small blessing. Very ordinary!"',
                ].join('\n'),
            },
            {
                id: 'great.taiki',
                text: [
                    'Taiki: "Howdy! Fuku and I baked fortune cookies, and this one is for {user}! Crack it open!"',
                    'Fuku: "Mumu! Great blessing! Taiki-san, your cookies have spiritual power!"',
                    'Taiki: "Yippee-ki-yay! Fortune party dēsu!"',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'blessing',
        heading: '吉 Blessing',
        effect: "-# Today's fortune: +1% chance of a special line until the daily reset.",
        delta: 0.01,
        weight: 25,
        label: 'Fortune: Blessing, until the daily reset.',
        lines: [
            {
                id: 'blessing.rice',
                text: [
                    'Fuku: "A blessing! {user}-san, a good, honest blessing... and look, Rice-san drew one too!"',
                    'Rice: "R-Rice did? Not a curse? ...Rice really did. Ganbaru zo, oh!"',
                    'Machitan: "Uhihi, a good day for everyone! Mun!"',
                ].join('\n'),
            },
            {
                id: 'blessing.blue',
                text: [
                    'Fuku: "A blessing! {user}-san, today\'s lucky colour is blue, and the lucky item is... potato salad?"',
                    'Machitan: "Blue Machitan and potato salad?! Fuku-chan senpai, that\'s just my lunch! Babaan!"',
                ].join('\n'),
            },
            {
                id: 'blessing.suzuka',
                text: [
                    'Fuku: "A blessing! {user}-san, I prayed for Suzuka-san this morning, and some of it must have spilled over onto you!"',
                    'Suzuka: "Fufu... thank you, Fukukitaru. Then I\'ll run a little extra today. The view from the front should be nice..."',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'small',
        heading: '小吉 Small blessing',
        effect: "-# Today's fortune: +0.5% chance of a special line until the daily reset.",
        delta: 0.005,
        weight: 25,
        label: 'Fortune: Small blessing, until the daily reset.',
        lines: [
            {
                id: 'small.machitan',
                text: [
                    'Fuku: "A small blessing! {user}-san, it\'s small, but a blessing is a blessing! The crystal ball says: take it slow, and don\'t skip lunch."',
                    'Machitan: "Very ordinary. I love it! Ei, ei, mun!"',
                ].join('\n'),
            },
            {
                id: 'small.nature',
                text: [
                    'Fuku: "Small blessing! {user}-san, that\'s not bad at all!"',
                    'Nature: "Not great, not bad... very me. My usual third place! ...Just kidding."',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'curse',
        heading: '凶 Curse',
        effect: "-# Today's fortune: -1% chance of a special line until the daily reset.",
        delta: -0.01,
        weight: 20,
        label: 'Fortune: Curse, until the daily reset.',
        lines: [
            {
                id: 'curse.crystal',
                text: [
                    'Fuku: "A curse... {user}-san, I\'m so sorry, the crystal ball went all cloudy... namu, namu..."',
                    'Machitan: "Don\'t cry, Fuku-chan senpai! We\'ll draw again tomorrow! Ei, ei, mun!"',
                ].join('\n'),
            },
            {
                id: 'curse.doto',
                text: [
                    'Doto: "Hiee... I only wanted to help hang the charms, and now they\'re all tangled, and {user}-san drew a curse... someone like me shouldn\'t touch lucky things... sumimaseeen!"',
                    'Fuku: "Doto-san, the charms aren\'t cursed, the ribbon is just knotted! ...Mostly."',
                ].join('\n'),
            },
        ],
    },
    {
        id: 'great-curse',
        heading: '大凶 Great curse',
        effect: "-# Today's fortune: -2% chance of a special line until the daily reset.",
        delta: -0.02,
        weight: 10,
        label: 'Fortune: Great curse, until the daily reset.',
        lines: [
            {
                id: 'great-curse.cat',
                text: [
                    'Fuku: "D-daikyou... a GREAT curse... and a black cat just walked right past the tent... {user}-san, it\'s hopeless~!"',
                    'Machitan: "Hiii! Fuku-chan senpai, quick, call the Charm Army!"',
                ].join('\n'),
            },
            // Owner, 2026-11-15 (final copy): Air Groove hands back the Shigaraki tanuki Fuku once gave her.
            {
                id: 'great-curse.groove',
                text: [
                    "Fuku: \"D-daikyou... {user}-san, it's a GREAT curse, and the black cat is back, and—\"",
                    "Groove: \"Mattaku. What is this racket outside the student council room? ...Fukukitaru. It is a cat. Not the end of the world.\"",
                    "Groove: \"...Still. Kisama, take this. A Shigaraki tanuki. Fukukitaru insisted it would bring luck, and I am in no mood to argue with a crystal ball. Just in case.\"",
                    "Fuku: \"Air Groove-san... you kept it all this time?!\"",
                    "Machitan: \"Ei, ei, mun! ...It's still a great curse though, isn't it.\" / Groove: \"Yes. But perhaps a smaller one.\"",
                ].join('\n'),
            },
        ],
    },
];

/** The tier with id `id`, or undefined. */
export function fortuneTier(id: string): FortuneTier | undefined {
    return FORTUNE_TIERS.find((t) => t.id === id);
}

/** The tier a roll `r` in [0, 1) lands on: the tiers cut [0, 1) in order by weight. */
export function tierForRoll(r: number): FortuneTier {
    const total = FORTUNE_TIERS.reduce((sum, t) => sum + t.weight, 0);
    const x = Math.min(Math.max(r, 0), 1 - 1e-12) * total;
    let start = 0;
    for (const tier of FORTUNE_TIERS) {
        if (x < start + tier.weight) return tier;
        start += tier.weight;
    }
    return FORTUNE_TIERS[FORTUNE_TIERS.length - 1]!;
}

/**
 * A line of `tier` from a roll `r` in [0, 1), evenly, never `previousLineId`
 * (the trainer's previous draw) unless it is the tier's only line.
 */
export function lineForRoll(tier: FortuneTier, r: number, previousLineId: string | null = null): FortuneLine {
    const others = tier.lines.filter((l) => l.id !== previousLineId);
    const from = others.length > 0 ? others : tier.lines;
    return from[Math.min(from.length - 1, Math.floor(Math.max(r, 0) * from.length))]!;
}

/** Whether the tent exists at `now`. */
export function tentIsOpen(now: Date = new Date()): boolean {
    return now.getTime() >= TENT_OPENS.getTime();
}

/** True when `found` (special ids) holds both Matikanes. */
export function hasPair(found: ReadonlySet<string>): boolean {
    return TENT_PAIR.every((id) => found.has(id));
}

/** Whether a trainer has the tent at `now`: it is open, and they have found both Matikanes. */
export async function hasTent(guildId: string, discordUserId: string, now: Date = new Date()): Promise<boolean> {
    if (!tentIsOpen(now)) return false;
    return hasPair(await foundSpecialIds(guildId, discordUserId));
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
