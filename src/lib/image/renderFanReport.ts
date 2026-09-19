import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { THEME, dashNum, drawLabel, drawRule, drawText, placeColor } from './theme';
import { font } from './fonts';
import { formatCompactFans, formatMillionsFans, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard.
 *
 * One row per member ranked by cumulative fans. Colour is spent sparingly:
 * gold for structure and the figure a trainer must hit, red for exactly one
 * meaning -- behind -- and placement tints for the top four. Empty cells show
 * an em dash rather than nothing, so a blank never reads as a missing value.
 *
 * Beyond the columns the reference report carried, each row gets a seven-day
 * trend sparkline and a straight-line month-end projection, and the header
 * shows the club's progress against its total quota. All of it derives from
 * data already ingested; nothing here costs an extra API call.
 */

const WIDTH = 1600;
const MARGIN = 40;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 196;
const COLUMN_HEADER_HEIGHT = 44;
const FOOTER_HEIGHT = 84;

/** Column anchors. Numeric columns right-align on these. */
const COL = {
    rank: 70,
    trainer: 120,
    trendLeft: 405,
    trendWidth: 96,
    total: 690,
    expected: 850,
    behind: 1000,
    avgDay: 1150,
    needDay: 1300,
    dayN: 1430,
    projected: WIDTH - MARGIN,
} as const;

/** Widest a trainer name may draw before truncation. */
const MAX_NAME_WIDTH = COL.trendLeft - COL.trainer - 24;

export interface FanReportMeta {
    circleName: string;
    monthlyRank: number | null;
    memberCount: number;
    /** e.g. "September 14, 2026" */
    dateLabel: string;
}

/** Truncates with an ellipsis until the text fits the given width. */
function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    let out = text;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/**
 * Draws a small trend line of recent daily gains.
 *
 * Scaled to the member's own range, so it shows the *shape* of their week --
 * ramping, steady, collapsing -- rather than their magnitude, which the
 * numbers beside it already give. The last point is marked so the eye lands on
 * where they are now.
 */
function drawSparkline(ctx: SKRSContext2D, gains: number[], x: number, cy: number, width: number) {
    const height = 18;
    if (gains.length < 2) {
        drawRule(ctx, x, cy, width, THEME.line, 1);
        return;
    }

    const max = Math.max(...gains);
    const min = Math.min(...gains);
    const span = max - min || 1;
    const step = width / (gains.length - 1);

    const points = gains.map((g, i) => ({
        px: x + i * step,
        py: cy + height / 2 - ((g - min) / span) * height,
    }));

    ctx.strokeStyle = THEME.muted;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py)));
    ctx.stroke();

    const last = points[points.length - 1]!;
    const previous = gains[gains.length - 2] ?? 0;
    const latest = gains[gains.length - 1] ?? 0;
    ctx.fillStyle = latest >= previous ? THEME.gold : THEME.red;
    ctx.beginPath();
    ctx.arc(last.px, last.py, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

/** Draws the club-wide quota progress bar with its labels. */
function drawClubProgress(ctx: SKRSContext2D, progress: CircleProgress, y: number) {
    const barX = MARGIN;
    const barWidth = WIDTH - MARGIN * 2;
    const ratio = progress.quotaTarget > 0 ? Math.min(1, progress.totalFans / progress.quotaTarget) : 0;
    const expectedRatio =
        progress.daysInMonth > 0 ? Math.min(1, progress.daysElapsed / progress.daysInMonth) : 0;

    drawRule(ctx, barX, y, barWidth, THEME.line, 4);
    drawRule(ctx, barX, y, barWidth * ratio, THEME.gold, 4);

    // A tick where the club *should* be today, so the bar reads as pace, not
    // just accumulation.
    ctx.fillStyle = THEME.text;
    ctx.fillRect(barX + barWidth * expectedRatio - 1, y - 4, 2, 12);

    const pct = progress.quotaTarget > 0 ? ((progress.totalFans / progress.quotaTarget) * 100).toFixed(1) : '0.0';
    drawText(ctx, `${formatMillionsFans(progress.totalFans)} of ${formatMillionsFans(progress.quotaTarget)} · ${pct}%`, barX, y + 26, {
        spec: '400 13px',
        color: THEME.muted,
    });
    drawText(
        ctx,
        `${progress.onPaceCount} of ${progress.members.length} on pace · projected ${formatMillionsFans(progress.projectedTotalFans)}`,
        barX + barWidth,
        y + 26,
        { spec: '400 13px', color: THEME.muted, align: 'right' },
    );
}

/** Draws one member row. */
function drawRow(ctx: SKRSContext2D, m: MemberProgress, y: number, quota: number) {
    const cy = y + ROW_HEIGHT / 2 + 6;
    const tint = placeColor(m.rank);

    // Left bar: placement for the top four, red for anyone behind.
    const bar = tint ?? (m.onPace ? null : THEME.red);
    if (bar) {
        ctx.fillStyle = bar;
        ctx.fillRect(MARGIN, y + 7, 3, ROW_HEIGHT - 14);
    }

    drawText(ctx, String(m.rank), COL.rank, cy, { spec: '400 15px', color: THEME.faint });
    if (m.rankChange !== null && m.rankChange !== 0) {
        const arrow = m.rankChange > 0 ? '↑' : '↓';
        drawText(ctx, `${arrow}${Math.abs(m.rankChange)}`, COL.rank + 26, cy, {
            spec: '400 12px',
            color: m.rankChange > 0 ? THEME.gold : THEME.red,
        });
    }

    // Measure with the same font the name is drawn in, or truncation is wrong.
    ctx.font = font('500 19px');
    drawText(ctx, fit(ctx, m.trainerName, MAX_NAME_WIDTH), COL.trainer, cy, {
        spec: '500 19px',
        color: tint ?? THEME.text,
    });

    drawSparkline(ctx, m.recentGains, COL.trendLeft, cy - 6, COL.trendWidth);

    drawText(ctx, dashNum(m.total), COL.total, cy, { spec: '700 19px', color: THEME.text, align: 'right' });
    drawText(ctx, dashNum(m.expected), COL.expected, cy, { spec: '400 15px', color: THEME.faint, align: 'right' });
    drawText(ctx, dashNum(m.behind > 0 ? m.behind : null), COL.behind, cy, {
        spec: '500 15px',
        color: m.behind > 0 ? THEME.red : THEME.faint,
        align: 'right',
    });
    drawText(ctx, dashNum(m.avgPerDay), COL.avgDay, cy, { spec: '400 15px', color: THEME.muted, align: 'right' });
    drawText(ctx, dashNum(m.needPerDay), COL.needDay, cy, {
        spec: '500 15px',
        color: m.needPerDay !== null ? THEME.gold : THEME.faint,
        align: 'right',
    });
    drawText(ctx, dashNum(m.latestDayGain), COL.dayN, cy, {
        spec: '400 15px',
        color: m.latestDayGain === 0 ? THEME.faint : THEME.muted,
        align: 'right',
    });

    const willMakeQuota = m.projectedTotal >= quota;
    drawText(ctx, formatCompactFans(m.projectedTotal), COL.projected, cy, {
        spec: '400 15px',
        color: willMakeQuota ? THEME.green : m.onPace ? THEME.muted : THEME.red,
        align: 'right',
    });
}

export async function renderFanReport(progress: CircleProgress, meta: FanReportMeta): Promise<Buffer> {
    const rows = Math.max(progress.members.length, 1);
    const height = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT + rows * ROW_HEIGHT + FOOTER_HEIGHT;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawText(ctx, meta.circleName.toUpperCase(), MARGIN, 62, { spec: '500 30px', color: THEME.gold, tracking: 5 });

    const rankLabel = meta.monthlyRank === null ? 'UNRANKED' : `RANK #${meta.monthlyRank}`;
    drawLabel(ctx, `${meta.dateLabel} · ${rankLabel} · ${meta.memberCount} MEMBERS`, WIDTH - MARGIN, 58, THEME.muted, 14, 'right');

    drawText(
        ctx,
        `day ${progress.daysElapsed} of ${progress.daysInMonth} · quota ${formatCompactFans(progress.effectiveQuota)} per member · ${formatCompactFans(progress.quotaPerDay)}/day`,
        MARGIN,
        90,
        { spec: '400 14px', color: THEME.gold },
    );

    drawClubProgress(ctx, progress, 118);
    drawRule(ctx, MARGIN, HEADER_HEIGHT - 4, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    // ── Column headings ───────────────────────────────────────────────────────
    const hy = HEADER_HEIGHT + 24;
    drawLabel(ctx, '#', COL.rank, hy, THEME.muted);
    drawLabel(ctx, 'Trainer', COL.trainer, hy, THEME.muted);
    drawLabel(ctx, '7d trend', COL.trendLeft, hy, THEME.muted);
    drawLabel(ctx, 'Total', COL.total, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Expected', COL.expected, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Behind', COL.behind, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Avg/day', COL.avgDay, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Need/day', COL.needDay, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, `Day ${progress.daysElapsed}`, COL.dayN, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Proj.', COL.projected, hy, THEME.muted, 12, 'right');
    drawRule(ctx, MARGIN, HEADER_HEIGHT + COLUMN_HEADER_HEIGHT - 6, WIDTH - MARGIN * 2, THEME.line);

    let y = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT;

    if (progress.members.length === 0) {
        drawText(ctx, 'No fan data ingested for this month yet.', COL.rank, y + 30, { spec: '400 16px', color: THEME.faint });
        return canvas.encode('png');
    }

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (const member of progress.members) {
        drawRow(ctx, member, y, progress.effectiveQuota);
        y += ROW_HEIGHT;
        drawRule(ctx, MARGIN, y - 1, WIDTH - MARGIN * 2, THEME.line);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, y + 8, WIDTH - MARGIN * 2, THEME.gold, 1.5);
    const behind = progress.members.length - progress.onPaceCount;
    drawLabel(
        ctx,
        `Σ  ${progress.members.length} members · ${behind} behind · day ${progress.daysElapsed}/${progress.daysInMonth}`,
        MARGIN,
        y + 42,
        THEME.gold,
        13,
    );
    drawText(ctx, formatMillionsFans(progress.totalFans), COL.total, y + 44, { spec: '700 19px', color: THEME.text, align: 'right' });
    drawLabel(ctx, `projected ${formatMillionsFans(progress.projectedTotalFans)} of ${formatMillionsFans(progress.quotaTarget)}`, COL.projected, y + 42, THEME.muted, 12, 'right');

    return canvas.encode('png');
}
