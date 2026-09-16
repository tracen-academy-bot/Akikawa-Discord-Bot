import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import { formatCompactFans, formatFans, formatMillionsFans, type CircleProgress } from '../fans/metrics';
import { font } from './fonts';

/**
 * Renders the club fan-quota leaderboard.
 *
 * Layout follows the report this feature replaces: one row per member, ranked
 * by cumulative fans, with a status dot that answers "is this trainer on pace?"
 * before any number is read. Columns that only apply to members who are behind
 * (`Behind`, `Need/Day`) are blank for everyone else, which keeps the eye on
 * the rows that need attention.
 */

const WIDTH = 1560;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 96;
const TABLE_HEADER_HEIGHT = 38;
const FOOTER_HEIGHT = 56;

const TEXT_PRIMARY = '#e6e6e6';
const TEXT_MUTED = '#9ba3b4';
const TEXT_FAINT = '#6b7280';
const TEXT_DIM = '#5a6072';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

const ON_PACE = '#3b82f6';
const BEHIND_MILD = '#e0a33e';
const BEHIND_SEVERE = '#ef4444';
const UP = '#3fb950';
const DOWN = '#f85149';
const GOLD = '#ffd166';

/** Column x positions. Numeric columns are right-aligned on these. */
const COL = {
    rank: 44,
    trainer: 150,
    total: 640,
    expected: 840,
    behind: 1030,
    avgDay: 1200,
    needDay: 1375,
    dayN: 1500,
    dot: 1528,
} as const;

/** Severity threshold: behind by more than this fraction of expected is severe. */
const SEVERE_BEHIND_RATIO = 0.15;

/** Extra context the report header shows but the maths does not produce. */
export interface FanReportMeta {
    circleName: string;
    /** uma.moe monthly rank, if known. */
    monthlyRank: number | null;
    memberCount: number;
    /** Date line, e.g. "September 14, 2026". */
    dateLabel: string;
}

/** Colour for a member's behind-ness. */
function behindColor(behind: number, expected: number): string {
    if (behind === 0) return TEXT_DIM;
    return behind > expected * SEVERE_BEHIND_RATIO ? BEHIND_SEVERE : BEHIND_MILD;
}

/** Draws the small movement arrow next to a rank. */
function drawRankChange(ctx: SKRSContext2D, change: number | null, x: number, y: number) {
    if (change === null || change === 0) return;
    ctx.font = font('bold 12px');
    ctx.fillStyle = change > 0 ? UP : DOWN;
    ctx.textAlign = 'left';
    ctx.fillText(`${change > 0 ? '↑' : '↓'}${Math.abs(change)}`, x, y);
}

export async function renderFanReport(progress: CircleProgress, meta: FanReportMeta): Promise<Buffer> {
    const height =
        HEADER_HEIGHT + TABLE_HEADER_HEIGHT + Math.max(progress.members.length, 1) * ROW_HEIGHT + FOOTER_HEIGHT;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, '#15161f');
    bg.addColorStop(1, '#0d0e15');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, WIDTH, height, 20);
    ctx.fill();

    // ── Header ────────────────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 36px');
    ctx.fillText(meta.circleName, 40, 52);

    ctx.font = font('15px');
    ctx.fillStyle = TEXT_FAINT;
    const quotaLabel = `${formatCompactFans(progress.effectiveQuota)} (${formatCompactFans(progress.quotaPerDay)}/day)`;
    const rankLabel = meta.monthlyRank === null ? 'Unranked' : `Rank #${meta.monthlyRank}`;
    ctx.fillText(
        `${meta.dateLabel}  ·  ${rankLabel}  ·  ${meta.memberCount} members  ·  Quota ${quotaLabel}`,
        40,
        78,
    );

    // ── Column headings ───────────────────────────────────────────────────────
    ctx.font = font('bold 13px');
    ctx.fillStyle = TEXT_FAINT;
    ctx.textAlign = 'left';
    ctx.fillText('#', COL.rank, HEADER_HEIGHT + 10);
    ctx.fillText('TRAINER', COL.trainer, HEADER_HEIGHT + 10);
    ctx.textAlign = 'right';
    ctx.fillText('TOTAL', COL.total, HEADER_HEIGHT + 10);
    ctx.fillText('EXPECTED', COL.expected, HEADER_HEIGHT + 10);
    ctx.fillText('BEHIND', COL.behind, HEADER_HEIGHT + 10);
    ctx.fillText('AVG/DAY', COL.avgDay, HEADER_HEIGHT + 10);
    ctx.fillText('NEED/DAY', COL.needDay, HEADER_HEIGHT + 10);
    ctx.fillText(`DAY ${progress.daysElapsed}`, COL.dayN, HEADER_HEIGHT + 10);

    ctx.strokeStyle = 'rgba(88, 166, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, HEADER_HEIGHT + 22);
    ctx.lineTo(WIDTH - 32, HEADER_HEIGHT + 22);
    ctx.stroke();

    let y = HEADER_HEIGHT + TABLE_HEADER_HEIGHT;

    if (progress.members.length === 0) {
        ctx.textAlign = 'left';
        ctx.font = font('17px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText('No fan data ingested for this month yet.', COL.rank, y + 28);
        return canvas.encode('png');
    }

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (const member of progress.members) {
        const cy = y + ROW_HEIGHT / 2 + 5;

        if (member.rank % 2 === 1) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
            ctx.fillRect(24, y, WIDTH - 48, ROW_HEIGHT);
        }

        // Rank, with the top three highlighted and a movement arrow.
        ctx.textAlign = 'left';
        ctx.font = font(member.rank <= 3 ? 'bold 16px' : '16px');
        ctx.fillStyle = member.rank <= 3 ? GOLD : TEXT_FAINT;
        const rankText = member.rank <= 3 ? `#${member.rank}` : String(member.rank);
        ctx.fillText(rankText, COL.rank, cy);
        drawRankChange(ctx, member.rankChange, COL.rank + ctx.measureText(rankText).width + 8, cy);

        // Trainer name, truncated rather than allowed to overflow.
        ctx.font = font(member.rank <= 3 ? 'bold 17px' : '17px');
        ctx.fillStyle = member.rank === 1 ? GOLD : TEXT_PRIMARY;
        let name = member.trainerName;
        const maxName = COL.total - COL.trainer - 220;
        while (ctx.measureText(name).width > maxName && name.length > 1) {
            name = `${name.slice(0, -2)}…`;
        }
        ctx.fillText(name, COL.trainer, cy);

        ctx.textAlign = 'right';

        ctx.font = font('bold 17px');
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.fillText(formatFans(member.total), COL.total, cy);

        ctx.font = font('15px');
        ctx.fillStyle = TEXT_DIM;
        ctx.fillText(formatFans(member.expected), COL.expected, cy);

        // Behind and Need/Day are shown only when they mean something.
        if (member.behind > 0) {
            ctx.font = font('bold 15px');
            ctx.fillStyle = behindColor(member.behind, member.expected);
            ctx.fillText(formatFans(member.behind), COL.behind, cy);
        }

        ctx.font = font('15px');
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(formatFans(member.avgPerDay), COL.avgDay, cy);

        if (member.needPerDay !== null) {
            ctx.font = font('bold 15px');
            ctx.fillStyle = behindColor(member.behind, member.expected);
            ctx.fillText(formatFans(member.needPerDay), COL.needDay, cy);
        }

        ctx.font = font('15px');
        ctx.fillStyle = member.latestDayGain === 0 ? TEXT_DIM : TEXT_MUTED;
        ctx.fillText(formatFans(member.latestDayGain), COL.dayN, cy);

        // Status dot: the fastest read on the row.
        ctx.beginPath();
        ctx.arc(COL.dot, cy - 5, 7, 0, Math.PI * 2);
        ctx.fillStyle = member.onPace ? ON_PACE : BEHIND_SEVERE;
        ctx.fill();

        y += ROW_HEIGHT;
    }

    // ── Footer total ──────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, y + 6);
    ctx.lineTo(WIDTH - 32, y + 6);
    ctx.stroke();

    const behindCount = progress.members.filter((m) => !m.onPace).length;

    ctx.textAlign = 'left';
    ctx.font = font('bold 15px');
    ctx.fillStyle = TEXT_FAINT;
    ctx.fillText('Σ', COL.rank, y + 34);
    ctx.fillStyle = TEXT_MUTED;
    ctx.fillText(
        `${progress.members.length} members  ·  ${behindCount} behind  ·  day ${progress.daysElapsed}/${progress.daysInMonth}`,
        COL.trainer,
        y + 34,
    );

    ctx.textAlign = 'right';
    ctx.font = font('bold 17px');
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fillText(formatMillionsFans(progress.totalFans), COL.total, y + 34);

    return canvas.encode('png');
}
