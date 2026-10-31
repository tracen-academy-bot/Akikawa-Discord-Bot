import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { RENDER_SCALE, seeded } from './cards';
import { font } from './fonts';
import type { Palette } from './theme';

/**
 * Illustrated backdrops for the fan report.
 *
 * A plain backdrop only shows in the 16px gaps around the cards, too little
 * for a picture to read. A palette with a `scene` therefore gets a wider
 * image: the report is drawn on a transparent background, then placed on a
 * larger canvas with a band of open sky (`HERO`) above it and a wider margin
 * (`SIDE`) round it, where the scene is painted.
 *
 *   fireworks  a night sky with glowing bursts and drooping trails over a
 *              city skyline; the cards stand where the street would be
 *   confetti   a warm wash with tumbling, shaded confetti, sequins and
 *              curled streamers, densest at the top and thinning downwards
 *   stillinlove  Still in Love in her room at night, watching you: a gothic
 *              window with a crescent moon, her eyes in the dark, a side
 *              table of jam, a draped mirror, and lace along the bottom.
 *              It turns red with `mood`: calm when everyone is on pace,
 *              yandere when much of the club is behind.
 *   oguri      Oguri Cap: a blue sky with clouds and a garland of her food
 *              (onigiri, carrots, dango, buns), and a white rail on mown
 *              turf with food piled up (she is famously hungry)
 *
 * A scene may also show a picture from `src/assets/scenes/<scene>.png`,
 * standing on the right of the band, when one is there. None is shipped: a
 * picture of a character belongs to its artist, so a club adds one it has
 * permission to use. Without it the scene is complete as drawn.
 *
 * Every scene is drawn from a fixed seed, so the same report always looks
 * the same.
 */

/** The scenes a palette can carry. */
export type SceneId = 'fireworks' | 'confetti' | 'oguri' | 'stillinlove' | 'mambo' | 'nature' | 'journey';

/**
 * Where the club stands in its rank band, for a scene that races it along a
 * track: `progress` from 0 (the band's bottom cutoff, `start`) to 1 (the
 * next cutoff up, `finish`). Labels like "#500 A+" and "#100 S".
 */
export interface SceneRace {
    progress: number;
    start: string;
    finish: string;
}

/** Height of the open band above the cards, by layout. */
const HERO = { tall: 190, wide: 170 } as const;

/** Visible margin left, right and below the cards (the report keeps its own 16px inside). */
const SIDE = 30;

/** The margin the report draws around its cards, which is transparent here. */
const INNER = 16;

/** Where a scene's optional picture lives, beside the other image assets. */
const ART_DIR = path.join(__dirname, '..', '..', 'assets', 'scenes');

/** Each scene picture, once loaded; null when there is none. */
const artCache = new Map<string, Image | null>();

/**
 * A scene picture (`<name>.png`), or null when the file is missing or
 * unreadable: `oguri` stands; `oguri-run` is posed running, for the race.
 */
async function sceneArt(name: string): Promise<Image | null> {
    if (artCache.has(name)) return artCache.get(name)!;
    const file = path.join(ART_DIR, `${name}.png`);
    let art: Image | null = null;
    if (existsSync(file)) {
        try {
            art = await loadImage(file);
        } catch {
            art = null;
        }
    }
    artCache.set(name, art);
    return art;
}

/** Oguri's food from the game (`src/assets/scenes/food`), cut out by Fwoxie. */
const FOOD_NAMES = ['burger', 'rice_mountain', 'ramen_tray', 'hamburg_tray'] as const;
type FoodArt = Record<(typeof FOOD_NAMES)[number], Image>;
let foodCache: FoodArt | null | undefined;

/** The food pictures, or null when any is missing (the scene then draws its own food). */
async function foodArt(): Promise<FoodArt | null> {
    if (foodCache !== undefined) return foodCache;
    const loaded: Partial<FoodArt> = {};
    for (const name of FOOD_NAMES) {
        const file = path.join(ART_DIR, 'food', `${name}.png`);
        if (!existsSync(file)) return (foodCache = null);
        try {
            loaded[name] = await loadImage(file);
        } catch {
            return (foodCache = null);
        }
    }
    return (foodCache = loaded as FoodArt);
}

/**
 * Her picture for `mood`: `stillinlove-calm.png` (smiling),
 * `stillinlove-uneasy.png` (worried) or `stillinlove-yandere.png` (teeth
 * gritted), the same thirds as her lines. Falls back to `stillinlove.png`,
 * then to none (the scene then draws her eyes).
 */
async function stillInLovePose(mood: number): Promise<Image | null> {
    const pose = mood < 0.34 ? 'calm' : mood < 0.67 ? 'uneasy' : 'yandere';
    return (await sceneArt(`stillinlove-${pose}`)) ?? sceneArt('stillinlove');
}

/** Still in Love's blood, knives and roses (`src/assets/scenes/stillinlove`, public domain). */
const SIL_NAMES = ['splat', 'drips', 'drips-thin', 'smear', 'smear-short', 'spray', 'knife', 'cleaver', 'hand', 'hand-smear', 'rose', 'lilies', 'lily'] as const;
type SilArt = Record<(typeof SIL_NAMES)[number], Image>;
let silCache: SilArt | null | undefined;

/** The blood and knife pictures, or null when any is missing (the scene then draws its own blood). */
async function stillInLoveArt(): Promise<SilArt | null> {
    if (silCache !== undefined) return silCache;
    const loaded: Partial<SilArt> = {};
    for (const name of SIL_NAMES) {
        const file = path.join(ART_DIR, 'stillinlove', `${name}.png`);
        if (!existsSync(file)) return (silCache = null);
        try {
            loaded[name] = await loadImage(file);
        } catch {
            return (silCache = null);
        }
    }
    return (silCache = loaded as SilArt);
}

/**
 * Draws `image` `width` wide (height to scale), centred on (x, y), turned by
 * `angle` and at `alpha`.
 */
function placed(ctx: SKRSContext2D, image: Image, x: number, y: number, width: number, angle = 0, alpha = 1) {
    const height = (image.height / image.width) * width;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
}

/**
 * A knife stabbed into a surface at (x, y), blade down: only the part above
 * `y` shows, so it reads as driven in. The pictures have the blade on the
 * left, so a quarter turn points it down; `lean` tips it.
 */
function stabbed(ctx: SKRSContext2D, knife: Image, x: number, y: number, length: number, lean: number, buried = 0.3) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - length, y - length * 2, length * 2, length * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2 + lean);
    const height = (knife.height / knife.width) * length;
    // The tip sits `buried` of the length below the surface.
    ctx.drawImage(knife, -length * buried, -height / 2, length, height);
    ctx.restore();
}

/**
 * A long-stemmed rose `height` tall, the foot of its stem at (x, y), turned
 * by `angle` (0 is upright, a quarter turn lays it on its side).
 */
function roseStem(ctx: SKRSContext2D, rose: Image, x: number, y: number, height: number, angle: number) {
    const width = (rose.width / rose.height) * height;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // The stem's foot is a little left of the picture's centre.
    ctx.drawImage(rose, -width * 0.45, -height, width, height);
    ctx.restore();
}

/** Draws a picture scaled by `scale`, centred on `cx`, standing on `bottom`. */
function standing(ctx: SKRSContext2D, image: Image, cx: number, bottom: number, scale: number): number {
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, cx - w / 2, bottom - h, w, h);
    return h;
}

/**
 * The game's food laid out side by side on the grass, centred on `cx`: the
 * ramen tray with the lone burger on its left and the tall rice bowl on its
 * right, then the hamburg-steak tray. One scale for all, nothing stacked
 * (Fwoxie, 2026-10-26: "who stacks multiple plates on top of each other").
 * About 190px wide.
 */
function drawMealPile(ctx: SKRSContext2D, food: FoodArt, cx: number, ground: number) {
    ctx.save();
    ctx.shadowColor = 'rgba(20, 60, 30, 0.3)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    const s = 0.42;
    const trayW = food.ramen_tray.width * s;
    const ramenX = cx - trayW / 2 - 2;
    const hamburgX = cx + trayW / 2 + 2;
    standing(ctx, food.hamburg_tray, hamburgX, ground, s);
    standing(ctx, food.ramen_tray, ramenX, ground, s);
    // On the ramen tray's surface, about 20 tray pixels above its bottom edge.
    const onTray = ground - 20 * s;
    // The burger leans inwards against the ramen bowl: bottom edge on the
    // tray, top resting on the bowl's upper side.
    const burgerX = ramenX - trayW * 0.34;
    ctx.save();
    ctx.translate(burgerX, onTray);
    ctx.rotate(0.22);
    standing(ctx, food.burger, 0, 0, s);
    ctx.restore();
    standing(ctx, food.rice_mountain, ramenX + trayW * 0.41, onTray, s);
    ctx.restore();
}

/**
 * Places a report, drawn on a transparent background, on its palette's
 * scene. Returns the report unchanged for a palette without one.
 */
export async function withScene(
    report: Canvas,
    p: Palette,
    layout: 'tall' | 'wide',
    race: SceneRace | null = null,
    /** 0 to 1: how far a scene with a mood has turned (Still in Love: the share of the club behind). */
    mood = 0,
): Promise<Canvas> {
    const scene = p.style.scene;
    if (!scene) return report;
    const hero = HERO[layout];
    const offsetX = SIDE - INNER;
    const offsetY = hero - INNER;
    // The report is already at RENDER_SCALE; lay out in plain pixels.
    const reportW = report.width / RENDER_SCALE;
    const reportH = report.height / RENDER_SCALE;
    const w = reportW + offsetX * 2;
    const h = reportH + offsetY + offsetX;
    const canvas = createCanvas(w * RENDER_SCALE, h * RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    // Still in Love's scene hands back its moonlight, to lay over the cards too.
    let moonlight: Canvas | null = null;
    if (scene === 'fireworks') drawFireworks(ctx, w, h, hero);
    else if (scene === 'confetti') drawConfetti(ctx, w, h, hero);
    else if (scene === 'stillinlove') moonlight = drawStillInLove(ctx, w, h, hero, await stillInLovePose(mood), mood, race, await stillInLoveArt());
    else if (scene === 'mambo') drawMambo(ctx, w, h, hero, await mamboPose(mood), mood, race, await sceneArtFolder('mambo-crowd'));
    else if (scene === 'nature') drawNature(ctx, w, h, hero, await naturePose(mood), mood, race);
    else if (scene === 'journey') drawJourney(ctx, w, h, hero, await journeyPose(mood), mood, race);
    else drawOguri(ctx, w, h, hero, await sceneArt(scene), await sceneArt(`${scene}-run`), race, await foodArt());
    ctx.drawImage(report, offsetX, offsetY, reportW, reportH);
    // Her moonlight carries on over the cards, faintly.
    if (moonlight) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, hero, w, h - hero);
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.45;
        ctx.filter = 'blur(2px)';
        ctx.drawImage(moonlight, 0, 0, w, h);
        ctx.restore();
    }
    // Still in Love's blood reaches past the scene onto the cards' edges.
    if (scene === 'stillinlove') bloodOnTheCards(ctx, w, h, hero, mood, await stillInLoveArt());
    return canvas;
}

// ─── Fireworks ────────────────────────────────────────────────────────────────

/** Burst colours: a bright core colour and the colour its trails fade into. */
const FIREWORK_COLOURS: readonly [string, string][] = [
    ['#fff1b8', '#ffb52e'],
    ['#ffd1f0', '#ff4fb8'],
    ['#c9f3ff', '#3ec8ff'],
    ['#e2d4ff', '#9b6bff'],
    ['#d6ffe6', '#38e08c'],
    ['#ffe0c7', '#ff7a2e'],
];

/** `#rrggbb` as `rgba(r, g, b, a)`. */
function rgba(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A night sky over a skyline, with bursts in the open band and embers down the margins. */
function drawFireworks(ctx: SKRSContext2D, w: number, h: number, hero: number) {
    const rand = seeded(2026);

    // Sky: deepest at the top, a little lighter and warmer near the skyline.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#04061a');
    sky.addColorStop(Math.min(0.99, (hero * 0.85) / h), '#1a1240');
    sky.addColorStop(Math.min(1, (hero * 1.6) / h), '#0c0f2c');
    sky.addColorStop(1, '#070918');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars, fainter lower down.
    for (let i = 0; i < Math.round((w * h) / 2200); i += 1) {
        const y = rand() * h;
        ctx.fillStyle = rgba('#ffffff', (0.15 + rand() * 0.6) * (y < hero ? 1 : 0.6));
        ctx.beginPath();
        ctx.arc(rand() * w, y, rand() < 0.1 ? 1.3 : 0.7, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bursts; light adds up, as it does in smoke. Three kinds, back to
    // front: small distant ones, older ones fading and drooping, and a few
    // big fresh ones at uneven heights, so the band never reads as a row.
    ctx.globalCompositeOperation = 'lighter';
    const colour = () => FIREWORK_COLOURS[Math.floor(rand() * FIREWORK_COLOURS.length)]!;
    for (let i = 0; i < Math.round(w / 150); i += 1) {
        drawBurst(ctx, rand() * w, hero * (0.15 + rand() * 0.45), 14 + rand() * 14, colour(), rand, 0.45, 0.3);
    }
    for (let i = 0; i < Math.max(2, Math.round(w / 420)); i += 1) {
        drawBurst(ctx, rand() * w, hero * (0.3 + rand() * 0.25), 40 + rand() * 25, colour(), rand, 0.35, 0.75);
    }
    const fresh = Math.max(3, Math.round(w / 300));
    const slot = w / fresh;
    for (let i = 0; i < fresh; i += 1) {
        const r = Math.min(hero * 0.4, 34 + rand() * 46);
        const cx = slot * i + slot / 2 + (rand() - 0.5) * slot * 0.8;
        const cy = Math.max(r * 0.75, hero * (0.18 + rand() * 0.32));
        drawBurst(ctx, cx, cy, r, colour(), rand, 1, 0.28);
    }
    // Rockets still climbing, with a spark at the head.
    for (let i = 0; i < Math.max(2, Math.round(w / 450)); i += 1) {
        const x = rand() * w;
        const top = hero * (0.35 + rand() * 0.3);
        const trail = ctx.createLinearGradient(0, hero, 0, top);
        trail.addColorStop(0, 'rgba(255, 200, 120, 0)');
        trail.addColorStop(1, 'rgba(255, 220, 160, 0.8)');
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 6, hero);
        ctx.quadraticCurveTo(x - 2, (hero + top) / 2, x, top);
        ctx.stroke();
        glowDot(ctx, x, top, 5, '#ffe8b0');
    }
    ctx.globalCompositeOperation = 'source-over';

    drawSkyline(ctx, w, hero, rand);

    // Embers drifting down the margins.
    for (let i = 0; i < Math.round(h / 22); i += 1) {
        const x = rand() < 0.5 ? rand() * SIDE : w - rand() * SIDE;
        const y = hero + rand() * (h - hero);
        const [, colour] = FIREWORK_COLOURS[Math.floor(rand() * FIREWORK_COLOURS.length)]!;
        const fade = 0.25 + 0.6 * (1 - (y - hero) / (h - hero));
        ctx.strokeStyle = rgba(colour, fade * 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = rgba('#fff4d6', fade);
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** A soft glowing point: a halo and a bright core. Draw with 'lighter'. */
function glowDot(ctx: SKRSContext2D, x: number, y: number, r: number, colour: string) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(colour, 0.9));
    g.addColorStop(0.35, rgba(colour, 0.35));
    g.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * One burst: a soft glow, then sparks flying out along trails that thin,
 * brighten towards the head, and droop under gravity.
 */
function drawBurst(
    ctx: SKRSContext2D,
    cx: number,
    cy: number,
    r: number,
    [core, tint]: [string, string],
    rand: () => number,
    /** 1 for a fresh burst; less for a distant or fading one. */
    strength = 1,
    /** How far the trails fall, as a share of the radius. */
    fall = 0.28,
) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
    glow.addColorStop(0, rgba(tint, 0.32 * strength));
    glow.addColorStop(0.5, rgba(tint, 0.1 * strength));
    glow.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    ctx.fill();

    const sparks = Math.round((r < 30 ? 22 : 46) + rand() * 26);
    const droop = r * fall;
    ctx.lineCap = 'round';
    for (let i = 0; i < sparks; i += 1) {
        const a = (i / sparks) * Math.PI * 2 + (rand() - 0.5) * 0.12;
        const reach = r * (0.72 + rand() * 0.32);
        const at = (t: number) => [cx + Math.cos(a) * reach * t, cy + Math.sin(a) * reach * t + droop * t * t] as const;
        const steps = 12;
        for (let j = 0; j < steps; j += 1) {
            const t0 = 0.12 + (j / steps) * 0.88;
            const t1 = 0.12 + ((j + 1) / steps) * 0.88;
            const [x0, y0] = at(t0);
            const [x1, y1] = at(t1);
            ctx.strokeStyle = rgba(j > steps - 3 ? core : tint, Math.pow(t1, 1.6) * 0.85 * strength);
            ctx.lineWidth = 0.5 + 1.3 * t1;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
        const [hx, hy] = at(1);
        if (strength > 0.5) glowDot(ctx, hx, hy, r < 30 ? 2 : 3.2, core);
        // Some sparks have already burst into a falling glitter.
        if (rand() < 0.22) {
            for (let k = 1; k <= 3; k += 1) {
                ctx.fillStyle = rgba(core, 0.5 / k);
                ctx.beginPath();
                ctx.arc(hx + (rand() - 0.5) * 3, hy + k * 5, 0.9, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.lineCap = 'butt';
    if (strength > 0.5) glowDot(ctx, cx, cy, r * 0.22, '#ffffff');
}

/** A city skyline along the bottom of the band, with a few lit windows. */
function drawSkyline(ctx: SKRSContext2D, w: number, base: number, rand: () => number) {
    // Two rows: a hazier far row, then the near one.
    for (const [shade, low, high, lit] of [
        ['#120f2e', 16, 46, 0.02],
        ['#05060f', 10, 34, 0.05],
    ] as const) {
        let x = -10;
        while (x < w + 10) {
            const bw = 16 + rand() * 34;
            const bh = low + rand() * (high - low);
            ctx.fillStyle = shade;
            ctx.fillRect(x, base - bh, bw, bh + 2);
            if (rand() < 0.15) ctx.fillRect(x + bw / 2 - 1, base - bh - 8, 2, 8);
            for (let wy = base - bh + 5; wy < base - 4; wy += 6) {
                for (let wx = x + 4; wx < x + bw - 4; wx += 5) {
                    if (rand() < lit) {
                        ctx.fillStyle = rgba('#ffd27a', 0.45 + rand() * 0.4);
                        ctx.fillRect(wx, wy, 2, 3);
                        ctx.fillStyle = shade;
                    }
                }
            }
            x += bw + (rand() < 0.3 ? rand() * 6 : 0);
        }
    }
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

/** Confetti colours: a face colour and the darker colour of its back. */
const CONFETTI_COLOURS: readonly [string, string][] = [
    ['#ff4f81', '#c2185b'],
    ['#ffb703', '#d98e04'],
    ['#3a86ff', '#1f5fcc'],
    ['#06d6a0', '#05a07a'],
    ['#8338ec', '#5d21b0'],
    ['#fb5607', '#c43f00'],
    ['#ffd6e8', '#f2a7c8'],
];

/** A warm wash with confetti falling from the top and thinning down the margins. */
function drawConfetti(ctx: SKRSContext2D, w: number, h: number, hero: number) {
    const rand = seeded(1225);

    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#ffd8c4');
    wash.addColorStop(Math.min(0.99, hero / h), '#ffe9d2');
    wash.addColorStop(1, '#fff4e4');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    // Out-of-focus party lights behind everything.
    for (let i = 0; i < Math.max(10, Math.round(w / 70)); i += 1) {
        const x = rand() * w;
        const y = rand() * hero * 1.1;
        const r = 24 + rand() * 60;
        const [face] = CONFETTI_COLOURS[Math.floor(rand() * CONFETTI_COLOURS.length)]!;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(face, 0.2));
        g.addColorStop(0.7, rgba(face, 0.08));
        g.addColorStop(1, rgba(face, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Two long streamers swooping across the band.
    drawStreamer(ctx, -20, hero * 0.15, w * 0.45, hero * 0.75, 7, CONFETTI_COLOURS[0]!, rand);
    drawStreamer(ctx, w + 20, hero * 0.3, w * 0.6, hero * 0.85, 7, CONFETTI_COLOURS[2]!, rand);

    // The band: far pieces first, so near ones overlap them.
    const pieces = Array.from({ length: Math.round((w * hero) / 760) }, () => ({
        x: rand() * w,
        // Denser near the top, as if just thrown.
        y: Math.pow(rand(), 1.3) * (hero + 10) - 8,
        depth: rand(),
    })).sort((a, b) => a.depth - b.depth);
    for (const piece of pieces) drawPiece(ctx, piece.x, piece.y, piece.depth, rand);

    // Down the margins, thinning out.
    for (let i = 0; i < Math.round(h / 12); i += 1) {
        const y = hero + Math.pow(rand(), 1.8) * (h - hero);
        const x = rand() < 0.5 ? rand() * SIDE : w - rand() * SIDE;
        drawPiece(ctx, x, y, rand() * 0.6, rand);
    }
}

/**
 * One piece of confetti at `depth` (0 far, 1 near): a tumbling strip, a
 * sequin, a triangle or a short curl. Its tilt narrows it and shows its
 * darker back, so it reads as turning in the air.
 */
function drawPiece(ctx: SKRSContext2D, x: number, y: number, depth: number, rand: () => number) {
    const [face, back] = CONFETTI_COLOURS[Math.floor(rand() * CONFETTI_COLOURS.length)]!;
    const size = 4 + depth * 9;
    const flip = Math.cos(rand() * Math.PI);
    const kind = rand();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.globalAlpha = 0.55 + depth * 0.45;
    if (depth > 0.7) {
        ctx.shadowColor = 'rgba(120, 60, 20, 0.22)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = flip < 0 ? back : face;
    const squash = Math.max(0.18, Math.abs(flip));
    if (kind < 0.55) {
        ctx.fillRect((-size * 0.4 * squash), -size, size * 0.8 * squash, size * 2);
        // The strip catches light along one edge.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(-size * 0.4 * squash, -size, Math.max(0.6, size * 0.15 * squash), size * 2);
    } else if (kind < 0.78) {
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.7, size * 0.7 * squash, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.beginPath();
        ctx.ellipse(-size * 0.2, -size * 0.2 * squash, size * 0.2, size * 0.14 * squash, 0, 0, Math.PI * 2);
        ctx.fill();
    } else if (kind < 0.95) {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.9 * squash, size * 0.7);
        ctx.lineTo(-size * 0.9 * squash, size * 0.7);
        ctx.closePath();
        ctx.fill();
    } else {
        // A short curl: a ribbon twisting through a turn and a half.
        ctx.strokeStyle = face;
        ctx.lineWidth = 1.5 + depth * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const px = (t - 0.5) * size * 3;
            const py = Math.sin(t * Math.PI * 3) * size * 0.45;
            if (t === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * A long paper streamer from (x0, y0) to (x1, y1), waving as it falls. The
 * ribbon twists, so each half-wave alternates between its face and back.
 */
function drawStreamer(
    ctx: SKRSContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    [face, back]: [string, string],
    rand: () => number,
) {
    const waves = 4 + rand() * 2;
    const amp = 14 + rand() * 10;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const at = (t: number) => {
        const off = Math.sin(t * Math.PI * 2 * waves) * amp * (0.4 + 0.6 * t);
        return [x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off + Math.sin(t * Math.PI) * 30] as const;
    };
    ctx.lineCap = 'round';
    const steps = 160;
    for (let i = 0; i < steps; i += 1) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        // The twist: width follows |cos|, colour flips with its sign.
        const twist = Math.cos(t0 * Math.PI * 2 * waves * 0.5);
        const [ax, ay] = at(t0);
        const [bx, by] = at(t1);
        ctx.strokeStyle = twist < 0 ? back : face;
        ctx.lineWidth = Math.max(1.2, width * Math.abs(twist));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

// ─── Oguri ────────────────────────────────────────────────────────────────────

/** Oguri Cap's blue (umamusu.wiki). */
const OGURI_BLUE = '#3a7ad2';

/** A four-pointed twinkle. */
function twinkle(ctx: SKRSContext2D, x: number, y: number, r: number, colour: string) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
}

/** A puffy cloud: overlapping circles, white on top and shaded underneath. */
function cloud(ctx: SKRSContext2D, x: number, y: number, size: number, rand: () => number) {
    const puffs = Array.from({ length: 5 }, (_, i) => ({
        dx: (i - 2) * size * 0.42 + (rand() - 0.5) * size * 0.15,
        dy: -Math.sin((i / 4) * Math.PI) * size * 0.32,
        r: size * (0.34 + Math.sin((i / 4) * Math.PI) * 0.22),
    }));
    ctx.fillStyle = 'rgba(40, 90, 170, 0.12)';
    for (const p of puffs) {
        ctx.beginPath();
        ctx.arc(x + p.dx + 3, y + p.dy + 5, p.r, 0, Math.PI * 2);
        ctx.fill();
    }
    const g = ctx.createLinearGradient(0, y - size * 0.7, 0, y + size * 0.35);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#dfe9f7');
    ctx.fillStyle = g;
    for (const p of puffs) {
        ctx.beginPath();
        ctx.arc(x + p.dx, y + p.dy, p.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** One onigiri: a rounded white triangle on a strip of nori. */
function onigiri(ctx: SKRSContext2D, x: number, y: number, size: number, tilt: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    const half = size / 2;
    ctx.shadowColor = 'rgba(30, 60, 30, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fffdf7';
    // A firm beige edge, so white rice holds its shape against white cloud.
    ctx.strokeStyle = '#b3a487';
    ctx.lineWidth = Math.max(1.5, size / 16);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.quadraticCurveTo(half * 0.25, -half * 0.95, half * 0.95, half * 0.55);
    ctx.quadraticCurveTo(half, half, half * 0.55, half);
    ctx.lineTo(-half * 0.55, half);
    ctx.quadraticCurveTo(-half, half, -half * 0.95, half * 0.55);
    ctx.quadraticCurveTo(-half * 0.25, -half * 0.95, 0, -half);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    // Nori, with a little sheen.
    ctx.fillStyle = '#1d2b25';
    ctx.fillRect(-half * 0.32, half * 0.28, half * 0.64, half * 0.72);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(-half * 0.32, half * 0.28, half * 0.12, half * 0.72);
    // A few sesame seeds.
    ctx.fillStyle = '#d9cfb8';
    for (const [sx, sy] of [[-0.2, -0.2], [0.18, -0.05], [-0.05, 0.08]] as const) ctx.fillRect(sx * half, sy * half, 2, 1.2);
    ctx.restore();
}

/**
 * Oguri Cap: her blue sky, clouds, a garland hung with her food, and a
 * white rail on mown turf just above the cards, with food piled on the
 * grass. `art`, when given, stands on the right among it.
 */
function drawOguri(
    ctx: SKRSContext2D,
    w: number,
    h: number,
    hero: number,
    art: Image | null,
    runArt: Image | null,
    race: SceneRace | null,
    food: FoodArt | null,
) {
    const rand = seeded(1987);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2c69c2');
    sky.addColorStop(Math.min(0.99, (hero * 0.7) / h), '#5d95df');
    sky.addColorStop(Math.min(0.995, hero / h), '#a9c8f0');
    sky.addColorStop(1, '#e3ecf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Clouds across the whole sky, small and low enough to sit under the
    // hanging food rather than behind it, where white food on white cloud
    // would vanish.
    const clouds = Math.max(3, Math.round(w / 240));
    for (let i = 0; i < clouds; i += 1) {
        const x = (w / clouds) * (i + 0.2 + rand() * 0.6);
        cloud(ctx, x, hero * (0.6 + rand() * 0.12), 20 + rand() * 12, rand);
    }
    for (let i = 0; i < Math.round(w / 90); i += 1) {
        twinkle(ctx, rand() * w, rand() * hero * 0.75, 3 + rand() * 5, rand() < 0.5 ? '#ffffff' : '#fff2b0');
    }

    // A garland sagging across the top, with her food hanging from it on
    // short threads of different lengths, so it swings rather than lines up.
    const sag = 16;
    const along = (x: number) => 4 + sag * Math.sin((x / w) * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
        if (x === 0) ctx.moveTo(x, along(x));
        else ctx.lineTo(x, along(x));
    }
    ctx.stroke();
    // The game's burger and rice mountain hang between the drawn onigiri and
    // carrots when their pictures are there; otherwise dango and buns do.
    const hanging = food ? (['onigiri', 'burger', 'carrot', 'rice'] as const) : (['onigiri', 'carrot', 'dango', 'bun'] as const);
    for (let i = 0, x = 24; x < w - 16; i += 1, x += 52) {
        const top = along(x);
        const thread = 6 + ((i * 7) % 4) * 4;
        const sway = ((i % 3) - 1) * 0.12;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + thread);
        ctx.stroke();
        const y = top + thread;
        const kind = hanging[i % hanging.length]!;
        if (kind === 'onigiri') onigiri(ctx, x, y + 13, 26, sway);
        else if (kind === 'carrot') carrot(ctx, x, y + 16, 34, Math.PI / 2 + sway);
        else if (kind === 'dango') dango(ctx, x, y + 15, 7.5, Math.PI / 2 + sway);
        else if (kind === 'bun') bun(ctx, x, y + 11, 13);
        else if (food) {
            const image = kind === 'burger' ? food.burger : food.rice_mountain;
            const scale = kind === 'burger' ? 0.5 : 0.3;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(sway);
            ctx.drawImage(image, (-image.width * scale) / 2, 0, image.width * scale, image.height * scale);
            ctx.restore();
        }
    }

    // Turf, mown in stripes, running into the cards.
    const turfTop = hero - 30;
    const turf = ctx.createLinearGradient(0, turfTop, 0, hero + 20);
    turf.addColorStop(0, '#5fbf6c');
    turf.addColorStop(1, '#3d9a52');
    ctx.fillStyle = turf;
    ctx.fillRect(0, turfTop, w, h - turfTop);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let x = -40; x < w; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, turfTop);
        ctx.lineTo(x + 24, turfTop);
        ctx.lineTo(x + 34, h);
        ctx.lineTo(x + 10, h);
        ctx.closePath();
        ctx.fill();
    }

    // The white rail along the turf: posts first, then the bars across them,
    // so the bars sit in front.
    const railY = turfTop - 18;
    for (let x = RAIL_FIRST_POST; x < w; x += RAIL_POST_GAP) railPost(ctx, x, railY, turfTop + 6);
    railBars(ctx, 0, w, railY);

    const ground = hero - 6;
    if ((runArt ?? art) && race) {
        // The running pose leans a little too far, so it is turned back a
        // touch; the standing picture is tipped forward instead.
        drawRace(ctx, w, ground, (runArt ?? art)!, runArt ? -0.1 : 0.12, runArt ? 0.75 : 1, race, food);
    } else if (art) {
        // No rank to race for: she stands on the right with food piled round
        // her feet and an onigiri balanced on her head.
        const artH = hero - 30;
        const artW = (art.width / art.height) * artH;
        const artX = w - SIDE - artW - 80;
        const artY = ground - artH;
        groundShadow(ctx, artX + artW / 2, ground, artW * 0.42);
        ctx.drawImage(art, artX, artY, artW, artH);
        onigiri(ctx, artX + artW * 0.5, artY + 10, 30, 0.18);
        if (food) drawMealPile(ctx, food, artX - 110, ground);
        else drawFoodPile(ctx, artX + artW / 2, ground, artW, true);
    } else if (food) {
        drawMealPile(ctx, food, w - SIDE - 100, ground);
    } else {
        drawFoodPile(ctx, w - SIDE - 90, ground, 120, false);
    }
}

/** Where the rail's dividing posts stand: every `RAIL_POST_GAP` from `RAIL_FIRST_POST`. */
const RAIL_FIRST_POST = 6;
const RAIL_POST_GAP = 30;

/** The rail post nearest `x`, so a signpost is one of them run taller rather than a second post beside it. */
function onRailPost(x: number): number {
    return RAIL_FIRST_POST + Math.round((x - RAIL_FIRST_POST) / RAIL_POST_GAP) * RAIL_POST_GAP;
}

/** A rail post from `top` to `bottom`: white, with a light grey shaded side. */
function railPost(ctx: SKRSContext2D, x: number, top: number, bottom: number) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, top, 4, bottom - top);
    ctx.fillStyle = RAIL_SHADE;
    ctx.fillRect(x + 3, top, 1, bottom - top);
}

/**
 * The rail's two bars from `x0` to `x1`, the top one at `railY`: white,
 * each with a light grey underside. Drawn after the posts so they cross in
 * front of them.
 */
function railBars(ctx: SKRSContext2D, x0: number, x1: number, railY: number) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, railY, x1 - x0, 5);
    ctx.fillRect(x0, railY + 11, x1 - x0, 3);
    ctx.fillStyle = RAIL_SHADE;
    ctx.fillRect(x0, railY + 4, x1 - x0, 1);
    ctx.fillRect(x0, railY + 13, x1 - x0, 1);
}

/** The rail's shading: a light cool grey, not a dark band. */
const RAIL_SHADE = '#d3dbe6';

/** A soft shadow on the grass. */
function groundShadow(ctx: SKRSContext2D, x: number, ground: number, rx: number) {
    ctx.fillStyle = 'rgba(20, 60, 30, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, ground - 2, rx, 6, 0, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * A signpost: a post exactly like the rail's dividing posts (white, 4px,
 * with the same thin shade line), carrying an arrow-shaped sign. The start
 * sign points left, back down the band; the finish sign points right, to
 * the next rank, under a chequered banner. `bottom` is where the rail posts
 * end.
 */
function trackPost(ctx: SKRSContext2D, x: number, bottom: number, label: string, finish: boolean) {
    const top = bottom - 78;
    railPost(ctx, x, top, bottom);
    // The rail's bars cross in front of this post too (the top bar is 24px
    // above the posts' feet).
    railBars(ctx, x - 1, x + 5, bottom - 24);

    ctx.font = font('700 13px');
    const body = ctx.measureText(label).width + 16;
    const tip = 10;
    const h = 22;
    const signY = top + 4;
    // The sign hangs off the post on the side it points to.
    const left = finish ? x - 4 : x + 8 - body - tip;
    const right = left + body + tip;
    ctx.beginPath();
    if (finish) {
        ctx.moveTo(left, signY);
        ctx.lineTo(right - tip, signY);
        ctx.lineTo(right, signY + h / 2);
        ctx.lineTo(right - tip, signY + h);
        ctx.lineTo(left, signY + h);
    } else {
        ctx.moveTo(right, signY);
        ctx.lineTo(left + tip, signY);
        ctx.lineTo(left, signY + h / 2);
        ctx.lineTo(left + tip, signY + h);
        ctx.lineTo(right, signY + h);
    }
    ctx.closePath();
    ctx.fillStyle = finish ? '#1b3f86' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = finish ? '#ffffff' : '#1b3f86';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (finish) {
        // A chequered banner on top of the finish sign.
        const cell = 5;
        for (let cx = 0; cx < body; cx += cell) {
            for (let cy = 0; cy < 10; cy += cell) {
                ctx.fillStyle = (cx / cell + cy / cell) % 2 === 0 ? '#1d2230' : '#ffffff';
                ctx.fillRect(left + cx, signY - 10 + cy, Math.min(cell, body - cx), cell);
            }
        }
    }
    ctx.fillStyle = finish ? '#ffffff' : '#1b3f86';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, finish ? left + body / 2 : left + tip + body / 2, signY + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/**
 * A simple starting gate standing on the turf: a white frame over `stalls`
 * stalls, each with a pair of closed front doors and a number. `x` is its
 * left edge; returns its right edge.
 */
function startingGate(ctx: SKRSContext2D, x: number, ground: number, stalls: number): number {
    const stall = 24;
    const height = 66;
    const top = ground - height;
    const width = stalls * stall + 4;
    ctx.fillStyle = 'rgba(20, 60, 30, 0.25)';
    ctx.fillRect(x + 3, ground - 4, width, 5);
    // The number board across the top.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, top, width, 18);
    for (let i = 0; i < stalls; i += 1) {
        const sx = x + 2 + i * stall;
        // Two closed doors, meeting in the middle.
        const door = ctx.createLinearGradient(0, top + 16, 0, ground);
        door.addColorStop(0, '#dfe7f2');
        door.addColorStop(1, '#b9c8dc');
        ctx.fillStyle = door;
        ctx.fillRect(sx + 2, top + 18, stall - 4, height - 20);
        ctx.fillStyle = 'rgba(27, 63, 134, 0.35)';
        ctx.fillRect(sx + stall / 2 - 0.5, top + 18, 1, height - 20);
        ctx.fillRect(sx + 2, top + 18 + (height - 20) / 2, stall - 4, 1);
        // The stall's number on the beam.
        ctx.fillStyle = '#1b3f86';
        ctx.font = font('700 11px');
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), sx + stall / 2, top + 13);
        ctx.textAlign = 'left';
    }
    // The frame: a beam across the top and a pillar between every stall.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, top, width, 4);
    ctx.fillRect(x, top + 16, width, 3);
    for (let i = 0; i <= stalls; i += 1) ctx.fillRect(x + i * stall, top, 4, height);
    ctx.strokeStyle = 'rgba(40, 90, 140, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1);
    return x + width;
}

/**
 * The race (Verillia, 2026-10-26: "could we have the mascot run across, with
 * their progress depending on their position in the rank bracket?"). The
 * track runs from the start post (the band's bottom cutoff) to the finish
 * post (the next cutoff up), with her food piled past the finish. She runs
 * at `race.progress` along it, leaning forward, a little off the ground,
 * with speed lines and dust behind her.
 */
function drawRace(ctx: SKRSContext2D, w: number, ground: number, art: Image, lean: number, size: number, race: SceneRace, food: FoodArt | null) {
    // The rail's posts end 18px above the ground line; the signposts match.
    const postBottom = ground - 18;
    const gateRight = startingGate(ctx, SIDE + 4, ground, 3);
    const startX = onRailPost(gateRight + 14);
    const finishX = onRailPost(w - SIDE - (food ? 215 : 150));
    trackPost(ctx, startX, postBottom, race.start, false);
    if (food) drawMealPile(ctx, food, w - SIDE - 100, ground);
    else drawFoodPile(ctx, w - SIDE - 70, ground, 100, false);

    // Short enough to run under the hanging food.
    const artH = Math.min(130, ground - 68) * size;
    const artW = (art.width / art.height) * artH;
    const progress = Math.max(0, Math.min(1, race.progress));
    // Her centre runs from just past the start post to the finish post.
    const cx = startX + artW / 2 + 10 + progress * (finishX - startX - artW / 2 - 10);
    const hop = 8;
    const feetY = ground - hop;

    // The dirt her feet throw up, then her shadow.
    drawDirt(ctx, cx - artW * 0.12, ground, artW);
    groundShadow(ctx, cx, ground, artW * 0.32);

    // Lean forward about the feet.
    ctx.save();
    ctx.translate(cx, feetY);
    ctx.rotate(lean);
    ctx.drawImage(art, -artW / 2, -artH, artW, artH);
    ctx.restore();

    // The finish post goes over her, so she runs behind it, not through it.
    trackPost(ctx, finishX, postBottom, race.finish, true);
}

/** A carrot lying at `angle`, its leaves at the thick end. */
function carrot(ctx: SKRSContext2D, x: number, y: number, length: number, angle: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(30, 60, 30, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 2;
    const body = ctx.createLinearGradient(0, -length * 0.12, 0, length * 0.12);
    body.addColorStop(0, '#ffa040');
    body.addColorStop(1, '#e8620c');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-length / 2, -length * 0.12);
    ctx.quadraticCurveTo(length * 0.1, -length * 0.1, length / 2, 0);
    ctx.quadraticCurveTo(length * 0.1, length * 0.1, -length / 2, length * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(160, 60, 0, 0.5)';
    ctx.lineWidth = 1;
    for (const t of [-0.25, 0, 0.22]) {
        ctx.beginPath();
        ctx.moveTo(length * t, -length * 0.08);
        ctx.lineTo(length * t + 3, -length * 0.02);
        ctx.stroke();
    }
    ctx.fillStyle = '#3fae4a';
    for (const a of [-0.5, 0, 0.5]) {
        ctx.save();
        ctx.translate(-length / 2, 0);
        ctx.rotate(Math.PI + a);
        ctx.beginPath();
        ctx.ellipse(length * 0.14, 0, length * 0.16, length * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

/** A rice bowl in Oguri blue, heaped with rice. */
function riceBowl(ctx: SKRSContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.shadowColor = 'rgba(30, 60, 30, 0.3)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    // The heap of rice, bumpy on top.
    ctx.fillStyle = '#fffdf7';
    for (let i = -3; i <= 3; i += 1) {
        ctx.beginPath();
        ctx.arc(x + i * r * 0.26, y - r * 0.15 - (3 - Math.abs(i)) * r * 0.14, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.shadowColor = 'transparent';
    // The bowl.
    const bowl = ctx.createLinearGradient(x - r, 0, x + r, 0);
    bowl.addColorStop(0, '#2c62b3');
    bowl.addColorStop(0.5, OGURI_BLUE);
    bowl.addColorStop(1, '#244f92');
    ctx.fillStyle = bowl;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r * 0.12);
    ctx.lineTo(x + r, y - r * 0.12);
    ctx.quadraticCurveTo(x + r * 0.9, y + r * 0.75, x, y + r * 0.78);
    ctx.quadraticCurveTo(x - r * 0.9, y + r * 0.75, x - r, y - r * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - r, y - r * 0.16, r * 2, r * 0.1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const dx of [-0.45, 0, 0.45]) {
        ctx.beginPath();
        ctx.arc(x + dx * r, y + r * 0.3, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** A skewer of three dango: pink, white and green. */
function dango(ctx: SKRSContext2D, x: number, y: number, size: number, angle: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#c8a46a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size * 2, 0);
    ctx.lineTo(size * 1.7, 0);
    ctx.stroke();
    ctx.shadowColor = 'rgba(30, 60, 30, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    for (const [i, colour] of [[-1, '#f7a8c4'], [0, '#fffaf2'], [1, '#9fd38a']] as const) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(i * size * 1.05, 0, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/**
 * Oguri's food, piled up: rice bowl and onigiri at the back, carrots and
 * dango in front. Centred on `cx`, resting on `ground`, about `width` wide.
 * `split` leaves the middle clear so a figure standing there shows.
 */
function drawFoodPile(ctx: SKRSContext2D, cx: number, ground: number, width: number, split: boolean) {
    const half = width / 2;
    const left = split ? cx - half - 30 : cx - half * 0.5;
    const right = split ? cx + half + 26 : cx + half * 0.5;
    riceBowl(ctx, left - 6, ground - 20, 20);
    onigiri(ctx, right, ground - 18, 34, 0.12);
    onigiri(ctx, right + 26, ground - 14, 28, -0.2);
    onigiri(ctx, right + 13, ground - 42, 28, 0.05);
    onigiri(ctx, left - 32, ground - 14, 28, -0.1);
    carrot(ctx, left + 12, ground - 6, 44, -0.25);
    carrot(ctx, right - 6, ground - 4, 40, 0.35);
    dango(ctx, cx + (split ? half * 0.55 : 0), ground - 6, 7, -0.2);
}

/** A steamed bun: a soft white dome with pleats gathered at the top. */
function bun(ctx: SKRSContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.shadowColor = 'rgba(30, 60, 110, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 2;
    const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.2, r * 0.2, x, y, r * 1.1);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(1, '#efe6d8');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.15, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#b3a487';
    ctx.lineWidth = Math.max(1.5, r / 8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 128, 95, 0.8)';
    ctx.lineWidth = 1;
    for (const a of [-0.7, -0.35, 0, 0.35, 0.7]) {
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.55);
        ctx.quadraticCurveTo(x + a * r * 0.6, y - r * 0.2, x + a * r, y + r * 0.1);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * The ground kicked up behind a runner whose feet strike at (`footX`,
 * `ground`): a haze of dust along the ground fading behind her, then a
 * spray of soil clods and torn turf thrown up and back in arcs, the big
 * ones falling short and the small ones flying furthest.
 */
function drawDirt(ctx: SKRSContext2D, footX: number, ground: number, artW: number) {
    const rand = seeded(4242);

    // Dust haze: soft tan clouds along the ground, thinning behind her.
    for (let i = 0; i < 5; i += 1) {
        const x = footX - artW * (0.15 + i * 0.22);
        const rx = artW * (0.28 + i * 0.06);
        const ry = 8 + i * 3;
        const y = ground - 4 - i * 2.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
        const a = 0.42 * (1 - i / 5.5);
        g.addColorStop(0, `rgba(176, 146, 104, ${a})`);
        g.addColorStop(0.6, `rgba(176, 146, 104, ${a * 0.45})`);
        g.addColorStop(1, 'rgba(176, 146, 104, 0)');
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / rx);
        ctx.translate(-x, -y);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Clods and turf, thrown up and back.
    const soil = ['#5b3d22', '#6e4a2a', '#83603a', '#4a3119', '#9a7448'];
    for (let i = 0; i < 46; i += 1) {
        const size = rand() < 0.2 ? 2.6 + rand() * 2.2 : 0.9 + rand() * 1.6;
        // Small bits fly further; each sits somewhere along its arc.
        const reach = artW * (0.25 + rand() * 0.9) * (3.2 / (size + 1.2));
        const t = 0.25 + rand() * 0.75;
        const x = footX - 8 - reach * t - rand() * 6;
        // Kicked low off the heels, not thrown over her shoulder.
        const rise = artW * (0.05 + rand() * 0.2);
        const y = ground - 3 - rise * 4 * t * (1 - t) - rand() * 3;
        const turf = rand() < 0.22;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI);
        ctx.globalAlpha = 0.65 + rand() * 0.35;
        // An irregular lump, not a circle.
        ctx.beginPath();
        const corners = 5 + Math.floor(rand() * 3);
        for (let k = 0; k < corners; k += 1) {
            const a = (k / corners) * Math.PI * 2;
            const r = size * (0.7 + rand() * 0.5);
            if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = turf ? '#4f9a4f' : soil[Math.floor(rand() * soil.length)]!;
        ctx.fill();
        if (turf) {
            // Torn turf: grass on top, a little soil underneath.
            ctx.fillStyle = '#6b4a2a';
            ctx.fillRect(-size * 0.6, size * 0.15, size * 1.2, size * 0.5);
        }
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

// ─── Still in Love ────────────────────────────────────────────────────────────

/** Her image colours (umamusu.wiki): red #D83A43 and blue #6FBBF1. */
const SIL_RED = '#d83a43';

/** Mixes `#rrggbb` colours `a` to `b` by `t`. */
function mix(a: string, b: string, t: number): string {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
    return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/** A pale crescent moon with a faint glow and soft shading: the calm moon. */
function crescentMoon(ctx: SKRSContext2D, x: number, y: number, r: number) {
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
    halo.addColorStop(0, 'rgba(240, 230, 210, 0.28)');
    halo.addColorStop(1, 'rgba(240, 230, 210, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Draw the crescent on its own layer so the cut does not reach the sky.
    const size = Math.ceil(r * 2 + 4);
    const layer = createCanvas(size * RENDER_SCALE, size * RENDER_SCALE);
    const l = layer.getContext('2d');
    l.scale(RENDER_SCALE, RENDER_SCALE);
    const c = size / 2;
    const body = l.createRadialGradient(c - r * 0.4, c - r * 0.3, r * 0.2, c, c, r);
    body.addColorStop(0, '#fbf5e6');
    body.addColorStop(1, '#d9ccb2');
    l.fillStyle = body;
    l.beginPath();
    l.arc(c, c, r, 0, Math.PI * 2);
    l.fill();
    l.globalCompositeOperation = 'destination-out';
    l.beginPath();
    l.arc(c + r * 0.5, c - r * 0.22, r * 0.9, 0, Math.PI * 2);
    l.fill();
    ctx.drawImage(layer, x - c, y - c, size, size);
}

/**
 * A full blood moon: deep red, darker at the limb, mottled with maria and a
 * few craters, a wide red halo, and a wisp of cloud across it. The full
 * moon she cannot stand.
 */
function bloodMoon(ctx: SKRSContext2D, x: number, y: number, r: number) {
    const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.2);
    halo.addColorStop(0, 'rgba(200, 30, 40, 0.3)');
    halo.addColorStop(0.5, 'rgba(160, 10, 25, 0.08)');
    halo.addColorStop(1, 'rgba(160, 10, 25, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    body.addColorStop(0, '#e2453c');
    body.addColorStop(0.6, '#a8171f');
    body.addColorStop(1, '#5a0710');
    ctx.fillStyle = body;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // Maria: darker blotches.
    const rand = seeded(77);
    for (let i = 0; i < 7; i += 1) {
        ctx.fillStyle = `rgba(70, 4, 10, ${0.18 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(x + (rand() - 0.5) * r * 1.2, y + (rand() - 0.5) * r * 1.2, r * (0.15 + rand() * 0.25), r * (0.1 + rand() * 0.18), rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
    }
    // Craters: a dark bowl with a lit rim.
    for (let i = 0; i < 5; i += 1) {
        const cx = x + (rand() - 0.5) * r * 1.3;
        const cy = y + (rand() - 0.5) * r * 1.3;
        const cr = r * (0.05 + rand() * 0.08);
        ctx.fillStyle = 'rgba(60, 3, 8, 0.45)';
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 140, 120, 0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, Math.PI * 0.9, Math.PI * 1.7);
        ctx.stroke();
    }
    ctx.restore();
    // A thin cloud drifting across.
    ctx.fillStyle = 'rgba(30, 6, 14, 0.55)';
    for (const [dx, dy, rx, ry] of [[-0.6, 0.35, 0.9, 0.12], [0.3, 0.45, 0.7, 0.1], [-0.1, 0.55, 0.5, 0.08]] as const) {
        ctx.beginPath();
        ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** A small bat silhouette, wings spread. */
function bat(ctx: SKRSContext2D, x: number, y: number, s: number, colour: string) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.6, x - s * 1.2, y - s * 0.3);
    ctx.quadraticCurveTo(x - s * 0.9, y, x - s * 1.0, y + s * 0.25);
    ctx.quadraticCurveTo(x - s * 0.6, y + s * 0.05, x - s * 0.4, y + s * 0.35);
    ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.15, x, y + s * 0.3);
    ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.15, x + s * 0.4, y + s * 0.35);
    ctx.quadraticCurveTo(x + s * 0.6, y + s * 0.05, x + s * 1.0, y + s * 0.25);
    ctx.quadraticCurveTo(x + s * 0.9, y, x + s * 1.2, y - s * 0.3);
    ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.6, x, y);
    ctx.fill();
}

/**
 * A gothic arched window from (x, top) to the sill at `bottom`: night sky,
 * its moon (a pale crescent or a full blood moon), bats, dark mullions and
 * a stone frame, with blood on the glass as `mood` rises.
 */
function gothicWindow(ctx: SKRSContext2D, x: number, top: number, w: number, bottom: number, moon: 'crescent' | 'blood', mood: number, seed: number, art: SilArt | null) {
    const arch = () => {
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        ctx.lineTo(x, top + w * 0.6);
        ctx.quadraticCurveTo(x, top, x + w / 2, top - w * 0.05);
        ctx.quadraticCurveTo(x + w, top, x + w, top + w * 0.6);
        ctx.lineTo(x + w, bottom);
        ctx.closePath();
    };
    ctx.save();
    arch();
    ctx.clip();
    const sky = ctx.createLinearGradient(0, top, 0, bottom);
    sky.addColorStop(0, moon === 'blood' ? '#140610' : '#0b1128');
    sky.addColorStop(1, moon === 'blood' ? '#2a0a18' : '#232b48');
    ctx.fillStyle = sky;
    ctx.fillRect(x, top - w, w, bottom - top + w);
    const rand = seeded(seed);
    for (let i = 0; i < 18; i += 1) {
        ctx.fillStyle = `rgba(255, 240, 240, ${0.3 + rand() * 0.5})`;
        ctx.fillRect(x + rand() * w, top + rand() * (bottom - top), 1.2, 1.2);
    }
    // Each moon sits on the window's outer side, so its light slants in
    // towards her in the middle of the room.
    const outer = moon === 'blood' ? 1 : -1;
    const mx = x + w * (0.5 + outer * 0.16);
    const my = top + (bottom - top) * 0.3;
    if (moon === 'blood') bloodMoon(ctx, mx, my, w * 0.2);
    else crescentMoon(ctx, mx, my, w * 0.17);
    bat(ctx, x + w * (0.5 - outer * 0.2), top + (bottom - top) * 0.5, w * 0.07, 'rgba(10, 4, 8, 0.9)');
    bat(ctx, x + w * (0.5 - outer * 0.08), top + (bottom - top) * 0.64, w * 0.05, 'rgba(10, 4, 8, 0.85)');
    // Blood on the glass, more as she turns.
    if (mood > 0.15) {
        const r2 = seeded(seed + 9);
        if (art) {
            // Blood thrown at the glass, running down it.
            placed(ctx, art.drips, x + w * 0.5, top + (bottom - top) * 0.3, w * (0.7 + mood * 0.5), (r2() - 0.5) * 0.3, 0.55 + mood * 0.45);
            if (mood > 0.5) placed(ctx, art.splat, x + w * (0.3 + r2() * 0.4), top + (bottom - top) * 0.55, w * 0.5 * mood, r2() * Math.PI, 0.9);
        } else {
            const n = Math.round(mood * 3);
            for (let i = 0; i < n; i += 1) bloodSplat(ctx, x + w * (0.2 + r2() * 0.6), top + (bottom - top) * (0.2 + r2() * 0.45), 6 + mood * 8, mood, r2);
        }
    }
    ctx.restore();
    ctx.strokeStyle = '#3a2630';
    ctx.lineWidth = 5;
    arch();
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, top);
    ctx.lineTo(x + w / 2, bottom);
    ctx.moveTo(x, top + (bottom - top) * 0.62);
    ctx.lineTo(x + w, top + (bottom - top) * 0.62);
    ctx.stroke();
    ctx.fillStyle = '#3a2630';
    ctx.fillRect(x - 3, bottom, w + 6, 4);
}

/** One window's moonlight: where it is, which way it falls, its colour and strength. */
interface Moonbeam {
    x: number;
    /** 1 slants to the right, -1 to the left. */
    dir: 1 | -1;
    colour: string;
    strength: number;
}

/**
 * The moonlight through the windows, on its own layer (`w` by `h`, at
 * RENDER_SCALE) so it can be laid over the scene and, more faintly, over
 * the cards.
 *
 * Each pane of a window throws its own shaft, so the mullions leave dark
 * bars between them, and a few brighter rays streak each shaft. The shafts
 * slant down at `slope` across per px down and fade quickly, mostly gone
 * by the lace and out entirely just onto the cards (at `reach`). The glass
 * itself is left clear.
 */
function moonlightLayer(
    w: number,
    h: number,
    beams: Moonbeam[],
    top: number,
    winW: number,
    sill: number,
    reach: number,
    slope: number,
): Canvas {
    const layer = createCanvas(w * RENDER_SCALE, h * RENDER_SCALE);
    const ctx = layer.getContext('2d');
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    const midY = top + (sill - top) * 0.62;
    const glassTop = top + winW * 0.3;
    for (const beam of beams) {
        const { x, dir, colour, strength } = beam;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.rect(x - 4, 0, winW + 8, sill + 4);
        ctx.clip('evenodd');
        // One shaft per pane: the hull of the pane and the pane moved along the light.
        const shaft = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
            const drop = reach - y0;
            const shift = dir * slope * drop;
            const pts: [number, number][] =
                dir > 0
                    ? [[x0, y0], [x1, y0], [x1 + shift, y0 + drop], [x1 + shift, y1 + drop], [x0 + shift, y1 + drop], [x0, y1]]
                    : [[x0, y0], [x1, y0], [x1, y1], [x1 + shift, y1 + drop], [x0 + shift, y1 + drop], [x0 + shift, y0 + drop]];
            const cx = (x0 + x1) / 2;
            const fade = ctx.createLinearGradient(cx, y0, cx + shift, y0 + drop);
            // Bright at the glass, mostly gone by the lace.
            fade.addColorStop(0, rgba(colour, alpha));
            fade.addColorStop(0.25, rgba(colour, alpha * 0.45));
            fade.addColorStop(0.6, rgba(colour, alpha * 0.12));
            fade.addColorStop(1, rgba(colour, 0));
            ctx.fillStyle = fade;
            ctx.beginPath();
            ctx.moveTo(pts[0]![0], pts[0]![1]);
            for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
            ctx.closePath();
            ctx.fill();
        };
        const gap = 2.5;
        shaft(x + 3, glassTop, x + winW / 2 - gap, midY - gap, strength);
        shaft(x + winW / 2 + gap, glassTop, x + winW - 3, midY - gap, strength);
        shaft(x + 3, midY + gap, x + winW / 2 - gap, sill - 2, strength);
        shaft(x + winW / 2 + gap, midY + gap, x + winW - 3, sill - 2, strength);
        // Brighter rays streaking through.
        const rand = seeded(Math.round(x) + 3);
        for (let i = 0; i < 6; i += 1) {
            const rx = x + 6 + rand() * (winW - 12);
            const rw = 1.5 + rand() * 4;
            shaft(rx, glassTop + rand() * 20, rx + rw, sill - 2, strength * (0.4 + rand() * 0.6));
        }
        // Dust caught in the light.
        for (let i = 0; i < 12; i += 1) {
            const t = rand();
            const py = glassTop + t * (reach - glassTop) * 0.6;
            const px = x + rand() * winW + dir * slope * (py - glassTop);
            ctx.fillStyle = rgba(colour, 0.6 * (1 - t));
            ctx.beginPath();
            ctx.arc(px, py, 0.8 + rand() * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    return layer;
}

/** A soft glow of moonlight on the wall round a window, drawn before the window. */
function windowGlow(ctx: SKRSContext2D, x: number, top: number, winW: number, sill: number, colour: string, strength: number) {
    const cx = x + winW / 2;
    const cy = (top + sill) / 2;
    const r = winW * 1.25;
    const glow = ctx.createRadialGradient(cx, cy, winW * 0.3, cx, cy, r);
    glow.addColorStop(0, rgba(colour, strength));
    glow.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
}

/** A small heart, point down, centred on (x, y), `s` across. */
function heart(ctx: SKRSContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.7, y - s * 0.05, x - s * 0.35, y - s * 0.6, x, y - s * 0.2);
    ctx.bezierCurveTo(x + s * 0.35, y - s * 0.6, x + s * 0.7, y - s * 0.05, x, y + s * 0.45);
    ctx.fill();
}

/**
 * Velvet curtains on a rod over a window, tied back at either side with a
 * white ribbon and a gold heart: the ribbons and hearts of her dress. Deep
 * blue (her blue) while she is calm, turning red as she turns.
 */
function curtains(ctx: SKRSContext2D, x: number, top: number, winW: number, sill: number, mood: number) {
    const rodY = top - 4;
    const tieY = top + (sill - top) * 0.62;
    const hem = sill + 2;
    for (const side of [-1, 1] as const) {
        // The edge of the window this drape hangs at.
        const edge = side < 0 ? x : x + winW;
        const out = edge + side * 16;
        const inner = edge - side * 14;
        const pinchIn = edge - side * 3;
        const pinchOut = edge + side * 7;
        const velvet = ctx.createLinearGradient(Math.min(out, inner), 0, Math.max(out, inner), 0);
        const blue = ['#132338', '#2c537e', '#1a3352', '#264a72', '#101d30'];
        const red = ['#4a0b16', '#8a1c2c', '#5c1020', '#7a1828', '#3e0912'];
        [0, 0.3, 0.55, 0.8, 1].forEach((at, i) => velvet.addColorStop(at, mix(blue[i]!, red[i]!, mood)));
        ctx.fillStyle = velvet;
        ctx.beginPath();
        ctx.moveTo(out, rodY);
        ctx.lineTo(inner, rodY);
        ctx.quadraticCurveTo(inner, tieY - 20, pinchIn, tieY);
        ctx.quadraticCurveTo(pinchIn - side * 2, hem - 10, edge - side * 8, hem);
        ctx.lineTo(out + side * 4, hem);
        ctx.quadraticCurveTo(pinchOut + side * 4, hem - 14, pinchOut, tieY);
        ctx.quadraticCurveTo(out, tieY - 20, out, rodY);
        ctx.fill();
        // Folds.
        ctx.strokeStyle = 'rgba(20, 0, 6, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo((out + inner) / 2, rodY + 2);
        ctx.quadraticCurveTo((out + inner) / 2, tieY - 12, (pinchIn + pinchOut) / 2, tieY);
        ctx.stroke();
        // The tie: a white ribbon with a gold heart.
        const tx = (pinchIn + pinchOut) / 2;
        ctx.fillStyle = '#f4ecef';
        ctx.fillRect(Math.min(pinchIn, pinchOut) - 2, tieY - 2, Math.abs(pinchOut - pinchIn) + 4, 4);
        ctx.beginPath();
        ctx.moveTo(tx, tieY + 1);
        ctx.lineTo(tx - 4, tieY + 10);
        ctx.lineTo(tx - 1, tieY + 9);
        ctx.lineTo(tx, tieY + 1);
        ctx.lineTo(tx + 4, tieY + 10);
        ctx.lineTo(tx + 1, tieY + 9);
        ctx.fill();
        ctx.fillStyle = '#e2b24a';
        heart(ctx, tx, tieY, 6);
    }
    // The rod and its finials.
    ctx.fillStyle = '#2a1a14';
    ctx.fillRect(x - 22, rodY - 2, winW + 44, 3);
    ctx.fillStyle = '#c9a050';
    for (const fx of [x - 22, x + winW + 22]) {
        ctx.beginPath();
        ctx.arc(fx, rodY - 0.5, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** A glass of red on the table, "an unquenched thirst"; it spills over the rim as she turns. */
function goblet(ctx: SKRSContext2D, cx: number, base: number, mood: number) {
    // Foot and stem.
    ctx.fillStyle = 'rgba(220, 210, 220, 0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, base - 1, 7, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 1, base - 14, 2, 13);
    // The wine, then the bowl's glass over it.
    const bowlTop = base - 30;
    ctx.fillStyle = mix('#7a0a18', '#a00818', mood);
    ctx.beginPath();
    ctx.moveTo(cx - 7.5, bowlTop + 6);
    ctx.quadraticCurveTo(cx - 7.5, base - 14, cx, base - 14);
    ctx.quadraticCurveTo(cx + 7.5, base - 14, cx + 7.5, bowlTop + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(235, 225, 235, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, bowlTop);
    ctx.quadraticCurveTo(cx - 8.5, base - 14, cx, base - 14);
    ctx.quadraticCurveTo(cx + 8.5, base - 14, cx + 8, bowlTop);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(cx - 5, bowlTop + 3, 1.2, 10);
    if (mood > 0.5) {
        ctx.fillStyle = '#a00818';
        ctx.fillRect(cx + 6.5, bowlTop + 4, 1.6, 10 + mood * 8);
    }
}

/**
 * A splat of blood at (x, y): an irregular blob, droplets flung round it,
 * and drips running down, darkening as they dry, with a wet highlight.
 */
function bloodSplat(ctx: SKRSContext2D, x: number, y: number, size: number, mood: number, rand: () => number) {
    const wet = '#a3101c';
    const dark = '#5e0710';
    ctx.save();
    // The blob.
    ctx.fillStyle = wet;
    ctx.beginPath();
    const lobes = 9;
    for (let k = 0; k <= lobes; k += 1) {
        const a = (k / lobes) * Math.PI * 2;
        const r = size * (0.6 + rand() * 0.55);
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.85;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.quadraticCurveTo(x + Math.cos(a - 0.35) * r * 1.25, y + Math.sin(a - 0.35) * r * 1.05, px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x + size * 0.15, y + size * 0.2, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Droplets flung outwards.
    for (let i = 0; i < 6 + Math.round(mood * 8); i += 1) {
        const a = rand() * Math.PI * 2;
        const d = size * (1.2 + rand() * 1.6);
        ctx.fillStyle = rand() < 0.5 ? wet : dark;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + rand() * size * 0.14, 0, Math.PI * 2);
        ctx.fill();
    }
    // Drips running down.
    for (let i = 0; i < 1 + Math.round(mood * 2); i += 1) {
        const dx = x + (rand() - 0.5) * size;
        const len = size * (1.2 + rand() * 2.4) * (0.6 + mood);
        const width = 1.4 + rand() * 1.6;
        ctx.fillStyle = wet;
        ctx.fillRect(dx - width / 2, y, width, len);
        ctx.beginPath();
        ctx.arc(dx, y + len, width * 0.9, 0, Math.PI * 2);
        ctx.fill();
    }
    // A wet highlight.
    ctx.fillStyle = 'rgba(255, 190, 190, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x - size * 0.25, y - size * 0.3, size * 0.18, size * 0.08, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** A jar of red fruit jam with a gingham lid and a label. */
function jamJar(ctx: SKRSContext2D, cx: number, bottom: number, s: number) {
    const w = s;
    const h = s * 1.15;
    const glass = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    glass.addColorStop(0, '#7a0f1c');
    glass.addColorStop(0.4, SIL_RED);
    glass.addColorStop(1, '#5c0a14');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, bottom - h, w, h, s * 0.18);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(cx - w * 0.32, bottom - h * 0.85, w * 0.08, h * 0.6);
    // Lid: a gingham cloth tied over the top.
    ctx.fillStyle = '#f4e9ee';
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.6, bottom - h - s * 0.22, w * 1.2, s * 0.3, s * 0.08);
    ctx.fill();
    ctx.fillStyle = 'rgba(216, 58, 67, 0.55)';
    for (let i = -2; i <= 2; i += 2) ctx.fillRect(cx + i * w * 0.2 - 1, bottom - h - s * 0.22, 2, s * 0.3);
    ctx.fillStyle = '#f7efe6';
    ctx.fillRect(cx - w * 0.3, bottom - h * 0.55, w * 0.6, h * 0.28);
}

/**
 * The side table: two jars of jam, a candle, and a mirror draped with
 * cloth, because she does not like large mirrors.
 */
function sideTable(ctx: SKRSContext2D, x: number, floor: number, mood: number, art: SilArt | null) {
    // The draped mirror behind.
    ctx.fillStyle = '#2a1a22';
    ctx.beginPath();
    ctx.roundRect(x + 52, floor - 118, 62, 84, 30);
    ctx.fill();
    const cloth = ctx.createLinearGradient(x + 50, 0, x + 116, 0);
    cloth.addColorStop(0, '#4a2a38');
    cloth.addColorStop(0.5, '#6a3a4c');
    cloth.addColorStop(1, '#3f2330');
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(x + 50, floor - 104);
    ctx.quadraticCurveTo(x + 83, floor - 128, x + 116, floor - 104);
    ctx.lineTo(x + 120, floor - 30);
    ctx.quadraticCurveTo(x + 104, floor - 38, x + 92, floor - 30);
    ctx.quadraticCurveTo(x + 76, floor - 40, x + 62, floor - 30);
    ctx.quadraticCurveTo(x + 54, floor - 36, x + 46, floor - 30);
    ctx.closePath();
    ctx.fill();
    // The table top.
    ctx.fillStyle = '#3a2028';
    ctx.fillRect(x, floor - 30, 190, 6);
    ctx.fillStyle = '#2a161c';
    ctx.fillRect(x + 10, floor - 24, 6, 24);
    ctx.fillRect(x + 174, floor - 24, 6, 24);
    goblet(ctx, x + 142, floor - 30, mood);
    // A vase of red spider lilies at the end of the table, for her
    // "Scarlet Lily" skill.
    if (art) {
        const lw = 52;
        const lh = (art.lilies.height / art.lilies.width) * lw;
        ctx.drawImage(art.lilies, x + 168 - lw / 2, floor - 44 - lh, lw, lh);
    }
    const vx = x + 12;
    const glass = ctx.createLinearGradient(x + 148 + vx, 0, x + 164 + vx, 0);
    glass.addColorStop(0, '#5a1420');
    glass.addColorStop(0.4, '#8a2232');
    glass.addColorStop(1, '#40101a');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(vx + 152, floor - 52);
    ctx.lineTo(vx + 160, floor - 52);
    ctx.quadraticCurveTo(vx + 158, floor - 44, vx + 165, floor - 36);
    ctx.quadraticCurveTo(vx + 166, floor - 30, vx + 156, floor - 30);
    ctx.quadraticCurveTo(vx + 146, floor - 30, vx + 147, floor - 36);
    ctx.quadraticCurveTo(vx + 154, floor - 44, vx + 152, floor - 52);
    ctx.fill();
    jamJar(ctx, x + 32, floor - 30, 24);
    jamJar(ctx, x + 56, floor - 30, 18);
    // Her jam knife: lying by the jars while she is calm, then stabbed
    // upright into the table. At her worst it is in the cards instead.
    if (art && mood < 0.34) {
        placed(ctx, art.knife, x + 90, floor - 34, 74, 0.05);
    } else if (art && mood < 0.67) {
        stabbed(ctx, art.knife, x + 96, floor - 28, 82, 0.18);
        placed(ctx, art['smear-short'], x + 96, floor - 30, 30, 0.4, 0.8);
    }
    // A candle, its flame brighter as she turns.
    ctx.fillStyle = '#efe4dc';
    ctx.fillRect(x + 122, floor - 58, 8, 28);
    const flame = ctx.createRadialGradient(x + 126, floor - 64, 0, x + 126, floor - 64, 18 + mood * 10);
    flame.addColorStop(0, `rgba(255, ${Math.round(210 - mood * 120)}, ${Math.round(140 - mood * 90)}, 0.9)`);
    flame.addColorStop(1, 'rgba(255, 120, 80, 0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(x + 126, floor - 64, 18 + mood * 10, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * Her eyes in the dark, half-lidded: red with a dark ring round the pupil.
 * They glow brighter and redder with `mood`.
 */
function watchingEyes(ctx: SKRSContext2D, cx: number, cy: number, s: number, mood: number) {
    for (const side of [-1, 1]) {
        const ex = cx + side * s * 1.25;
        const glow = ctx.createRadialGradient(ex, cy, 0, ex, cy, s * (1.6 + mood * 1.4));
        glow.addColorStop(0, `rgba(255, 40, 60, ${0.25 + mood * 0.55})`);
        glow.addColorStop(1, 'rgba(255, 40, 60, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ex, cy, s * (1.6 + mood * 1.4), 0, Math.PI * 2);
        ctx.fill();
        // The eye, cut flat on top by a heavy lid.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ex, cy, s, s * 0.55, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = mix('#b8323c', '#ff2a3c', mood);
        ctx.fillRect(ex - s, cy - s, s * 2, s * 2);
        ctx.fillStyle = '#4a0610';
        ctx.beginPath();
        ctx.arc(ex + side * s * 0.05, cy + s * 0.08, s * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#12020a';
        ctx.beginPath();
        ctx.arc(ex + side * s * 0.05, cy + s * 0.08, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 230, 230, 0.85)';
        ctx.beginPath();
        ctx.arc(ex - s * 0.25, cy - s * 0.05, s * 0.1, 0, Math.PI * 2);
        ctx.fill();
        // The lid: half-lidded, lower as she turns.
        ctx.fillStyle = '#0c0509';
        ctx.fillRect(ex - s, cy - s, s * 2, s * (0.62 + mood * 0.18));
        ctx.restore();
        ctx.strokeStyle = '#0c0509';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ex - s * 1.05, cy - s * (0.38 - mood * 0.18));
        ctx.quadraticCurveTo(ex, cy - s * (0.5 - mood * 0.18), ex + s * 1.05, cy - s * (0.38 - mood * 0.18));
        ctx.stroke();
    }
}

/**
 * Where the club stands between the two rank windows, shown on the lace:
 * `from` and `to` are the windows' centres, `at` the progress from 0 to 1.
 */
interface LaceTrack {
    from: number;
    to: number;
    at: number;
}

/** A four-pointed glint of light at (x, y), `s` from tip to tip. */
function glint(ctx: SKRSContext2D, x: number, y: number, s: number, alpha: number) {
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x, y - s / 2);
    ctx.quadraticCurveTo(x, y, x + s / 2, y);
    ctx.quadraticCurveTo(x, y, x, y + s / 2);
    ctx.quadraticCurveTo(x, y, x - s / 2, y);
    ctx.quadraticCurveTo(x, y, x, y - s / 2);
    ctx.fill();
}

/** A full, rounded heart outline (point down) centred on (x, y), `s` tall; path only. */
function gemHeartPath(ctx: SKRSContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.5);
    ctx.bezierCurveTo(x - s * 0.15, y + s * 0.32, x - s * 0.56, y + s * 0.1, x - s * 0.56, y - s * 0.15);
    ctx.bezierCurveTo(x - s * 0.56, y - s * 0.43, x - s * 0.2, y - s * 0.53, x, y - s * 0.27);
    ctx.bezierCurveTo(x + s * 0.2, y - s * 0.53, x + s * 0.56, y - s * 0.43, x + s * 0.56, y - s * 0.15);
    ctx.bezierCurveTo(x + s * 0.56, y + s * 0.1, x + s * 0.15, y + s * 0.32, x, y + s * 0.5);
    ctx.closePath();
}

/**
 * A heart-cut blue diamond, her halter's blue diamond, centred on (cx, cy)
 * and `s` tall. Drawn as a polished stone rather than a diagram: light
 * pooling in from the upper left through ice blue into a deep sapphire
 * edge, facets only hinted at by faint lines, a bright rim, a soft
 * highlight and a single fine glint.
 */
function blueHeartGem(ctx: SKRSContext2D, cx: number, cy: number, s: number) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.5);
    glow.addColorStop(0, 'rgba(130, 200, 255, 0.55)');
    glow.addColorStop(1, 'rgba(130, 200, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    gemHeartPath(ctx, cx, cy, s);
    const body = ctx.createRadialGradient(cx - s * 0.18, cy - s * 0.2, 0, cx + s * 0.04, cy + s * 0.06, s * 0.64);
    body.addColorStop(0, '#dff3ff');
    body.addColorStop(0.22, '#8fd0ff');
    body.addColorStop(0.5, '#3f9cf0');
    body.addColorStop(0.78, '#1f5fc0');
    body.addColorStop(1, '#0f2f6e');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();
    // Light coming back out low on the right, as it does through a cut stone.
    const bounce = ctx.createRadialGradient(cx + s * 0.18, cy + s * 0.2, 0, cx + s * 0.18, cy + s * 0.2, s * 0.26);
    bounce.addColorStop(0, 'rgba(150, 220, 255, 0.6)');
    bounce.addColorStop(1, 'rgba(150, 220, 255, 0)');
    ctx.fillStyle = bounce;
    ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
    // Depth: the lower right falls into shadow.
    const shade = ctx.createLinearGradient(cx - s * 0.3, cy - s * 0.3, cx + s * 0.4, cy + s * 0.5);
    shade.addColorStop(0, 'rgba(8, 24, 70, 0)');
    shade.addColorStop(1, 'rgba(8, 24, 70, 0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
    // Facets, barely there: lines from the culet out to the edge, and the table.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 0.45;
    const fx = cx;
    const fy = cy + s * 0.05;
    for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + Math.cos(a) * s, fy + Math.sin(a) * s);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    gemHeartPath(ctx, cx, cy + s * 0.02, s * 0.5);
    ctx.stroke();
    // A soft highlight on the left lobe.
    const shine = ctx.createRadialGradient(cx - s * 0.28, cy - s * 0.24, 0, cx - s * 0.28, cy - s * 0.24, s * 0.17);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
    ctx.restore();

    // The rim: bright where the light comes from.
    const rim = ctx.createLinearGradient(cx - s * 0.5, cy - s * 0.5, cx + s * 0.5, cy + s * 0.5);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    rim.addColorStop(0.5, 'rgba(170, 220, 255, 0.7)');
    rim.addColorStop(1, 'rgba(40, 90, 170, 0.9)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 0.8;
    gemHeartPath(ctx, cx, cy, s);
    ctx.stroke();
    // One fine glint off the right lobe.
    glint(ctx, cx + s * 0.36, cy - s * 0.34, s * 0.55, 0.85);
}

/** Lace scallops are this far apart; the track snaps to them. */
const LACE_STEP = 18;

/** The x of the lace hole marking the club on `track`. */
function trackMarker(track: LaceTrack): number {
    const x = track.from + Math.max(0, Math.min(1, track.at)) * (track.to - track.from);
    return Math.round(x / LACE_STEP) * LACE_STEP;
}

/**
 * Bobbin lace along `y`: scallops with picot holes, `colour` turning red
 * with mood, and gold heart charms. With a `track`, the holes between the
 * two windows become a strip of lights: gold beads from the bottom cutoff
 * up to the club, the club's place marked with a blue heart-cut diamond,
 * and dark beyond.
 */
function laceTrim(ctx: SKRSContext2D, w: number, y: number, colour: string, track: LaceTrack | null, mood: number) {
    const r = LACE_STEP / 2;
    ctx.fillStyle = colour;
    ctx.fillRect(0, y - 6, w, 6);
    for (let x = 0; x < w + r * 2; x += r * 2) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < w + r * 2; x += r * 2) {
        ctx.beginPath();
        ctx.arc(x, y + 2, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + r, y - 3, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // The scallop whose hole marks the club, if there is a track.
    const step = LACE_STEP;
    const snap = (x: number) => Math.round(x / step) * step;
    const marker = track ? trackMarker(track) : null;
    // Gold heart charms hanging from every eighth scallop, from the hearts
    // on her dress; none right by the marker, which has its own charm.
    ctx.fillStyle = '#e2b24a';
    for (let x = 0; x < w; x += r * 16) {
        if (marker !== null && Math.abs(x - marker) < step * 2) continue;
        ctx.fillRect(x - 0.5, y + r - 1, 1, 3);
        heart(ctx, x, y + r + 5, 7);
    }
    if (!track || marker === null) return;
    const hole = r * 0.35;
    const first = snap(track.from);
    const last = snap(track.to);
    for (let x = first; x <= last; x += step) {
        if (x === marker) continue;
        if (x < marker) {
            // Lit: a gold bead with a warm glow, like a light strip. On the
            // white lace a deep amber gold, so it does not wash out; on the
            // red lace a bright yellow gold, so it does not sink into it.
            const glow = ctx.createRadialGradient(x, y + 2, 0, x, y + 2, hole * 2.8);
            glow.addColorStop(0, rgba(mix('#e08a00', '#ffd23a', mood), 0.35 + mood * 0.3));
            glow.addColorStop(1, rgba(mix('#e08a00', '#ffd23a', mood), 0));
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(x, y + 2, hole * 2.8, 0, Math.PI * 2);
            ctx.fill();
            const bead = ctx.createRadialGradient(x - hole * 0.35, y + 2 - hole * 0.35, 0, x, y + 2, hole * 1.15);
            bead.addColorStop(0, mix('#ffe08a', '#fffbe0', mood));
            bead.addColorStop(0.45, mix('#f0a400', '#ffd83a', mood));
            bead.addColorStop(1, mix('#9a5600', '#e8a400', mood));
            ctx.fillStyle = bead;
        } else {
            // Still to come: dark.
            ctx.fillStyle = 'rgba(30, 12, 18, 0.85)';
        }
        ctx.beginPath();
        ctx.arc(x, y + 2, x < marker ? hole * 1.15 : hole, 0, Math.PI * 2);
        ctx.fill();
    }
    blueHeartGem(ctx, marker, y + 2, 10);
}

/** How wide `speechBubble` draws `text`; leaves the bubble's font set. */
function bubbleWidth(ctx: SKRSContext2D, text: string): number {
    ctx.font = font('700 15px');
    return ctx.measureText(text).width + 28;
}

/** A tuft of grass: a few thin blades fanning out from (x, root), `height` tall. */
function grassTuft(ctx: SKRSContext2D, x: number, root: number, height: number, colour: string, rand: () => number) {
    ctx.fillStyle = colour;
    const blades = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < blades; i += 1) {
        const lean = (i / (blades - 1) - 0.5) * 1.1 + (rand() - 0.5) * 0.3;
        const tall = height * (0.6 + rand() * 0.4);
        const tipX = x + Math.sin(lean) * tall;
        const tipY = root - Math.cos(lean) * tall;
        const base = 0.9;
        ctx.beginPath();
        ctx.moveTo(x - base, root);
        ctx.quadraticCurveTo(x + (tipX - x) * 0.3, root - tall * 0.6, tipX, tipY);
        ctx.quadraticCurveTo(x + (tipX - x) * 0.3 + base, root - tall * 0.55, x + base, root);
        ctx.fill();
    }
}

/**
 * A field of red spider lilies across the bottom of the room, from `from`
 * to `to`, its front row rooted at `y`. Rows further back stand higher up
 * the wall, smaller and darker, so the ground seems to recede. Left of
 * `marker` (the club's place) they are in bloom; past it they are bare
 * stalks with closed buds, as spider lilies flower before their leaves.
 * Under `low` (the side table) only a short front row grows. Dark grass
 * covers the ground of every row, so the field reads as one.
 */
function lilyField(ctx: SKRSContext2D, lily: Image, from: number, to: number, y: number, marker: number, low: [number, number]) {
    // A dark ground for the field to stand in.
    const ground = ctx.createLinearGradient(0, y - 44, 0, y + 4);
    ground.addColorStop(0, 'rgba(15, 4, 8, 0)');
    ground.addColorStop(1, 'rgba(15, 4, 8, 0.6)');
    ctx.fillStyle = ground;
    ctx.fillRect(from, y - 44, to - from, 48);
    const rows = [
        { root: y - 30, h: [16, 22], gap: [18, 30], light: 0.42, front: false },
        { root: y - 15, h: [24, 32], gap: [24, 40], light: 0.68, front: false },
        { root: y, h: [34, 44], gap: [32, 54], light: 1, front: true },
    ] as const;
    const rand = seeded(1229);
    const grass = seeded(77);
    for (const row of rows) {
        // The row's grass first, flowers and stalks over it.
        const grassH = row.h[0] * 0.38;
        for (let x = from; x < to; x += 4 + grass() * 5) {
            const underTable = x > low[0] && x < low[1];
            if (underTable && !row.front) continue;
            grassTuft(ctx, x, row.root + 1, grassH * (0.6 + grass() * 0.7), mix('#060b04', '#2f5222', row.light * (0.75 + grass() * 0.25)), grass);
        }
        for (let x = from + rand() * row.gap[1]; x < to; x += row.gap[0] + rand() * (row.gap[1] - row.gap[0])) {
            let height = row.h[0] + rand() * (row.h[1] - row.h[0]);
            const underTable = x > low[0] && x < low[1];
            if (underTable && !row.front) continue;
            if (underTable) height *= 0.6;
            const lean = (rand() - 0.5) * 0.35;
            if (x < marker - 6) {
                ctx.filter = row.light < 1 ? `brightness(${row.light})` : 'none';
                roseStem(ctx, lily, x, row.root, height, lean);
                ctx.filter = 'none';
            } else {
                // Not yet: bare stalks with closed red buds, in twos and threes.
                const stalks = 2 + Math.floor(rand() * 2);
                for (let k = 0; k < stalks; k += 1) {
                    const sx = x + (k - (stalks - 1) / 2) * 5;
                    const sl = lean + (k - (stalks - 1) / 2) * 0.15;
                    const sh = height * (0.55 + rand() * 0.25);
                    const tipX = sx + Math.sin(sl) * sh;
                    const tipY = row.root - Math.cos(sl) * sh;
                    ctx.strokeStyle = mix('#0e1608', '#4c6b34', row.light);
                    ctx.lineWidth = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(sx, row.root);
                    ctx.quadraticCurveTo(sx, (row.root + tipY) / 2, tipX, tipY);
                    ctx.stroke();
                    ctx.fillStyle = mix('#1a0306', '#9a1424', row.light);
                    ctx.beginPath();
                    ctx.ellipse(tipX, tipY - 1.5, 1.2, 2.6, sl, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}

/**
 * Her words in a speech bubble, as the game shows them: a white rounded
 * bubble with a tail pointing at her (to `tailX`, `tailY`). Its edge and
 * text turn red as she turns.
 */
function speechBubble(ctx: SKRSContext2D, x: number, y: number, text: string, tailX: number, tailY: number, mood: number) {
    const w = bubbleWidth(ctx, text);
    const pad = 14;
    // The tail leaves from whichever lower corner is nearer her.
    const tail = tailX < x + w / 2 ? 18 : w - 36;
    const h = 36;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = mix('#fffafc', '#ffe3e6', mood);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.fill();
    // The tail, from the bubble's lower left towards her.
    ctx.beginPath();
    ctx.moveTo(x + tail, y + h - 2);
    ctx.lineTo(tailX, tailY);
    ctx.lineTo(x + tail + 18, y + h - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = mix('#d8b9c4', '#c0101e', mood);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.stroke();
    ctx.fillStyle = mix('#3a2430', '#b0101c', mood);
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    // At her worst, the bubble itself bleeds.
    if (mood > 0.6) {
        const rand = seeded(5);
        for (let i = 0; i < 3; i += 1) {
            const dx = x + w * (0.3 + rand() * 0.6);
            const len = 6 + rand() * 12 * mood;
            ctx.fillStyle = '#a3101c';
            ctx.fillRect(dx - 1.2, y + h - 1, 2.4, len);
            ctx.beginPath();
            ctx.arc(dx, y + h - 1 + len, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/** A small brass plaque under a window naming the rank it stands for. */
function rankPlaque(ctx: SKRSContext2D, cx: number, y: number, text: string) {
    ctx.font = font('700 12px');
    const w = ctx.measureText(text).width + 16;
    const plate = ctx.createLinearGradient(0, y, 0, y + 18);
    plate.addColorStop(0, '#d9b46a');
    plate.addColorStop(1, '#9c7a3c');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, y, w, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#2a1a10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** Drops of blood hanging from the lace's scallops, more as she turns. */
function laceDrips(ctx: SKRSContext2D, w: number, y: number, mood: number, art: SilArt | null) {
    if (mood < 0.3) return;
    const rand = seeded(88);
    if (art) {
        const count = Math.round((w / 140) * mood);
        for (let i = 0; i < count; i += 1) {
            const x = rand() * w;
            const width = 22 + rand() * 26 * mood;
            const height = (art['drips-thin'].height / art['drips-thin'].width) * width;
            placed(ctx, art['drips-thin'], x, y + height / 2 - 2, width, 0, 0.85);
        }
        return;
    }
    const count = Math.round((w / 60) * mood);
    for (let i = 0; i < count; i += 1) {
        const x = Math.round((rand() * w) / 18) * 18;
        const len = 4 + rand() * 14 * mood;
        ctx.fillStyle = '#a3101c';
        ctx.fillRect(x - 1.3, y + 6, 2.6, len);
        ctx.beginPath();
        ctx.arc(x, y + 6 + len, 2.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Blood on the report, drawn over it: none when calm, spreading as she
 * turns. Splatter on the cards' corners, then a hand reaching up over the
 * bottom edge, then the knives driven into the top corners.
 */
function bloodOnTheCards(ctx: SKRSContext2D, w: number, h: number, hero: number, mood: number, art: SilArt | null) {
    if (mood < 0.2) return;
    const rand = seeded(616);
    if (art) {
        // Splatter on the cards' outer corners and a bloody hand reaching up
        // over the bottom edge: actual marks on the cards, not paint
        // running in from the sides.
        const marks: [Image, number, number, number, number][] = [
            [art.splat, SIDE + 10, hero + 12, 54, 0.4],
            [art.splat, w - SIDE - 12, h - SIDE - 12, 60, 2.2],
            [art.spray, SIDE + 30, h - SIDE - 8, 90, -0.2],
            [art.splat, w - SIDE - 10, hero + (h - hero) * 0.55, 46, 1.3],
        ];
        const n = Math.max(1, Math.round(marks.length * mood));
        for (const [image, x, y, width, angle] of marks.slice(0, n)) placed(ctx, image, x, y, width * (0.8 + mood * 0.3), angle, 0.9);
        if (mood >= 0.5) {
            const handW = 46;
            const handH = (art.hand.height / art.hand.width) * handW;
            // Fingers over the last few pixels of the cards, palm in the margin.
            placed(ctx, art.hand, w * 0.45, h - SIDE + handH / 2 - 30, handW, 0.08, 0.92);
        }
        // At her worst the knives are driven into the cards' outer corners.
        if (mood >= 0.67) {
            stabbed(ctx, art.cleaver, SIDE + 12, hero + 12, 105, -0.2, 0.2);
            placed(ctx, art['drips-thin'], SIDE + 14, hero + 32, 28, 0, 0.9);
            stabbed(ctx, art.knife, w - SIDE - 12, hero + 12, 100, 0.2, 0.22);
            placed(ctx, art['drips-thin'], w - SIDE - 14, hero + 30, 24, 0, 0.9);
        }
        return;
    }
    const spots: [number, number][] = [
        [SIDE + 4, hero + 6],
        [w - SIDE - 4, hero + 10],
        [SIDE + 2, h - SIDE - 6],
        [w - SIDE - 6, h - SIDE - 4],
        [w * 0.5, h - SIDE + 4],
        [SIDE - 6, hero + (h - hero) * 0.45],
        [w - SIDE + 6, hero + (h - hero) * 0.6],
    ];
    const n = Math.max(1, Math.round(spots.length * mood));
    for (const [x, y] of spots.slice(0, n)) bloodSplat(ctx, x, y, 7 + mood * 9, mood, rand);
}

/**
 * Still in Love watching from her room (see `SceneId`). Two windows stand
 * for her rank band: the bottom cutoff under a pale crescent on the left,
 * the next rank up under the full blood moon on the right, each named on a
 * brass plaque. She sits between them with her words in a bubble. `mood` 0
 * is calm; towards 1 the room reddens, her eyes burn, and blood spreads
 * over the glass, the lace and the cards' edges.
 */
function drawStillInLove(
    ctx: SKRSContext2D,
    w: number,
    h: number,
    hero: number,
    art: Image | null,
    mood: number,
    race: SceneRace | null,
    blood: SilArt | null,
): Canvas {
    // The room: dark wine walls with faint damask stripes, warming to red.
    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, mix('#1b0f17', '#2e0810', mood * 0.8));
    wall.addColorStop(Math.min(0.99, hero / h), mix('#22121b', '#3a0a12', mood * 0.8));
    wall.addColorStop(1, mix('#140b10', '#22060b', mood * 0.8));
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let x = 0; x < w; x += 26) ctx.fillRect(x, 0, 10, h);

    const floor = hero - 14;
    // Tall, narrow arched windows, as in the first draft.
    const winW = 88;
    const top = 12;
    const leftX = SIDE + 24;
    const rightX = w - SIDE - 24 - winW;
    // The windows stop short of the lace, leaving room for each plaque.
    const sill = floor - 34;
    const coolLight = '#b4ccff';
    const redLight = '#ff6a72';
    const redStrength = 0.14 + mood * 0.1;
    windowGlow(ctx, leftX, top, winW, sill, coolLight, 0.1);
    windowGlow(ctx, rightX, top, winW, sill, redLight, redStrength * 0.7);
    gothicWindow(ctx, leftX, top, winW, sill, 'crescent', mood, 11, blood);
    gothicWindow(ctx, rightX, top, winW, sill, 'blood', mood, 23, blood);
    curtains(ctx, leftX, top, winW, sill, mood);
    curtains(ctx, rightX, top, winW, sill, mood);
    // A single rose left lying on the calm window's ledge.
    if (blood) roseStem(ctx, blood.rose, leftX + 12, sill - 5, 44, 1.45);
    if (race) {
        rankPlaque(ctx, leftX + winW / 2, sill + 5, race.start);
        rankPlaque(ctx, rightX + winW / 2, sill + 5, race.finish);
    }
    sideTable(ctx, rightX - 222, floor, mood, blood);
    // Moonlight slanting in towards her: cool from the crescent, red from the
    // blood moon, which burns stronger as she turns. It falls on, past the
    // lace and onto the cards.
    const light = moonlightLayer(
        w,
        h,
        [
            { x: leftX, dir: 1, colour: coolLight, strength: 0.2 },
            { x: rightX, dir: -1, colour: redLight, strength: redStrength },
        ],
        top,
        winW,
        sill,
        hero + 40,
        0.85,
    );

    // The club's place between the ranks, marked on the lace.
    const track = race ? { from: leftX + winW / 2, to: rightX + winW / 2, at: race.progress } : null;
    const marker = track ? trackMarker(track) : null;
    // A field of spider lilies, in bloom up to it.
    if (blood && marker !== null) {
        const tableX = rightX - 222;
        lilyField(ctx, blood.lily, leftX + winW + 18, rightX - 18, floor - 3, marker, [tableX, tableX + 190]);
    }

    // Petals drifting down, more as she turns; behind her, so none lands on her face.
    const rand = seeded(214);
    const petals = Math.round(6 + mood * 18);
    for (let i = 0; i < petals; i += 1) {
        const x = rand() * w;
        const y = rand() * (hero - 10);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI);
        ctx.fillStyle = mix('#c8505e', '#e0283a', mood);
        ctx.globalAlpha = 0.5 + rand() * 0.4;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Her, standing over the club's place; until her picture exists, her eyes.
    const herX = marker ?? w * 0.45;
    let faceY = hero * 0.5;
    // How far her bubble keeps from her centre.
    let reach = 52;
    if (art) {
        // Standing on the lace, right over the club's place.
        const artH = hero - 30;
        const artW = (art.width / art.height) * artH;
        const footY = floor - 2;
        // Once she turns, a red aura behind her.
        if (mood > 0.4) {
            const cy = footY - artH * 0.5;
            const aura = ctx.createRadialGradient(herX, cy, artW * 0.2, herX, cy, artH * 0.65);
            aura.addColorStop(0, `rgba(230, 20, 40, ${0.4 * mood})`);
            aura.addColorStop(1, 'rgba(230, 20, 40, 0)');
            ctx.fillStyle = aura;
            ctx.beginPath();
            ctx.arc(herX, cy, artH * 0.65, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(herX, footY, artW * 0.38, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(art, herX - artW / 2, footY - artH, artW, artH);
        faceY = footY - artH * 0.6;
        reach = artW / 2 + 10;
    } else {
        watchingEyes(ctx, herX, faceY, 15, mood);
    }
    const eyeY = faceY;
    const line = mood < 0.34 ? 'I still love you.' : mood < 0.67 ? 'I still love you…' : '…why are you leaving me behind?';
    // Her bubble to her right, or her left when it would run off the edge.
    const bw = bubbleWidth(ctx, line);
    const bubbleX = herX + reach + bw > w - SIDE ? herX - reach - bw : herX + reach;
    speechBubble(ctx, bubbleX, 18, line, herX + (bubbleX > herX ? 30 : -30), eyeY - 14, mood);

    // Bloody handprints on the wall once she has turned.
    if (blood && mood >= 0.4) {
        // On the wall past the left window, unless she is standing there.
        const smearX = leftX + winW + 70;
        if (Math.abs(smearX - herX) > 80) placed(ctx, blood['hand-smear'], smearX, hero * 0.5, 52, -0.25, 0.55 + mood * 0.35);
        // And one more in the wide image, clear of her and her bubble.
        const handX = rightX - 250;
        const clear = Math.abs(handX - herX) > 90 && (handX < bubbleX - 30 || handX > bubbleX + bw + 30);
        if (w > 1200 && mood >= 0.67 && clear) placed(ctx, blood.hand, handX, hero * 0.42, 40, 0.2, 0.85);
    }


    // Lace along the bottom of the band, white to red, dripping when she turns.
    laceTrim(ctx, w, floor, mix('#f3e6ec', '#c8202e', mood), track, mood);
    laceDrips(ctx, w, floor, mood, blood);

    // The moonlight over everything in the room, softened.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, hero);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(light, 0, 0, w, h);
    ctx.restore();

    // The red closing in from the edges.
    if (mood > 0) {
        const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
        v.addColorStop(0, 'rgba(160, 0, 20, 0)');
        v.addColorStop(1, `rgba(140, 0, 18, ${0.5 * mood})`);
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, w, h);
    }
    return light;
}

// ─── Mambo (Matikanetannhauser) ──────────────────────────────────────────────

/**
 * Her picture for `mood`, the same thirds as her lines: `mambo-calm.png`
 * (cheering), `mambo-uneasy.png` (worried) or `mambo-yandere.png` (her
 * fumble). Falls back to `mambo.png`, then to none (the scene then draws
 * her pom-poms).
 */
async function mamboPose(mood: number): Promise<Image | null> {
    const pose = mood < 0.34 ? 'calm' : mood < 0.67 ? 'uneasy' : 'yandere';
    return (await sceneArt(`mambo-${pose}`)) ?? sceneArt('mambo');
}

/** Every picture in a folder under the scene art, by file name; none when it is missing. */
const folderCache = new Map<string, Image[]>();
async function sceneArtFolder(name: string): Promise<Image[]> {
    const cached = folderCache.get(name);
    if (cached) return cached;
    const dir = path.join(ART_DIR, name);
    const images: Image[] = [];
    if (existsSync(dir)) {
        for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort()) {
            try {
                images.push(await loadImage(path.join(dir, file)));
            } catch {
                // An unreadable picture is left out.
            }
        }
    }
    folderCache.set(name, images);
    return images;
}

/**
 * A trainer watching, small: dark suit, white shirt, a tie in `tie`, hair
 * dark or light; `cheer` puts an arm up. Generic, so drawn rather than
 * pictured.
 */
function trainerFigure(ctx: SKRSContext2D, x: number, base: number, h: number, tie: string, light: boolean, cheer: boolean) {
    const u = h / 10;
    ctx.fillStyle = 'rgba(60, 40, 20, 0.2)';
    ctx.beginPath();
    ctx.ellipse(x, base, u * 2.2, u * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Legs, then the jacket.
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(x - u * 1.1, base - u * 4, u * 0.9, u * 4);
    ctx.fillRect(x + u * 0.2, base - u * 4, u * 0.9, u * 4);
    ctx.fillStyle = '#353b4a';
    ctx.beginPath();
    ctx.roundRect(x - u * 1.6, base - u * 7.6, u * 3.2, u * 4, u * 0.6);
    ctx.fill();
    ctx.fillStyle = '#f4f2ee';
    ctx.beginPath();
    ctx.moveTo(x - u * 0.6, base - u * 7.6);
    ctx.lineTo(x + u * 0.6, base - u * 7.6);
    ctx.lineTo(x, base - u * 6.2);
    ctx.fill();
    ctx.fillStyle = tie;
    ctx.fillRect(x - u * 0.2, base - u * 7.4, u * 0.4, u * 1.6);
    // Arms: one up to cheer, or both down.
    ctx.strokeStyle = '#353b4a';
    ctx.lineWidth = u * 0.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - u * 1.5, base - u * 7);
    ctx.lineTo(x - u * 1.8, base - u * 4.4);
    ctx.moveTo(x + u * 1.5, base - u * 7);
    if (cheer) ctx.lineTo(x + u * 2.4, base - u * 9.6);
    else ctx.lineTo(x + u * 1.8, base - u * 4.4);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // Head and hair.
    ctx.fillStyle = '#f2cfae';
    ctx.beginPath();
    ctx.arc(x, base - u * 8.6, u * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light ? '#b08a5a' : '#2a2420';
    ctx.beginPath();
    ctx.arc(x, base - u * 8.9, u * 1.15, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
}

/**
 * Up to `count` of `images` in an order that changes once a day: a
 * shuffle seeded by the UTC day, so each day's report has a different crowd
 * and the same report all day. `day` is for tests.
 */
function dailyPick<T>(images: T[], count: number, day = Math.floor(Date.now() / 86_400_000)): T[] {
    const rand = seeded(day * 7919 + images.length);
    const order = [...images];
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order.slice(0, count);
}

/**
 * One crowd chibi standing at (x, feet), `h` tall, leaning by `lean`
 * (radians, about her feet): back for a tug-of-war, upright to watch.
 */
function crowdChibi(ctx: SKRSContext2D, art: Image, x: number, feet: number, h: number, lean = 0, flip = false) {
    const w = (art.width / art.height) * h;
    ctx.fillStyle = 'rgba(60, 40, 20, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x, feet, w * 0.38, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, feet);
    ctx.rotate(lean);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(art, -w / 2, -h, w, h);
    ctx.restore();
}

/** Cheer signs the audience holds up for her: words, and her ribbon colours. */
const CHEER_SIGNS: readonly [string, string, string][] = [
    ['MAMBO!', '#0f8dce', '#ffffff'],
    ['ファイト!', '#ee5b56', '#ffffff'],
    ['WASSHOI!', '#ffd23a', '#0a3a5a'],
    ['がんばれ!', '#ffffff', '#c42f2a'],
    ['110%!', '#f48fb1', '#ffffff'],
    ['♥ MACHITAN ♥', '#ffffff', '#0a6aa3'],
    ['マンボ〜♪', '#0f8dce', '#ffffff'],
];

/** A cheer sign held up on two sticks, its bottom edge at (x, y). */
function cheerSign(ctx: SKRSContext2D, x: number, y: number, text: string, fill: string, ink: string, tilt: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.font = font('800 9px');
    const sw = Math.max(34, ctx.measureText(text).width + 10);
    const sh = 15;
    ctx.fillStyle = '#c9a26a';
    ctx.fillRect(-sw * 0.3, 0, 1.6, 9);
    ctx.fillRect(sw * 0.3 - 1.6, 0, 1.6, 9);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(-sw / 2 + 1.5, -sh + 1.5, sw, sh);
    ctx.fillStyle = fill;
    ctx.fillRect(-sw / 2, -sh, sw, sh);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(-sw / 2 + 1.5, -sh + 1.5, sw - 3, sh - 3);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, -sh / 2 + 0.5);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/**
 * The audience: classmates sitting on picnic sheets across the back of the
 * field, as families and classes do at a sports day, from x0 to x1 in rows
 * whose seats are at each `seat`. Each picture is cut off below the waist
 * where she sits on the sheet. Every few hold up a cheer sign; now and then
 * a trainer stands at the back. Skips `gaps`.
 */
function seatedAudience(ctx: SKRSContext2D, x0: number, x1: number, rows: { seat: number; h: number; gap: number }[], gaps: [number, number][], chibis: Image[]) {
    if (chibis.length === 0) return;
    const sheets = ['#3d7fd6', '#e35d6a', '#3fae6a', '#f2b632'];
    let pick = 0;
    rows.forEach((row, r) => {
        const rand = seeded(500 + r * 37);
        // The sheets the row sits on: one colour per stretch.
        const sheetTop = row.seat - row.h * 0.12;
        const sheetBottom = row.seat + row.h * 0.18;
        let sx = x0 - 20;
        let s = r;
        while (sx < x1 + 20) {
            const len = 90 + rand() * 80;
            ctx.fillStyle = sheets[s % sheets.length]!;
            ctx.beginPath();
            ctx.moveTo(sx + 6, sheetTop);
            ctx.lineTo(sx + len - 2, sheetTop);
            ctx.lineTo(sx + len + 4, sheetBottom);
            ctx.lineTo(sx, sheetBottom);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.fillRect(sx + 4, sheetTop + 1, len - 6, 1.2);
            sx += len + 6;
            s += 1;
        }
        let k = 0;
        for (let x = x0; x < x1; x += row.gap * (0.8 + rand() * 0.4)) {
            if (gaps.some(([a, b]) => x > a && x < b)) continue;
            const art = chibis[pick % chibis.length]!;
            pick += 1;
            // Sitting: only the top of her shows above the seat.
            const shown = 0.66;
            const h = row.h * (0.92 + rand() * 0.16);
            const w = (art.width / art.height) * h;
            const seat = row.seat + (rand() - 0.5) * 3;
            ctx.drawImage(art, 0, 0, art.width, art.height * shown, x - w / 2, seat - h * shown, w, h * shown);
            ctx.fillStyle = 'rgba(30, 30, 50, 0.12)';
            ctx.beginPath();
            ctx.ellipse(x, seat + 1, w * 0.4, 2, 0, 0, Math.PI * 2);
            ctx.fill();
            if (k % 4 === 1) {
                const [text, fill, ink] = CHEER_SIGNS[(pick + r) % CHEER_SIGNS.length]!;
                cheerSign(ctx, x, seat - h * shown - 2, text, fill, ink, (rand() - 0.5) * 0.25);
            }
            k += 1;
        }
    });
}

/**
 * Classmates and trainers watching from the back of the field, between x0
 * and x1 with their feet at `base`: the pictures in `mambo-crowd/` (small
 * chibis of other Umamusume), every third a drawn trainer, every `gap`,
 * skipping `gaps`, scaled by `size`. `seed` and `offset` vary a second row
 * so it is not a copy of the first. Without pictures, trainers alone.
 */
function crowd(ctx: SKRSContext2D, x0: number, x1: number, base: number, gap: number, gaps: [number, number][], chibis: Image[], size = 1, seed = 907, offset = 0) {
    const rand = seeded(seed);
    const ties = ['#c0392b', '#2d6cdf', '#3a8f5a', '#8e44ad', '#d4a017'];
    let chibi = offset;
    let k = 0;
    for (let x = x0; x < x1; x += gap * (0.8 + rand() * 0.4)) {
        if (gaps.some(([a, b]) => x > a && x < b)) continue;
        // Mostly classmates; every third a trainer.
        const useChibi = chibis.length > 0 && k % 3 !== 2;
        // A little in front or behind, a little bigger or smaller, so it is not a line-up.
        const depth = rand() * 2 - 1;
        const feet = base + depth * 5;
        const scale = (1 + depth * 0.1) * size;
        if (useChibi) {
            const art = chibis[chibi % chibis.length]!;
            chibi += 1;
            crowdChibi(ctx, art, x, feet, 40 * scale);
        } else {
            trainerFigure(ctx, x, feet, 34 * scale, ties[k % ties.length]!, rand() < 0.4, rand() < 0.45);
        }
        k += 1;
    }
}

/** Pennant colours: her blue and coral, Tracen white. */
const PENNANTS: readonly string[] = ['#0f8dce', '#ee5b56', '#f7f4ea'];

/** A small gold horseshoe, open end up, centred on (x, y): the Tracen uniform's brooch. */
function horseshoe(ctx: SKRSContext2D, x: number, y: number, r: number) {
    ctx.strokeStyle = '#d9b44a';
    ctx.lineWidth = r * 0.45;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#7a5a10';
    for (const a of [0.3, 0.5, 0.7]) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(Math.PI * a) * r, y + Math.sin(Math.PI * a) * r, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * A string of Tracen pennants sagging from (x0, y0) to (x1, y1) by `sag`:
 * triangles in her blue and coral and Tracen white, each with a gold
 * horseshoe, the school's emblem on its uniform brooch.
 */
function pennantString(ctx: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, sag: number) {
    const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag });
    ctx.strokeStyle = 'rgba(60, 60, 70, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i <= 40; i += 1) {
        const p = at(i / 40);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const count = Math.max(4, Math.round(Math.abs(x1 - x0) / 30));
    for (let i = 1; i < count; i += 1) {
        const p = at(i / count);
        const colour = PENNANTS[i % PENNANTS.length]!;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y);
        ctx.lineTo(p.x + 9, p.y);
        ctx.lineTo(p.x, p.y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        horseshoe(ctx, p.x, p.y + 4.5, 3.6);
    }
}

/** Tracen's motto on a cloth banner hung across (cx, y): "Eclipse first, the rest nowhere." */
function mottoBanner(ctx: SKRSContext2D, cx: number, y: number, wide: boolean) {
    const text = 'Eclipse first, the rest nowhere.';
    ctx.font = font(`700 ${wide ? 11 : 10}px`);
    const bw = ctx.measureText(text).width + 28;
    const bh = 18;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(cx - bw / 2 + 2, y + 2, bw, bh);
    ctx.fillStyle = '#f7f4ea';
    ctx.fillRect(cx - bw / 2, y, bw, bh);
    ctx.fillStyle = '#2d3f78';
    ctx.fillRect(cx - bw / 2, y, bw, 3);
    ctx.fillRect(cx - bw / 2, y + bh - 3, bw, 3);
    horseshoe(ctx, cx - bw / 2 + 9, y + bh / 2 - 1, 3.2);
    horseshoe(ctx, cx + bw / 2 - 9, y + bh / 2 - 1, 3.2);
    ctx.fillStyle = '#2d3f78';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/**
 * The Three Goddesses statue on its plinth, bronze gone green: Tracen's
 * statue of the three founding sires, where trainees inherit.
 */
function threeGoddesses(ctx: SKRSContext2D, x: number, base: number, s: number) {
    // A stepped stone plinth.
    ctx.fillStyle = '#a9a396';
    ctx.fillRect(x - s * 0.95, base - s * 0.18, s * 1.9, s * 0.18);
    ctx.fillStyle = '#c4beb0';
    ctx.fillRect(x - s * 0.75, base - s * 0.42, s * 1.5, s * 0.24);
    ctx.fillStyle = '#d6d1c4';
    ctx.fillRect(x - s * 0.6, base - s * 0.5, s * 1.2, s * 0.08);
    const foot = base - s * 0.5;
    const bronze = '#5f8a74';
    const light = '#86b09a';
    // Three robed figures, back to back, the middle one tallest, arms raised.
    const figure = (fx: number, h: number, arm: -1 | 0 | 1) => {
        ctx.fillStyle = bronze;
        ctx.beginPath();
        ctx.moveTo(fx - s * 0.22, foot);
        ctx.quadraticCurveTo(fx - s * 0.16, foot - h * 0.45, fx - s * 0.08, foot - h * 0.8);
        ctx.lineTo(fx + s * 0.08, foot - h * 0.8);
        ctx.quadraticCurveTo(fx + s * 0.16, foot - h * 0.45, fx + s * 0.22, foot);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(fx, foot - h * 0.88, s * 0.085, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bronze;
        ctx.lineWidth = s * 0.055;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx, foot - h * 0.72);
        if (arm === 0) ctx.lineTo(fx, foot - h * 1.12);
        else ctx.lineTo(fx + arm * s * 0.3, foot - h * 1.0);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.fillStyle = light;
        ctx.fillRect(fx - s * 0.05, foot - h * 0.75, s * 0.025, h * 0.6);
    };
    figure(x - s * 0.36, s * 0.95, -1);
    figure(x + s * 0.36, s * 0.95, 1);
    figure(x, s * 1.15, 0);
}

/** The sun with soft rays, fading as the sky clouds over. */
function sun(ctx: SKRSContext2D, x: number, y: number, r: number, alpha: number) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
    glow.addColorStop(0, 'rgba(255, 244, 190, 0.7)');
    glow.addColorStop(1, 'rgba(255, 244, 190, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 236, 150, 0.55)';
    for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a - 0.08) * r * 1.25, y + Math.sin(a - 0.08) * r * 1.25);
        ctx.lineTo(x + Math.cos(a) * r * 2.1, y + Math.sin(a) * r * 2.1);
        ctx.lineTo(x + Math.cos(a + 0.08) * r * 1.25, y + Math.sin(a + 0.08) * r * 1.25);
        ctx.fill();
    }
    const disc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    disc.addColorStop(0, '#fffbe0');
    disc.addColorStop(1, '#ffd84d');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** The school behind the field: cream walls, a blue roof, rows of windows and a clock. */
function school(ctx: SKRSContext2D, x0: number, x1: number, base: number, height: number) {
    const w = x1 - x0;
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(x0, base - height, w, height);
    ctx.fillStyle = '#e2d7c0';
    ctx.fillRect(x0, base - height * 0.18, w, height * 0.18);
    ctx.fillStyle = '#5b7fa8';
    ctx.fillRect(x0 - 3, base - height - 4, w + 6, 5);
    // A clock tower in the middle.
    const tx = x0 + w / 2;
    const tw = Math.min(34, w * 0.14);
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(tx - tw / 2, base - height - 18, tw, 18);
    ctx.fillStyle = '#5b7fa8';
    ctx.beginPath();
    ctx.moveTo(tx - tw / 2 - 3, base - height - 18);
    ctx.lineTo(tx, base - height - 30);
    ctx.lineTo(tx + tw / 2 + 3, base - height - 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tx, base - height - 9, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3b4a5e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, base - height - 9);
    ctx.lineTo(tx, base - height - 13);
    ctx.moveTo(tx, base - height - 9);
    ctx.lineTo(tx + 3, base - height - 8);
    ctx.stroke();
    // Two rows of windows.
    ctx.fillStyle = '#9fc3dd';
    for (const row of [0.22, 0.52]) {
        for (let x = x0 + 8; x + 12 < x1 - 4; x += 20) {
            if (Math.abs(x + 6 - tx) < tw / 2 + 4) continue;
            ctx.fillRect(x, base - height + height * row, 12, height * 0.2);
        }
    }
}

/** A round tree at the edge of the field. */
function tree(ctx: SKRSContext2D, x: number, base: number, r: number) {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(x - 1.5, base - r * 0.8, 3, r * 0.8);
    for (const [dx, dy, rr, c] of [[-0.45, -1.1, 0.7, '#4f9d5c'], [0.45, -1.15, 0.7, '#4f9d5c'], [0, -1.6, 0.8, '#5fb06a']] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x + dx * r, base + dy * r, rr * r, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * The cheer tent: a roof striped in her coral and white, two poles, shade
 * beneath, and a long cheer banner with her tagline across the front.
 */
function cheerTent(ctx: SKRSContext2D, x0: number, x1: number, top: number, ground: number) {
    const w = x1 - x0;
    const roofBottom = top + 16;
    ctx.fillStyle = 'rgba(40, 30, 20, 0.18)';
    ctx.fillRect(x0 + 4, roofBottom, w - 8, ground - roofBottom);
    ctx.fillStyle = '#8a8f99';
    ctx.fillRect(x0 + 4, roofBottom, 2.5, ground - roofBottom);
    ctx.fillRect(x1 - 6.5, roofBottom, 2.5, ground - roofBottom);
    const stripes = Math.max(6, Math.round(w / 22));
    for (let i = 0; i < stripes; i += 1) {
        const a = x0 + (w * i) / stripes;
        const b = x0 + (w * (i + 1)) / stripes;
        ctx.fillStyle = i % 2 === 0 ? '#ee5b56' : '#ffffff';
        ctx.beginPath();
        ctx.moveTo(a + (w / 2 - (a - x0)) * 0.12, top);
        ctx.lineTo(b + (w / 2 - (b - x0)) * 0.12, top);
        ctx.lineTo(b, roofBottom);
        ctx.lineTo(a, roofBottom);
        ctx.fill();
    }
    // Scalloped valance.
    for (let i = 0; i < stripes; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? '#ee5b56' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x0 + (w * (i + 0.5)) / stripes, roofBottom, w / stripes / 2, 0, Math.PI);
        ctx.fill();
    }
    // The cheer banner: her tagline.
    const by = roofBottom + 9;
    const bh = 15;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 + 10, by, w - 20, bh);
    ctx.strokeStyle = '#0f8dce';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 10, by, w - 20, bh);
    ctx.fillStyle = '#0a6aa3';
    ctx.font = font(`700 ${w > 200 ? 11 : 9.5}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TALENT TAKES TIME!', x0 + w / 2, by + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** An orange cat sitting, tail curled round: Hachimi, watching from the roof. */
function sittingCat(ctx: SKRSContext2D, x: number, base: number, s: number) {
    ctx.fillStyle = '#f0a24a';
    ctx.beginPath();
    ctx.ellipse(x, base - s * 0.45, s * 0.42, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + s * 0.05, base - s * 1.05, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + s * 0.05 + side * s * 0.12, base - s * 1.3);
        ctx.lineTo(x + s * 0.05 + side * s * 0.3, base - s * 1.5);
        ctx.lineTo(x + s * 0.05 + side * s * 0.3, base - s * 1.18);
        ctx.fill();
    }
    ctx.strokeStyle = '#f0a24a';
    ctx.lineWidth = s * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.35, base - s * 0.15);
    ctx.quadraticCurveTo(x - s * 0.9, base - s * 0.3, x - s * 0.7, base - s * 0.85);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#c97a2a';
    ctx.fillRect(x - s * 0.2, base - s * 0.7, s * 0.4, s * 0.06);
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(x - s * 0.06, base - s * 1.08, s * 0.04, 0, Math.PI * 2);
    ctx.arc(x + s * 0.16, base - s * 1.08, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
}

/** A chicken loose on the field, facing `dir`; pecking puts its head down. */
function chicken(ctx: SKRSContext2D, x: number, ground: number, s: number, dir: 1 | -1, pecking: boolean) {
    ctx.save();
    ctx.translate(x, ground);
    ctx.scale(dir, 1);
    ctx.strokeStyle = '#e08a1e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.35);
    ctx.lineTo(-s * 0.12, 0);
    ctx.moveTo(s * 0.12, -s * 0.35);
    ctx.lineTo(s * 0.1, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tail, body, wing.
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, -s * 0.6);
    ctx.lineTo(-s * 0.72, -s * 1.0);
    ctx.lineTo(-s * 0.55, -s * 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.55, s * 0.48, s * 0.3, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 110, 100, 0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(-s * 0.05, -s * 0.55, s * 0.25, s * 0.14, -0.2, 0, Math.PI * 2);
    ctx.stroke();
    // Head: up, or down to the ground.
    const hx = pecking ? s * 0.55 : s * 0.38;
    const hy = pecking ? -s * 0.25 : -s * 0.95;
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath();
    ctx.arc(hx, hy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e23a2e';
    ctx.beginPath();
    ctx.arc(hx - s * 0.04, hy - s * 0.2, s * 0.08, 0, Math.PI * 2);
    ctx.arc(hx + s * 0.08, hy - s * 0.18, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.12, hy + s * 0.17, s * 0.04, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0a020';
    ctx.beginPath();
    ctx.moveTo(hx + s * 0.18, hy - s * 0.04);
    ctx.lineTo(hx + s * 0.34, hy + s * 0.02);
    ctx.lineTo(hx + s * 0.18, hy + s * 0.07);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(hx + s * 0.07, hy - s * 0.04, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** The tug-of-war rope's height at `x`: a gentle sag between its two poles. */
function ropeY(x: number, x0: number, x1: number, y: number): number {
    const t = (x - x0) / (x1 - x0);
    return y + Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 5;
}

/** A thick braided rope from x0 to x1, sagging at `y`. */
function tugRope(ctx: SKRSContext2D, x0: number, x1: number, y: number) {
    const steps = Math.ceil((x1 - x0) / 4);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.2)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
        const x = x0 + ((x1 - x0) * i) / steps;
        if (i === 0) ctx.moveTo(x, ropeY(x, x0, x1, y) + 3);
        else ctx.lineTo(x, ropeY(x, x0, x1, y) + 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d6b479';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
        const x = x0 + ((x1 - x0) * i) / steps;
        if (i === 0) ctx.moveTo(x, ropeY(x, x0, x1, y));
        else ctx.lineTo(x, ropeY(x, x0, x1, y));
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    // The braid.
    ctx.strokeStyle = 'rgba(120, 85, 40, 0.55)';
    ctx.lineWidth = 1.1;
    for (let x = x0 + 3; x < x1 - 3; x += 6) {
        const yy = ropeY(x, x0, x1, y);
        ctx.beginPath();
        ctx.moveTo(x - 2.4, yy - 3.8);
        ctx.lineTo(x + 2.4, yy + 3.8);
        ctx.stroke();
    }
}

/** A team pole at the rope's end, with its rank on a banner in the team colour. */
function teamPole(ctx: SKRSContext2D, x: number, ground: number, colour: string, label: string, side: -1 | 1) {
    ctx.fillStyle = '#9aa0aa';
    ctx.fillRect(x - 1.5, ground - 52, 3, 52);
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.arc(x, ground - 53, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font('700 12px');
    const tw = ctx.measureText(label).width + 16;
    const bx = side < 0 ? x : x - tw;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(bx, ground - 50, tw, 20, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + tw / 2, ground - 39.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** Her ribbon bow (her emoji), tied on the rope at the club's place. */
function ribbonBow(ctx: SKRSContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = '#e8578f';
    for (const side of [-1, 1]) {
        // Tails, then loops.
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + side * s * 0.35, y + s * 0.9);
        ctx.lineTo(x + side * s * 0.12, y + s * 0.75);
        ctx.fill();
    }
    ctx.fillStyle = '#f48fb1';
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + side * s * 0.9, y - s * 0.7, x + side * s * 1.0, y + s * 0.5, x, y);
        ctx.fill();
    }
    ctx.strokeStyle = '#d6467d';
    ctx.lineWidth = 0.9;
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + side * s * 0.9, y - s * 0.7, x + side * s * 1.0, y + s * 0.5, x, y);
        ctx.stroke();
    }
    ctx.fillStyle = '#e8578f';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.45, y - s * 0.18, s * 0.14, s * 0.07, -0.5, 0, Math.PI * 2);
    ctx.fill();
}

/** A pom-pom: a burst of strands in `colour`, for when there is no picture of her. */
function pomPom(ctx: SKRSContext2D, x: number, y: number, r: number, colour: string, light: string, seed: number) {
    const rand = seeded(seed);
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i += 1) {
        const a = rand() * Math.PI * 2;
        const len = r * (0.5 + rand() * 0.55);
        ctx.strokeStyle = rand() < 0.35 ? light : colour;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

/** Her newsboy cap, blue-purple with a white brim and a pink ribbon, lying where it fell. */
function fallenHat(ctx: SKRSContext2D, x: number, ground: number, s: number) {
    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(-0.25);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(0, 1, s * 1.1, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(s * 0.55, -s * 0.05, s * 0.55, s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a63b8';
    ctx.beginPath();
    ctx.ellipse(-s * 0.05, -s * 0.32, s * 0.75, s * 0.42, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.72);
    ctx.lineTo(s * 0.05, -s * 0.5);
    ctx.lineTo(-s * 0.1, -s * 0.36);
    ctx.lineTo(-s * 0.25, -s * 0.5);
    ctx.fill();
    ctx.fillStyle = '#f48fb1';
    ctx.fillRect(-s * 0.75, -s * 0.38, s * 1.4, s * 0.12);
    ctx.restore();
}

/** A rain cloud of her own, dark and dripping: her bad luck. */
function rainCloud(ctx: SKRSContext2D, x: number, y: number, s: number) {
    ctx.fillStyle = '#6b7380';
    for (const [dx, dy, r] of [[-0.55, 0.05, 0.42], [0, -0.2, 0.55], [0.55, 0.05, 0.42], [0, 0.15, 0.5]] as const) {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120, 170, 230, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    const rand = seeded(9);
    for (let i = 0; i < 9; i += 1) {
        const rx = x + (rand() - 0.5) * s * 1.6;
        const ry = y + s * 0.6 + rand() * s * 1.4;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 1.5, ry + 6);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

/** A small spider let down on its thread from `top` to `y`: she hates real spiders. */
function danglingSpider(ctx: SKRSContext2D, x: number, top: number, y: number) {
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.7)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.6, 1.6);
    ctx.translate(-x, -y);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.9;
    for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i += 1) {
            ctx.beginPath();
            ctx.moveTo(x, y + 2);
            ctx.quadraticCurveTo(x + side * 4, y - 1 + i * 2, x + side * 5.5, y + 2 + i * 2.2);
            ctx.stroke();
        }
    }
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x, y + 3, 2.6, 0, Math.PI * 2);
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * Children watching from the far edge of the field in red and white caps,
 * as every school sports day has, from x0 to x1 along `y`, skipping `gaps`.
 */
function capRow(ctx: SKRSContext2D, x0: number, x1: number, y: number, gaps: [number, number][]) {
    const rand = seeded(61);
    let team = 0;
    for (let x = x0; x < x1; x += 9 + rand() * 2) {
        if (gaps.some(([a, b]) => x > a && x < b)) continue;
        if (rand() < 0.12) team = 1 - team;
        const hy = y - rand() * 1.5;
        ctx.fillStyle = '#f6f2ea';
        ctx.fillRect(x - 3, hy + 2, 6, 5);
        ctx.fillStyle = '#f2cfae';
        ctx.beginPath();
        ctx.arc(x, hy, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = team === 0 ? '#e0453f' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x, hy - 0.8, 3.5, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(x - 0.5, hy - 1.2, 4.6, 1.2);
    }
}

/**
 * Mambo (Matikanetannhauser) at the school sports day, cheering for the
 * club. The band: a blue sky with the sun, clouds and strings of Tracen
 * pennants (gold horseshoes, from the uniform brooch) under the school
 * motto, "Eclipse first, the rest nowhere."; the school, trees and the
 * Three Goddesses statue at the horizon; her cheer tent with "Talent
 * Takes Time" across it and a cat (Hachimi) on the roof; a dirt field with
 * chalk lines and chickens loose on it.
 *
 * The rank band is a tug-of-war: a rope between the bottom cutoff's coral
 * team pole and the next rank's blue one, her ribbon bow tied on at the
 * club's place, chalk ticks every tenth beneath, and her standing on it.
 *
 * Her mood follows the share behind, as a comedy: sunny with confetti and
 * "Mambo~♪ Wasshoi!" when all is well; clouding over and "This time for
 * sure!" in between; at her worst, her own rain cloud, her hat on the
 * ground, a spider let down beside her, and "Wah—!? Not again…".
 */
function drawMambo(ctx: SKRSContext2D, w: number, h: number, hero: number, art: Image | null, mood: number, race: SceneRace | null, crowdArt: Image[] = []) {
    const floor = hero - 10;
    const horizon = Math.round(hero * 0.56);
    const wide = w > 1200;
    // Today's classmates: a different draw from the pictures each day.
    crowdArt = dailyPick(crowdArt, 80);

    // Sky, greying as she turns.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, mix('#4aa8e6', '#7f8fa3', mood * 0.75));
    sky.addColorStop(1, mix('#c4e9ff', '#d3d9e1', mood * 0.75));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon + 2);
    sun(ctx, w * (wide ? 0.82 : 0.8), 30, wide ? 14 : 12, 1 - mood * 1.1);
    const rand = seeded(415);
    ctx.save();
    ctx.filter = mood > 0 ? `grayscale(${Math.min(1, mood * 1.2)}) brightness(${1 - mood * 0.25})` : 'none';
    const clouds = wide ? 6 : 4;
    for (let i = 0; i < clouds + Math.round(mood * 3); i += 1) cloud(ctx, w * (0.08 + rand() * 0.84), 16 + rand() * (horizon - 44), 22 + rand() * 14, rand);
    ctx.restore();

    // The horizon: trees, the school, and the Three Goddesses in front of it.
    for (let x = 12; x < w; x += 46 + ((x * 7) % 30)) tree(ctx, x, horizon + 2, 9 + ((x * 13) % 5));
    school(ctx, w * (wide ? 0.6 : 0.56), w * (wide ? 0.9 : 0.94), horizon + 2, horizon * 0.42);
    threeGoddesses(ctx, w * (wide ? 0.42 : 0.44), horizon + 4, 34);

    // The field: packed dirt with chalk lane lines, a grass edge at the horizon.
    const dirt = ctx.createLinearGradient(0, horizon, 0, hero);
    dirt.addColorStop(0, mix('#e6c99a', '#bfa480', mood * 0.6));
    dirt.addColorStop(1, mix('#d4a86c', '#a88a62', mood * 0.6));
    ctx.fillStyle = dirt;
    ctx.fillRect(0, horizon + 2, w, hero - horizon);
    ctx.fillStyle = '#6fb86e';
    ctx.fillRect(0, horizon, w, 4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.6;
    for (const [lift, curve] of [[0.25, 10], [0.55, 16], [0.85, 22]] as const) {
        const y = horizon + 4 + (floor - horizon - 4) * lift;
        ctx.beginPath();
        ctx.moveTo(-10, y + curve);
        ctx.quadraticCurveTo(w / 2, y - curve, w + 10, y + curve);
        ctx.stroke();
    }

    // Her cheer tent, with Hachimi on the roof.
    const tentX0 = SIDE + (wide ? 120 : 100);
    const tentX1 = tentX0 + (wide ? 260 : 180);
    const tentTop = horizon - 34;
    // The children along the far edge, then the tent over them.
    capRow(ctx, 6, w - 6, horizon + 9, [[tentX0 - 6, tentX1 + 6]]);
    cheerTent(ctx, tentX0, tentX1, tentTop, horizon + 26);
    sittingCat(ctx, tentX0 + (tentX1 - tentX0) * 0.72, tentTop + 4, 19);

    // Flag strings from a pole in the middle down to either edge.
    ctx.fillStyle = '#9aa0aa';
    ctx.fillRect(w / 2 - 1.5, 0, 3, horizon + 4);
    pennantString(ctx, w / 2, 4, -10, 30, 22);
    pennantString(ctx, w / 2, 4, w + 10, 30, 22);
    mottoBanner(ctx, w / 2, 8, wide);

    // The tug-of-war.
    const ropeLevel = floor - 16;
    const x0 = SIDE + 26;
    const x1 = w - SIDE - 26;
    let herX = w * 0.5;
    if (race) herX = x0 + Math.max(0, Math.min(1, race.progress)) * (x1 - x0);
    // The audience sitting on picnic sheets across the back of the field,
    // a backdrop for her; without pictures, trainers stand there instead.
    if (crowdArt.length > 0) {
        seatedAudience(ctx, x0 + 70, x1 - 70, [
            { seat: horizon + 30, h: 34, gap: wide ? 22 : 21 },
            { seat: horizon + 50, h: 42, gap: wide ? 27 : 26 },
        ], [[tentX0 - 8, tentX1 + 8]], crowdArt);
    } else {
        crowd(ctx, x0 + 95, x1 - 95, horizon + 42, wide ? 74 : 66, [[tentX0 - 20, tentX1 + 20], [herX - 70, herX + 70]], crowdArt);
    }
    if (race) {
        // Chalk ticks every tenth, under the rope.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1.4;
        for (let i = 1; i < 10; i += 1) {
            const x = x0 + ((x1 - x0) * i) / 10;
            ctx.beginPath();
            ctx.moveTo(x, floor - 5);
            ctx.lineTo(x, floor - (i === 5 ? 1 : 3));
            ctx.stroke();
        }
        tugRope(ctx, x0, x1, ropeLevel);
        teamPole(ctx, x0, floor, '#d9443f', race.start, -1);
        teamPole(ctx, x1, floor, '#0a6aa3', race.finish, 1);
    }

    // Chickens loose on the field, kept clear of her.
    const spots = [w * 0.22, w * 0.4, w * 0.78].filter((x) => Math.abs(x - herX) > 60);
    spots.forEach((x, i) => chicken(ctx, x, floor - 22 - (i % 2) * 6, 19, i % 2 === 0 ? 1 : -1, i === 1));
    // One at her feet.
    if (herX + 60 < x1 - 20) chicken(ctx, herX + 60, floor - 3, 16, -1, false);

    // Confetti bursting round her while all is well.
    if (mood < 0.34) {
        const c = seeded(88);
        for (let i = 0; i < 18; i += 1) {
            const a = c() * Math.PI * 2;
            const r = 30 + c() * 50;
            drawPiece(ctx, herX + Math.cos(a) * r * 1.4, floor - 70 + Math.sin(a) * r * 0.6, 0.3 + c() * 0.3, c);
        }
    }

    // Her, on the bow; until her picture exists, her pom-poms.
    let faceY = floor - 52;
    let reach = 40;
    if (race) ribbonBow(ctx, herX, ropeY(herX, x0, x1, ropeLevel), 17);
    if (art) {
        // Big, front and centre: she is the cheerleader.
        const artH = hero - 6;
        const artW = (art.width / art.height) * artH;
        const footY = floor + 4;
        ctx.fillStyle = 'rgba(60, 40, 20, 0.22)';
        ctx.beginPath();
        ctx.ellipse(herX, footY, artW * 0.38, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(art, herX - artW / 2, footY - artH, artW, artH);
        // Pom-poms in her hands, which are up behind her head on either side.
        const handY = footY - artH * 0.52;
        const pom = artW * 0.24;
        pomPom(ctx, herX - artW * 0.46, handY, pom, '#0f8dce', '#bfe4ff', 21);
        pomPom(ctx, herX + artW * 0.46, handY, pom, '#ee5b56', '#ffd0cc', 22);
        faceY = footY - artH * 0.62;
        reach = artW / 2 + pom * 0.6 + 10;
    } else {
        const bounce = mood < 0.34 ? 14 : 0;
        pomPom(ctx, herX - 34, floor - 96 - bounce, 30, '#0f8dce', '#bfe4ff', 21);
        pomPom(ctx, herX + 34, floor - 96 - bounce, 30, '#ee5b56', '#ffd0cc', 22);
        faceY = floor - 104 - bounce;
    }

    // At her worst: her own rain cloud, her hat on the ground, a spider beside her.
    if (mood >= 0.67) {
        rainCloud(ctx, herX, Math.max(22, faceY - 46), 22);
        // Her cap on the ground, unless her picture is wearing it.
        if (!art) fallenHat(ctx, herX - 48, floor - 2, 17);
        danglingSpider(ctx, herX + reach + 14, 30, faceY + 10);
    }

    const line = mood < 0.34 ? 'Mambo~♪ Wasshoi!' : mood < 0.67 ? 'This time for sure!' : 'Wah—!? Not again…';
    const bw = bubbleWidth(ctx, line);
    const bubbleX = herX + reach + bw > w - SIDE ? herX - reach - bw : herX + reach;
    speechBubble(ctx, bubbleX, 26, line, herX + (bubbleX > herX ? 18 : -18), faceY - 8, 0);
}

// ─── Nice Nature ──────────────────────────────────────────────────────────────

/**
 * Her picture for `mood`: `nature-calm.png`, `nature-uneasy.png` or
 * `nature-yandere.png` (the same thirds as her lines), else `nature.png`,
 * else none (the scene then sets out a bowl of oden in her place).
 */
async function naturePose(mood: number): Promise<Image | null> {
    const pose = mood < 0.34 ? 'calm' : mood < 0.67 ? 'uneasy' : 'yandere';
    return (await sceneArt(`nature-${pose}`)) ?? sceneArt('nature');
}

/**
 * An origami crane, `s` across, facing right, in `colour` with a darker
 * fold: the paper cranes fans brought the real Nice Nature, folded the way
 * she folds them.
 */
function paperCrane(ctx: SKRSContext2D, x: number, y: number, s: number, colour: string, fold: string, tilt: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    const p = (px: number, py: number): [number, number] => [px * s, py * s];
    const shape = (colourOf: string, pts: [number, number][]) => {
        ctx.fillStyle = colourOf;
        ctx.beginPath();
        ctx.moveTo(...pts[0]!);
        for (const pt of pts.slice(1)) ctx.lineTo(...pt);
        ctx.closePath();
        ctx.fill();
    };
    // Far wing (shaded), tail, neck and head, body, near wing raised.
    shape(fold, [p(0.02, -0.04), p(0.22, -0.04), p(0.16, -0.66)]);
    shape(fold, [p(-0.12, 0.02), p(-0.24, 0.06), p(-0.52, -0.42)]);
    shape(fold, [p(0.14, 0.02), p(0.26, 0.06), p(0.5, -0.46)]);
    shape(fold, [p(0.5, -0.46), p(0.47, -0.39), p(0.64, -0.38)]);
    shape(colour, [p(-0.26, 0.02), p(0, -0.12), p(0.28, 0.02), p(0, 0.2)]);
    shape(colour, [p(-0.08, -0.04), p(0.14, -0.04), p(-0.18, -0.78)]);
    ctx.restore();
}

/** A square of origami paper, not folded yet, hanging by a corner. */
function paperSquare(ctx: SKRSContext2D, x: number, y: number, s: number, colour: string, tilt: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4 + tilt);
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(0, 0, s * 0.42, s * 0.42);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.42, s * 0.42);
    ctx.stroke();
    ctx.restore();
}

/**
 * The crane garland across the bar: a string from x0 to x1 at `y`, cranes
 * folded in her green and red up to `upTo` (the club's place), flat paper
 * squares beyond it.
 */
function craneGarland(ctx: SKRSContext2D, x0: number, x1: number, y: number, upTo: number | null) {
    const at = (x: number) => y + Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * 16;
    ctx.strokeStyle = 'rgba(230, 215, 190, 0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 6) {
        if (x === x0) ctx.moveTo(x, at(x));
        else ctx.lineTo(x, at(x));
    }
    ctx.stroke();
    const rand = seeded(1203);
    let i = 0;
    for (let x = x0 + 18; x < x1 - 10; x += 38) {
        const hang = 8 + (i % 2) * 7;
        const cy = at(x) + hang;
        ctx.strokeStyle = 'rgba(230, 215, 190, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x, at(x));
        ctx.lineTo(x, cy);
        ctx.stroke();
        const green = i % 2 === 0;
        if (upTo === null || x < upTo - 4) paperCrane(ctx, x, cy + 20, 32, green ? '#3fbf72' : '#d9433b', green ? '#23874d' : '#9c241f', (rand() - 0.5) * 0.25);
        else paperSquare(ctx, x, cy, 30, green ? '#3fbf72' : '#d9433b', (rand() - 0.5) * 0.4);
        i += 1;
    }
}

/** A red paper lantern (akachōchin) with "おでん" down it, glowing. */
function redLantern(ctx: SKRSContext2D, x: number, top: number, h: number) {
    const w = h * 0.62;
    const glow = ctx.createRadialGradient(x, top + h / 2, 0, x, top + h / 2, h * 1.3);
    glow.addColorStop(0, 'rgba(255, 120, 70, 0.35)');
    glow.addColorStop(1, 'rgba(255, 120, 70, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, top + h / 2, h * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(x - w * 0.3, top - 3, w * 0.6, 4);
    ctx.fillRect(x - w * 0.3, top + h - 1, w * 0.6, 4);
    const body = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    body.addColorStop(0, '#9e1d16');
    body.addColorStop(0.45, '#e8402e');
    body.addColorStop(1, '#8a1812');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 10, 5, 0.35)';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < 6; k += 1) {
        const yy = top + (h * k) / 6;
        const half = (w / 2) * Math.sqrt(1 - ((yy - top - h / 2) / (h / 2)) ** 2);
        ctx.beginPath();
        ctx.moveTo(x - half, yy);
        ctx.lineTo(x + half, yy);
        ctx.stroke();
    }
    ctx.fillStyle = '#1a0c08';
    ctx.font = font(`700 ${Math.round(h * 0.2)}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ['お', 'で', 'ん'].forEach((ch, k) => ctx.fillText(ch, x, top + h * (0.27 + k * 0.23)));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** The oden pot: a square steel pot of daikon, eggs, konnyaku and chikuwa, steaming. */
function odenPot(ctx: SKRSContext2D, x: number, top: number, w: number) {
    const h = w * 0.34;
    ctx.fillStyle = '#9aa1a8';
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x + 3, top + 3, w - 6, h * 0.55);
    // Dividers.
    ctx.fillStyle = '#c4cad0';
    for (let k = 1; k < 3; k += 1) ctx.fillRect(x + (w * k) / 3 - 1, top + 2, 2, h * 0.6);
    const rand = seeded(5);
    for (let k = 0; k < 9; k += 1) {
        const cx = x + 8 + rand() * (w - 16);
        const cy = top + 5 + rand() * (h * 0.4);
        const kind = k % 4;
        if (kind === 0) {
            ctx.fillStyle = '#e9d29a';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 6, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (kind === 1) {
            ctx.fillStyle = '#b8743a';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 4.5, 3.4, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (kind === 2) {
            ctx.fillStyle = '#6d6a66';
            ctx.beginPath();
            ctx.moveTo(cx - 5, cy + 3);
            ctx.lineTo(cx + 5, cy + 3);
            ctx.lineTo(cx, cy - 4);
            ctx.fill();
        } else {
            ctx.fillStyle = '#c58a4a';
            ctx.fillRect(cx - 7, cy - 2, 14, 4);
            ctx.fillStyle = '#f2e3c6';
            ctx.fillRect(cx - 7, cy - 0.6, 14, 1.2);
        }
    }
    steam(ctx, x + w * 0.3, top - 2, 22);
    steam(ctx, x + w * 0.7, top - 2, 26);
}

/** A curl of steam rising `h` from (x, y). */
function steam(ctx: SKRSContext2D, x: number, y: number, h: number) {
    ctx.strokeStyle = 'rgba(255, 245, 230, 0.35)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 6, y - h * 0.3, x + 6, y - h * 0.6, x, y - h);
    ctx.stroke();
    ctx.lineCap = 'butt';
}

/** Wooden menu tags (oshinagaki) hung in a row from x0 to x1 at `top`: the oden of the day. */
function menuTags(ctx: SKRSContext2D, x0: number, x1: number, top: number) {
    const items = ['だいこん', 'たまご', 'ちくわ', 'はんぺん', 'つくね', 'ごぼう', 'もち', 'こんぶ'];
    const tagW = 15;
    const gap = 22;
    const count = Math.min(items.length, Math.floor((x1 - x0) / gap));
    ctx.font = font('700 9px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < count; k += 1) {
        const x = x0 + k * gap;
        const chars = [...items[k]!];
        const h = Math.max(46, chars.length * 10 + 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x + 2, top + 2, tagW, h);
        ctx.fillStyle = '#e9d6b0';
        ctx.fillRect(x, top, tagW, h);
        ctx.fillStyle = '#2a1a10';
        chars.forEach((ch, c) => ctx.fillText(ch, x + tagW / 2, top + 8 + c * 10));
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** A bottle on the shelf: sake or soy, in brown, green or clear glass. */
function bottle(ctx: SKRSContext2D, x: number, shelf: number, h: number, rand: () => number) {
    const glass = ['#3d6b3a', '#6b3d1e', '#a7b8b0', '#2f4a63'][Math.floor(rand() * 4)]!;
    ctx.fillStyle = glass;
    ctx.fillRect(x - 4, shelf - h * 0.65, 8, h * 0.65);
    ctx.fillRect(x - 1.8, shelf - h, 3.6, h * 0.38);
    ctx.fillStyle = '#efe4cc';
    ctx.fillRect(x - 4, shelf - h * 0.45, 8, h * 0.2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(x - 3, shelf - h * 0.62, 1.2, h * 0.5);
}

/** A bowl of oden on the counter, steaming: what she sets out when you're down. */
function odenBowl(ctx: SKRSContext2D, x: number, counter: number, s: number) {
    ctx.fillStyle = '#e9e0cf';
    ctx.beginPath();
    ctx.ellipse(x, counter - s * 0.05, s * 0.75, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f3f6e';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.7, counter - s * 0.45);
    ctx.quadraticCurveTo(x, counter + s * 0.25, x + s * 0.7, counter - s * 0.45);
    ctx.fill();
    ctx.fillStyle = '#e9d29a';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.15, counter - s * 0.48, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8743a';
    ctx.beginPath();
    ctx.ellipse(x + s * 0.28, counter - s * 0.5, s * 0.18, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    steam(ctx, x - s * 0.15, counter - s * 0.6, s * 0.9);
    steam(ctx, x + s * 0.2, counter - s * 0.6, s * 0.7);
}

/** A newspaper clipping pinned to the wall: a headline bar, a photo, lines of text. */
function clipping(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, tilt: number, headline: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(2, 2, w, h);
    ctx.fillStyle = '#e8dcc2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2118';
    ctx.font = font('700 8px');
    ctx.fillText(headline, 3, 9);
    ctx.fillStyle = '#9b8d76';
    ctx.fillRect(3, 12, w * 0.42, h - 16);
    ctx.fillStyle = 'rgba(42, 33, 24, 0.5)';
    for (let yy = 13; yy < h - 4; yy += 3.5) ctx.fillRect(w * 0.48, yy, w * 0.46, 1.2);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(w / 2, 1, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** The window onto the street: a winter night, snow falling, heavier as she turns. */
function snowWindow(ctx: SKRSContext2D, x: number, top: number, w: number, h: number, mood: number) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, w, h);
    ctx.clip();
    const night = ctx.createLinearGradient(0, top, 0, top + h);
    night.addColorStop(0, '#16223a');
    night.addColorStop(1, '#2c3a56');
    ctx.fillStyle = night;
    ctx.fillRect(x, top, w, h);
    // Rooftops across the street, a lit window or two.
    ctx.fillStyle = '#0e1626';
    ctx.fillRect(x, top + h * 0.62, w, h);
    ctx.beginPath();
    ctx.moveTo(x, top + h * 0.62);
    ctx.lineTo(x + w * 0.3, top + h * 0.48);
    ctx.lineTo(x + w * 0.6, top + h * 0.62);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 210, 120, 0.8)';
    ctx.fillRect(x + w * 0.18, top + h * 0.7, 6, 5);
    ctx.fillRect(x + w * 0.72, top + h * 0.74, 6, 5);
    ctx.fillStyle = '#f4f8ff';
    ctx.fillRect(x, top + h * 0.6, w, 2.5);
    const rand = seeded(71);
    for (let k = 0; k < 18 + mood * 30; k += 1) {
        ctx.globalAlpha = 0.5 + rand() * 0.5;
        ctx.beginPath();
        ctx.arc(x + rand() * w, top + rand() * h, 0.8 + rand() * 1.3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = '#5a3f28';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, top, w, h);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, top);
    ctx.lineTo(x + w / 2, top + h);
    ctx.stroke();
}

/**
 * Nice Nature at her mother's bar after hours, the place where articles
 * about her hang on the walls. Warm wood and lantern light, a window onto a
 * snowy December street (the Arima Kinen, where she came third three years
 * running), clippings on the wall, a red lantern, the oden pot, and the
 * neighbourhood cat from her phone's wallpaper on a stool.
 *
 * The rank band is a garland of paper cranes across the bar, her origami:
 * folded in her green and red up to the club's place, still flat squares
 * beyond, between rank tags at either end. She stands behind the counter
 * under the club's place, the bar's quiet supporting star.
 *
 * Her mood stays in character, cynical but kind: "Huh. Since when are we
 * this good?" when all is well, "Third's not bad… right?" in between, and
 * at her worst, with the snow heavier, she sets out a bowl: "Eat something
 * first. Then we fight."
 */
function drawNature(ctx: SKRSContext2D, w: number, h: number, hero: number, art: Image | null, mood: number, race: SceneRace | null) {
    const floor = hero - 10;
    const wide = w > 1200;
    const counter = floor - 20;

    // Plank wall, warm under the lamps.
    const wall = ctx.createLinearGradient(0, 0, 0, hero);
    wall.addColorStop(0, '#3a2618');
    wall.addColorStop(1, '#4e3320');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, hero);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let x = 0; x < w; x += 34) ctx.fillRect(x, 0, 1.5, counter);
    const lamp = ctx.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, w * 0.5);
    lamp.addColorStop(0, 'rgba(255, 200, 120, 0.18)');
    lamp.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, w, hero);

    // The window, clippings and a calendar torn down to December.
    const winX = SIDE + 30;
    const winW = wide ? 150 : 110;
    snowWindow(ctx, winX, 14, winW, counter - 30, mood);
    const clips: [string, number][] = [['3RD!', -0.06], ['ARIMA KINEN', 0.05], ['3RD AGAIN', -0.03], ['BRONZE', 0.07]];
    const clipX = winX + winW + 26;
    clips.slice(0, wide ? 4 : 2).forEach(([text, tilt], k) => clipping(ctx, clipX + k * 64, 62 + (k % 2) * 12, 54, 40, tilt, text));
    if (wide) {
        const calX = clipX + 4 * 64 + 16;
        ctx.fillStyle = '#f4ede0';
        ctx.fillRect(calX, 62, 40, 46);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(calX, 62, 40, 11);
        ctx.fillStyle = '#fff';
        ctx.font = font('700 8px');
        ctx.textAlign = 'center';
        ctx.fillText('DEC', calX + 20, 70.5);
        ctx.fillStyle = '#2a2118';
        ctx.font = font('700 18px');
        ctx.fillText('25', calX + 20, 98);
        ctx.textAlign = 'left';
    }

    // A shelf of bottles and the wooden menu tags (oshinagaki).
    // Tags first, then the shelf of bottles beside them.
    const tagsX0 = wide ? w * 0.42 : w * 0.4;
    const tagsX1 = tagsX0 + (wide ? 180 : 110);
    menuTags(ctx, tagsX0, tagsX1, 58);
    const shelfX0 = tagsX1 + 14;
    const shelfX1 = shelfX0 + (wide ? 150 : 0);
    if (shelfX1 > shelfX0) {
        ctx.fillStyle = '#5a3a20';
        ctx.fillRect(shelfX0 - 6, 104, shelfX1 - shelfX0 + 12, 4);
        const bottles = seeded(17);
        for (let x = shelfX0; x < shelfX1; x += 15 + bottles() * 6) bottle(ctx, x, 104, 20 + bottles() * 10, bottles);
    }

    // The garland of cranes.
    const x0 = SIDE + 20;
    const x1 = w - SIDE - 20;
    let herX = w * 0.55;
    if (race) herX = x0 + Math.max(0, Math.min(1, race.progress)) * (x1 - x0);
    craneGarland(ctx, x0, x1, 10, race ? herX : null);
    if (race) {
        rankPlaque(ctx, x0 + 34, counter - 46, race.start);
        rankPlaque(ctx, x1 - 34, counter - 46, race.finish);
    }

    // The lantern and the oden pot at the end of the counter.
    const potX = w - SIDE - (wide ? 210 : 150);
    redLantern(ctx, potX - 30, 58, 40);

    // Her behind the counter, under the club's place.
    let faceY = counter - 40;
    let reach = 40;
    if (art) {
        const artH = hero - 30;
        const artW = (art.width / art.height) * artH;
        ctx.drawImage(art, herX - artW / 2, counter + 18 - artH, artW, artH);
        faceY = counter + 18 - artH * 0.62;
        reach = artW / 2 + 10;
    }

    // The counter, over her lower half.
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(0, counter, w, hero - counter);
    ctx.fillStyle = '#8a5a32';
    ctx.fillRect(0, counter, w, 5);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.15)';
    ctx.fillRect(0, counter, w, 1.5);
    odenPot(ctx, potX, counter - (wide ? 120 : 92) * 0.34 + 3, wide ? 120 : 92);
    // The cat on its stool at the near end.
    ctx.fillStyle = '#3b2a1e';
    ctx.fillRect(x1 - 14, counter + 5, 4, hero - counter);
    sittingCat(ctx, x1 - 12, counter + 2, 16);
    if (!art || mood >= 0.67) odenBowl(ctx, art ? herX + reach + 22 : herX, counter, 24);

    const line = mood < 0.34 ? 'Huh. Since when are we this good?' : mood < 0.67 ? "Third's not bad… right?" : 'Eat something first. Then we fight.';
    const bw = bubbleWidth(ctx, line);
    const bubbleX = herX + reach + bw > w - SIDE ? herX - reach - bw : herX + reach;
    speechBubble(ctx, bubbleX, Math.max(54, faceY - 40), line, herX + (bubbleX > herX ? 14 : -14), faceY, 0);
}

// ─── Dream Journey ────────────────────────────────────────────────────────────

/**
 * Her picture for `mood`: `journey-calm.png`, `journey-uneasy.png` or
 * `journey-yandere.png` (the same thirds as her lines), else `journey.png`,
 * else none (the scene then stands her suitcase on the track in her place).
 */
async function journeyPose(mood: number): Promise<Image | null> {
    const pose = mood < 0.34 ? 'calm' : mood < 0.67 ? 'uneasy' : 'yandere';
    return (await sceneArt(`journey-${pose}`)) ?? sceneArt('journey');
}

/**
 * A Japanese station name board (ekimeihyō): white, on two posts, the
 * station's name large, a line in her pale gold beneath it, and the next
 * station along it in small type.
 */
function stationBoard(ctx: SKRSContext2D, cx: number, ground: number, name: string, next: string, nextSide: -1 | 1) {
    const bw = 96;
    const bh = 40;
    const top = ground - 64;
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(cx - bw / 2 + 8, top + bh, 3, ground - top - bh);
    ctx.fillRect(cx + bw / 2 - 11, top + bh, 3, ground - top - bh);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(cx - bw / 2 + 2, top + 2, bw, bh);
    ctx.fillStyle = '#f7f4ea';
    ctx.fillRect(cx - bw / 2, top, bw, bh);
    ctx.fillStyle = '#1e1e1e';
    ctx.font = font('700 15px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, cx, top + 14);
    ctx.fillStyle = '#c9b23a';
    ctx.fillRect(cx - bw / 2, top + 25, bw, 4);
    ctx.fillStyle = '#4a4a4a';
    ctx.font = font('600 8px');
    ctx.textAlign = nextSide > 0 ? 'right' : 'left';
    ctx.fillText(nextSide > 0 ? `${next} →` : `← ${next}`, nextSide > 0 ? cx + bw / 2 - 5 : cx - bw / 2 + 5, top + 35);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

/** Rails from x0 to x1 at `y`, sleepers under them; gold up to `goldTo`, Stay Gold's streak. */
function railway(ctx: SKRSContext2D, x0: number, x1: number, y: number, goldTo: number | null) {
    ctx.fillStyle = '#4a4636';
    ctx.fillRect(x0 - 20, y - 2, x1 - x0 + 40, 12);
    ctx.fillStyle = '#2a2619';
    for (let x = x0 - 16; x < x1 + 16; x += 11) ctx.fillRect(x, y - 3, 6, 11);
    for (const off of [0, 6]) {
        ctx.fillStyle = '#7d8088';
        ctx.fillRect(x0 - 20, y + off - 1, x1 - x0 + 40, 2);
    }
    if (goldTo === null) return;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 210, 90, 0.9)';
    ctx.shadowBlur = 8;
    for (const off of [0, 6]) {
        const g = ctx.createLinearGradient(x0, 0, goldTo, 0);
        g.addColorStop(0, '#b8902a');
        g.addColorStop(1, '#ffe27a');
        ctx.fillStyle = g;
        ctx.fillRect(x0 - 20, y + off - 1.2, goldTo - x0 + 20, 2.4);
    }
    ctx.restore();
}

/** A three-light railway signal: green, yellow or red lit by her mood. */
function railSignal(ctx: SKRSContext2D, x: number, ground: number, mood: number) {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(x - 1.5, ground - 64, 3, 64);
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(x - 7, ground - 76, 14, 36, 4);
    ctx.fill();
    const lit = mood < 0.34 ? 2 : mood < 0.67 ? 1 : 0;
    const lamps = ['#ff3b30', '#ffcc33', '#3ddc84'];
    lamps.forEach((colour, k) => {
        const ly = ground - 70 + k * 11;
        if (k === lit) {
            const glow = ctx.createRadialGradient(x, ly, 0, x, ly, 16);
            glow.addColorStop(0, rgba(colour, 0.7));
            glow.addColorStop(1, rgba(colour, 0));
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(x, ly, 16, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = k === lit ? colour : '#333';
        ctx.beginPath();
        ctx.arc(x, ly, 3.6, 0, Math.PI * 2);
        ctx.fill();
    });
}

/** Her travel case, packed (she loves packing): brown leather, gold clasps, stickers. */
function suitcase(ctx: SKRSContext2D, cx: number, ground: number, s: number) {
    const w = s;
    const h = s * 0.72;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, ground, w * 0.55, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a2614';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.16, ground - h - 8, w * 0.32, 10, 4);
    ctx.stroke();
    ctx.fillStyle = '#7a4a24';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, ground - h, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#5e3818';
    ctx.fillRect(cx - w / 2, ground - h * 0.55, w, 3);
    ctx.fillStyle = '#e6c75a';
    ctx.fillRect(cx - w * 0.3, ground - h * 0.6, 5, 7);
    ctx.fillRect(cx + w * 0.3 - 5, ground - h * 0.6, 5, 7);
    for (const [dx, dy, c] of [[-0.25, -0.3, '#e6e08a'], [0.18, -0.25, '#d9433b'], [0.05, -0.82, '#9fb8e6']] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(cx + dx * w, ground + dy * h, w * 0.1, w * 0.07, 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Her bench on the platform: a chess game she is winning, a cup of chamomile
 * (she makes it for Orfevre), a sketchbook. At her worst a black piece has
 * taken the white king, laid on its side.
 */
function platformBench(ctx: SKRSContext2D, x: number, ground: number, mood: number) {
    ctx.fillStyle = '#5a4630';
    ctx.fillRect(x, ground - 20, 96, 5);
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(x + 6, ground - 15, 4, 15);
    ctx.fillRect(x + 86, ground - 15, 4, 15);
    // The board.
    const bx = x + 12;
    const by = ground - 26;
    for (let r = 0; r < 2; r += 1) {
        for (let c = 0; c < 8; c += 1) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#e9dfc4' : '#5a4630';
            ctx.fillRect(bx + c * 5, by + r * 3, 5, 3);
        }
    }
    const piece = (px: number, colour: string, tall: number) => {
        ctx.fillStyle = colour;
        ctx.fillRect(px - 1.5, by - tall, 3, tall);
        ctx.beginPath();
        ctx.arc(px, by - tall, 2, 0, Math.PI * 2);
        ctx.fill();
    };
    piece(bx + 6, '#f4efe0', 6);
    piece(bx + 30, '#1a1a1a', 8);
    piece(bx + 18, '#1a1a1a', 5);
    if (mood >= 0.67) {
        ctx.fillStyle = '#f4efe0';
        ctx.fillRect(bx + 22, by - 3, 9, 3);
        ctx.beginPath();
        ctx.arc(bx + 32, by - 1.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
    } else piece(bx + 24, '#f4efe0', 9);
    // Tea and a sketchbook.
    ctx.fillStyle = '#f4efe0';
    ctx.fillRect(x + 62, ground - 30, 9, 10);
    ctx.fillStyle = '#e6c75a';
    ctx.fillRect(x + 63, ground - 29, 7, 2);
    steam(ctx, x + 66, ground - 31, 14);
    ctx.fillStyle = '#efe6cf';
    ctx.fillRect(x + 76, ground - 25, 16, 5);
    ctx.fillStyle = '#8a7a5a';
    ctx.fillRect(x + 76, ground - 25, 16, 1.2);
}

/** Telegraph poles along the line, every `gap`, with their wires sagging between. */
function telegraphPoles(ctx: SKRSContext2D, w: number, ground: number, gap: number, colour: string) {
    const tops: number[] = [];
    for (let x = 18; x < w; x += gap) tops.push(x);
    ctx.fillStyle = colour;
    for (const x of tops) {
        ctx.fillRect(x - 1.5, ground - 70, 3, 70);
        ctx.fillRect(x - 9, ground - 66, 18, 2.5);
        ctx.fillRect(x - 6, ground - 58, 12, 2);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 0.7;
    for (const [dy, half] of [[-66, 8], [-58, 5]] as const) {
        for (const side of [-1, 1]) {
            for (let k = 0; k < tops.length - 1; k += 1) {
                const a = tops[k]! + side * half;
                const b = tops[k + 1]! + side * half;
                ctx.beginPath();
                ctx.moveTo(a, ground + dy);
                ctx.quadraticCurveTo((a + b) / 2, ground + dy + 9, b, ground + dy);
                ctx.stroke();
            }
        }
    }
}

/** A night train waiting from x0 to x1, its windows lit, a gold line along it. */
function nightTrain(ctx: SKRSContext2D, x0: number, x1: number, rail: number) {
    const top = rail - 34;
    const cars = Math.max(1, Math.round((x1 - x0) / 120));
    const carW = (x1 - x0) / cars;
    for (let k = 0; k < cars; k += 1) {
        const cx = x0 + k * carW;
        ctx.fillStyle = '#1f2a24';
        ctx.beginPath();
        ctx.roundRect(cx + 2, top, carW - 4, 30, 5);
        ctx.fill();
        ctx.fillStyle = '#c9a43a';
        ctx.fillRect(cx + 2, top + 22, carW - 4, 2);
        for (let wx = cx + 10; wx < cx + carW - 14; wx += 13) {
            const glow = ctx.createLinearGradient(0, top + 6, 0, top + 16);
            glow.addColorStop(0, '#ffe7a8');
            glow.addColorStop(1, '#e8b85a');
            ctx.fillStyle = glow;
            ctx.fillRect(wx, top + 6, 8, 10);
        }
        ctx.fillStyle = '#111';
        for (const wx of [cx + 14, cx + carW - 18]) {
            ctx.beginPath();
            ctx.arc(wx, rail + 1, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // Headlamp at the front, towards the end of the line.
    const lamp = ctx.createRadialGradient(x1 - 4, top + 14, 0, x1 - 4, top + 14, 22);
    lamp.addColorStop(0, 'rgba(255, 240, 190, 0.8)');
    lamp.addColorStop(1, 'rgba(255, 240, 190, 0)');
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(x1 - 4, top + 14, 22, 0, Math.PI * 2);
    ctx.fill();
}

/** Rolling hills at `base`, with a few town lights on them. */
function hills(ctx: SKRSContext2D, w: number, base: number, height: number, colour: string, seed: number, lights: boolean) {
    const rand = seeded(seed);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, base + 20);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, base - height * (0.5 + 0.5 * Math.sin(x / (90 + seed * 7) + seed)) - rand() * 3);
    ctx.lineTo(w, base + 20);
    ctx.fill();
    if (!lights) return;
    for (let k = 0; k < w / 40; k += 1) {
        ctx.fillStyle = `rgba(255, 214, 120, ${0.5 + rand() * 0.5})`;
        ctx.fillRect(rand() * w, base - rand() * height * 0.5, 1.6, 1.6);
    }
}

/**
 * Dream Journey's railway at dusk: "Witness of Journey's End". Rolling hills
 * with town lights under a sky from her pale gold into night; a line of
 * track across the band between two station boards, the bottom cutoff and
 * the next rank up. The rails already travelled are gold, Stay Gold's
 * streak of gold, up to the club's place, where she stands (or, until her
 * picture exists, her packed case). Beside her a railway signal; on the
 * platform her bench with a chess game and chamomile.
 *
 * Her mood is the signal and the dusk: green and golden when all is well
 * ("Thorough preparation. All as planned."), yellow as night comes on ("A
 * small detour. I'll amend the itinerary."), and red in the dark at her
 * worst, the white king down on the board and her manners intact: "Leave
 * the rest to me. Personally."
 */
function drawJourney(ctx: SKRSContext2D, w: number, h: number, hero: number, art: Image | null, mood: number, race: SceneRace | null) {
    const floor = hero - 10;
    const wide = w > 1200;
    const railY = floor - 14;

    const sky = ctx.createLinearGradient(0, 0, 0, railY);
    sky.addColorStop(0, mix('#2e3048', '#0d0d16', mood));
    sky.addColorStop(0.65, mix('#b88a5a', '#2a2238', mood));
    sky.addColorStop(1, mix('#efd48a', '#4a2a2a', mood));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hero);
    // Stars as it darkens; the evening star always.
    const stars = seeded(33);
    for (let k = 0; k < 20 + mood * 50; k += 1) {
        ctx.fillStyle = `rgba(255, 248, 220, ${(0.3 + stars() * 0.6) * Math.min(1, 0.3 + mood)})`;
        ctx.fillRect(stars() * w, stars() * railY * 0.55, 1.4, 1.4);
    }
    twinkle(ctx, w * 0.3, 24, 5, '#fff3c4');

    hills(ctx, w, railY - 6, 34, mix('#5a5236', '#1e1c16', mood), 2, false);
    hills(ctx, w, railY + 2, 22, mix('#3d3824', '#14130e', mood), 5, true);

    const x0 = SIDE + 70;
    const x1 = w - SIDE - 70;
    let herX = w * 0.55;
    if (race) herX = x0 + Math.max(0, Math.min(1, race.progress)) * (x1 - x0);
    telegraphPoles(ctx, w, railY + 2, wide ? 150 : 120, mix('#2e2a1c', '#0c0b08', mood));
    railway(ctx, x0, x1, railY, race ? herX : null);
    // The night train waiting at journey's end, if she is not there yet.
    const trainLen = Math.min(wide ? 300 : 180, (x1 - x0) * 0.24);
    if (herX < x1 - trainLen - 50) nightTrain(ctx, x1 - trainLen, x1 - 6, railY - 1);
    // The ground in front of the track.
    ctx.fillStyle = mix('#2b2719', '#121109', mood);
    ctx.fillRect(0, railY + 10, w, hero - railY - 10);

    if (race) {
        stationBoard(ctx, x0 - 10, floor, race.start, race.finish, 1);
        stationBoard(ctx, x1 + 10, floor, race.finish, race.start, -1);
    }
    ctx.save();
    ctx.translate(x0 + 70, floor);
    ctx.scale(1.5, 1.5);
    platformBench(ctx, 0, 0, mood);
    ctx.restore();
    railSignal(ctx, Math.min(x1 - 70, herX + 46), railY + 4, mood);

    let faceY = railY - 40;
    let reach = 30;
    if (art) {
        const artH = hero - 30;
        const artW = (art.width / art.height) * artH;
        const footY = railY + 6;
        ctx.drawImage(art, herX - artW / 2, footY - artH, artW, artH);
        faceY = footY - artH * 0.62;
        reach = artW / 2 + 10;
    } else {
        suitcase(ctx, herX, railY + 4, 48);
        faceY = railY - 34;
    }

    const line = mood < 0.34 ? 'Thorough preparation. All as planned.' : mood < 0.67 ? "A small detour. I'll amend the itinerary." : 'Leave the rest to me. Personally.';
    const bw = bubbleWidth(ctx, line);
    const bubbleX = herX + reach + bw > w - SIDE ? herX - reach - bw : herX + reach;
    speechBubble(ctx, bubbleX, wide ? 22 : 18, line, herX + (bubbleX > herX ? 12 : -12), faceY, 0);
}
