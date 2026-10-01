import { drawRankBadge } from './canvasUtils';
import type { Club } from '@prisma/client';
import {
    FOOTER_HEIGHT,
    MARGIN,
    THEME,
    beginCard,
    drawEmpty,
    drawFooter,
    drawHeader,
    drawProgressBar,
    drawTableHead,
    drawText,
    drawZebra,
    fit,
    paceColor,
} from './theme';

/**
 * The club directory: every club with its rank badge, headcount against the
 * 30-member cap, and its stated fan count requirement.
 */

const WIDTH = 1000;
const ROW_HEIGHT = 58;
const MAX_HEADCOUNT = 30;

export async function renderClubList(clubs: Club[]): Promise<Buffer> {
    const headerBottom = 151;
    const tableTop = headerBottom + 24;
    const height = tableTop + 40 + 8 + Math.max(clubs.length, 1) * ROW_HEIGHT + FOOTER_HEIGHT + 12;

    const { canvas, ctx } = beginCard(WIDTH, height);

    const openSlots = clubs.reduce((sum, c) => sum + Math.max(0, MAX_HEADCOUNT - c.headcount), 0);
    drawHeader(ctx, WIDTH, {
        eyebrow: 'Club directory',
        title: 'Clubs',
        subtitle: 'Rank, headcount and fan requirement for every club',
        stats: [
            { label: 'Clubs', value: String(clubs.length) },
            { label: 'Open slots', value: String(openSlots), color: THEME.accent },
        ],
    });

    const colBadge = MARGIN + 20;
    const colName = MARGIN + 56;
    const colBar = 470;
    const barWidth = 220;
    const colCount = 760;
    const colFan = WIDTH - MARGIN;

    let y = drawTableHead(ctx, tableTop, WIDTH, [
        { label: 'Rank', x: colBadge, align: 'center' },
        { label: 'Club', x: colName },
        { label: 'Headcount', x: colBar },
        { label: 'Fan count', x: colFan, align: 'right' },
    ]);
    y += 8;

    if (clubs.length === 0) drawEmpty(ctx, y, 'No clubs created yet.');

    for (const [i, club] of clubs.entries()) {
        drawZebra(ctx, y, WIDTH, ROW_HEIGHT, i);
        const cy = y + ROW_HEIGHT / 2;

        await drawRankBadge(ctx, club.rank, colBadge, cy, 18, 14);

        const spec = '700 18px';
        drawText(ctx, fit(ctx, club.name, colBar - colName - 24, spec), colName, cy + 6, { spec, color: THEME.text });

        // Fuller is better: a club near the cap reads blue, a thin one red.
        const pct = (club.headcount / MAX_HEADCOUNT) * 100;
        const color = paceColor(pct, 60);
        drawProgressBar(ctx, colBar, cy, barWidth, 10, pct / 100, color);
        drawText(ctx, `${club.headcount}/${MAX_HEADCOUNT}`, colCount, cy + 6, { spec: '700 15px', color, align: 'right' });

        const fanText =
            club.fanCountAmount != null && club.fanCountPeriod
                ? `${club.fanCountAmount}M / ${club.fanCountPeriod.toLowerCase()}`
                : '—';
        drawText(ctx, fanText, colFan, cy + 6, { spec: '400 16px', color: fanText === '—' ? THEME.faint : THEME.muted, align: 'right' });

        y += ROW_HEIGHT;
    }

    drawFooter(ctx, WIDTH, height, 'Akikawa  ·  use /club view for a club’s staff');
    return canvas.encode('png');
}
