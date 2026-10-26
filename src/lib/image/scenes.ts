import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { seeded } from './cards';
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
 *   oguri      Oguri Cap's colours: a blue sky with clouds and pennants in
 *              blue, white and gold, her gold star, and a white rail on
 *              mown turf with a stack of onigiri (she is famously hungry)
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
export type SceneId = 'fireworks' | 'confetti' | 'oguri';

/** Height of the open band above the cards, by layout. */
const HERO = { tall: 190, wide: 170 } as const;

/** Visible margin left, right and below the cards (the report keeps its own 16px inside). */
const SIDE = 30;

/** The margin the report draws around its cards, which is transparent here. */
const INNER = 16;

/** Where a scene's optional picture lives, beside the other image assets. */
const ART_DIR = path.join(__dirname, '..', '..', 'assets', 'scenes');

/** Each scene's picture, once loaded; null when there is none. */
const artCache = new Map<SceneId, Image | null>();

/** The scene's picture, or null when the file is missing or unreadable. */
async function sceneArt(scene: SceneId): Promise<Image | null> {
    if (artCache.has(scene)) return artCache.get(scene)!;
    const file = path.join(ART_DIR, `${scene}.png`);
    let art: Image | null = null;
    if (existsSync(file)) {
        try {
            art = await loadImage(file);
        } catch {
            art = null;
        }
    }
    artCache.set(scene, art);
    return art;
}

/**
 * Places a report, drawn on a transparent background, on its palette's
 * scene. Returns the report unchanged for a palette without one.
 */
export async function withScene(report: Canvas, p: Palette, layout: 'tall' | 'wide'): Promise<Canvas> {
    const scene = p.style.scene;
    if (!scene) return report;
    const hero = HERO[layout];
    const offsetX = SIDE - INNER;
    const offsetY = hero - INNER;
    const w = report.width + offsetX * 2;
    const h = report.height + offsetY + offsetX;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (scene === 'fireworks') drawFireworks(ctx, w, h, hero);
    else if (scene === 'confetti') drawConfetti(ctx, w, h, hero);
    else drawOguri(ctx, w, h, hero, await sceneArt(scene));
    ctx.drawImage(report, offsetX, offsetY);
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

/** Oguri Cap's blue and white (umamusu.wiki), and the gold of her star. */
const OGURI_BLUE = '#3a7ad2';
const OGURI_WHITE = '#ece7e7';
const OGURI_GOLD = '#ffcc33';

/** A five-pointed star path centred on (cx, cy). */
function starPath(ctx: SKRSContext2D, cx: number, cy: number, outer: number, inner: number, turn: number) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const a = turn - Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
}

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
    ctx.strokeStyle = '#e4ddcf';
    ctx.lineWidth = 1.5;
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
 * Oguri Cap: her blue sky, clouds, a garland of pennants in her colours,
 * her gold star, and a white rail on mown turf just above the cards, with a
 * stack of onigiri on the grass. `art`, when given, stands on the right.
 */
function drawOguri(ctx: SKRSContext2D, w: number, h: number, hero: number, art: Image | null) {
    const rand = seeded(1987);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2c69c2');
    sky.addColorStop(Math.min(0.99, (hero * 0.7) / h), '#5d95df');
    sky.addColorStop(Math.min(0.995, hero / h), '#a9c8f0');
    sky.addColorStop(1, '#e3ecf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Clouds, away from the star on the left.
    for (let i = 0; i < Math.max(3, Math.round(w / 260)); i += 1) {
        const x = w * 0.25 + rand() * w * 0.75;
        cloud(ctx, x, hero * (0.3 + rand() * 0.28), 26 + rand() * 22, rand);
    }

    // Her star, glowing.
    const sx = Math.min(w * 0.14, 130);
    const sy = hero * 0.42;
    const sr = hero * 0.27;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.2);
    glow.addColorStop(0, 'rgba(255, 236, 150, 0.75)');
    glow.addColorStop(1, 'rgba(255, 236, 150, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 2.2, 0, Math.PI * 2);
    ctx.fill();
    starPath(ctx, sx, sy, sr, sr * 0.45, -0.2);
    const gold = ctx.createLinearGradient(sx - sr, sy - sr, sx + sr, sy + sr);
    gold.addColorStop(0, '#fff0a0');
    gold.addColorStop(0.45, OGURI_GOLD);
    gold.addColorStop(1, '#e09a00');
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    starPath(ctx, sx - sr * 0.12, sy - sr * 0.12, sr * 0.38, sr * 0.17, -0.2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    for (let i = 0; i < Math.round(w / 90); i += 1) {
        twinkle(ctx, rand() * w, rand() * hero * 0.75, 3 + rand() * 5, rand() < 0.5 ? '#ffffff' : '#fff2b0');
    }

    // A garland of pennants sagging across the top.
    const sag = 16;
    const along = (x: number) => 6 + sag * Math.sin((x / w) * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
        if (x === 0) ctx.moveTo(x, along(x));
        else ctx.lineTo(x, along(x));
    }
    ctx.stroke();
    const flags = [OGURI_BLUE, OGURI_WHITE, OGURI_GOLD];
    for (let i = 0, x = 10; x < w - 10; i += 1, x += 34) {
        const top = along(x);
        ctx.fillStyle = flags[i % flags.length]!;
        ctx.beginPath();
        ctx.moveTo(x - 11, top);
        ctx.lineTo(x + 11, along(x + 22) - (along(x + 22) - top) / 2);
        ctx.lineTo(x, top + 24);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(20, 50, 110, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
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

    // The white rail along the turf.
    const railY = turfTop - 18;
    ctx.fillStyle = 'rgba(20, 60, 30, 0.25)';
    ctx.fillRect(0, railY + 3, w, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, railY, w, 5);
    ctx.fillRect(0, railY + 11, w, 3);
    for (let x = 6; x < w; x += 30) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, railY, 4, turfTop - railY + 6);
        ctx.fillStyle = 'rgba(40, 90, 140, 0.25)';
        ctx.fillRect(x + 3, railY + 2, 1, turfTop - railY + 4);
    }

    // The picture, when there is one, standing on the right; the onigiri
    // pile sits beside it, or at the right edge without it.
    let pileX = w - SIDE - 70;
    if (art) {
        const artH = hero - 16;
        const artW = (art.width / art.height) * artH;
        const artX = w - SIDE - artW;
        ctx.drawImage(art, artX, hero - artH - 2, artW, artH);
        pileX = artX - 46;
    }
    const size = 38;
    const ground = hero - 8;
    onigiri(ctx, pileX - size * 0.55, ground - size / 2, size, -0.08);
    onigiri(ctx, pileX + size * 0.55, ground - size / 2, size, 0.1);
    onigiri(ctx, pileX, ground - size * 1.35, size, 0.02);
}
