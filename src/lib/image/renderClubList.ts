import { createCanvas } from '@napi-rs/canvas';
import { roundRect, drawRankBadge } from './canvasUtils';
import type { Club } from '@prisma/client';
import { font } from './fonts';
import { THEME } from './theme';

export async function renderClubList(clubs: Club[]): Promise<Buffer> {
    const width = 1000;
    const rowHeight = 56;
    const headerHeight = 110;
    const tableHeaderHeight = 50;
    const height = headerHeight + tableHeaderHeight + Math.max(clubs.length, 1) * rowHeight + 40;

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
    ctx.fillText('RANK', colRank, headerHeight + 20);
    ctx.fillText('CLUB', colName, headerHeight + 20);
    ctx.fillText('HEADCOUNT', colProgress, headerHeight + 20);
    ctx.fillText('FAN COUNT', colFan, headerHeight + 20);

    let y = headerHeight + tableHeaderHeight;

    if (clubs.length === 0) {
        ctx.font = font('18px');
        ctx.fillStyle = THEME.faint;
        ctx.textAlign = 'left';
        ctx.fillText('No clubs created yet.', colRank, y + 30);
    }

    for (const club of clubs) {
        ctx.fillStyle = ((y - headerHeight - tableHeaderHeight) / rowHeight) % 2 === 0
            ? THEME.bgRaised
            : 'rgba(0, 0, 0, 0)';
        ctx.fillRect(24, y, width - 48, rowHeight);

        const cy = y + rowHeight / 2;

        await drawRankBadge(ctx, club.rank, colRank + 16, cy, 18, 14);

        ctx.textAlign = 'left';
        ctx.font = font('bold 18px');
        ctx.fillStyle = THEME.text;
        ctx.fillText(club.name, colName, cy + 6);

        const barW = 300, barH = 10;
        const pct = Math.min(club.headcount / 30, 1);
        ctx.fillStyle = THEME.line;
        roundRect(ctx, colProgress, cy - barH / 2, barW, barH, barH / 2);
        ctx.fill();
        const barColor = pct >= 0.8 ? '#3fb950' : pct >= 0.4 ? '#58a6ff' : '#f85149';
        ctx.fillStyle = barColor;
        roundRect(ctx, colProgress, cy - barH / 2, Math.max(barW * pct, barH), barH, barH / 2);
        ctx.fill();
        ctx.font = font('bold 14px');
        ctx.fillStyle = barColor;
        ctx.fillText(`${club.headcount}/30`, colProgress + barW + 16, cy + 5);

        ctx.font = font('16px');
        ctx.fillStyle = THEME.muted;
        const fanText =
            club.fanCountAmount != null && club.fanCountPeriod
                ? `${club.fanCountAmount}M/${club.fanCountPeriod.toLowerCase()}`
                : '—';
        ctx.fillText(fanText, colFan, cy + 6);

        y += rowHeight;
    }

    return canvas.encode('png');
}