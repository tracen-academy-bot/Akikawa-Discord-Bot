import type { SKRSContext2D } from '@napi-rs/canvas';
import type { Palette } from './theme';
import { font } from './fonts';

/**
 * Drawing pieces shared by the card-style images (the fan report and the
 * timer leaderboard): text in the bot's face, labels in a palette's label
 * style, rounded cards with the palette's outline and glow, and the
 * backdrop patterns behind them.
 */

/** Text drawing options. */
export interface Ink {
    spec: string;
    color: string;
    align?: 'left' | 'right' | 'center';
    /** Extra letter spacing in pixels. */
    tracking?: number;
}

/** Draws text in the bot's face and returns its width. */
export function text(ctx: SKRSContext2D, value: string, x: number, y: number, ink: Ink): number {
    ctx.font = font(ink.spec);
    ctx.fillStyle = ink.color;
    ctx.textAlign = ink.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${ink.tracking ?? 0}px`;
    ctx.fillText(value, x, y);
    const width = ctx.measureText(value).width;
    ctx.letterSpacing = '0px';
    return width;
}

/** A small label in the palette's label style: as written, or tracked capitals. */
export function label(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color: string, p: Palette, align: Ink['align'] = 'left') {
    const upper = p.style.labels === 'upper';
    return text(ctx, upper ? value.toUpperCase() : value, x, y, {
        spec: `400 ${upper ? size - 1 : size}px`,
        color,
        align,
        tracking: upper ? 1.5 : 0,
    });
}

/** Truncates with an ellipsis until the text fits, measured in `spec`. */
export function fit(ctx: SKRSContext2D, value: string, maxWidth: number, spec: string): string {
    ctx.font = font(spec);
    let out = value;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/** Joins parts with `joiner` into lines that fit `maxWidth` in `spec`. */
export function wrap(ctx: SKRSContext2D, parts: string[], maxWidth: number, spec: string, joiner = ' · '): string[] {
    ctx.font = font(spec);
    const lines: string[] = [];
    let line = '';
    for (const part of parts) {
        const next = line ? `${line}${joiner}${part}` : part;
        if (line && ctx.measureText(next).width > maxWidth) {
            lines.push(line);
            line = part;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

/** Wraps sentences word by word. */
export function wrapWords(ctx: SKRSContext2D, sentences: string[], maxWidth: number, spec: string): string[] {
    return sentences.flatMap((s) => wrap(ctx, s.split(' '), maxWidth, spec, ' '));
}

/** Traces a rounded rectangle path. */
export function roundPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/** Fills a rounded rectangle in one colour. */
export function fillRound(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
    roundPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
}

/** Draws a card in the palette's style: fill, then outline and glow if any. */
export function card(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, p: Palette) {
    fillRound(ctx, x, y, w, h, p.style.radius, p.bg);
    if (!p.style.border) return;
    ctx.save();
    if (p.style.glow) {
        ctx.shadowColor = p.style.border;
        ctx.shadowBlur = 14;
    }
    roundPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, p.style.radius);
    ctx.strokeStyle = p.style.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

/** Inner radius for strips and stripes inside a card. */
export function innerRadius(p: Palette): number {
    return Math.max(0, Math.min(10, p.style.radius - 6));
}

/** Small deterministic generator, so a starry backdrop is the same every time. */
export function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/** Paints the backdrop behind the cards in the palette's frame style. */
export function drawFrame(ctx: SKRSContext2D, w: number, h: number, p: Palette) {
    const style = p.style.frameStyle;
    if (style === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, p.frame);
        g.addColorStop(1, p.frameEnd);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        return;
    }
    ctx.fillStyle = p.frame;
    ctx.fillRect(0, 0, w, h);
    if (style === 'lanes') {
        // Diagonal bands of the two greens, like a mown course.
        const band = 56;
        ctx.save();
        ctx.fillStyle = p.frameEnd;
        for (let x = -h; x < w + h; x += band * 2) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + band, 0);
            ctx.lineTo(x + band + h, h);
            ctx.lineTo(x + h, h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    } else if (style === 'stars') {
        const rand = seeded(194);
        const count = Math.round((w * h) / 2600);
        ctx.fillStyle = p.frameEnd;
        for (let i = 0; i < count; i += 1) {
            ctx.globalAlpha = 0.25 + rand() * 0.75;
            ctx.beginPath();
            ctx.arc(rand() * w, rand() * h, rand() < 0.08 ? 1.6 : 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    } else if (style === 'bursts') {
        // Fireworks: rays from a centre, faint sparks between them. Most fall
        // behind the cards; the gaps show their edges.
        const rand = seeded(731);
        const colours = [p.accent, p.target, p.good, ...p.place];
        const count = Math.max(12, Math.round((w * h) / 9000));
        ctx.lineCap = 'round';
        for (let i = 0; i < count; i += 1) {
            const cx = rand() * w;
            const cy = rand() * h;
            const r = 16 + rand() * 26;
            const rays = 10 + Math.floor(rand() * 6);
            const turn = rand() * Math.PI;
            ctx.strokeStyle = colours[Math.floor(rand() * colours.length)]!;
            ctx.globalAlpha = 0.45 + rand() * 0.45;
            ctx.lineWidth = 1.6;
            for (let k = 0; k < rays; k += 1) {
                const a = turn + (k / rays) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35);
                ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
                ctx.stroke();
            }
        }
        ctx.fillStyle = p.frameEnd;
        for (let i = 0; i < Math.round((w * h) / 3000); i += 1) {
            ctx.globalAlpha = 0.4 + rand() * 0.6;
            ctx.beginPath();
            ctx.arc(rand() * w, rand() * h, 1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
    } else if (style === 'confetti') {
        // Small strips in the bright colours, each turned its own way.
        const rand = seeded(415);
        const colours = [p.accent, p.target, p.good, ...p.place];
        const count = Math.round((w * h) / 1400);
        for (let i = 0; i < count; i += 1) {
            ctx.save();
            ctx.translate(rand() * w, rand() * h);
            ctx.rotate(rand() * Math.PI);
            ctx.fillStyle = colours[Math.floor(rand() * colours.length)]!;
            ctx.globalAlpha = 0.55 + rand() * 0.35;
            ctx.fillRect(-4, -1.5, 8, 3);
            ctx.restore();
        }
    } else if (style === 'checker') {
        // A chequered flag of `frameEnd` squares.
        const size = 14;
        ctx.fillStyle = p.frameEnd;
        for (let y = 0; y < h; y += size) {
            for (let x = (y / size) % 2 === 0 ? 0 : size; x < w; x += size * 2) ctx.fillRect(x, y, size, size);
        }
    } else if (style === 'grid') {
        ctx.strokeStyle = p.frameEnd;
        ctx.lineWidth = 1;
        for (let x = 0.5; x < w; x += 28) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0.5; y < h; y += 28) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }
}
