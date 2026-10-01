import type { SKRSContext2D } from '@napi-rs/canvas';
import {
    FOOTER_HEIGHT,
    MARGIN,
    TABLE_HEAD_HEIGHT,
    THEME,
    alpha,
    beginCard,
    dashNum,
    drawEmpty,
    drawFooter,
    drawHeader,
    drawLabel,
    drawProgressBar,
    drawRankChip,
    drawTableHead,
    drawText,
    drawZebra,
    fit,
    paceColor,
    placeColor,
} from './theme';
import { formatCompactFans, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard.
 *
 * One row per member ranked by cumulative fans. The pace bar is the row's
 * headline: how far along each trainer is against where they should be today,
 * blue when on pace, amber when close, red when behind. The numbers after it
 * answer "how much" (fans, average), "what now" (need per day, only shown
 * when behind), "which way" (seven-day trend) and "where it ends" (straight-
 * line projection). Shame score is uma.moe's own figure, shown as given.
 *
 * Everything derives from data already ingested; nothing costs an API call.
 */

const WIDTH = 1600;
const ROW_HEIGHT = 50;
/** Club progress strip between the header and the table. */
const STRIP_HEIGHT = 92;

/** Column anchors. Numeric columns right-align on these. */
const COL = {
    rankCx: MARGIN + 16,
    trainer: MARGIN + 50,
    trainerEnd: 400,
    bar: 420,
    barWidth: 190,
    pct: 690,
    fans: 860,
    avgDay: 1010,
    needDay: 1160,
    trendLeft: 1200,
    trendWidth: 110,
    projected: 1430,
    shame: WIDTH - MARGIN,
} as const;

/** Spec used for trainer names; truncation measures with the same one. */
const NAME_SPEC = '700 18px';

export interface FanReportMeta {
    circleName: string;
    monthlyRank: number | null;
    memberCount: number;
    /** e.g. "September 14, 2026" */
    dateLabel: string;
}

/** Fans in millions with separators, e.g. "2,351.8M". Circle totals are quoted in millions. */
function millions(value: number): string {
    return `${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

/** A member's progress against today's expectation, in percent. */
function pacePct(m: MemberProgress): number {
    return m.expected > 0 ? (m.total / m.expected) * 100 : 100;
}

/**
 * Draws a small trend line of recent daily gains.
 *
 * Scaled to the member's own range, so it shows the *shape* of their week --
 * ramping, steady, collapsing -- rather than its size, which the numbers
 * beside it already give. The last point is marked, blue if the latest day
 * beat the one before and red if it fell.
 */
function drawSparkline(ctx: SKRSContext2D, gains: number[], x: number, cy: number, width: number) {
    const height = 20;
    if (gains.length < 2) {
        drawText(ctx, '—', x + width / 2, cy + 5, { spec: '400 14px', color: THEME.faint, align: 'center' });
        return;
    }

    const max = Math.max(...gains);
    const min = Math.min(...gains);
    const span = max - min || 1;
    const step = width / (gains.length - 1);
    const points = gains.map((g, i) => ({ px: x + i * step, py: cy + height / 2 - ((g - min) / span) * height }));

    ctx.strokeStyle = alpha(THEME.muted, 0.8);
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py)));
    ctx.stroke();

    const last = points[points.length - 1]!;
    const rising = (gains[gains.length - 1] ?? 0) >= (gains[gains.length - 2] ?? 0);
    ctx.fillStyle = rising ? THEME.accent : THEME.red;
    ctx.beginPath();
    ctx.arc(last.px, last.py, 3.5, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * The club-wide strip: total against the month's target, with a tick where
 * the club should be today so the bar reads as pace, not just accumulation.
 */
function drawClubProgress(ctx: SKRSContext2D, progress: CircleProgress, top: number) {
    const width = WIDTH - MARGIN * 2;
    const ratio = progress.quotaTarget > 0 ? progress.totalFans / progress.quotaTarget : 0;
    const expectedRatio = progress.daysInMonth > 0 ? progress.daysElapsed / progress.daysInMonth : 0;
    const onPace = ratio >= expectedRatio;

    drawLabel(ctx, 'Circle progress', MARGIN, top + 30, THEME.muted, 11);
    const totalsWidth = drawText(ctx, `${millions(progress.totalFans)} of ${millions(progress.quotaTarget)}`, MARGIN + 150, top + 30, {
        spec: '700 15px',
        color: THEME.text,
    });
    drawText(ctx, `${(ratio * 100).toFixed(1)}%`, MARGIN + 150 + totalsWidth + 14, top + 30, {
        spec: '700 15px',
        color: onPace ? THEME.accent : THEME.amber,
    });
    drawText(
        ctx,
        `${progress.onPaceCount} of ${progress.members.length} on pace  ·  projected ${millions(progress.projectedTotalFans)}`,
        WIDTH - MARGIN,
        top + 30,
        { spec: '400 14px', color: THEME.muted, align: 'right' },
    );

    const barY = top + 56;
    drawProgressBar(ctx, MARGIN, barY, width, 10, ratio, onPace ? THEME.accent : THEME.amber);
    const tickX = MARGIN + width * Math.min(1, expectedRatio);
    ctx.fillStyle = THEME.text;
    ctx.fillRect(tickX - 1, barY - 10, 2, 20);
    drawText(ctx, `today`, tickX, barY + 26, { spec: '400 11px', color: THEME.faint, align: 'center' });
}

/** Draws one member row. */
function drawRow(ctx: SKRSContext2D, m: MemberProgress, y: number, index: number, quota: number) {
    drawZebra(ctx, y, WIDTH, ROW_HEIGHT, index);
    const cy = y + ROW_HEIGHT / 2;
    const base = cy + 6;

    drawRankChip(ctx, m.rank, COL.rankCx, cy);

    // Movement since yesterday sits at the end of the name column, so the
    // name itself always starts on the same line.
    let nameRoom = COL.trainerEnd - COL.trainer;
    if (m.rankChange !== null && m.rankChange !== 0) {
        const up = m.rankChange > 0;
        drawText(ctx, `${up ? '▲' : '▼'} ${Math.abs(m.rankChange)}`, COL.trainerEnd, base - 1, {
            spec: '700 12px',
            color: up ? THEME.accent : THEME.red,
            align: 'right',
        });
        nameRoom -= 44;
    }
    drawText(ctx, fit(ctx, m.trainerName, nameRoom, NAME_SPEC), COL.trainer, base, {
        spec: NAME_SPEC,
        color: placeColor(m.rank) ?? THEME.text,
    });

    const pct = pacePct(m);
    const color = paceColor(pct);
    drawProgressBar(ctx, COL.bar, cy, COL.barWidth, 10, pct / 100, color);
    drawText(ctx, `${Math.floor(pct)}%`, COL.pct, base, { spec: '700 15px', color, align: 'right' });

    drawText(ctx, dashNum(m.total), COL.fans, base, { spec: '700 18px', color: THEME.text, align: 'right' });
    drawText(ctx, dashNum(m.avgPerDay), COL.avgDay, base, { spec: '400 16px', color: THEME.muted, align: 'right' });
    drawText(ctx, dashNum(m.needPerDay), COL.needDay, base, {
        spec: m.needPerDay !== null ? '700 16px' : '400 16px',
        color: m.needPerDay !== null ? THEME.amber : THEME.faint,
        align: 'right',
    });

    drawSparkline(ctx, m.recentGains, COL.trendLeft, cy - 4, COL.trendWidth);

    drawText(ctx, formatCompactFans(m.projectedTotal), COL.projected, base, {
        spec: '700 16px',
        color: m.projectedTotal >= quota ? THEME.accent : THEME.red,
        align: 'right',
    });
    drawText(ctx, m.shameScore === null ? '—' : String(m.shameScore), COL.shame, base, {
        spec: '400 16px',
        color: m.shameScore === null ? THEME.faint : THEME.muted,
        align: 'right',
    });
}

export async function renderFanReport(progress: CircleProgress, meta: FanReportMeta): Promise<Buffer> {
    const rows = Math.max(progress.members.length, 1);
    const headerBottom = 151;
    const tableTop = headerBottom + STRIP_HEIGHT + 12;
    const height = tableTop + TABLE_HEAD_HEIGHT + 8 + rows * ROW_HEIGHT + FOOTER_HEIGHT + 12;

    const { canvas, ctx } = beginCard(WIDTH, height);
    const behind = progress.members.length - progress.onPaceCount;

    drawHeader(ctx, WIDTH, {
        eyebrow: `Fan report  ·  ${meta.dateLabel}`,
        title: meta.circleName,
        subtitle: `Day ${progress.daysElapsed} of ${progress.daysInMonth}  ·  quota ${formatCompactFans(progress.effectiveQuota)} per member  ·  ${formatCompactFans(progress.quotaPerDay)} per day`,
        stats: [
            { label: 'Monthly rank', value: meta.monthlyRank === null ? '—' : `#${meta.monthlyRank}`, color: THEME.place[0] },
            { label: 'Members', value: String(meta.memberCount) },
            { label: 'Behind', value: String(behind), color: behind > 0 ? THEME.red : THEME.accent },
        ],
    });

    drawClubProgress(ctx, progress, headerBottom);

    let y = drawTableHead(ctx, tableTop, WIDTH, [
        { label: '#', x: COL.rankCx, align: 'center' },
        { label: 'Trainer', x: COL.trainer },
        { label: 'Pace', x: COL.bar },
        { label: 'Fans', x: COL.fans, align: 'right' },
        { label: 'Avg / day', x: COL.avgDay, align: 'right' },
        { label: 'Need / day', x: COL.needDay, align: 'right' },
        { label: '7-day trend', x: COL.trendLeft },
        { label: 'Projected', x: COL.projected, align: 'right' },
        { label: 'Shame', x: COL.shame, align: 'right' },
    ]);
    y += 8;

    if (progress.members.length === 0) {
        drawEmpty(ctx, y, 'No fan data ingested for this month yet.');
    } else {
        progress.members.forEach((member, i) => {
            drawRow(ctx, member, y, i, progress.effectiveQuota);
            y += ROW_HEIGHT;
        });
    }

    drawFooter(
        ctx,
        WIDTH,
        height,
        'Data source: uma.moe  ·  pace = fans against where the member should be today',
        `Σ ${millions(progress.totalFans)}  ·  ${behind} behind`,
    );

    return canvas.encode('png');
}
