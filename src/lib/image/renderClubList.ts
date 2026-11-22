import { createCanvas } from '@napi-rs/canvas';
import { roundRect, drawRankBadge } from './canvasUtils';
import type { ClubRank } from '@prisma/client';
import { font } from './fonts';
import { formatRank } from '../clubFormat';
import { THEME } from './theme';
import { splitColumns } from './renderClubPoster';

/**
 * One club as the directory and the club card show it. Headcount and quota
 * are worked out by the caller: headcount from uma.moe's current members
 * (null when the club is not tracked or has no data yet), quota from the
 * club's fan quota.
 */
export interface ClubSummary {
    id: string;
    name: string;
    rank: ClubRank | null;
    headcount: number | null;
    quotaText: string;
    /** Fans each member must earn per day to meet the quota; null with no quota. */
    dailyRequirement?: number | null;
}

/** A daily figure short enough for its column: "8.2M", "533K", "950". */
export function shortDaily(fans: number): string {
    if (fans >= 1_000_000) return `${(fans / 1_000_000).toFixed(1)}M`;
    if (fans >= 1_000) return `${Math.floor(fans / 1_000)}K`;
    return String(fans);
}

/** Expected ranks from highest to lowest; clubs with none set come last. */
const RANK_ORDER: (ClubRank | null)[] = ['S_PLUS', 'S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL', null];

/**
 * Clubs grouped by expected rank, highest first. Within a group, the
 * highest effective daily requirement comes first; clubs with no quota go
 * last, and ties go by name. Empty groups are left out.
 */
export function groupByRank(clubs: ClubSummary[]): { rank: ClubRank | null; clubs: ClubSummary[] }[] {
    return RANK_ORDER.map((rank) => ({
        rank,
        clubs: clubs
            .filter((c) => c.rank === rank)
            .sort((a, b) => (b.dailyRequirement ?? -1) - (a.dailyRequirement ?? -1) || a.name.localeCompare(b.name)),
    })).filter((g) => g.clubs.length > 0);
}

/** Layout of the club list: a column is the old single-column table. */
const MARGIN = 40;
const COLUMN_W = 920;
const GUTTER = 40;
const ROW_H = 56;
const SECTION_H = 44;
const HEADER_H = 110;
const TABLE_HEAD_H = 50;

/**
 * The club list, `/club list`: clubs grouped by expected rank. With more
 * than one group the groups flow into two columns, each to the shorter one
 * so far (`splitColumns`, as on the club poster), so the image is wide
 * rather than tall and the columns end close together. `extra` groups (the
 * JP clubs) come after the rank groups.
 */
export async function renderClubList(clubs: ClubSummary[], options: { extra?: { label: string; clubs: ClubSummary[] }[] } = {}): Promise<Buffer> {
    // Rank groups, then hand-written groups (the JP clubs, `jpClubs.ts`) after them.
    const groups = [
        ...groupByRank(clubs).map((g) => ({ label: g.rank === null ? 'Rank not set' : formatRank(g.rank), clubs: g.clubs })),
        ...(options.extra ?? []).filter((e) => e.clubs.length > 0),
    ];
    const total = groups.reduce((sum, g) => sum + g.clubs.length, 0);
    const groupHeight = (g: { clubs: ClubSummary[] }) => SECTION_H + g.clubs.length * ROW_H;
    const columns = groups.length > 1 ? splitColumns(groups.map(groupHeight), groups) : [groups];
    const width = MARGIN * 2 + COLUMN_W * columns.length + GUTTER * (columns.length - 1);
    const body = Math.max(ROW_H, ...columns.map((col) => col.reduce((sum, g) => sum + groupHeight(g), 0)));
    const height = HEADER_H + TABLE_HEAD_H + body + 40;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.text;
    ctx.font = font('bold 34px');
    ctx.fillText('Club Directory', MARGIN, 55);
    ctx.font = font('18px');
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`${total} club${total === 1 ? '' : 's'}`, MARGIN, 85);

    ctx.strokeStyle = THEME.line;
    ctx.beginPath();
    ctx.moveTo(MARGIN, HEADER_H - 10);
    ctx.lineTo(width - MARGIN, HEADER_H - 10);
    ctx.stroke();

    if (total === 0) {
        ctx.font = font('18px');
        ctx.fillStyle = THEME.faint;
        ctx.fillText('No clubs created yet.', MARGIN + 20, HEADER_H + TABLE_HEAD_H + 30);
    }

    for (const [i, column] of columns.entries()) {
        // Positions within a column, from its left edge (x).
        const x = MARGIN + i * (COLUMN_W + GUTTER);
        const colRank = x + 20, colName = x + 110, colProgress = x + 360, colDaily = x + 620, colFan = x + 750;

        ctx.textAlign = 'left';
        ctx.font = font('bold 14px');
        ctx.fillStyle = THEME.faint;
        ctx.fillText('EXP. RANK', colRank - 12, HEADER_H + 20);
        ctx.fillText('CLUB', colName, HEADER_H + 20);
        ctx.fillText('HEADCOUNT', colProgress, HEADER_H + 20);
        ctx.fillText('EFF. DAILY', colDaily, HEADER_H + 20);
        ctx.fillText('QUOTA', colFan, HEADER_H + 20);

        let y = HEADER_H + TABLE_HEAD_H;
        for (const group of column) {
            // Section header: the rank's name and how many clubs hold it.
            ctx.textAlign = 'left';
            ctx.font = font('bold 16px');
            ctx.fillStyle = THEME.muted;
            ctx.fillText(`${group.label}  \u00b7  ${group.clubs.length}`, x, y + 28);
            ctx.strokeStyle = THEME.line;
            ctx.beginPath();
            ctx.moveTo(x, y + SECTION_H - 6);
            ctx.lineTo(x + COLUMN_W, y + SECTION_H - 6);
            ctx.stroke();
            y += SECTION_H;

            let row = 0;
            for (const club of group.clubs) {
                ctx.fillStyle = row % 2 === 0 ? THEME.bgRaised : 'rgba(0, 0, 0, 0)';
                row += 1;
                ctx.fillRect(x - 16, y, COLUMN_W + 32, ROW_H);

                const cy = y + ROW_H / 2;

                await drawRankBadge(ctx, club.rank, colRank + 16, cy, 18, 14);

                ctx.textAlign = 'left';
                ctx.font = font('bold 18px');
                ctx.fillStyle = THEME.text;
                ctx.fillText(club.name, colName, cy + 6);

                const barW = 180, barH = 10;
                const pct = Math.min((club.headcount ?? 0) / 30, 1);
                ctx.fillStyle = THEME.line;
                roundRect(ctx, colProgress, cy - barH / 2, barW, barH, barH / 2);
                ctx.fill();
                const barColor = pct >= 0.8 ? '#3fb950' : pct >= 0.4 ? '#58a6ff' : '#f85149';
                ctx.fillStyle = barColor;
                roundRect(ctx, colProgress, cy - barH / 2, Math.max(barW * pct, barH), barH, barH / 2);
                ctx.fill();
                ctx.font = font('bold 14px');
                ctx.fillStyle = barColor;
                ctx.fillText(club.headcount === null ? '\u2014' : `${club.headcount}/30`, colProgress + barW + 16, cy + 5);

                ctx.font = font('bold 16px');
                ctx.fillStyle = THEME.text;
                ctx.fillText(club.dailyRequirement == null ? '\u2014' : `${shortDaily(club.dailyRequirement)}/day`, colDaily, cy + 6);

                ctx.font = font('16px');
                ctx.fillStyle = THEME.muted;
                ctx.fillText(club.quotaText, colFan, cy + 6);

                y += ROW_H;
            }
        }
    }

    return canvas.encode('png');
}
