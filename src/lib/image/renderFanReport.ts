import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank } from '@prisma/client';
import { PALETTES, DEFAULT_PALETTE, dashNum, type Palette } from './theme';
import { sansFont } from './fonts';
import { loadClubIcon, loadRankIcon } from './canvasUtils';
import type { LastDayGains } from '../fans/readings';
import { describeQuota, formatMillionsFans, periodAdjective, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard, as rounded cards on a coloured frame.
 *
 *   header   club image, name, date and members, the report line; monthly
 *            rank and the club's rank badge on the right; quota, expected and
 *            next-due figures; the club's progress bar
 *   on pace  one row per member on pace, ranked by month-to-date total
 *   behind   the members behind, in their own card, names cream when less
 *            than one day's quota short and red when more
 *   footer   what the columns and colours mean
 *
 * Figures are compact ("107.93M", "+7.08M") in a proportional face with
 * tabular digits, so columns line up and read at phone size. Expected is the
 * same for everyone who was in the circle all period, so it is one header
 * figure; the Days column shows who joined late and so owes less.
 *
 * Laid out after the ChronoGenesis club page the club pointed to on
 * 2026-10-24, keeping this report's own header placement and columns.
 */

const WIDTH = 900;
/** Frame visible around and between the cards. */
const FRAME = 16;
const GAP = 12;
const RADIUS = 16;
/** Padding inside a card. */
const PAD = 24;
const ROW_HEIGHT = 40;
const HEADING_HEIGHT = 36;
/** Club image and rank badge size. */
const SLOT = 72;
/** Room on the header's right for the monthly rank, left of the badge. */
const RANK_BLOCK = 170;

const CARD_X = FRAME;
const CARD_W = WIDTH - FRAME * 2;
const RIGHT = CARD_X + CARD_W - PAD;
/** Where the club's name and report line start, right of its image. */
const HEADER_TEXT_X = CARD_X + PAD + SLOT + 18;
const HEADER_TEXT_WIDTH = RIGHT - SLOT - RANK_BLOCK - HEADER_TEXT_X;

/** Column anchors. Numeric columns right-align on these. */
const COL = {
    rank: CARD_X + PAD + 30,
    trainer: CARD_X + PAD + 46,
    avg: 488,
    total: 610,
    recent: 718,
    target: 808,
    days: RIGHT,
} as const;

/** Widest a trainer name may draw, leaving room for its rank movement. */
const MAX_NAME_WIDTH = COL.avg - 90 - COL.trainer;

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

/** Text drawing options for this report's sans face. */
interface Ink {
    spec: string;
    color: string;
    align?: 'left' | 'right' | 'center';
}

/** Draws text in the sans face and returns its width. */
function text(ctx: SKRSContext2D, value: string, x: number, y: number, ink: Ink): number {
    ctx.font = sansFont(ink.spec);
    ctx.fillStyle = ink.color;
    ctx.textAlign = ink.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
}

/** Truncates with an ellipsis until the text fits, measured in `spec`. */
function fit(ctx: SKRSContext2D, value: string, maxWidth: number, spec: string): string {
    ctx.font = sansFont(spec);
    let out = value;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/** Joins parts with " · " into lines that fit `maxWidth` in `spec`. */
function wrap(ctx: SKRSContext2D, parts: string[], maxWidth: number, spec: string): string[] {
    ctx.font = sansFont(spec);
    const lines: string[] = [];
    let line = '';
    for (const part of parts) {
        const next = line ? `${line} · ${part}` : part;
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

/** Fills a rounded rectangle. */
function card(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string, r = RADIUS) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

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

/**
 * Draws an image in a `SLOT`-sized square, clipped to a circle when `round`,
 * or an empty circle with `placeholder` when there is no image. The empty
 * slot keeps the layout the same with or without a picture.
 */
function drawSlot(ctx: SKRSContext2D, image: Image | null, x: number, y: number, p: Palette, placeholder: string, round: boolean) {
    const r = SLOT / 2;
    if (image) {
        ctx.save();
        if (round) {
            ctx.beginPath();
            ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
            ctx.clip();
        }
        // Fit inside the slot, keeping the aspect ratio.
        const scale = Math.min(SLOT / image.width, SLOT / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, x + (SLOT - w) / 2, y + (SLOT - h) / 2, w, h);
        ctx.restore();
        return;
    }
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.fillStyle = p.panel;
    ctx.fill();
    text(ctx, placeholder, x + r, y + r + 9, { spec: '700 26px', color: p.faint, align: 'center' });
}

/** Parts of the report line under the club's name. */
function reportLine(p: CircleProgress): string[] {
    const parts = [`${periodAdjective(p.period).toLowerCase()} report`];
    if (p.period !== 'DAY') parts.push(p.windowLabel.toLowerCase());
    parts.push(`day ${p.daysElapsed} of ${p.daysInMonth}`);
    return parts;
}

/** The three header figures: quota, expected by now, and what is due next. */
function headerStats(progress: CircleProgress): { label: string; value: string; note: string }[] {
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
        { label: 'Expected now', value: shortFans(expected), note: `day ${judged}` },
        next,
    ];
}

/** Vertical layout of the header card, from its top. */
function headerLayout(lines: number) {
    const identity = Math.max(SLOT, 70 + lines * 20);
    const statsY = PAD + identity + 24;
    const barY = statsY + 80;
    return { statsY, barY, height: barY + 32 + PAD };
}

/** Draws the header card at `y`. */
async function drawHeader(ctx: SKRSContext2D, progress: CircleProgress, meta: FanReportMeta, lines: string[], y: number, p: Palette) {
    const layout = headerLayout(lines.length);
    card(ctx, CARD_X, y, CARD_W, layout.height, p.bg);
    const top = y + PAD;

    // Club image, then name, date and members, then the report line.
    const avatar = await loadClubIcon(meta.circleName);
    drawSlot(ctx, avatar, CARD_X + PAD, top, p, meta.circleName.slice(0, 1).toUpperCase(), true);
    text(ctx, fit(ctx, meta.circleName, HEADER_TEXT_WIDTH, '700 30px'), HEADER_TEXT_X, top + 30, { spec: '700 30px', color: p.text });
    text(ctx, `${meta.dateLabel} · ${meta.memberCount} members`, HEADER_TEXT_X, top + 54, { spec: '400 15px', color: p.muted });
    lines.forEach((line, i) => text(ctx, line, HEADER_TEXT_X, top + 78 + i * 20, { spec: '400 15px', color: p.accent }));

    // Monthly rank, then the club's rank badge in the corner.
    const badgeX = RIGHT - SLOT;
    const badge = meta.clubRank ? await loadRankIcon(meta.clubRank) : null;
    drawSlot(ctx, badge, badgeX, top, p, '?', false);
    const rankLabel = meta.monthlyRank === null ? 'Unranked' : `#${meta.monthlyRank}`;
    text(ctx, rankLabel, badgeX - 16, top + 34, { spec: '700 30px', color: p.text, align: 'right' });
    text(ctx, 'monthly rank', badgeX - 16, top + 56, { spec: '400 14px', color: p.muted, align: 'right' });

    // Quota, expected, next due: three equal columns.
    const statsY = y + layout.statsY;
    const third = (CARD_W - PAD * 2) / 3;
    headerStats(progress).forEach((s, i) => {
        const x = CARD_X + PAD + third * i;
        text(ctx, s.label, x, statsY + 14, { spec: '400 14px', color: p.muted });
        const w = text(ctx, s.value, x, statsY + 42, { spec: '700 22px', color: p.text });
        text(ctx, fit(ctx, s.note, third - w - 20, '400 14px'), x + w + 8, statsY + 42, { spec: '400 14px', color: p.muted });
    });

    // Club progress: fans against what the club owes by month end, with a tick
    // where it should be by now.
    const barY = y + layout.barY;
    const barW = CARD_W - PAD * 2;
    const ratio = progress.quotaTarget > 0 ? Math.min(1, progress.totalFans / progress.quotaTarget) : 0;
    const due = progress.members.reduce((sum, m) => sum + m.expected, 0);
    const dueRatio = progress.quotaTarget > 0 ? Math.min(1, due / progress.quotaTarget) : 0;
    card(ctx, CARD_X + PAD, barY, barW, 8, p.line, 4);
    if (ratio > 0) card(ctx, CARD_X + PAD, barY, Math.max(8, barW * ratio), 8, p.accent, 4);
    ctx.fillStyle = p.text;
    ctx.fillRect(CARD_X + PAD + barW * dueRatio - 1, barY - 5, 2, 18);
    const pct = progress.quotaTarget > 0 ? ((progress.totalFans / progress.quotaTarget) * 100).toFixed(1) : '0.0';
    text(ctx, `${formatMillionsFans(progress.totalFans)} of ${formatMillionsFans(progress.quotaTarget)} · ${pct}%`, CARD_X + PAD, barY + 32, {
        spec: '400 15px',
        color: p.muted,
    });
    text(ctx, `${progress.onPaceCount} of ${progress.members.length} on pace`, RIGHT, barY + 32, { spec: '400 15px', color: p.muted, align: 'right' });
}

/** Column headings in the strip at the top of the on-pace card. */
function drawHeadings(ctx: SKRSContext2D, y: number, recentLabel: string, p: Palette) {
    card(ctx, CARD_X + 8, y + 8, CARD_W - 16, HEADING_HEIGHT - 4, p.panel, 10);
    const by = y + 8 + 22;
    const ink = { spec: '400 14px', color: p.muted };
    text(ctx, '#', COL.rank, by, { ...ink, align: 'right' });
    text(ctx, 'Trainer', COL.trainer, by, ink);
    text(ctx, 'Avg/day', COL.avg, by, { ...ink, align: 'right' });
    text(ctx, 'Total', COL.total, by, { ...ink, align: 'right' });
    text(ctx, recentLabel, COL.recent, by, { ...ink, align: 'right' });
    text(ctx, 'Target', COL.target, by, { ...ink, align: 'right' });
    text(ctx, 'Days', COL.days, by, { ...ink, align: 'right' });
}

/**
 * Draws one member row. `recent` is the last-24h figure, or the latest game
 * day's; `striped` shades the row; `dayQuota` is one day's quota, the line
 * between a cream and a red name.
 */
function drawRow(ctx: SKRSContext2D, m: MemberProgress, y: number, recent: number | null, striped: boolean, dayQuota: number, p: Palette) {
    if (striped) card(ctx, CARD_X + 8, y, CARD_W - 16, ROW_HEIGHT, p.stripe, 8);
    const by = y + ROW_HEIGHT / 2 + 7;
    const tint = p.place[m.rank - 1] ?? null;

    // Left bar: placement for the top four.
    if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(CARD_X + 12, y + 8, 3, ROW_HEIGHT - 16);
    }

    text(ctx, String(m.rank), COL.rank, by, { spec: '400 18px', color: p.muted, align: 'right' });

    const nameColor = m.onPace ? (tint ?? p.text) : m.behind < dayQuota ? p.warn : p.behind;
    const nameWidth = text(ctx, fit(ctx, m.trainerName, MAX_NAME_WIDTH, '400 19px'), COL.trainer, by, { spec: '400 19px', color: nameColor });
    if (m.rankChange !== null && m.rankChange !== 0) {
        text(ctx, `${m.rankChange > 0 ? '▲' : '▼'}${Math.abs(m.rankChange)}`, COL.trainer + nameWidth + 8, by - 1, {
            spec: '400 12px',
            // A slip is not "behind", so it does not borrow that colour.
            color: m.rankChange > 0 ? p.good : p.muted,
        });
    }

    text(ctx, shortFans(m.avgPerDay), COL.avg, by, { spec: '400 18px', color: p.text, align: 'right' });
    text(ctx, shortFans(m.total), COL.total, by, { spec: '700 18px', color: p.text, align: 'right' });
    text(ctx, recent === null ? '—' : `+${shortFans(recent)}`, COL.recent, by, { spec: '400 16px', color: recent ? p.muted : p.faint, align: 'right' });
    text(ctx, m.needPerDay === null ? '—' : shortFans(m.needPerDay, true), COL.target, by, {
        spec: m.onPace ? '400 16px' : '700 16px',
        color: m.needPerDay === null ? p.faint : m.onPace ? p.target : p.behind,
        align: 'right',
    });
    text(ctx, dashNum(m.dataDays), COL.days, by, { spec: '400 16px', color: p.muted, align: 'right' });
}

/** Footer lines: what the target, days and colours mean. */
function footerLines(progress: CircleProgress, last24h: LastDayGains | null): string[] {
    const until = progress.period === 'MONTH' ? 'until month end' : `until the day ${progress.nextCheckpointDay} check`;
    const lines = [
        `Target: fans a day ${until}, the whole amount, not extra on top of pace.`,
        'Days: days in the circle this month. Behind: cream is under one day of quota short, red is more.',
    ];
    if (last24h?.overlapsFreeze) lines.push('* Last 24h includes the 1st, 17:00–24:00 JST, when fans do not count.');
    return lines;
}

/**
 * Renders the report as a PNG.
 *
 * @param palette Colours to draw in; the default palette when omitted.
 */
export async function renderFanReport(progress: CircleProgress, meta: FanReportMeta, palette: Palette = PALETTES[DEFAULT_PALETTE]!): Promise<Buffer> {
    const p = palette;
    const last24h = meta.last24h ?? null;

    // Measure first: the header's report line may wrap.
    const lines = wrap(createCanvas(1, 1).getContext('2d'), reportLine(progress), HEADER_TEXT_WIDTH, '400 15px');
    const onPace = progress.members.filter((m) => m.onPace);
    const behind = progress.members.filter((m) => !m.onPace);
    const footer = footerLines(progress, last24h);

    const headerH = headerLayout(lines.length).height;
    const onPaceH = HEADING_HEIGHT + 12 + Math.max(onPace.length, 1) * ROW_HEIGHT + 12;
    const behindH = behind.length > 0 ? 44 + behind.length * ROW_HEIGHT + 12 : 0;
    const footerH = 18 + footer.length * 20 + 12;
    const height = FRAME + headerH + GAP + onPaceH + (behindH > 0 ? GAP + behindH : 0) + GAP + footerH + FRAME;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const frame = ctx.createLinearGradient(0, 0, 0, height);
    frame.addColorStop(0, p.frame);
    frame.addColorStop(1, p.frameEnd);
    ctx.fillStyle = frame;
    ctx.fillRect(0, 0, WIDTH, height);

    let y = FRAME;
    await drawHeader(ctx, progress, meta, lines, y, p);
    y += headerH + GAP;

    // A finished day when there is one; on a month's first day, the day so far.
    const day = progress.finishedDay > 0 ? progress.finishedDay : progress.daysElapsed;
    const recentLabel = last24h ? `Last 24h${last24h.overlapsFreeze ? '*' : ''}` : `Day ${day}`;
    const recentOf = (m: MemberProgress) =>
        last24h ? (last24h.gains.get(m.viewerId) ?? null) : progress.finishedDay > 0 ? m.finishedDayGain : m.latestDayGain;

    card(ctx, CARD_X, y, CARD_W, onPaceH, p.bg);
    drawHeadings(ctx, y, recentLabel, p);
    let rowY = y + HEADING_HEIGHT + 12;
    if (onPace.length === 0) {
        const empty = progress.members.length === 0 ? 'No fan data ingested for this month yet.' : 'Nobody is on pace yet.';
        text(ctx, empty, COL.trainer, rowY + 26, { spec: '400 17px', color: p.faint });
    }
    onPace.forEach((m, i) => {
        drawRow(ctx, m, rowY, recentOf(m), i % 2 === 1, progress.quotaPerDay, p);
        rowY += ROW_HEIGHT;
    });
    y += onPaceH + GAP;

    if (behindH > 0) {
        card(ctx, CARD_X, y, CARD_W, behindH, p.bg);
        text(ctx, `Behind pace · ${behind.length}`, CARD_X + PAD, y + 30, { spec: '700 16px', color: p.behind });
        rowY = y + 44;
        behind.forEach((m, i) => {
            drawRow(ctx, m, rowY, recentOf(m), i % 2 === 1, progress.quotaPerDay, p);
            rowY += ROW_HEIGHT;
        });
        y += behindH + GAP;
    }

    card(ctx, CARD_X, y, CARD_W, footerH, p.bg);
    footer.forEach((line, i) => text(ctx, line, CARD_X + PAD, y + 28 + i * 20, { spec: '400 13px', color: p.muted }));

    return canvas.encode('png');
}
