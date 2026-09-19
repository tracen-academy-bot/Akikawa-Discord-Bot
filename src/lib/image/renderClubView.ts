import { createCanvas } from "@napi-rs/canvas";
import { roundRect, drawRankBadge, drawClubIcon, RANK_COLORS } from './canvasUtils';
import type { Club, ClubMember } from '@prisma/client';
import { font } from './fonts';
import { THEME } from './theme';

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

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);


    // Shared vertical center for both the club icon and the rank badge
    const headerCy = 90;

    // Club icon (custom image if set, otherwise initial-letter fallback)
    const iconX = 70, iconR = 44;
    await drawClubIcon(ctx, club, iconX, headerCy, iconR, 44);

    // Title + subtitle
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = THEME.text;
    ctx.font = font('bold 40px');
    ctx.fillText(club.name, 135, 78);

    ctx.font = font('22px');
    ctx.fillStyle = THEME.muted;
    const fanCountText =
        club.fanCountAmount != null && club.fanCountPeriod
            ? `${club.fanCountAmount}M / ${club.fanCountPeriod.toLowerCase()}`
            : 'Not set';
    ctx.fillText(`Headcount: ${club.headcount}/30  •  Fan Count: ${fanCountText}`, 135, 112);

    // Rank badge, top-right
    const badgeX = width - 130, badgeR = 46;
    await drawRankBadge(ctx, club.rank, badgeX, headerCy, badgeR, 34);
    ctx.font = font('13px');
    ctx.fillStyle = THEME.faint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('RANK', badgeX, headerCy + badgeR + 20);

    // Divider
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight - 40);
    ctx.lineTo(width - 40, headerHeight - 40);
    ctx.stroke();

    // Staff table header
    ctx.textAlign = 'left';
    ctx.font = font('bold 15px');
    ctx.fillStyle = THEME.faint;
    ctx.fillText('ROLE', 60, headerHeight);
    ctx.fillText('MEMBER', 220, headerHeight);

    let rowY = headerHeight + tableHeaderHeight;
    if (rows.length === 0) {
        ctx.font = font('16px');
        ctx.fillStyle = THEME.faint;
        ctx.fillText('No trainers or assistants assigned yet.', 60, rowY);
    } else {
        rows.forEach((row, i) => {
            if (i % 2 === 0) {
                ctx.fillStyle = THEME.bgRaised;
                ctx.fillRect(40, rowY - 22, width - 80, 40);
            }
            ctx.font = font('bold 18px');
            ctx.fillStyle = row.role === 'Trainer' ? '#ffd166' : '#79c0ff';
            ctx.fillText(row.role, 60, rowY);
            ctx.font = font('18px');
            ctx.fillStyle = THEME.text;
            ctx.fillText(row.name, 220, rowY);
            rowY += rowHeight;
        });
    }

    // Footer
    ctx.font = font('13px');
    ctx.fillStyle = THEME.faint;
    ctx.textAlign = 'left';
    ctx.fillText(`Club ID: ${club.id}`, 40, height - 20);

    return canvas.encode('png');
}