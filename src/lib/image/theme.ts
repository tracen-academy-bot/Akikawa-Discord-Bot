import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';

/**
 * Visual system shared by every rendered image.
 *
 * One accent colour -- gold -- carries structure: rules, headings, the figure
 * a trainer needs to hit. Red is reserved for a single meaning, "behind", so it
 * keeps its urgency. Everything else is a warm near-black and a short scale of
 * warm greys. Placement colours mark the top four by a left bar and name tint
 * rather than by medal glyphs.
 */
export const THEME = {
    bg: '#0c0b0b',
    bgRaised: '#121010',
    gold: '#d4a54a',
    goldDim: 'rgba(212, 165, 74, 0.55)',
    text: '#e9e6df',
    muted: '#8b877f',
    faint: '#6e6a63',
    line: '#1e1b19',
    red: '#d0584c',
    green: '#8fbf6a',
    /** 1st through 4th place. */
    place: ['#e9c8f2', '#d4a54a', '#d5d6dc', '#c97c4c'] as const,
} as const;

/** Placement colour for a 1-based rank, or null past fourth. */
export function placeColor(rank: number): string | null {
    return THEME.place[rank - 1] ?? null;
}

/** Horizontal anchor. Declared locally so no DOM lib is needed to compile. */
export type Align = 'left' | 'right' | 'center' | 'start' | 'end';

/** Text drawing options. */
export interface TextOptions {
    /** Weight and size, e.g. `'500 14px'`. */
    spec: string;
    color: string;
    align?: Align;
    /** Extra tracking in pixels. Headings in the reference are tracked wide. */
    tracking?: number;
}

/**
 * Draws text with the theme's font and optional tracking.
 *
 * Resets letter spacing afterwards so a tracked heading never leaks into the
 * body text drawn next.
 */
export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, options: TextOptions): number {
    ctx.font = font(options.spec);
    ctx.fillStyle = options.color;
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${options.tracking ?? 0}px`;
    ctx.fillText(text, x, y);
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = '0px';
    return width;
}

/** Uppercase, tracked label -- the reference's heading and column style. */
export function drawLabel(ctx: SKRSContext2D, text: string, x: number, y: number, color: string, size = 12, align: Align = 'left') {
    drawText(ctx, text.toUpperCase(), x, y, { spec: `400 ${size}px`, color, align, tracking: Math.max(1.5, size * 0.16) });
}

/** Horizontal rule. Gold for structure, `line` for row separators. */
export function drawRule(ctx: SKRSContext2D, x: number, y: number, width: number, color: string, thickness = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, thickness);
}

/** Formats a nullable number with separators, or an em dash. */
export function dashNum(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('en-US');
}

/**
 * A colour set for the fan report. Each key carries one meaning, so a palette
 * can change every colour without changing what any colour says:
 *
 *   frame    the backdrop the cards sit on, a vertical gradient from
 *            `frame` to `frameEnd`
 *   bg       each card
 *   panel    the column-heading strip
 *   stripe   every other row, so a row can be followed across the table
 *   line     hairlines and the empty part of the progress bar
 *   accent   structure: the club name, rules, the progress bar, rank-ups
 *   target   the daily target of someone on pace
 *   good     on pace
 *   warn     behind by less than one day's quota (names and bars). A
 *            saturated yellow (amber on light palettes), so it never reads
 *            as plain text; `scripts/palettes.ts` checks this.
 *   behind   behind by more, and nothing else (names, bars, and the daily
 *            target of anyone behind)
 *   place    name tints and left bars for 1st through 4th
 *
 * `text`, `muted` and `faint` are a three-step grey scale for figures by
 * importance. Every text colour must read on `bg`, `panel` and `stripe`:
 * 4.5:1 for figures, 3:1 for `faint`. `scripts/palettes.ts` checks this.
 */
export interface Palette {
    /** Identifier, as a club would pick it. */
    id: string;
    /** Human name, e.g. "Jewel". */
    label: string;
    /** One line on where it comes from. */
    origin: string;
    /** True for a light background, where Discord's dark theme frames it as a bright card. */
    light: boolean;
    frame: string;
    frameEnd: string;
    bg: string;
    panel: string;
    stripe: string;
    line: string;
    text: string;
    muted: string;
    faint: string;
    accent: string;
    target: string;
    good: string;
    warn: string;
    behind: string;
    place: readonly [string, string, string, string];
    /** The look beyond colour: shape, outline and backdrop. See `PaletteStyle`. */
    style: PaletteStyle;
}

/**
 * How a palette draws, beyond its colours, so palettes differ in feel and not
 * only in hue.
 */
export interface PaletteStyle {
    /** Card corner radius in pixels; 0 is square, like a terminal. */
    radius: number;
    /** Card outline colour, or null for none. */
    border: string | null;
    /** When true the outline glows (neon). Needs `border`. */
    glow: boolean;
    /** Column headings and small labels: as written, or tracked capitals. */
    labels: 'plain' | 'upper';
    /**
     * The backdrop behind the cards, drawn from `frame` and `frameEnd`:
     *   gradient  top to bottom
     *   solid     `frame` only
     *   lanes     diagonal bands, like a mown racecourse
     *   stars     scattered points of `frameEnd` on `frame`
     *   grid      a fine grid of `frameEnd` lines on `frame`
     */
    frameStyle: 'gradient' | 'solid' | 'lanes' | 'stars' | 'grid';
}

/**
 * Palettes the fan report can render in. `rose` is the default; the others
 * are candidates for clubs to choose from. Each has
 * a different background, so a club's report is recognisable at a glance.
 */
export const PALETTES: Record<string, Palette> = {
    rose: {
        id: 'rose',
        label: 'Rose',
        origin: 'Dark plum cards on a pink frame, after the ChronoGenesis club page the club pointed to (2026-10-24). The default.',
        light: false,
        frame: '#e0336f',
        frameEnd: '#ff8fc2',
        bg: '#2a1820',
        panel: '#36212b',
        stripe: '#311d26',
        line: '#4a2f3b',
        text: '#f8eff3',
        muted: '#c7b3bd',
        faint: '#9a848f',
        accent: '#ff7fb2',
        target: '#ffd27a',
        good: '#7be0a0',
        warn: '#ffd23f',
        behind: '#ff6b63',
        place: ['#ffd27a', '#e9e2e6', '#f0a774', '#ff9ccc'],
        style: { radius: 16, border: null, glow: false, labels: 'plain', frameStyle: 'gradient' },
    },
    classic: {
        id: 'classic',
        label: 'Classic',
        origin: 'The original look: gold rules on warm black, square and outlined like a terminal.',
        light: false,
        frame: '#0c0b0b',
        frameEnd: '#0c0b0b',
        bg: THEME.bg,
        panel: '#151312',
        stripe: '#121110',
        line: '#24211e',
        text: THEME.text,
        muted: THEME.muted,
        faint: THEME.faint,
        accent: THEME.gold,
        target: THEME.gold,
        good: THEME.green,
        warn: '#ffe14d',
        behind: '#e0665a',
        place: THEME.place,
        style: { radius: 0, border: 'rgba(212, 165, 74, 0.45)', glow: false, labels: 'upper', frameStyle: 'solid' },
    },
    midnight: {
        id: 'midnight',
        label: 'Midnight',
        origin: 'Navy, from the unmerged redesign branch (claude/redesign, 2026-10-01).',
        light: false,
        frame: '#1c3a7a',
        frameEnd: '#3f6fd1',
        bg: '#0e1528',
        panel: '#162040',
        stripe: '#121a33',
        line: '#26304f',
        text: '#e8ecf6',
        muted: '#a3adc6',
        faint: '#7781a0',
        accent: '#62adff',
        target: '#f2b84b',
        good: '#62adff',
        warn: '#ffd84d',
        behind: '#ff7a7a',
        place: ['#f5c84c', '#d4dae8', '#e8a06a', '#b49cff'],
        style: { radius: 14, border: '#2c3a66', glow: false, labels: 'plain', frameStyle: 'stars' },
    },
    jewel: {
        id: 'jewel',
        label: 'Jewel',
        origin: "viinus's jewel tones (#F1C40F, #16A085, #E74C3C, #00BFFF), 2026-10-21, on deep indigo.",
        light: false,
        frame: '#0b6e8a',
        frameEnd: '#14a3c7',
        bg: '#13132a',
        panel: '#1d1d3d',
        stripe: '#181834',
        line: '#2a2a50',
        text: '#ecf0f1',
        muted: '#a9b4c2',
        faint: '#7e86a0',
        accent: '#00bfff',
        target: '#f1c40f',
        good: '#1abc9c',
        warn: '#ffe14d',
        behind: '#ff6f61',
        place: ['#f1c40f', '#dfe4ea', '#f39c45', '#00bfff'],
        style: { radius: 20, border: null, glow: false, labels: 'plain', frameStyle: 'gradient' },
    },
    plum: {
        id: 'plum',
        label: 'Plum',
        origin: 'Deep purple with pink and mint.',
        light: false,
        frame: '#6a2a8c',
        frameEnd: '#a855c9',
        bg: '#1c1026',
        panel: '#2a1838',
        stripe: '#231430',
        line: '#3a2550',
        text: '#f4ecf8',
        muted: '#c0aecb',
        faint: '#8f7ca0',
        accent: '#ff8fc7',
        target: '#ffd479',
        good: '#7ee0c3',
        warn: '#ffd84d',
        behind: '#ff7b7b',
        place: ['#ffd479', '#e6dcef', '#ffa978', '#ff8fc7'],
        style: { radius: 22, border: null, glow: false, labels: 'plain', frameStyle: 'gradient' },
    },
    turf: {
        id: 'turf',
        label: 'Turf',
        origin: 'Race day: dark green cards on a mown-stripe racecourse, mint and warm gold.',
        light: false,
        frame: '#2f7a4f',
        frameEnd: '#3b8f5d',
        bg: '#0d1d18',
        panel: '#152a23',
        stripe: '#11241e',
        line: '#21392f',
        text: '#eaf3ee',
        muted: '#a6bdb2',
        faint: '#76908a',
        accent: '#6fd6a8',
        target: '#f0c75e',
        good: '#6fd6a8',
        warn: '#ffe14d',
        behind: '#ff8a7a',
        place: ['#f0c75e', '#dbe6e0', '#e8a36c', '#8fc8ff'],
        style: { radius: 10, border: null, glow: false, labels: 'upper', frameStyle: 'lanes' },
    },
    graphite: {
        id: 'graphite',
        label: 'Graphite',
        origin: "Discord's own dark grey, so the image blends into the chat.",
        light: false,
        frame: '#1e1f22',
        frameEnd: '#26282c',
        bg: '#2b2d31',
        panel: '#36383e',
        stripe: '#313338',
        line: '#44474e',
        text: '#f2f3f5',
        muted: '#c4c9ce',
        faint: '#9aa0a8',
        accent: '#8ea1ff',
        target: '#ffcf5c',
        good: '#6fdc8c',
        warn: '#ffd84d',
        behind: '#ff8a8a',
        place: ['#ffcf5c', '#e3e5e8', '#f0a774', '#8ea1ff'],
        style: { radius: 8, border: '#44474e', glow: false, labels: 'plain', frameStyle: 'solid' },
    },
    paper: {
        id: 'paper',
        label: 'Paper',
        origin: 'Light: dark ink on cream, like a printed table.',
        light: true,
        frame: '#d8c7a3',
        frameEnd: '#e9dcc0',
        bg: '#faf6ee',
        panel: '#efe7d6',
        stripe: '#f3eddf',
        line: '#ddd2bb',
        text: '#1d1a15',
        muted: '#4f483d',
        faint: '#7a7062',
        accent: '#8a5a00',
        target: '#8a5a00',
        good: '#1f6e3a',
        warn: '#945200',
        behind: '#b3261e',
        place: ['#8a5a00', '#4a5563', '#9a4a12', '#2c5aa0'],
        style: { radius: 2, border: '#c9b88f', glow: false, labels: 'upper', frameStyle: 'solid' },
    },
    akikawa: {
        id: 'akikawa',
        label: 'Akikawa',
        origin: "Light: hues sampled from the bot's avatar (honey hair, blue eyes, pink), darkened to read on peach.",
        light: true,
        frame: '#f2a87a',
        frameEnd: '#f8cfb0',
        bg: '#fff4ea',
        panel: '#fbe3cf',
        stripe: '#fdeadb',
        line: '#efcfb4',
        text: '#2e1d14',
        muted: '#5e4536',
        faint: '#876a58',
        accent: '#94490f',
        target: '#94490f',
        good: '#2f58c4',
        warn: '#924f00',
        behind: '#c0262d',
        place: ['#b0306a', '#94490f', '#5b5f6b', '#2f58c4'],
        style: { radius: 24, border: null, glow: false, labels: 'plain', frameStyle: 'gradient' },
    },
    clear: {
        id: 'clear',
        label: 'Clear',
        origin: 'Okabe-Ito colours (Color Universal Design): behind (vermillion), close (yellow) and on pace (sky blue) stay distinct with red-green colour blindness.',
        light: false,
        frame: '#26262b',
        frameEnd: '#33333a',
        bg: '#0c0c0e',
        panel: '#18181c',
        stripe: '#131316',
        line: '#26262b',
        text: '#f2f2f2',
        muted: '#b0b0b6',
        faint: '#7c7c83',
        accent: '#56b4e9',
        target: '#f0e442',
        good: '#56b4e9',
        warn: '#f0e442',
        behind: '#e2661a',
        place: ['#f0e442', '#e2e2e2', '#cc79a7', '#009e73'],
        style: { radius: 10, border: '#3a3a42', glow: false, labels: 'plain', frameStyle: 'solid' },
    },
    neon: {
        id: 'neon',
        label: 'Neon',
        origin: 'Arcade: near-black cards with glowing magenta outlines on a cyan grid.',
        light: false,
        frame: '#07060f',
        frameEnd: '#1d2a4a',
        bg: '#0c0b18',
        panel: '#17152c',
        stripe: '#12101f',
        line: '#2a2650',
        text: '#f2f0ff',
        muted: '#b6acdb',
        faint: '#8279ab',
        accent: '#2ef2ff',
        target: '#fff35c',
        good: '#39ff9c',
        warn: '#fff35c',
        behind: '#ff5c7a',
        place: ['#fff35c', '#e6e6ff', '#ffad5c', '#ff6cf3'],
        style: { radius: 6, border: '#ff3df2', glow: true, labels: 'upper', frameStyle: 'grid' },
    },
    sakura: {
        id: 'sakura',
        label: 'Sakura',
        origin: 'Light and soft: white cards, very round, on a lavender-to-pink wash.',
        light: true,
        frame: '#c9b8ff',
        frameEnd: '#ffc6e5',
        bg: '#fffaff',
        panel: '#f1e6ff',
        stripe: '#f8f0ff',
        line: '#e3d3f3',
        text: '#2b2140',
        muted: '#54476b',
        faint: '#7e7196',
        accent: '#7338c9',
        target: '#855400',
        good: '#1d7448',
        warn: '#995400',
        behind: '#bf2440',
        place: ['#a1307a', '#4f5868', '#9a4a12', '#7338c9'],
        style: { radius: 26, border: null, glow: false, labels: 'plain', frameStyle: 'gradient' },
    },
    oguri: {
        id: 'oguri',
        label: 'Oguri',
        origin: "Oguri Cap's image colours on the Umamusume wiki (umamusu.wiki, 2026-10-26): blue #3A7AD2 and white #ECE7E7, as off-white stars on blue, with the gold of her star and the red of her neckerchief.",
        light: true,
        frame: '#3a7ad2',
        frameEnd: '#ece7e7',
        bg: '#f8f6f6',
        panel: '#ece7e7',
        stripe: '#f1eeee',
        line: '#d9d3d3',
        text: '#16233a',
        muted: '#3f4c63',
        faint: '#66708a',
        accent: '#2a63b5',
        target: '#835400',
        good: '#2a63b5',
        warn: '#945200',
        behind: '#b8241c',
        place: ['#835400', '#4e5866', '#9a4a12', '#2a63b5'],
        style: { radius: 14, border: null, glow: false, labels: 'plain', frameStyle: 'stars' },
    },
};

/** The default palette. */
export const DEFAULT_PALETTE = 'rose';

/** The palette for an id, falling back to the default for an unknown one. */
export function paletteOf(id: string | null | undefined): Palette {
    return (id && PALETTES[id]) || PALETTES[DEFAULT_PALETTE]!;
}
