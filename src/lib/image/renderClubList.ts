import { createCanvas } from '@napi-rs/canvas';
import { roundRect, drawRankBadge } from './canvasUtils';
import type { ClubRank } from '@prisma/client';
import { font } from './fonts';
import { formatRank } from '../clubFormat';
import { THEME } from './theme';

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
}

/** Expected ranks from highest to lowest; clubs with none set come last. */
const RANK_ORDER: (ClubRank | null)[] = ['S_PLUS', 'S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL', null];

/**
 * Clubs grouped by expected rank, highest first, each group sorted by name.
 * Empty groups are left out.
 */
export function groupByRank(clubs: ClubSummary[]): { rank: ClubRank | null; clubs: ClubSummary[] }[] {
    return RANK_ORDER.map((rank) => ({
        rank,
        clubs: clubs.filter((c) => c.rank === rank).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.clubs.length > 0);
}

export async function renderClubList(clubs: ClubSummary[]): Promise<Buffer> {
    const width = 1000;
    const rowHeight = 56;
    const sectionHeight = 44;
    const headerHeight = 110;
    const tableHeaderHeight = 50;
    const groups = groupByRank(clubs);
    const height = headerHeight + tableHeaderHeight + Math.max(clubs.length, 1) * rowHeight + groups.length * sectionHeight + 40;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);


    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.text;
    ctx.font = font('bold 34px');
    ctx.fillText('Club Directory', 40, 55);
    ctx.font = font('18px');
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`${clubs.length} club${clubs.length === 1 ? '' : 's'}`, 40, 85);

    ctx.strokeStyle = THEME.line;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight - 10);
    ctx.lineTo(width - 40, headerHeight - 10);
    ctx.stroke();

    const colRank = 60, colName = 150, colProgress = 430, colFan = 830;
    ctx.font = font('bold 14px');
    ctx.fillStyle = THEME.faint;
    ctx.fillText('EXP. RANK', colRank - 12, headerHeight + 20);
    ctx.fillText('CLUB', colName, headerHeight + 20);
    ctx.fillText('HEADCOUNT', colProgress, headerHeight + 20);
    ctx.fillText('QUOTA', colFan, headerHeight + 20);

    let y = headerHeight + tableHeaderHeight;

    if (clubs.length === 0) {
        ctx.font = font('18px');
        ctx.fillStyle = THEME.faint;
        ctx.textAlign = 'left';
        ctx.fillText('No clubs created yet.', colRank, y + 30);
    }

    for (const group of groups) {
        // Section header: the rank's name and how many clubs hold it.
        ctx.textAlign = 'left';
        ctx.font = font('bold 16px');
        ctx.fillStyle = THEME.muted;
        const label = group.rank === null ? 'Rank not set' : `${formatRank(group.rank)}`;
        ctx.fillText(`${label}  \u00b7  ${group.clubs.length}`, 40, y + 28);
        ctx.strokeStyle = THEME.line;
        ctx.beginPath();
        ctx.moveTo(40, y + sectionHeight - 6);
        ctx.lineTo(width - 40, y + sectionHeight - 6);
        ctx.stroke();
        y += sectionHeight;

        let row = 0;
        for (const club of group.clubs) {
            ctx.fillStyle = row % 2 === 0 ? THEME.bgRaised : 'rgba(0, 0, 0, 0)';
            row += 1;
            ctx.fillRect(24, y, width - 48, rowHeight);

            const cy = y + rowHeight / 2;

            await drawRankBadge(ctx, club.rank, colRank + 16, cy, 18, 14);

            ctx.textAlign = 'left';
            ctx.font = font('bold 18px');
            ctx.fillStyle = THEME.text;
            ctx.fillText(club.name, colName, cy + 6);

            const barW = 300, barH = 10;
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
            ctx.fillText(club.headcount === null ? '—' : `${club.headcount}/30`, colProgress + barW + 16, cy + 5);

            ctx.font = font('16px');
            ctx.fillStyle = THEME.muted;
            ctx.fillText(club.quotaText, colFan, cy + 6);

            y += rowHeight;
        }
    }

    return canvas.encode('png');
}