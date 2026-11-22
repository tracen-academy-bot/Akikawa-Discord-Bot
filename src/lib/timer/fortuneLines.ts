import { TENT_OPENS } from './openers';

/**
 * Fuku-chan's Fortune Tent: its texts and tiers (no database, no Discord),
 * so the Specials pages can list the fortunes without importing the draw.
 * See `fortune.ts`.
 */

export { TENT_OPENS } from './openers';

/** The two specials that open the tent. */
export const TENT_PAIR = ['set1.matikane', 'set1-2.fukukitaru'] as const;

/** Added to the ping that completes the pair (or a trainer's first ping after the tent opens, if they had both). */
export const TENT_UNLOCK_LINE = "**Congrats!** Fuku-chan's Fortune Tent unlocked!";

/** The introduction: the trainer's next run's ping after the unlock, once ever. `{user}` is the trainer's mention. */
export const TENT_INTRO = [
    'Machitan: "Babaan! {user}, welcome to the Matikane Fortune Tent! Every morning, Fuku-chan senpai reads my fortune before breakfast... and this morning it said a very special visitor was coming. Uhihi, and here you are!"',
    'Fuku: "Mumu! Shiraoki-sama\'s oracles are never wrong! Machitan carries my charm, I carry the crystal ball, and together we are... the Matikanes! ...Not sisters, by the way!"',
    'Machitan: "Totally not sisters! I\'m ordinary at everything, but meeting you was the one lucky thing that\'s special. So I want to share the luck back. Ei, ei, mun!"',
    'Fuku: "One omikuji a day, Trainer-san. Great blessing or great curse, Shiraoki-sama decides! Namu, namu!"',
    "-# Fuku-chan's Fortune Tent is open: draw one omikuji a day from **Boosts**. Blessings raise your special chance for the day; curses lower it.",
].join('\n');

/** One result line of a tier. Stable `id`, stored with the draw. */
export interface FortuneLine {
    id: string;
    /** Its row on the Set 4 Specials page, once drawn (owner, 2026-11-15). */
    name: string;
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
                name: "Shiraoki-sama's Oracle",
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
                name: "超吉: Copano Rickey",
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
                name: "大吉: Tea Stalks",
                text: [
                    'Fuku: "Daikichi! {user}-san, three tea stalks stood up in my cup this morning, and not one of them sank! Grab that good fortune before it runs off!"',
                    'Machitan: "Uhihi, that beats mine! I got a small blessing. Very ordinary!"',
                ].join('\n'),
            },
            {
                id: 'great.taiki',
                name: "大吉: Taiki Shuttle",
                text: [
                    'Taiki: "Howdy! Fuku and I baked fortune cookies, and this one is for {user}! Crack it open!"',
                    'Fuku: "Mumu! Great blessing! Taiki-san, your cookies have spiritual power!"',
                    'Taiki: "Yippee-ki-yay! Fortune party!"',
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
                name: "吉: Rice Shower",
                text: [
                    'Fuku: "A blessing! {user}-san, a good, honest blessing... and look, Rice-san drew one too!"',
                    'Rice: "R-Rice did? Not a curse? ...Rice really did. Ganbaru zo, oh!"',
                    'Machitan: "Uhihi, a good day for everyone! Mun!"',
                ].join('\n'),
            },
            {
                id: 'blessing.blue',
                name: "吉: Blue Machitan",
                text: [
                    'Fuku: "A blessing! {user}-san, today\'s lucky colour is blue, and the lucky item is... potato salad?"',
                    'Machitan: "Blue Machitan and potato salad?! Fuku-chan senpai, that\'s just my lunch! Babaan!"',
                ].join('\n'),
            },
            {
                id: 'blessing.suzuka',
                name: "吉: Silence Suzuka",
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
                name: "小吉: Matikanetannhauser",
                text: [
                    'Fuku: "A small blessing! {user}-san, it\'s small, but a blessing is a blessing! The crystal ball says: take it slow, and don\'t skip lunch."',
                    'Machitan: "Very ordinary. I love it! Ei, ei, mun!"',
                ].join('\n'),
            },
            {
                id: 'small.nature',
                name: "小吉: Nice Nature",
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
                name: "凶: The Cloudy Crystal Ball",
                text: [
                    'Fuku: "A curse... {user}-san, I\'m so sorry, the crystal ball went all cloudy... namu, namu..."',
                    'Machitan: "Don\'t cry, Fuku-chan senpai! We\'ll draw again tomorrow! Ei, ei, mun!"',
                ].join('\n'),
            },
            {
                id: 'curse.doto',
                name: "凶: Meisho Doto",
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
                name: "大凶: The Black Cat",
                text: [
                    'Fuku: "D-daikyou... a GREAT curse... and a black cat just walked right past the tent... {user}-san, it\'s hopeless~!"',
                    'Machitan: "Hiii! Fuku-chan senpai, quick, call the Charm Army!"',
                ].join('\n'),
            },
            // Owner, 2026-11-15 (final copy): Air Groove hands back the Shigaraki tanuki Fuku once gave her.
            {
                id: 'great-curse.groove',
                name: "大凶: Air Groove",
                text: [
                    "Fuku: \"D-daikyou... {user}-san, it's a GREAT curse, and the black cat is back, and—\"",
                    "Groove: \"Mattaku. What is this racket outside the student council room? ...Fukukitaru. It is a cat. Not the end of the world.\"",
                    "Groove: \"...Still. Kisama, take this. A Shigaraki tanuki. Fukukitaru insisted it would bring luck, and I am in no mood to argue with a crystal ball. Just in case.\"",
                    "Fuku: \"Air Groove-san... you kept it all this time?!\"",
                    "Machitan: \"Ei, ei, mun! ...It's still a great curse though, isn't it.\"",
                    "Groove: \"Yes. But perhaps a smaller one.\"",
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

/** Every fortune, in Set 4 order (the tiers' order). */
export const FORTUNE_LINES: readonly (FortuneLine & { tier: string })[] = FORTUNE_TIERS.flatMap((t) => t.lines.map((l) => ({ ...l, tier: t.id })));

/** The fortune with id `id` and its tier, or undefined. */
export function fortuneLineById(id: string): { tier: FortuneTier; line: FortuneLine } | undefined {
    for (const tier of FORTUNE_TIERS) {
        const line = tier.lines.find((l) => l.id === id);
        if (line) return { tier, line };
    }
    return undefined;
}
