import { createCanvas } from "@napi-rs/canvas";
import { roundRect, drawRankBadge, drawClubIcon, RANK_COLORS } from './canvasUtils';
import type { Club, ClubMember } from '@prisma/client';

interface StaffRow {
    role: 'Trainer' | 'Assistant';
    name: string;
}

export async function renderClubView(club: Club & { members: ClubMember[] }, staffNames: Map<string, string> ): Promise<Buffer> {
    const rows: StaffRow[] = club.members.slice().sort((a, b) => (a.role === b.role ? 0 : a.role === 'TRAINER' ? -1 : 1))
        .map((m) => ({ role: m.role === 'TRAINER' ? 'Trainer' : 'Assistant', name: staffNames.get(m.discordUserId) ?? m.discordUserId }));
    
    const width = 1000;
    const headerHeight = 200;
    const tableHeaderHeight = 40;
    const rowHeight = 40;
    const height = headerHeight + tableHeaderHeight + Math.max(rows.length, 1) * rowHeight + 60;

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
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Shared vertical center for both the club icon and the rank badge
    const headerCy = 90;

    // Club icon (custom image if set, otherwise initial-letter fallback)
    const iconX = 70, iconR = 44;
    await drawClubIcon(ctx, club, iconX, headerCy, iconR, 44);

    // Title + subtitle
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(club.name, 135, 78);

    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#9ba3b4';
    const fanCountText =
        club.fanCountAmount != null && club.fanCountPeriod
            ? `${club.fanCountAmount}M / ${club.fanCountPeriod.toLowerCase()}`
            : 'Not set';
    ctx.fillText(`Headcount: ${club.headcount}/30  •  Fan Count: ${fanCountText}`, 135, 112);

    // Rank badge, top-right
    const badgeX = width - 130, badgeR = 46;
    await drawRankBadge(ctx, club.rank, badgeX, headerCy, badgeR, 34);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('RANK', badgeX, headerCy + badgeR + 20);

    // Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight - 40);
    ctx.lineTo(width - 40, headerHeight - 40);
    ctx.stroke();

    // Staff table header
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('ROLE', 60, headerHeight);
    ctx.fillText('MEMBER', 220, headerHeight);

    let rowY = headerHeight + tableHeaderHeight;
    if (rows.length === 0) {
        ctx.font = '16px sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('No trainers or assistants assigned yet.', 60, rowY);
    } else {
        rows.forEach((row, i) => {
            if (i % 2 === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
                ctx.fillRect(40, rowY - 22, width - 80, 40);
            }
            ctx.font = 'bold 18px sans-serif';
            ctx.fillStyle = row.role === 'Trainer' ? '#ffd166' : '#79c0ff';
            ctx.fillText(row.role, 60, rowY);
            ctx.font = '18px sans-serif';
            ctx.fillStyle = '#e6e6e6';
            ctx.fillText(row.name, 220, rowY);
            rowY += rowHeight;
        });
    }

    // Footer
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#555b6e';
    ctx.textAlign = 'left';
    ctx.fillText(`Club ID: ${club.id}`, 40, height - 20);

    return canvas.encode('png');
}