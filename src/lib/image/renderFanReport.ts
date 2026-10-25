import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank } from '@prisma/client';
import { PALETTES, DEFAULT_PALETTE, dashNum, type Palette } from './theme';
import { font } from './fonts';
import { loadClubIcon, loadRankIcon } from './canvasUtils';
import type { LastDayGains } from '../fans/readings';
import type { RankBand } from '../fans/cutoff';
import { describeQuota, formatMillionsFans, periodAdjective, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard, as cards on a backdrop.
 *
 * Two layouts share every piece:
 *
 *   tall   900px wide, for phones. A header card (club image, name, date
 *          and members; monthly rank and rank badge at the right; quota,
 *          expected and next-due figures; progress bar; rank band), then
 *          the on-pace table and the behind card.
 *   wide   1700px wide, three panels of equal height: a sidebar (club,
 *          rank and its band, figures, progress, then the day: club gain,
 *          per member, how many hit the daily quota, and its top 3), the
 *          on-pace table, and the behind card, with the members closest to
 *          the line under the shorter of the last two.
 *
 * The rank band shows where the club's monthly points sit between the rank
 * cutoffs around it (#194 between #100 and #500): fans to the place above,
 * cushion over the place below. Lists stretch to fill spare card height, up
 * to a limit (`flexRow`).
 *
 * Nothing is said twice and nothing needs a footnote: the period and day
 * live in the figures, the headings say what columns hold ("Target/day",
 * "Days in"), and the behind card keys its own colours. The only note left
 * is the freeze warning, shown when it applies.
 *
 * Behind members are not table rows but entries of their own: how far short
 * in fans and in days of quota, a bar of fans earned against fans expected,
 * and what they need a day from here. Cream when less than one day's quota
 * short, red when more. Dates use short month names ("Oct 24, 2026"). Figures are compact ("107.93M", "+7.08M")
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
/** The wide layout's right panel: behind, then closest to the line. */
const RIGHT_PANEL_WIDTH = 420;

export interface FanReportMeta {
    circleName: string;
    monthlyRank: number | null;
    memberCount: number;
    /** e.g. "September 14, 2026" */
    dateLabel: string;
    /** The club's expected rank, for the badge. Null or omitted: an empty slot. */
    clubRank?: ClubRank | null;
    /** Where the club sits between the rank cutoffs around it (`rankBand`). Omitted: not shown. */
    rankBand?: RankBand | null;
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
        { label: 'Expected now', value: shortFans(expected), note: `by day ${judged} of ${progress.daysInMonth}` },
        next,
    ];
}

/** Draws one header figure with its top at `y`, smaller when `compact` (the wide sidebar). */
function drawStat(ctx: SKRSContext2D, s: Stat, x: number, y: number, maxWidth: number, p: Palette, compact: boolean) {
    const [labelSize, valueSize, noteSize, valueY, noteY] = compact ? [13, 20, 12, 38, 56] : [14, 22, 14, 42, 62];
    label(ctx, s.label, x, y + 14, labelSize, p.muted, p);
    text(ctx, fit(ctx, s.value, maxWidth, `700 ${valueSize}px`), x, y + valueY, { spec: `700 ${valueSize}px`, color: p.text });
    text(ctx, fit(ctx, s.note, maxWidth, `400 ${noteSize}px`), x, y + noteY, { spec: `400 ${noteSize}px`, color: p.muted });
}

/**
 * The club progress bar, top at `y`, with the club total under it and the
 * on-pace count to the right. `pace: null` leaves the count out (the wide
 * sidebar shows it as a figure).
 */
function drawProgress(ctx: SKRSContext2D, progress: CircleProgress, x: number, y: number, w: number, p: Palette, pace: false | null) {
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
    text(ctx, total, x, y + 32, { spec: '400 14px', color: p.muted });
    if (pace === null) return;
    text(ctx, `${progress.onPaceCount} of ${progress.members.length} on pace`, x + w, y + 32, { spec: '400 14px', color: p.muted, align: 'right' });
}

/**
 * Notes under the report: only the freeze warning now. The column headings
 * ("Target/day", "Days in") and the behind card's key explain the rest.
 */
function footerNotes(last24h: LastDayGains | null): string[] {
    return last24h?.overlapsFreeze ? ['* Last 24h includes the 1st, 17:00-24:00 JST, when fans do not count.'] : [];
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
    const [d, t, r, a] = compact ? [66, 96, 90, 94] : [80, 112, 108, 104];
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
    label(ctx, 'Target/day', c.target, by, size, p.muted, p, 'right');
    label(ctx, 'Days in', c.days, by, size, p.muted, p, 'right');
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
    // Placement shows in the left bar only; a coloured name means behind.
    const nameColor = m.onPace ? p.text : m.behind < dayQuota ? p.warn : p.behind;
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

/** Height of the on-pace table card for `count` rows. */
function tableHeight(count: number, c: Columns): number {
    return HEADING_HEIGHT + 12 + Math.max(count, 1) * c.rowHeight + 12;
}

/** Draws the on-pace table as one card `h` tall: headings, then a row per member. */
function drawTable(ctx: SKRSContext2D, members: MemberProgress[], x: number, w: number, y: number, h: number, c: Columns, d: Prepared) {
    const { p, progress } = d;
    card(ctx, x, y, w, h, p);
    drawHeadings(ctx, x, w, y, c, d.recentLabel, p);
    let rowY = y + HEADING_HEIGHT + 12;
    if (members.length === 0) text(ctx, d.empty, c.trainer, rowY + 26, { spec: '400 16px', color: p.faint });
    // A card taller than its rows spreads them out, within limits.
    const rows = { ...c, rowHeight: flexRow(c.rowHeight, members.length, y + h - 12 - rowY) };
    members.forEach((m, i) => {
        drawRow(ctx, m, x, w, rowY, rows, d.recentOf(m), i % 2 === 1, progress.quotaPerDay, p);
        rowY += rows.rowHeight;
    });
}

/**
 * A list row's height when its card has `available` pixels for `count` rows:
 * the natural `base`, stretched to fill, but never past `max` times `base`,
 * so a short list breathes without turning into a few huge rows.
 */
function flexRow(base: number, count: number, available: number, max = 1.35): number {
    if (count <= 0) return base;
    return Math.max(base, Math.min(base * max, available / count));
}

// ─── Behind ─────────────────────────────────────────────────────────────────

/** Height of one behind entry: name and shortfall, a bar, then days and need. */
const BEHIND_ENTRY = 74;
/** Height of a side card's title row. */
const CARD_TITLE = 54;

/** A number of fans as days of quota: "2.8 days", "1.0 day". */
function inDays(fans: number, perDay: number): string {
    if (perDay <= 0) return '—';
    const days = (fans / perDay).toFixed(1);
    return `${days} ${days === '1.0' ? 'day' : 'days'}`;
}

/** Height of a compact behind entry, used once more than `FULL_BEHIND` are behind. */
const BEHIND_COMPACT = 50;
/** Most members behind that still get full entries. */
const FULL_BEHIND = 5;

/** Entry height and columns for `count` members behind in a card that allows `maxColumns`. */
function behindGrid(count: number, maxColumns: number): { entry: number; columns: number; rows: number } {
    const compact = count > FULL_BEHIND;
    const columns = compact ? maxColumns : 1;
    return { entry: compact ? BEHIND_COMPACT : BEHIND_ENTRY, columns, rows: Math.ceil(count / columns) };
}

/** Height of the behind card for `count` members. */
function behindHeight(count: number, maxColumns: number): number {
    const grid = behindGrid(count, maxColumns);
    return CARD_TITLE + grid.rows * grid.entry + 10;
}

/**
 * Draws one compact behind entry: rank, name and shortfall, then a short bar
 * with the shortfall in days and the daily need beside it.
 */
function drawBehindCompact(ctx: SKRSContext2D, m: MemberProgress, x: number, top: number, w: number, h: number, striped: boolean, d: Prepared) {
    const { p, progress } = d;
    if (striped) fillRound(ctx, x, top, w, h - 4, innerRadius(p), p.stripe);
    // Centred in a stretched entry.
    const y = top + (h - BEHIND_COMPACT) / 2;
    const color = m.behind < progress.quotaPerDay ? p.warn : p.behind;
    const left = x + 12;
    const right = x + w - 12;

    const short = `−${shortFans(m.behind)}`;
    const shortWidth = text(ctx, short, right, y + 22, { spec: '700 16px', color, align: 'right' });
    const rankWidth = text(ctx, `#${m.rank}`, left, y + 22, { spec: '400 13px', color: p.muted });
    const nameX = left + rankWidth + 8;
    text(ctx, fit(ctx, m.trainerName, right - shortWidth - 12 - nameX, '400 16px'), nameX, y + 22, { spec: '400 16px', color });

    const need = m.needPerDay === null ? '—' : `${shortFans(m.needPerDay, true)}/day`;
    const needWidth = text(ctx, need, right, y + 41, { spec: '700 13px', color: p.text, align: 'right' });
    const lead = `${inDays(m.behind, progress.quotaPerDay)} · needs `;
    const leadWidth = text(ctx, lead, right - needWidth, y + 41, { spec: '400 13px', color: p.muted, align: 'right' });
    const barWidth = right - needWidth - leadWidth - 12 - left;
    const ratio = m.expected > 0 ? Math.min(1, m.total / m.expected) : 0;
    fillRound(ctx, left, y + 34, barWidth, 5, 2.5, p.line);
    if (ratio > 0) fillRound(ctx, left, y + 34, Math.max(5, barWidth * ratio), 5, 2.5, color);
}

/**
 * Draws one behind member: rank and name, then how far short in fans, a bar
 * of fans earned against fans expected by now, then how far short in days
 * and what they need a day from here. Cream when less than one day of quota
 * short, red when more. `w` above 600 also shows the two totals.
 */
function drawBehindEntry(ctx: SKRSContext2D, m: MemberProgress, x: number, top: number, w: number, h: number, striped: boolean, d: Prepared) {
    const { p, progress } = d;
    if (striped) fillRound(ctx, x, top, w, h - 4, innerRadius(p), p.stripe);
    // Centred in a stretched entry.
    const y = top + (h - BEHIND_ENTRY) / 2;
    const color = m.behind < progress.quotaPerDay ? p.warn : p.behind;
    const left = x + 14;
    const right = x + w - 14;

    const short = `−${shortFans(m.behind)}`;
    ctx.font = font('700 20px');
    const shortWidth = ctx.measureText(short).width;
    const rankWidth = text(ctx, `#${m.rank}`, left, y + 25, { spec: '400 15px', color: p.muted });
    const nameX = left + rankWidth + 10;
    text(ctx, fit(ctx, m.trainerName, right - shortWidth - 16 - nameX, '400 18px'), nameX, y + 25, { spec: '400 18px', color });
    text(ctx, short, right, y + 26, { spec: '700 20px', color, align: 'right' });

    const barY = y + 35;
    const ratio = m.expected > 0 ? Math.min(1, m.total / m.expected) : 0;
    fillRound(ctx, left, barY, right - left, 6, 3, p.line);
    if (ratio > 0) fillRound(ctx, left, barY, Math.max(6, (right - left) * ratio), 6, 3, color);

    const days = `${inDays(m.behind, progress.quotaPerDay)} behind`;
    const detail = w > 600 ? `${days} · ${shortFans(m.total)} of ${shortFans(m.expected)} expected` : days;
    text(ctx, detail, left, y + 61, { spec: '400 14px', color: p.muted });
    const need = m.needPerDay === null ? '—' : `${shortFans(m.needPerDay, true)}/day`;
    const needWidth = text(ctx, need, right, y + 61, { spec: '700 14px', color: p.text, align: 'right' });
    text(ctx, 'needs ', right - needWidth, y + 61, { spec: '400 14px', color: p.muted, align: 'right' });
}

/**
 * Draws the behind card, `h` tall, in up to `maxColumns` columns; with
 * nobody behind, says so instead. Past `FULL_BEHIND` members the entries go
 * compact, so a long list stays readable.
 */
function drawBehindCard(ctx: SKRSContext2D, members: MemberProgress[], x: number, y: number, w: number, h: number, maxColumns: number, d: Prepared) {
    const { p } = d;
    card(ctx, x, y, w, h, p);
    const pad = 22;
    if (members.length === 0 && d.progress.members.length === 0) {
        text(ctx, 'No data yet', x + pad, y + 34, { spec: '700 17px', color: p.muted });
        text(ctx, 'Nothing to judge until the first day is in.', x + pad, y + 58, { spec: '400 14px', color: p.muted });
        return;
    }
    if (members.length === 0) {
        text(ctx, 'Everyone is on pace', x + pad, y + 34, { spec: '700 17px', color: p.good });
        text(ctx, 'Nobody is behind what is expected by now.', x + pad, y + 58, { spec: '400 14px', color: p.muted });
        return;
    }
    const titleWidth = text(ctx, `Behind pace · ${members.length}`, x + pad, y + 34, { spec: '700 17px', color: p.behind });
    // The colour key beside the title, where it fits (it does in both layouts).
    const key = 'cream <1 day · red more';
    ctx.font = font('400 12px');
    if (ctx.measureText(key).width < w - pad * 2 - titleWidth - 16) {
        text(ctx, key, x + w - pad, y + 34, { spec: '400 12px', color: p.muted, align: 'right' });
    }
    const grid = behindGrid(members.length, maxColumns);
    const columnW = (w - 16 - (grid.columns - 1) * 8) / grid.columns;
    const entry = flexRow(grid.entry, grid.rows, h - CARD_TITLE - 10, 1.25);
    members.forEach((m, i) => {
        // Down the first column, then the next, so rank order reads downwards.
        const column = Math.floor(i / grid.rows);
        const row = i % grid.rows;
        const ex = x + 8 + column * (columnW + 8);
        const ey = y + CARD_TITLE + row * entry;
        if (grid.entry === BEHIND_COMPACT) drawBehindCompact(ctx, m, ex, ey, columnW, entry, row % 2 === 1, d);
        else drawBehindEntry(ctx, m, ex, ey, columnW, entry, row % 2 === 1, d);
    });
}

/** Height of one row in the closest-to-the-line card. */
const CLOSE_ROW = 34;
/** Height of one row in the wide sidebar's top gains. */
const TOP_ROW = 26;
/** Height of one figure row in the wide sidebar's day summary. */
const SUMMARY_ROW = 24;

/**
 * Draws the members on pace with the least to spare, fewest first: how far
 * ahead of what is expected by now, in fans and in days of quota.
 */
function drawClosestCard(ctx: SKRSContext2D, members: MemberProgress[], x: number, y: number, w: number, h: number, d: Prepared) {
    const { p, progress } = d;
    card(ctx, x, y, w, h, p);
    const pad = 22;
    text(ctx, 'Closest to the line', x + pad, y + 34, { spec: '700 17px', color: p.text });
    text(ctx, 'ahead of expected', x + w - pad, y + 34, { spec: '400 13px', color: p.muted, align: 'right' });
    const rowH = flexRow(CLOSE_ROW, members.length, h - CARD_TITLE - 12);
    members.forEach((m, i) => {
        const rowY = y + CARD_TITLE + i * rowH;
        if (i % 2 === 1) fillRound(ctx, x + 8, rowY, w - 16, rowH, innerRadius(p), p.stripe);
        const by = rowY + rowH / 2 + 6;
        const cushion = Math.max(0, m.total - m.expected);
        const ahead = `+${shortFans(cushion)}`;
        const aheadWidth = text(ctx, ahead, x + w - pad, by, { spec: '700 15px', color: p.good, align: 'right' });
        const days = inDays(cushion, progress.quotaPerDay);
        ctx.font = font('400 13px');
        const daysWidth = ctx.measureText(days).width;
        text(ctx, days, x + w - pad - aheadWidth - 12, by, { spec: '400 13px', color: p.muted, align: 'right' });
        const rankWidth = text(ctx, `#${m.rank}`, x + pad, by, { spec: '400 14px', color: p.muted });
        const nameX = x + pad + rankWidth + 10;
        const nameMax = x + w - pad - aheadWidth - 12 - daysWidth - 14 - nameX;
        text(ctx, fit(ctx, m.trainerName, nameMax, '400 16px'), nameX, by, { spec: '400 16px', color: p.text });
    });
}

// ─── Rank band ──────────────────────────────────────────────────────────────

/** Height of the rank band block: stacked in the sidebar, or one row wide in the tall header. */
function rankBandHeight(band: RankBand, inline: boolean): number {
    const bar = bandEnds(band) !== null;
    if (inline) return bar ? 66 : 40;
    return bar ? 104 : 22 + (band.above ? 22 : 0) + (band.below ? 22 : 0);
}

/** Both edges' points, when the bar can be drawn between them. */
function bandEnds(band: RankBand): { low: number; high: number } | null {
    const low = band.below?.points ?? null;
    const high = band.above?.points ?? null;
    return low !== null && high !== null && high > low ? { low, high } : null;
}

/**
 * Draws where the club sits in its rank band: a bar from the band's bottom
 * place (left) to its top (right) with the club marked on it, then the fans
 * still needed to reach the place above and the cushion over the place
 * below. `inline` lays it out as one wide row, for the tall header.
 */
function drawRankBand(ctx: SKRSContext2D, band: RankBand, x: number, y: number, w: number, p: Palette, inline: boolean) {
    const from = band.above ? band.above.rank + 1 : 1;
    const title = band.below ? `${band.tier} band · #${from}–${band.below.rank}` : `Past #${band.above?.rank ?? ''} · ${band.tier}`;
    label(ctx, title, x, y + 12, 13, p.muted, p);

    const toAbove = band.above && band.above.points !== null ? band.above.points - band.points : null;
    const overBelow = band.below && band.below.points !== null ? band.points - band.below.points : null;
    const up = band.above
        ? {
              name: `To #${band.above.rank} (${band.above.tier})`,
              value: toAbove === null ? '—' : toAbove > 0 ? `+${shortFans(toAbove)}` : 'reached',
              color: toAbove === null ? p.faint : toAbove > 0 ? p.target : p.good,
          }
        : null;
    const down = band.below
        ? {
              name: `Over #${band.below.rank} (${band.below.tier})`,
              value: overBelow === null ? '—' : overBelow >= 0 ? `+${shortFans(overBelow)}` : `−${shortFans(-overBelow)}`,
              color: overBelow === null ? p.faint : overBelow >= 0 ? p.good : p.behind,
          }
        : null;

    let rowY = y + 22;
    const ends = bandEnds(band);
    if (ends) {
        const barY = y + 24;
        const ratio = Math.max(0, Math.min(1, (band.points - ends.low) / (ends.high - ends.low)));
        fillRound(ctx, x, barY, w, 6, 3, p.line);
        fillRound(ctx, x, barY, Math.max(6, w * ratio), 6, 3, p.accent);
        ctx.beginPath();
        ctx.arc(x + w * ratio, barY + 3, 6, 0, Math.PI * 2);
        ctx.fillStyle = p.text;
        ctx.fill();
        text(ctx, `#${band.below!.rank}`, x, barY + 24, { spec: '400 12px', color: p.muted });
        text(ctx, `#${band.above!.rank}`, x + w, barY + 24, { spec: '400 12px', color: p.muted, align: 'right' });
        rowY = barY + 34;
    }

    if (inline) {
        // One row: the cushion below on the left, the gap above on the right.
        const by = rowY + 16;
        if (down) {
            const nw = text(ctx, `${down.name} `, x, by, { spec: '400 14px', color: p.muted });
            text(ctx, down.value, x + nw, by, { spec: '700 15px', color: down.color });
        }
        if (up) {
            const vw = text(ctx, up.value, x + w, by, { spec: '700 15px', color: up.color, align: 'right' });
            text(ctx, `${up.name} `, x + w - vw, by, { spec: '400 14px', color: p.muted, align: 'right' });
        }
        return;
    }
    for (const row of [up, down]) {
        if (!row) continue;
        text(ctx, row.name, x, rowY + 16, { spec: '400 14px', color: p.muted });
        text(ctx, row.value, x + w, rowY + 16, { spec: '700 15px', color: row.color, align: 'right' });
        rowY += 22;
    }
}

// ─── Layouts ────────────────────────────────────────────────────────────────

/** What both layouts need, worked out once. */
interface Prepared {
    progress: CircleProgress;
    meta: FanReportMeta;
    p: Palette;
    avatar: Image | null;
    badge: Image | null;
    /** Members on pace, in rank order. */
    onPace: MemberProgress[];
    /** Members behind, in rank order. */
    behind: MemberProgress[];
    recentLabel: string;
    recentOf: (m: MemberProgress) => number | null;
    empty: string;
    notes: string[];
}

/**
 * Wraps the date and member count under the club's name. The period and day
 * are not repeated here: the figures below already say them.
 */
function identityLines(ctx: SKRSContext2D, d: Pick<Prepared, 'meta'>, width: number): string[] {
    return wrap(ctx, [d.meta.dateLabel, `${d.meta.memberCount} members`], width, '400 14px');
}

/** Height of the identity block: the image, or the name and lines beside it. */
function identityHeight(size: number, nameSize: number, lines: string[]): number {
    return Math.max(size, nameSize + 6 + lines.length * 19);
}

/** Draws the club image, then its name with the date and member count under it. */
function drawIdentity(ctx: SKRSContext2D, d: Prepared, x: number, y: number, size: number, textWidth: number, lines: string[], nameSize: number): void {
    const { p, meta } = d;
    drawSlot(ctx, d.avatar, x, y, size, p, meta.circleName.slice(0, 1).toUpperCase(), true);
    const tx = x + size + 16;
    // Centred on the image when it is the taller of the two.
    const blockH = nameSize + 6 + lines.length * 19;
    const ty = y + Math.max(0, (size - blockH) / 2);
    // A long name steps down in size before it is cut short.
    let fitted = nameSize;
    ctx.font = font(`700 ${fitted}px`);
    while (fitted > Math.round(nameSize * 0.7) && ctx.measureText(meta.circleName).width > textWidth) {
        fitted -= 1;
        ctx.font = font(`700 ${fitted}px`);
    }
    text(ctx, fit(ctx, meta.circleName, textWidth, `700 ${fitted}px`), tx, ty + nameSize, { spec: `700 ${fitted}px`, color: p.text });
    lines.forEach((line, i) => text(ctx, line, tx, ty + nameSize + 22 + i * 19, { spec: '400 14px', color: p.muted }));
}

/** The monthly rank, right-aligned at `right`, with its caption. */
function drawRank(ctx: SKRSContext2D, d: Prepared, right: number, y: number, align: 'left' | 'right') {
    const rank = d.meta.monthlyRank === null ? 'Unranked' : `#${d.meta.monthlyRank}`;
    text(ctx, rank, right, y + 32, { spec: '700 30px', color: d.p.text, align });
    label(ctx, 'monthly rank', right, y + 54, 14, d.p.muted, d.p, align);
}

/** The phone layout: header, on-pace table, behind card, footer, top to bottom. */
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
    const band = d.meta.rankBand ?? null;
    const bandH = band ? rankBandHeight(band, true) + 12 : 0;
    const headerH = PAD + identityH + 22 + 70 + 22 + 40 + bandH + PAD - 8;

    const c = columns(cardX, cardW, false);
    const tableH = tableHeight(d.onPace.length, c);
    const behindH = d.behind.length > 0 ? behindHeight(d.behind.length, 2) : 0;
    const notes = wrapWords(measure, d.notes, cardW - PAD * 2, '400 13px');
    const footerH = notes.length > 0 ? 16 + notes.length * 19 + 14 + GAP : 0;
    const height = FRAME + headerH + GAP + tableH + (behindH > 0 ? GAP + behindH : 0) + footerH + FRAME;

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
    headerStats(progress).forEach((s, i) => drawStat(ctx, s, cardX + PAD + third * i, statsY, third - 16, p, false));
    drawProgress(ctx, progress, cardX + PAD, statsY + 70 + 22, cardW - PAD * 2, p, false);
    if (band) drawRankBand(ctx, band, cardX + PAD, statsY + 70 + 22 + 40 + 12, cardW - PAD * 2, p, true);
    y += headerH + GAP;

    drawTable(ctx, d.onPace, cardX, cardW, y, tableH, c, d);
    y += tableH + GAP;
    if (behindH > 0) {
        drawBehindCard(ctx, d.behind, cardX, y, cardW, behindH, 2, d);
        y += behindH + GAP;
    }

    if (footerH > 0) {
        card(ctx, cardX, y, cardW, footerH - GAP, p);
        notes.forEach((line, i) => text(ctx, line, cardX + PAD, y + 28 + i * 19, { spec: '400 13px', color: p.muted }));
    }

    return canvas.encode('png');
}

/**
 * The landscape layout, three panels of equal height: a sidebar (club,
 * rank, figures, progress, the day's summary and best gains), the
 * on-pace table, and the behind card. The members closest to the line fill
 * the height left under whichever of the table and behind card is shorter.
 */
function renderWide(d: Prepared): Buffer | Promise<Buffer> {
    const { p, progress } = d;
    const width = WIDE_WIDTH;
    const sideX = FRAME;
    const sideW = SIDEBAR_WIDTH;
    const sidePad = 22;
    const inner = sideW - sidePad * 2;
    const rightW = RIGHT_PANEL_WIDTH;
    const tableX = sideX + sideW + GAP;
    const tableW = width - FRAME * 2 - sideW - rightW - GAP * 2;
    const rightX = tableX + tableW + GAP;
    const slot = 56;

    const measure = createCanvas(1, 1).getContext('2d');
    const textWidth = inner - slot - 16;
    const lines = identityLines(measure, d, textWidth);
    const notes = wrapWords(measure, d.notes, inner, '400 12px');

    const c = { ...columns(tableX, tableW, false), rowHeight: 36 };
    const tableH = tableHeight(d.onPace.length, c);

    // Sidebar contents: identity, rule, rank and its band, rule, 2×2
    // figures, progress, rule, the day's summary and its top 3, any notes.
    const identityH = identityHeight(slot, 22, lines);
    const band = d.meta.rankBand ?? null;
    const bandH = band ? rankBandHeight(band, false) + 12 : 0;
    const listsH = 30 + 3 * SUMMARY_ROW + 12 + 26 + 3 * TOP_ROW;
    const sideMin =
        sidePad + identityH + 19 + 18 + slot + 18 + bandH + 19 + 2 * 64 + 14 + 44 + 19 + listsH +
        (notes.length > 0 ? 18 + notes.length * 17 : 0) + sidePad;

    // Where the behind card goes, whichever arrangement is shortest:
    //   right   beside the table, with the closest to the line under the
    //           shorter of the two (few or some behind)
    //   under   across the middle and right in three columns, under the
    //           table and the closest to the line side by side (more behind
    //           than the right column can hold)
    //   span    the same with nothing above it (nobody on pace, so there is
    //           no table and no one close to the line)
    const n = d.behind.length;
    const behindRight = n > 0 ? behindHeight(n, 1) : 76;
    const closestMin = d.onPace.length > 0 ? CARD_TITLE + Math.min(3, d.onPace.length) * CLOSE_ROW + 12 : 0;
    const closestUnderTable = behindRight > tableH;
    const rightH = Math.max(
        sideMin,
        (closestUnderTable ? tableH : behindRight) + (closestMin > 0 ? GAP + closestMin : 0),
        closestUnderTable ? behindRight : tableH,
    );
    const topH = Math.max(tableH, closestMin);
    const underH = n > FULL_BEHIND ? Math.max(sideMin, topH + GAP + behindHeight(n, 3)) : Infinity;
    const mode: 'right' | 'under' | 'span' = n > 0 && d.onPace.length === 0 ? 'span' : underH < rightH ? 'under' : 'right';
    const contentH = mode === 'span' ? Math.max(sideMin, behindHeight(n, 3)) : mode === 'under' ? underH : rightH;
    const height = FRAME * 2 + contentH;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, width, height, p);

    // Sidebar.
    card(ctx, sideX, FRAME, sideW, contentH, p);
    const x = sideX + sidePad;
    let y = FRAME + sidePad;
    drawIdentity(ctx, d, x, y, slot, textWidth, lines, 22);
    y += identityH + 18;
    const rule = () => {
        ctx.fillStyle = p.line;
        ctx.fillRect(x, y, inner, 1);
        y += 1 + 18;
    };
    rule();
    drawSlot(ctx, d.badge, x, y, slot, p, '?', false);
    drawRank(ctx, d, x + slot + 16, y, 'left');
    y += slot + 18;
    if (band) {
        drawRankBand(ctx, band, x, y, inner, p, false);
        y += bandH;
    }
    rule();
    const half = (inner - 16) / 2;
    const stats = [
        ...headerStats(progress),
        { label: 'On pace', value: `${progress.onPaceCount}/${progress.members.length}`, note: 'members' },
    ];
    stats.forEach((s, i) => drawStat(ctx, s, x + (i % 2) * (half + 16), y + Math.floor(i / 2) * 64, half, p, true));
    y += 2 * 64 + 14;
    drawProgress(ctx, progress, x, y, inner, p, null);
    y += 44;
    rule();

    // The day: club gain, per member, how many hit the daily quota, then its
    // top 3. Spare height spreads the rows out a little (see `flexRow`).
    const notesTop = FRAME + contentH - sidePad - notes.length * 17;
    const spare = notesTop - (notes.length > 0 ? 18 : 0) - y - listsH;
    const stretch = Math.max(1, Math.min(1.35, 1 + spare / (3 * SUMMARY_ROW + 3 * TOP_ROW)));
    const gains = progress.members.map((m) => ({ m, gain: d.recentOf(m) ?? 0 }));
    const clubGain = gains.reduce((sum, g) => sum + g.gain, 0);
    const hit = gains.filter((g) => g.gain >= progress.quotaPerDay).length;
    label(ctx, d.recentLabel, x, y + 12, 13, p.muted, p);
    y += 30;
    const summary: [string, string][] = [
        ['Club gain', `+${shortFans(clubGain)}`],
        ['Per member', `+${shortFans(gains.length > 0 ? Math.round(clubGain / gains.length) : 0)}`],
        [`Hit ${shortFans(progress.quotaPerDay)}`, `${hit}/${gains.length}`],
    ];
    for (const [name, value] of summary) {
        const by = y + (SUMMARY_ROW * stretch) / 2 + 5;
        text(ctx, name, x, by, { spec: '400 14px', color: p.muted });
        text(ctx, value, x + inner, by, { spec: '700 15px', color: p.text, align: 'right' });
        y += SUMMARY_ROW * stretch;
    }
    y += 12;
    // The day's top 3, not the month's: those lead the table already.
    label(ctx, `Top 3 · ${d.recentLabel}`, x, y + 14, 13, p.muted, p);
    y += 26;
    const best = gains.filter((g) => g.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
    best.forEach((t, i) => {
        const by = y + (TOP_ROW * stretch) / 2 + 5;
        const gainWidth = text(ctx, `+${shortFans(t.gain)}`, x + inner, by, { spec: '700 15px', color: p.good, align: 'right' });
        const placeWidth = text(ctx, `${i + 1}.`, x, by, { spec: '700 14px', color: p.muted });
        const rankWidth = text(ctx, `#${t.m.rank}`, x + placeWidth + 8, by, { spec: '400 12px', color: p.faint });
        const nameX = x + placeWidth + 8 + rankWidth + 8;
        text(ctx, fit(ctx, t.m.trainerName, x + inner - gainWidth - 12 - nameX, '400 15px'), nameX, by, { spec: '400 15px', color: p.text });
        y += TOP_ROW * stretch;
    });
    notes.forEach((line, i) => text(ctx, line, x, notesTop + 12 + i * 17, { spec: '400 12px', color: p.muted }));

    // On-pace table and behind card, with the closest to the line under the
    // shorter of the two, filling it to the full height.
    const closestFor = (top: number, x: number, w: number, bottom = FRAME + contentH) => {
        const rows = Math.min(d.onPace.length, Math.floor((bottom - top - CARD_TITLE - 12) / CLOSE_ROW));
        if (rows <= 0) return false;
        const closest = [...d.onPace].sort((a, b) => a.total - a.expected - (b.total - b.expected)).slice(0, rows);
        drawClosestCard(ctx, closest, x, top, w, bottom - top, d);
        return true;
    };
    if (mode === 'span') {
        drawBehindCard(ctx, d.behind, tableX, FRAME, tableW + GAP + rightW, contentH, 3, d);
    } else if (mode === 'under') {
        drawTable(ctx, d.onPace, tableX, tableW, FRAME, topH, c, d);
        closestFor(FRAME, rightX, rightW, FRAME + topH);
        drawBehindCard(ctx, d.behind, tableX, FRAME + topH + GAP, tableW + GAP + rightW, contentH - topH - GAP, 3, d);
    } else if (closestUnderTable) {
        drawBehindCard(ctx, d.behind, rightX, FRAME, rightW, contentH, 1, d);
        const shown = closestFor(FRAME + tableH + GAP, tableX, tableW);
        drawTable(ctx, d.onPace, tableX, tableW, FRAME, shown ? tableH : contentH, c, d);
    } else {
        drawTable(ctx, d.onPace, tableX, tableW, FRAME, contentH, c, d);
        const shown = closestFor(FRAME + behindRight + GAP, rightX, rightW);
        drawBehindCard(ctx, d.behind, rightX, FRAME, rightW, shown ? behindRight : contentH, 1, d);
    }

    return canvas.encode('png');
}

/** Full month names, shortened to three letters in the report's date: "Oct 24, 2026". */
const MONTH_NAMES = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

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
        meta: { ...meta, dateLabel: meta.dateLabel.replace(MONTH_NAMES, (name) => name.slice(0, 3)) },
        p: palette,
        avatar: await loadClubIcon(meta.circleName),
        badge: meta.clubRank ? await loadRankIcon(meta.clubRank) : null,
        onPace: progress.members.filter((m) => m.onPace),
        behind: progress.members.filter((m) => !m.onPace),
        recentLabel: last24h ? `Last 24h${last24h.overlapsFreeze ? '*' : ''}` : `Day ${day}`,
        recentOf: (m) => (last24h ? (last24h.gains.get(m.viewerId) ?? null) : progress.finishedDay > 0 ? m.finishedDayGain : m.latestDayGain),
        empty: progress.members.length === 0 ? 'No fan data ingested for this month yet.' : 'Nobody is on pace yet.',
        notes: footerNotes(last24h),
    };
    return layout === 'wide' ? renderWide(prepared) : renderTall(prepared);
}
