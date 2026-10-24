import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank } from '@prisma/client';
import { PALETTES, DEFAULT_PALETTE, dashNum, type Palette } from './theme';
import { font } from './fonts';
import { loadClubIcon, loadRankIcon } from './canvasUtils';
import type { LastDayGains } from '../fans/readings';
import { describeQuota, formatMillionsFans, periodAdjective, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard, as cards on a backdrop.
 *
 * Two layouts share every piece:
 *
 *   tall   900px wide, for phones. A header card (club image, name, date
 *          and members, report line; monthly rank and rank badge at the
 *          right; quota, expected and next-due figures; progress bar), then
 *          an on-pace card, a behind card and a footer card.
 *   wide   1700px wide, like the ChronoGenesis landscape page. The header
 *          becomes a sidebar on the left with the footer notes at its foot,
 *          and the members run down two table columns, on pace first.
 *
 * Behind members get their own card, names cream when less than one day's
 * quota short and red when more. Figures are compact ("107.93M", "+7.08M")
 * in IBM Plex Mono, the bot's own face, whose digits are tabular. Expected
 * is the same for everyone present all period, so it is one header figure;
 * the Days column shows who joined late and so owes less.
 *
 * The palette decides colours and feel: corner radius, outlines, glow, label
 * style and backdrop pattern (see `PaletteStyle`).
 */

export type FanReportLayout = 'tall' | 'wide';

/** Frame visible around and between the cards. */
const FRAME = 16;
const GAP = 12;
/** Padding inside a card. */
const PAD = 24;
const HEADING_HEIGHT = 36;
/** Club image and rank badge size. */
const SLOT = 72;

const TALL_WIDTH = 900;
const WIDE_WIDTH = 1700;
const SIDEBAR_WIDTH = 340;

export interface FanReportMeta {
    circleName: string;
    monthlyRank: number | null;
    memberCount: number;
    /** e.g. "September 14, 2026" */
    dateLabel: string;
    /** The club's expected rank, for the badge. Null or omitted: an empty slot. */
    clubRank?: ClubRank | null;
    /**
     * Fans earned in the 24 hours before the report (see `lastDayGains`).
     * When given, the column shows it as "Last 24h". Without it (a report at
     * the daily reset, or no readings from a day ago yet) the column is the
     * last complete game day, "Day N".
     */
    last24h?: LastDayGains | null;
}

// ─── Drawing primitives ─────────────────────────────────────────────────────

/** Text drawing options. */
interface Ink {
    spec: string;
    color: string;
    align?: 'left' | 'right' | 'center';
    /** Extra letter spacing in pixels. */
    tracking?: number;
}

/** Draws text in the bot's face and returns its width. */
function text(ctx: SKRSContext2D, value: string, x: number, y: number, ink: Ink): number {
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
function label(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color: string, p: Palette, align: Ink['align'] = 'left') {
    const upper = p.style.labels === 'upper';
    return text(ctx, upper ? value.toUpperCase() : value, x, y, {
        spec: `400 ${upper ? size - 1 : size}px`,
        color,
        align,
        tracking: upper ? 1.5 : 0,
    });
}

/** Truncates with an ellipsis until the text fits, measured in `spec`. */
function fit(ctx: SKRSContext2D, value: string, maxWidth: number, spec: string): string {
    ctx.font = font(spec);
    let out = value;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/** Joins parts with `joiner` into lines that fit `maxWidth` in `spec`. */
function wrap(ctx: SKRSContext2D, parts: string[], maxWidth: number, spec: string, joiner = ' · '): string[] {
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
function wrapWords(ctx: SKRSContext2D, sentences: string[], maxWidth: number, spec: string): string[] {
    return sentences.flatMap((s) => wrap(ctx, s.split(' '), maxWidth, spec, ' '));
}

/** Traces a rounded rectangle path. */
function roundPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
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
function fillRound(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
    roundPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
}

/** Draws a card in the palette's style: fill, then outline and glow if any. */
function card(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, p: Palette) {
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
function innerRadius(p: Palette): number {
    return Math.max(0, Math.min(10, p.style.radius - 6));
}

/** Small deterministic generator, so a starry backdrop is the same every time. */
function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/** Paints the backdrop behind the cards in the palette's frame style. */
function drawFrame(ctx: SKRSContext2D, w: number, h: number, p: Palette) {
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

/**
 * Draws an image in a `size` square, clipped to a circle when `round`, or an
 * empty circle with `placeholder` when there is no image. The empty slot
 * keeps the layout the same with or without a picture.
 */
function drawSlot(ctx: SKRSContext2D, image: Image | null, x: number, y: number, size: number, p: Palette, placeholder: string, round: boolean) {
    const r = size / 2;
    if (image) {
        ctx.save();
        if (round) {
            ctx.beginPath();
            ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
            ctx.clip();
        }
        // Fit inside the slot, keeping the aspect ratio.
        const scale = Math.min(size / image.width, size / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
        ctx.restore();
        return;
    }
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.fillStyle = p.panel;
    ctx.fill();
    text(ctx, placeholder, x + r, y + r + size * 0.13, { spec: `700 ${Math.round(size * 0.36)}px`, color: p.faint, align: 'center' });
}

// ─── Figures ────────────────────────────────────────────────────────────────

/**
 * A fan count to two decimals of its unit: "107.93M", "1.98B", "12K", or the
 * plain number below ten thousand. `roundUp` rounds up instead of to the
 * nearest, for targets, so someone who earns the figure shown is never a few
 * fans short.
 */
export function shortFans(value: number, roundUp = false): string {
    const scaled = (unit: number, digits: number) => {
        const factor = 10 ** digits;
        const x = (value / unit) * factor;
        return ((roundUp ? Math.ceil(x - 1e-9) : Math.round(x)) / factor).toFixed(digits);
    };
    if (value >= 1_000_000_000) return `${scaled(1_000_000_000, 2)}B`;
    if (value >= 1_000_000) return `${scaled(1_000_000, 2)}M`;
    if (value >= 10_000) return `${scaled(1_000, 0)}K`;
    return value.toLocaleString('en-US');
}

/** The value most members share: the expected figure of everyone present all period. */
function commonValue(values: number[]): number {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = 0;
    let bestCount = -1;
    for (const [v, n] of counts) if (n > bestCount || (n === bestCount && v > best)) [best, bestCount] = [v, n];
    return best;
}

/** Parts of the report line under the club's name. */
function reportLine(p: CircleProgress): string[] {
    const parts = [`${periodAdjective(p.period).toLowerCase()} report`];
    if (p.period !== 'DAY') parts.push(p.windowLabel.toLowerCase());
    parts.push(`day ${p.daysElapsed} of ${p.daysInMonth}`);
    return parts;
}

/** One header figure: a label, the value, and a note under it. */
interface Stat {
    label: string;
    value: string;
    note: string;
}

/** The three header figures: quota, expected by now, and what is due next. */
function headerStats(progress: CircleProgress): Stat[] {
    const expected = commonValue(progress.members.map((m) => m.expected));
    const judged = progress.period === 'MONTH' ? progress.daysElapsed : progress.finishedDay;
    const next =
        progress.period === 'MONTH'
            ? { label: 'Due by month end', value: shortFans(progress.effectiveQuota), note: `day ${progress.daysInMonth}` }
            : progress.daysRemaining === 0
              ? { label: 'Month closed', value: shortFans(progress.effectiveQuota), note: 'was due' }
              : { label: 'Next check', value: shortFans(progress.nextCheckpointTarget), note: `end of day ${progress.nextCheckpointDay}` };
    return [
        { label: 'Quota', value: `${shortFans(progress.quotaPerDay)}/day`, note: describeQuota(progress.quota, progress.period) },
        { label: 'Expected now', value: shortFans(expected), note: `by day ${judged}` },
        next,
    ];
}

/** Draws one header figure with its top at `y`; returns the height used. */
function drawStat(ctx: SKRSContext2D, s: Stat, x: number, y: number, maxWidth: number, p: Palette): number {
    label(ctx, s.label, x, y + 14, 14, p.muted, p);
    text(ctx, s.value, x, y + 42, { spec: '700 22px', color: p.text });
    text(ctx, fit(ctx, s.note, maxWidth, '400 14px'), x, y + 62, { spec: '400 14px', color: p.muted });
    return 70;
}

/** The club progress bar with its two labels, top at `y`; returns the height used. */
function drawProgress(ctx: SKRSContext2D, progress: CircleProgress, x: number, y: number, w: number, p: Palette, stacked: boolean): number {
    const ratio = progress.quotaTarget > 0 ? Math.min(1, progress.totalFans / progress.quotaTarget) : 0;
    const due = progress.members.reduce((sum, m) => sum + m.expected, 0);
    const dueRatio = progress.quotaTarget > 0 ? Math.min(1, due / progress.quotaTarget) : 0;
    fillRound(ctx, x, y, w, 8, 4, p.line);
    if (ratio > 0) fillRound(ctx, x, y, Math.max(8, w * ratio), 8, 4, p.accent);
    // A tick where the club should be by now, so the bar reads as pace.
    ctx.fillStyle = p.text;
    ctx.fillRect(x + w * dueRatio - 1, y - 5, 2, 18);
    const pct = progress.quotaTarget > 0 ? ((progress.totalFans / progress.quotaTarget) * 100).toFixed(1) : '0.0';
    const total = `${formatMillionsFans(progress.totalFans)} of ${formatMillionsFans(progress.quotaTarget)} · ${pct}%`;
    const pace = `${progress.onPaceCount} of ${progress.members.length} on pace`;
    text(ctx, total, x, y + 32, { spec: '400 14px', color: p.muted });
    if (stacked) {
        text(ctx, pace, x, y + 52, { spec: '400 14px', color: p.muted });
        return 60;
    }
    text(ctx, pace, x + w, y + 32, { spec: '400 14px', color: p.muted, align: 'right' });
    return 40;
}

/** Footer notes: what the target, days and colours mean. */
function footerNotes(progress: CircleProgress, last24h: LastDayGains | null): string[] {
    const until = progress.period === 'MONTH' ? 'until month end' : `until the day ${progress.nextCheckpointDay} check`;
    const notes = [
        `Target: fans a day ${until}, the whole amount, not extra on top of pace.`,
        'Days: days in the circle this month.',
        'Behind: cream is under one day of quota short, red is more.',
    ];
    if (last24h?.overlapsFreeze) notes.push('* Last 24h includes the 1st, 17:00-24:00 JST, when fans do not count.');
    return notes;
}

// ─── Table ──────────────────────────────────────────────────────────────────

/** Column anchors and type sizes for a table card. Numeric columns right-align. */
interface Columns {
    rank: number;
    trainer: number;
    avg: number;
    total: number;
    recent: number;
    target: number;
    days: number;
    /** Widest a trainer name may draw, leaving room for its rank movement. */
    nameMax: number;
    rowHeight: number;
    nameSize: number;
    numSize: number;
    smallSize: number;
}

/** Column layout for a table card at `x`, `w` wide. Wide columns are tighter. */
function columns(x: number, w: number, compact: boolean): Columns {
    const right = x + w - (compact ? 18 : PAD);
    // Distances between right edges: days to target, to recent, to total, to avg.
    const [d, t, r, a] = compact ? [50, 84, 90, 94] : [62, 100, 112, 110];
    const days = right;
    const target = days - d;
    const recent = target - t;
    const total = recent - r;
    const avg = total - a;
    const rank = x + (compact ? 44 : PAD + 30);
    const trainer = rank + 16;
    const numSize = compact ? 15 : 17;
    return {
        rank,
        trainer,
        avg,
        total,
        recent,
        target,
        days,
        // Room for the average figure (6 characters) and a movement marker.
        nameMax: avg - numSize * 0.6 * 6 - 34 - trainer,
        rowHeight: compact ? 36 : 40,
        nameSize: compact ? 16 : 18,
        numSize,
        smallSize: compact ? 14 : 15,
    };
}

/** Column headings in a strip at the top of a card. */
function drawHeadings(ctx: SKRSContext2D, x: number, w: number, y: number, c: Columns, recentLabel: string, p: Palette) {
    fillRound(ctx, x + 8, y + 8, w - 16, HEADING_HEIGHT - 4, innerRadius(p), p.panel);
    const by = y + 8 + 21;
    const size = c.smallSize - 1;
    label(ctx, '#', c.rank, by, size, p.muted, p, 'right');
    label(ctx, 'Trainer', c.trainer, by, size, p.muted, p);
    label(ctx, 'Avg/day', c.avg, by, size, p.muted, p, 'right');
    label(ctx, 'Total', c.total, by, size, p.muted, p, 'right');
    label(ctx, recentLabel, c.recent, by, size, p.muted, p, 'right');
    label(ctx, 'Target', c.target, by, size, p.muted, p, 'right');
    label(ctx, 'Days', c.days, by, size, p.muted, p, 'right');
}

/**
 * Draws one member row. `recent` is the last-24h figure, or the latest game
 * day's; `striped` shades the row; `dayQuota` is one day's quota, the line
 * between a cream and a red name.
 */
function drawRow(ctx: SKRSContext2D, m: MemberProgress, x: number, w: number, y: number, c: Columns, recent: number | null, striped: boolean, dayQuota: number, p: Palette) {
    if (striped) fillRound(ctx, x + 8, y, w - 16, c.rowHeight, innerRadius(p), p.stripe);
    const by = y + c.rowHeight / 2 + 6;
    const tint = p.place[m.rank - 1] ?? null;

    // Left bar: placement for the top four.
    if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(x + 12, y + 8, 3, c.rowHeight - 16);
    }

    text(ctx, String(m.rank), c.rank, by, { spec: `400 ${c.numSize}px`, color: p.muted, align: 'right' });

    const nameSpec = `400 ${c.nameSize}px`;
    const nameColor = m.onPace ? (tint ?? p.text) : m.behind < dayQuota ? p.warn : p.behind;
    const nameWidth = text(ctx, fit(ctx, m.trainerName, c.nameMax, nameSpec), c.trainer, by, { spec: nameSpec, color: nameColor });
    if (m.rankChange !== null && m.rankChange !== 0) {
        text(ctx, `${m.rankChange > 0 ? '▲' : '▼'}${Math.abs(m.rankChange)}`, c.trainer + nameWidth + 6, by - 1, {
            spec: '400 11px',
            // A slip is not "behind", so it does not borrow that colour.
            color: m.rankChange > 0 ? p.good : p.muted,
        });
    }

    const num = `400 ${c.numSize}px`;
    const small = `400 ${c.smallSize}px`;
    text(ctx, shortFans(m.avgPerDay), c.avg, by, { spec: num, color: p.text, align: 'right' });
    text(ctx, shortFans(m.total), c.total, by, { spec: `700 ${c.numSize}px`, color: p.text, align: 'right' });
    text(ctx, recent === null ? '—' : `+${shortFans(recent)}`, c.recent, by, { spec: small, color: recent ? p.muted : p.faint, align: 'right' });
    text(ctx, m.needPerDay === null ? '—' : shortFans(m.needPerDay, true), c.target, by, {
        spec: m.onPace ? small : `700 ${c.smallSize}px`,
        color: m.needPerDay === null ? p.faint : m.onPace ? p.target : p.behind,
        align: 'right',
    });
    text(ctx, dashNum(m.dataDays), c.days, by, { spec: small, color: p.muted, align: 'right' });
}

/** A run of rows drawn as one card. */
interface Block {
    members: MemberProgress[];
    /** Column headings at the top: the first card of each column. */
    headings: boolean;
    /** Title above the rows, e.g. "Behind pace · 5". */
    title: string | null;
}

/** Height of a card holding `block`. */
function blockHeight(block: Block, c: Columns): number {
    const top = block.headings ? HEADING_HEIGHT + 12 : 0;
    const title = block.title ? 40 : 0;
    const pad = block.headings || block.title ? 0 : 12;
    return top + title + pad + Math.max(block.members.length, 1) * c.rowHeight + 12;
}

/** Draws `block` as a card at `y`; returns its height. */
function drawBlock(
    ctx: SKRSContext2D,
    block: Block,
    x: number,
    w: number,
    y: number,
    c: Columns,
    recentLabel: string,
    recentOf: (m: MemberProgress) => number | null,
    progress: CircleProgress,
    empty: string,
    p: Palette,
): number {
    const h = blockHeight(block, c);
    card(ctx, x, y, w, h, p);
    let rowY = y + (block.headings || block.title ? 0 : 12);
    if (block.headings) {
        drawHeadings(ctx, x, w, y, c, recentLabel, p);
        rowY += HEADING_HEIGHT + 12;
    }
    if (block.title) {
        text(ctx, block.title, c.rank - 20, rowY + 28, { spec: '700 15px', color: p.behind });
        rowY += 40;
    }
    if (block.members.length === 0) text(ctx, empty, c.trainer, rowY + 26, { spec: '400 16px', color: p.faint });
    block.members.forEach((m, i) => {
        drawRow(ctx, m, x, w, rowY, c, recentOf(m), i % 2 === 1, progress.quotaPerDay, p);
        rowY += c.rowHeight;
    });
    return h;
}

/**
 * Splits rows into cards: a new card wherever on pace turns to behind. The
 * first card gets the headings; the first behind card gets the title.
 */
function blocksOf(members: MemberProgress[], behindCount: number, behindTitled: boolean): Block[] {
    const blocks: Block[] = [];
    for (const m of members) {
        const last = blocks[blocks.length - 1];
        if (last && last.members[0]!.onPace === m.onPace) {
            last.members.push(m);
            continue;
        }
        const titled = !m.onPace && !behindTitled;
        if (titled) behindTitled = true;
        blocks.push({
            members: [m],
            headings: blocks.length === 0,
            title: m.onPace ? null : titled ? `Behind pace · ${behindCount}` : 'Behind pace, continued',
        });
    }
    if (blocks.length === 0) blocks.push({ members: [], headings: true, title: null });
    return blocks;
}

// ─── Layouts ────────────────────────────────────────────────────────────────

/** What both layouts need, worked out once. */
interface Prepared {
    progress: CircleProgress;
    meta: FanReportMeta;
    p: Palette;
    avatar: Image | null;
    badge: Image | null;
    /** Members on pace first, then behind, each in rank order. */
    ordered: MemberProgress[];
    behindCount: number;
    recentLabel: string;
    recentOf: (m: MemberProgress) => number | null;
    empty: string;
    notes: string[];
}

/** Lines of muted and accent text under the club's name. */
interface IdentityLines {
    /** Date and member count, wrapped. */
    meta: string[];
    /** The report line, wrapped. */
    report: string[];
}

/** Wraps the date, member count and report line to `width`. */
function identityLines(ctx: SKRSContext2D, d: Pick<Prepared, 'meta' | 'progress'>, width: number): IdentityLines {
    return {
        meta: wrap(ctx, [d.meta.dateLabel, `${d.meta.memberCount} members`], width, '400 14px'),
        report: wrap(ctx, reportLine(d.progress), width, '400 14px'),
    };
}

/** Height of the identity block: the image, or the name and lines beside it. */
function identityHeight(size: number, nameSize: number, lines: IdentityLines): number {
    return Math.max(size, nameSize + 6 + (lines.meta.length + lines.report.length) * 19);
}

/** Draws the club image, name, date and members, and report lines. */
function drawIdentity(ctx: SKRSContext2D, d: Prepared, x: number, y: number, size: number, textWidth: number, lines: IdentityLines, nameSize: number): void {
    const { p, meta } = d;
    drawSlot(ctx, d.avatar, x, y, size, p, meta.circleName.slice(0, 1).toUpperCase(), true);
    const tx = x + size + 16;
    text(ctx, fit(ctx, meta.circleName, textWidth, `700 ${nameSize}px`), tx, y + nameSize, { spec: `700 ${nameSize}px`, color: p.text });
    let ly = y + nameSize + 22;
    for (const line of lines.meta) {
        text(ctx, line, tx, ly, { spec: '400 14px', color: p.muted });
        ly += 19;
    }
    for (const line of lines.report) {
        text(ctx, line, tx, ly, { spec: '400 14px', color: p.accent });
        ly += 19;
    }
}

/** The monthly rank, right-aligned at `right`, with its caption. */
function drawRank(ctx: SKRSContext2D, d: Prepared, right: number, y: number, align: 'left' | 'right') {
    const rank = d.meta.monthlyRank === null ? 'Unranked' : `#${d.meta.monthlyRank}`;
    text(ctx, rank, right, y + 32, { spec: '700 30px', color: d.p.text, align });
    label(ctx, 'monthly rank', right, y + 54, 14, d.p.muted, d.p, align);
}

/** The phone layout: header, on-pace and behind cards, footer, top to bottom. */
function renderTall(d: Prepared): Buffer | Promise<Buffer> {
    const { p, progress } = d;
    const width = TALL_WIDTH;
    const cardX = FRAME;
    const cardW = width - FRAME * 2;
    const right = cardX + cardW - PAD;
    const rankBlock = 190;
    const textWidth = right - SLOT - rankBlock - (cardX + PAD + SLOT + 16);
    const measure = createCanvas(1, 1).getContext('2d');
    const lines = identityLines(measure, d, textWidth);
    const identityH = identityHeight(SLOT, 26, lines);
    const headerH = PAD + identityH + 22 + 70 + 22 + 40 + PAD - 8;

    const c = columns(cardX, cardW, false);
    const blocks = blocksOf(d.ordered, d.behindCount, false);
    const notes = wrapWords(measure, d.notes, cardW - PAD * 2, '400 13px');
    const footerH = 16 + notes.length * 19 + 14;
    const tableH = blocks.reduce((sum, b) => sum + blockHeight(b, c) + GAP, 0);
    const height = FRAME + headerH + GAP + tableH + footerH + FRAME;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, width, height, p);

    // Header: identity left, rank and badge right, figures, progress.
    let y = FRAME;
    card(ctx, cardX, y, cardW, headerH, p);
    const top = y + PAD;
    drawIdentity(ctx, d, cardX + PAD, top, SLOT, textWidth, lines, 26);
    drawSlot(ctx, d.badge, right - SLOT, top, SLOT, p, '?', false);
    drawRank(ctx, d, right - SLOT - 16, top, 'right');
    const statsY = top + identityH + 22;
    const third = (cardW - PAD * 2) / 3;
    headerStats(progress).forEach((s, i) => drawStat(ctx, s, cardX + PAD + third * i, statsY, third - 16, p));
    drawProgress(ctx, progress, cardX + PAD, statsY + 70 + 22, cardW - PAD * 2, p, false);
    y += headerH + GAP;

    for (const block of blocks) y += drawBlock(ctx, block, cardX, cardW, y, c, d.recentLabel, d.recentOf, progress, d.empty, p) + GAP;

    card(ctx, cardX, y, cardW, footerH, p);
    notes.forEach((line, i) => text(ctx, line, cardX + PAD, y + 28 + i * 19, { spec: '400 13px', color: p.muted }));

    return canvas.encode('png');
}

/** The landscape layout: a sidebar on the left and two table columns. */
function renderWide(d: Prepared): Buffer | Promise<Buffer> {
    const { p, progress } = d;
    const width = WIDE_WIDTH;
    const sideX = FRAME;
    const sideW = SIDEBAR_WIDTH;
    const sidePad = 22;
    const inner = sideW - sidePad * 2;
    const colW = (width - FRAME * 2 - sideW - GAP * 2) / 2;
    const colX = [sideX + sideW + GAP, sideX + sideW + GAP + colW + GAP];
    const slot = 60;

    const measure = createCanvas(1, 1).getContext('2d');
    const textWidth = inner - slot - 16;
    const lines = identityLines(measure, d, textWidth);
    const notes = wrapWords(measure, d.notes, inner, '400 12px');

    // Rows: the first half down the left column, the rest down the right.
    const split = Math.ceil(d.ordered.length / 2);
    const halves = [d.ordered.slice(0, split), d.ordered.slice(split)];
    const left = blocksOf(halves[0]!, d.behindCount, false);
    const right = halves[1]!.length > 0 ? blocksOf(halves[1]!, d.behindCount, halves[0]!.some((m) => !m.onPace)) : [];
    // The right column repeats the headings so it reads on its own.
    if (right[0]) right[0].headings = true;
    const c = [columns(colX[0]!, colW, true), columns(colX[1]!, colW, true)];
    const columnH = [left, right].map((blocks, i) => blocks.reduce((sum, b) => sum + blockHeight(b, c[i]!) + GAP, 0) - GAP);

    // Sidebar contents, top to bottom.
    const identityH = identityHeight(slot, 22, lines);
    const sideContent = sidePad + identityH + 20 + 1 + 20 + Math.max(slot, 60) + 20 + 1 + 18 + 3 * 74 + 10 + 60 + 20 + 1 + 16 + notes.length * 17 + sidePad;
    const contentH = Math.max(sideContent, ...columnH);
    const height = FRAME * 2 + contentH;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, width, height, p);

    // Sidebar: identity, rank and badge, figures, progress, notes.
    card(ctx, sideX, FRAME, sideW, contentH, p);
    const x = sideX + sidePad;
    let y = FRAME + sidePad;
    drawIdentity(ctx, d, x, y, slot, textWidth, lines, 22);
    y += identityH + 20;
    const rule = () => {
        ctx.fillStyle = p.line;
        ctx.fillRect(x, y, inner, 1);
        y += 1 + 20;
    };
    rule();
    drawSlot(ctx, d.badge, x, y, slot, p, '?', false);
    drawRank(ctx, d, x + slot + 16, y + 2, 'left');
    y += Math.max(slot, 60) + 20;
    rule();
    y -= 2;
    for (const s of headerStats(progress)) y += drawStat(ctx, s, x, y, inner, p) + 4;
    y += 10;
    y += drawProgress(ctx, progress, x, y, inner, p, true) + 20;
    rule();
    y -= 4;
    notes.forEach((line, i) => text(ctx, line, x, y + 12 + i * 17, { spec: '400 12px', color: p.muted }));

    // Table columns.
    [left, right].forEach((blocks, i) => {
        let by = FRAME;
        for (const block of blocks) by += drawBlock(ctx, block, colX[i]!, colW, by, c[i]!, d.recentLabel, d.recentOf, progress, d.empty, p) + GAP;
    });

    return canvas.encode('png');
}

/**
 * Renders the report as a PNG.
 *
 * @param palette Colours and style; the default palette when omitted.
 * @param layout  `tall` for phones (the default) or `wide`.
 */
export async function renderFanReport(
    progress: CircleProgress,
    meta: FanReportMeta,
    palette: Palette = PALETTES[DEFAULT_PALETTE]!,
    layout: FanReportLayout = 'tall',
): Promise<Buffer> {
    const last24h = meta.last24h ?? null;
    // A finished day when there is one; on a month's first day, the day so far.
    const day = progress.finishedDay > 0 ? progress.finishedDay : progress.daysElapsed;
    const prepared: Prepared = {
        progress,
        meta,
        p: palette,
        avatar: await loadClubIcon(meta.circleName),
        badge: meta.clubRank ? await loadRankIcon(meta.clubRank) : null,
        ordered: [...progress.members.filter((m) => m.onPace), ...progress.members.filter((m) => !m.onPace)],
        behindCount: progress.members.length - progress.onPaceCount,
        recentLabel: last24h ? `Last 24h${last24h.overlapsFreeze ? '*' : ''}` : `Day ${day}`,
        recentOf: (m) => (last24h ? (last24h.gains.get(m.viewerId) ?? null) : progress.finishedDay > 0 ? m.finishedDayGain : m.latestDayGain),
        empty: progress.members.length === 0 ? 'No fan data ingested for this month yet.' : 'Nobody is on pace yet.',
        notes: footerNotes(progress, last24h),
    };
    return layout === 'wide' ? renderWide(prepared) : renderTall(prepared);
}
