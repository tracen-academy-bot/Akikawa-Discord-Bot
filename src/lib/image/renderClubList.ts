import { createCanvas } from '@napi-rs/canvas';
import { roundRect, drawRankBadge } from './canvasUtils';
import type { Club } from '@prisma/client';

export async function renderClubList(clubs: Club[]): Promise<Buffer> {
    const width = 1000;
    const rowHeight = 56;
    const headerHeight = 110;
    const tableHeaderHeight = 50;
    const height = headerHeight + tableHeaderHeight + Math.max(clubs.length, 1) * rowHeight + 40;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#1a1c2e');
    bg.addColorStop(1, '#12131f');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, width, height, 24);
    ctx.fill();

    ctx.save();
    roundRect(ctx, 0, 0, width, height, 24);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Club Directory', 40, 55);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#9ba3b4';
    ctx.fillText(`${clubs.length} club${clubs.length === 1 ? '' : 's'}`, 40, 85);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(40, headerHeight - 10);
    ctx.lineTo(width - 40, headerHeight - 10);
    ctx.stroke();

    const colRank = 60, colName = 150, colProgress = 430, colFan = 830;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('RANK', colRank, headerHeight + 20);
    ctx.fillText('CLUB', colName, headerHeight + 20);
    ctx.fillText('HEADCOUNT', colProgress, headerHeight + 20);
    ctx.fillText('FAN COUNT', colFan, headerHeight + 20);

    let y = headerHeight + tableHeaderHeight;

    if (clubs.length === 0) {
        ctx.font = '18px sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'left';
        ctx.fillText('No clubs created yet.', colRank, y + 30);
    }

    for (const club of clubs) {
        ctx.fillStyle = ((y - headerHeight - tableHeaderHeight) / rowHeight) % 2 === 0
            ? 'rgba(255, 255, 255, 0.03)'
            : 'rgba(0, 0, 0, 0)';
        ctx.fillRect(24, y, width - 48, rowHeight);

        const cy = y + rowHeight / 2;

        await drawRankBadge(ctx, club.rank, colRank + 16, cy, 18, 14);

        ctx.textAlign = 'left';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#e6e6e6';
        ctx.fillText(club.name, colName, cy + 6);

        const barW = 300, barH = 10;
        const pct = Math.min(club.headcount / 30, 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        roundRect(ctx, colProgress, cy - barH / 2, barW, barH, barH / 2);
        ctx.fill();
        const barColor = pct >= 0.8 ? '#3fb950' : pct >= 0.4 ? '#58a6ff' : '#f85149';
        ctx.fillStyle = barColor;
        roundRect(ctx, colProgress, cy - barH / 2, Math.max(barW * pct, barH), barH, barH / 2);
        ctx.fill();
        ctx.font = 'bold 14px sans-serif';
        ctx.fillStyle = barColor;
        ctx.fillText(`${club.headcount}/30`, colProgress + barW + 16, cy + 5);

        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#9ba3b4';
        const fanText =
            club.fanCountAmount != null && club.fanCountPeriod
                ? `${club.fanCountAmount}M/${club.fanCountPeriod.toLowerCase()}`
                : '—';
        ctx.fillText(fanText, colFan, cy + 6);

        y += rowHeight;
    }

    return canvas.encode('png');
}