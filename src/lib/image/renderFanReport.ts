import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { PALETTES, dashNum, drawLabel, drawRule, drawText, type Palette } from './theme';
import { font } from './fonts';
import type { LastDayGains } from '../fans/readings';
import { checkpointNote, describeQuota, formatCompactFans, formatMillionsFans, periodAdjective, type CircleProgress, type MemberProgress } from '../fans/metrics';

/**
 * The club fan-quota leaderboard.
 *
 * One row per member ranked by cumulative fans. Each palette colour carries
 * one meaning (see `Palette`): accent for structure, target for the figure a
 * trainer must hit, behind for exactly that, and placement tints for the top
 * four. Empty cells show an em dash rather than nothing, so a blank never
 * reads as a missing value.
 *
 * The seven-day trend, month-end projection and Behind column were removed
 * on 2026-10-24 at the club's request: the first two told nobody what to do,
 * and Behind said the same as the daily target, which now takes the behind
 * colour for anyone behind (and the alert pings staff about them). Fewer
 * columns make a narrower image, easier to read on a phone. Every other row
 * is striped so a row can be followed across.
 */

const WIDTH = 1200;
const MARGIN = 40;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 196;
const COLUMN_HEADER_HEIGHT = 44;
const FOOTER_HEIGHT = 84;

/** Column anchors. Numeric columns right-align on these. */
const COL = {
    rank: 70,
    trainer: 130,
    total: 570,
    expected: 720,
    avgDay: 865,
    target: 1025,
    dayN: WIDTH - MARGIN,
} as const;

/** Widest a trainer name may draw before truncation; leaves room for the total. */
const MAX_NAME_WIDTH = COL.total - COL.trainer - 150;

export interface FanReportMeta {
    circleName: string;
    monthlyRank: number | null;
    memberCount: number;
    /** e.g. "September 14, 2026" */
    dateLabel: string;
    /**
     * Fans earned in the 24 hours before the report (see `lastDayGains`).
     * When given, the column shows it as "Last 24h". Without it (a report at
     * the daily reset, or no readings from a day ago yet) the column is the
     * last complete game day, "Day N".
     */
    last24h?: LastDayGains | null;
}

/** Truncates with an ellipsis until the text fits the given width. */
function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    let out = text;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/**
 * Draws the club-wide quota progress bar for the current window (month, week
 * or day) with its labels.
 */
function drawClubProgress(ctx: SKRSContext2D, progress: CircleProgress, y: number, p: Palette) {
    const barX = MARGIN;
    const barWidth = WIDTH - MARGIN * 2;
    const ratio = progress.quotaTarget > 0 ? Math.min(1, progress.totalFans / progress.quotaTarget) : 0;
    // Where the club should be by now: what is due, summed over members.
    const due = progress.members.reduce((sum, m) => sum + m.expected, 0);
    const expectedRatio = progress.quotaTarget > 0 ? Math.min(1, due / progress.quotaTarget) : 0;

    drawRule(ctx, barX, y, barWidth, p.line, 4);
    drawRule(ctx, barX, y, barWidth * ratio, p.accent, 4);

    // A tick where the club *should* be by now, so the bar reads as pace, not
    // just accumulation.
    ctx.fillStyle = p.text;
    ctx.fillRect(barX + barWidth * expectedRatio - 1, y - 4, 2, 12);

    const pct = progress.quotaTarget > 0 ? ((progress.totalFans / progress.quotaTarget) * 100).toFixed(1) : '0.0';
    drawText(ctx, `${formatMillionsFans(progress.totalFans)} of ${formatMillionsFans(progress.quotaTarget)} · ${pct}%`, barX, y + 26, {
        spec: '400 13px',
        color: p.muted,
    });
    drawText(ctx, `${progress.onPaceCount} of ${progress.members.length} on pace`, barX + barWidth, y + 26, {
        spec: '400 13px',
        color: p.muted,
        align: 'right',
    });
}

/**
 * Draws one member row. `recent` is the last-24h figure, or the latest game
 * day's; `striped` shades the row.
 */
function drawRow(ctx: SKRSContext2D, m: MemberProgress, y: number, recent: number | null, striped: boolean, p: Palette) {
    const cy = y + ROW_HEIGHT / 2 + 6;
    const tint = p.place[m.rank - 1] ?? null;

    if (striped) {
        ctx.fillStyle = p.stripe;
        ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, ROW_HEIGHT - 1);
    }

    // Left bar: placement for the top four, the behind colour for anyone behind.
    const bar = tint ?? (m.onPace ? null : p.behind);
    if (bar) {
        ctx.fillStyle = bar;
        ctx.fillRect(MARGIN, y + 7, 3, ROW_HEIGHT - 14);
    }

    drawText(ctx, String(m.rank), COL.rank, cy, { spec: '400 15px', color: p.faint });
    if (m.rankChange !== null && m.rankChange !== 0) {
        const arrow = m.rankChange > 0 ? '↑' : '↓';
        drawText(ctx, `${arrow}${Math.abs(m.rankChange)}`, COL.rank + 26, cy, {
            spec: '400 12px',
            // A slip is not "behind", so it does not borrow that colour.
            color: m.rankChange > 0 ? p.accent : p.muted,
        });
    }

    // Measure with the same font the name is drawn in, or truncation is wrong.
    ctx.font = font('500 19px');
    drawText(ctx, fit(ctx, m.trainerName, MAX_NAME_WIDTH), COL.trainer, cy, {
        spec: '500 19px',
        color: tint ?? p.text,
    });

    drawText(ctx, dashNum(m.total), COL.total, cy, { spec: '700 19px', color: p.text, align: 'right' });
    drawText(ctx, dashNum(m.expected), COL.expected, cy, { spec: '400 15px', color: p.faint, align: 'right' });
    drawText(ctx, dashNum(m.avgPerDay), COL.avgDay, cy, { spec: '400 15px', color: p.muted, align: 'right' });

    // Behind: the behind colour, bolder, so who is behind still stands out
    // without a Behind column.
    drawText(ctx, dashNum(m.needPerDay), COL.target, cy, {
        spec: m.onPace ? '500 15px' : '700 16px',
        color: m.needPerDay === null ? p.faint : m.onPace ? p.target : p.behind,
        align: 'right',
    });

    drawText(ctx, dashNum(recent), COL.dayN, cy, {
        spec: '400 15px',
        color: !recent ? p.faint : p.muted,
        align: 'right',
    });
}

/**
 * Header line: report kind, period, configured quota, per-day rate and, for
 * checkpoint periods, when the next check is and what it will ask for.
 */
function reportSubtitle(p: CircleProgress): string[] {
    const parts = [`${periodAdjective(p.period).toLowerCase()} report`];
    if (p.period !== 'DAY') parts.push(p.windowLabel.toLowerCase());
    parts.push(`day ${p.daysElapsed} of ${p.daysInMonth}`, `quota ${describeQuota(p.quota, p.period)} per member`);
    if (p.period !== 'DAY') parts.push(`${formatCompactFans(p.quotaPerDay)}/day`);
    const note = checkpointNote(p);
    if (note) parts.push(note);
    return parts;
}

/**
 * Joins subtitle parts with " · " into at most two lines that fit `maxWidth`
 * in the subtitle font. A biweekly subtitle with its checkpoint note runs
 * past the image edge on one line.
 */
function wrapSubtitle(ctx: SKRSContext2D, parts: string[], maxWidth: number): string[] {
    ctx.font = font(SUBTITLE_SPEC);
    const lines: string[] = [];
    let line = '';
    for (const part of parts) {
        const next = line ? `${line} · ${part}` : part;
        if (line && ctx.measureText(next).width > maxWidth && lines.length === 0) {
            lines.push(line);
            line = part;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

const SUBTITLE_SPEC = '400 14px';

/**
 * Renders the report as a PNG.
 *
 * @param palette Colours to draw in; `classic` when omitted.
 */
export async function renderFanReport(progress: CircleProgress, meta: FanReportMeta, palette: Palette = PALETTES.classic!): Promise<Buffer> {
    const p = palette;
    const rows = Math.max(progress.members.length, 1);
    const height = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT + rows * ROW_HEIGHT + FOOTER_HEIGHT;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, WIDTH, height);
    // Header band and column-heading strip, so the table reads as its own area.
    ctx.fillStyle = p.panel;
    ctx.fillRect(0, 0, WIDTH, HEADER_HEIGHT - 4);
    ctx.fillRect(MARGIN, HEADER_HEIGHT, WIDTH - MARGIN * 2, COLUMN_HEADER_HEIGHT - 6);

    // ── Header ────────────────────────────────────────────────────────────────
    drawText(ctx, meta.circleName.toUpperCase(), MARGIN, 62, { spec: '500 30px', color: p.accent, tracking: 5 });

    const rankLabel = meta.monthlyRank === null ? 'UNRANKED' : `RANK #${meta.monthlyRank}`;
    drawLabel(ctx, `${meta.dateLabel} · ${rankLabel} · ${meta.memberCount} MEMBERS`, WIDTH - MARGIN, 58, p.muted, 14, 'right');

    const subtitle = wrapSubtitle(ctx, reportSubtitle(progress), WIDTH - MARGIN * 2);
    subtitle.forEach((line, i) => drawText(ctx, line, MARGIN, 88 + i * 20, { spec: SUBTITLE_SPEC, color: p.accent }));

    drawClubProgress(ctx, progress, subtitle.length > 1 ? 130 : 118, p);
    drawRule(ctx, MARGIN, HEADER_HEIGHT - 4, WIDTH - MARGIN * 2, p.accent, 1.5);

    // ── Column headings ───────────────────────────────────────────────────────
    const hy = HEADER_HEIGHT + 24;
    drawLabel(ctx, '#', COL.rank, hy, p.muted);
    drawLabel(ctx, 'Trainer', COL.trainer, hy, p.muted);
    drawLabel(ctx, 'Total', COL.total, hy, p.muted, 12, 'right');
    drawLabel(ctx, 'Expected', COL.expected, hy, p.muted, 12, 'right');
    drawLabel(ctx, 'Avg/day', COL.avgDay, hy, p.muted, 12, 'right');
    // The whole daily amount from here on, not an extra on top of pace:
    // "Need/day" was read as the latter.
    drawLabel(ctx, 'Daily target', COL.target, hy, p.muted, 12, 'right');
    const last24h = meta.last24h ?? null;
    // A finished day when there is one; on a month's first day, the day so far.
    const day = progress.finishedDay > 0 ? progress.finishedDay : progress.daysElapsed;
    const recentLabel = last24h ? `Last 24h${last24h.overlapsFreeze ? '*' : ''}` : `Day ${day}`;
    drawLabel(ctx, recentLabel, COL.dayN, hy, p.muted, 12, 'right');
    drawRule(ctx, MARGIN, HEADER_HEIGHT + COLUMN_HEADER_HEIGHT - 6, WIDTH - MARGIN * 2, p.line);

    let y = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT;

    if (progress.members.length === 0) {
        drawText(ctx, 'No fan data ingested for this month yet.', COL.rank, y + 30, { spec: '400 16px', color: p.faint });
        return canvas.encode('png');
    }

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (const [index, member] of progress.members.entries()) {
        const recent = last24h
            ? (last24h.gains.get(member.viewerId) ?? null)
            : progress.finishedDay > 0
              ? member.finishedDayGain
              : member.latestDayGain;
        drawRow(ctx, member, y, recent, index % 2 === 1, p);
        y += ROW_HEIGHT;
        drawRule(ctx, MARGIN, y - 1, WIDTH - MARGIN * 2, p.line);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, y + 8, WIDTH - MARGIN * 2, p.accent, 1.5);
    const behind = progress.members.length - progress.onPaceCount;
    // The window is in the header; repeating it here ran into the total.
    drawLabel(ctx, `Σ  ${progress.members.length} members · ${behind} behind`, MARGIN, y + 42, p.accent, 13);
    drawText(ctx, formatMillionsFans(progress.totalFans), COL.total, y + 44, { spec: '700 19px', color: p.text, align: 'right' });
    const target = progress.period === 'MONTH' ? 'until month end' : `until the day ${progress.nextCheckpointDay} check`;
    drawLabel(ctx, `daily target = fans a day ${target}`, COL.dayN, y + 42, p.muted, 12, 'right');
    if (last24h?.overlapsFreeze) {
        drawText(ctx, '* Last 24h includes the 1st, 17:00–24:00 JST, when fans do not count.', MARGIN, y + 70, { spec: '400 13px', color: p.muted });
    }

    return canvas.encode('png');
}
