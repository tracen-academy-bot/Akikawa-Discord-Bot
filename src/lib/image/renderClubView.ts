import { drawRankBadge, drawClubIcon } from './canvasUtils';
import type { Club, ClubMember } from '@prisma/client';
import {
    FOOTER_HEIGHT,
    HEADER_HEIGHT,
    MARGIN,
    THEME,
    beginCard,
    drawEmpty,
    drawFooter,
    drawLabel,
    drawProgressBar,
    drawRule,
    drawTableHead,
    drawText,
    drawZebra,
    fit,
    paceColor,
} from './theme';

/**
 * One club's card: icon, name, rank badge, headcount and fan requirement,
 * then its trainers and assistants.
 *
 * The header is custom rather than `drawHeader` because it carries the club
 * icon and rank badge, but it keeps the same heights and divider so it lines
 * up with every other image.
 */

const WIDTH = 1000;
const ROW_HEIGHT = 48;
const MAX_HEADCOUNT = 30;

interface StaffRow {
    role: 'Trainer' | 'Assistant';
    name: string;
}

export async function renderClubView(club: Club & { members: ClubMember[] }, staffNames: Map<string, string>): Promise<Buffer> {
    const rows: StaffRow[] = club.members
        .slice()
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'TRAINER' ? -1 : 1))
        .map((m) => ({ role: m.role === 'TRAINER' ? 'Trainer' : 'Assistant', name: staffNames.get(m.discordUserId) ?? m.discordUserId }));

    const statsTop = HEADER_HEIGHT + 1;
    const tableTop = statsTop + 108;
    const height = tableTop + 40 + 8 + Math.max(rows.length, 1) * ROW_HEIGHT + FOOTER_HEIGHT + 12;

    const { canvas, ctx } = beginCard(WIDTH, height);

    // ── Header: icon, name, badge ─────────────────────────────────────────────
    const iconR = 40;
    await drawClubIcon(ctx, club, MARGIN + iconR, 90, iconR, 36);
    const textX = MARGIN + iconR * 2 + 22;
    drawLabel(ctx, 'Club', textX, 64, THEME.accent, 12);
    drawText(ctx, fit(ctx, club.name, WIDTH - MARGIN - 120 - textX, '700 38px'), textX, 108, { spec: '700 38px', color: THEME.text });
    drawText(ctx, `${club.members.length} staff`, textX, 136, { spec: '400 16px', color: THEME.muted });

    await drawRankBadge(ctx, club.rank, WIDTH - MARGIN - 44, 92, 44, 32);
    drawRule(ctx, MARGIN, HEADER_HEIGHT, WIDTH - MARGIN * 2, THEME.line);

    // ── Headcount and fan requirement ─────────────────────────────────────────
    const pct = (club.headcount / MAX_HEADCOUNT) * 100;
    const color = paceColor(pct, 60);
    drawLabel(ctx, 'Headcount', MARGIN, statsTop + 34, THEME.muted, 11);
    drawText(ctx, `${club.headcount}/${MAX_HEADCOUNT}`, MARGIN, statsTop + 68, { spec: '700 26px', color });
    drawProgressBar(ctx, MARGIN + 110, statsTop + 59, 300, 10, pct / 100, color);

    const fanText =
        club.fanCountAmount != null && club.fanCountPeriod ? `${club.fanCountAmount}M / ${club.fanCountPeriod.toLowerCase()}` : 'Not set';
    drawLabel(ctx, 'Fan count', WIDTH - MARGIN, statsTop + 34, THEME.muted, 11, 'right');
    drawText(ctx, fanText, WIDTH - MARGIN, statsTop + 68, {
        spec: '700 26px',
        color: fanText === 'Not set' ? THEME.faint : THEME.text,
        align: 'right',
    });

    // ── Staff ─────────────────────────────────────────────────────────────────
    const colRole = MARGIN + 20;
    const colName = 240;
    let y = drawTableHead(ctx, tableTop, WIDTH, [
        { label: 'Role', x: colRole },
        { label: 'Member', x: colName },
    ]);
    y += 8;

    if (rows.length === 0) drawEmpty(ctx, y, 'No trainers or assistants assigned yet.');

    rows.forEach((row, i) => {
        drawZebra(ctx, y, WIDTH, ROW_HEIGHT, i);
        const base = y + ROW_HEIGHT / 2 + 6;
        drawText(ctx, row.role, colRole, base, { spec: '700 17px', color: row.role === 'Trainer' ? THEME.place[0] : THEME.accent });
        drawText(ctx, fit(ctx, row.name, WIDTH - MARGIN - colName, '400 17px'), colName, base, { spec: '400 17px', color: THEME.text });
        y += ROW_HEIGHT;
    });

    drawFooter(ctx, WIDTH, height, `Club ID: ${club.id}`);
    return canvas.encode('png');
}
