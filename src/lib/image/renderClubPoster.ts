import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank, ClubTier } from '@prisma/client';
import { drawClubIcon, drawRankBadge } from './canvasUtils';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { fit } from './cards';
import { TIERS, TIER_ORDER } from '../clubDirectory';

/**
 * Every club on one picture, for the club bio channel: a section per tier
 * (directory order, in the tier's colour, with what the tier means), and a
 * card per club with its avatar, expected rank, quota and headcount.
 *
 * Drawn at twice its layout size so it stays sharp when Discord scales it
 * to the reader's screen.
 */

/** Layout width; the image is `SCALE` times this. */
const WIDTH = 1400;
const SCALE = 2;
const MARGIN = 48;
const COLUMNS = 3;
const GUTTER = 22;
const CARD_H = 156;
const SECTION_HEAD = 90;
const SECTION_GAP = 34;

/** A club as the poster shows it. */
export interface PosterClub {
    id: string;
    name: string;
    tier: ClubTier;
    rank: ClubRank | null;
    /** Current members on uma.moe; null when not tracked. */
    headcount: number | null;
    /** e.g. "80.0M per week", or "Not set". */
    quotaText: string;
    /** uma.moe monthly rank at the last sync, if tracked. */
    monthlyRank: number | null;
}

/** Members a club holds in game. */
const CLUB_SIZE = 30;

/** `#rrggbb` from a 0xRRGGBB number. */
function hex(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

/** One club's card. */
async function drawCard(ctx: SKRSContext2D, club: PosterClub, x: number, y: number, w: number, accent: string) {
    ctx.fillStyle = THEME.bgRaised;
    ctx.fillRect(x, y, w, CARD_H);
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, CARD_H - 1);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 4, CARD_H);

    const iconR = 34;
    const iconCx = x + 26 + iconR;
    const iconCy = y + 22 + iconR;
    await drawClubIcon(ctx, club, iconCx, iconCy, iconR, 30);

    const badgeR = 22;
    await drawRankBadge(ctx, club.rank, x + w - 22 - badgeR, y + 22 + badgeR, badgeR, 18);

    const textX = iconCx + iconR + 18;
    const textW = x + w - 22 - badgeR * 2 - 12 - textX;
    drawText(ctx, fit(ctx, club.name, textW, '700 26px'), textX, y + 52, { spec: '700 26px', color: THEME.text });
    drawText(ctx, club.monthlyRank ? `#${club.monthlyRank.toLocaleString('en-US')} this month` : 'not ranked', textX, y + 76, {
        spec: '400 14px',
        color: THEME.faint,
    });

    // Quota and headcount, side by side along the bottom.
    const rowY = y + CARD_H - 44;
    const half = (w - 52) / 2;
    drawLabel(ctx, 'Quota', x + 26, rowY, THEME.muted, 11);
    drawText(ctx, fit(ctx, club.quotaText === 'Not set' ? '—' : club.quotaText, half - 8, '600 16px'), x + 26, rowY + 24, {
        spec: '600 16px',
        color: club.quotaText === 'Not set' ? THEME.faint : THEME.text,
    });

    const hx = x + 26 + half;
    drawLabel(ctx, 'Members', hx, rowY, THEME.muted, 11);
    if (club.headcount === null) {
        drawText(ctx, '—', hx, rowY + 24, { spec: '600 16px', color: THEME.faint });
        return;
    }
    const open = Math.max(0, CLUB_SIZE - club.headcount);
    const countW = drawText(ctx, `${club.headcount}/${CLUB_SIZE}`, hx, rowY + 24, { spec: '600 16px', color: THEME.text });
    drawText(ctx, open > 0 ? `${open} open` : 'full', hx + countW + 10, rowY + 24, { spec: '500 13px', color: open > 0 ? THEME.green : THEME.faint });
    const barW = half - 8;
    ctx.fillStyle = THEME.line;
    ctx.fillRect(hx, rowY + 32, barW, 4);
    ctx.fillStyle = accent;
    ctx.fillRect(hx, rowY + 32, barW * Math.min(1, club.headcount / CLUB_SIZE), 4);
}

/**
 * Renders the poster. Clubs are drawn in the order given within each tier;
 * tiers with no clubs are left out.
 */
export async function renderClubPoster(clubs: PosterClub[], options: { title?: string; footer?: string } = {}): Promise<Buffer> {
    const sections = TIER_ORDER.map((tier) => ({ tier, clubs: clubs.filter((c) => c.tier === tier) })).filter((s) => s.clubs.length > 0);
    const cardW = (WIDTH - MARGIN * 2 - GUTTER * (COLUMNS - 1)) / COLUMNS;
    const headerH = 150;
    const footerH = 70;
    const sectionHeights = sections.map((s) => SECTION_HEAD + Math.ceil(s.clubs.length / COLUMNS) * (CARD_H + GUTTER) - GUTTER);
    const height = headerH + sectionHeights.reduce((a, b) => a + b + SECTION_GAP, 0) + footerH + (sections.length === 0 ? 80 : 0);

    const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawLabel(ctx, 'Tracen Academy', MARGIN, 54, THEME.gold, 14);
    drawText(ctx, options.title ?? 'Our Clubs', MARGIN, 102, { spec: '700 46px', color: THEME.text });
    const total = clubs.length;
    const members = clubs.reduce((sum, c) => sum + (c.headcount ?? 0), 0);
    const tracked = clubs.some((c) => c.headcount !== null);
    drawText(ctx, `${total} club${total === 1 ? '' : 's'}${tracked ? `  ·  ${members.toLocaleString('en-US')} trainers` : ''}`, WIDTH - MARGIN, 102, {
        spec: '500 20px',
        color: THEME.muted,
        align: 'right',
    });
    drawRule(ctx, MARGIN, headerH - 22, WIDTH - MARGIN * 2, THEME.gold, 2);

    // ── Tiers ─────────────────────────────────────────────────────────────────
    let y = headerH;
    if (sections.length === 0) {
        drawText(ctx, 'No clubs have a tier yet.', MARGIN, y + 40, { spec: '400 18px', color: THEME.faint });
        y += 80;
    }
    for (const [i, section] of sections.entries()) {
        const info = TIERS[section.tier];
        const accent = hex(info.color);
        ctx.fillStyle = accent;
        ctx.fillRect(MARGIN, y + 6, 6, 58);
        drawText(ctx, info.title, MARGIN + 22, y + 36, { spec: '700 30px', color: accent });
        drawText(ctx, info.blurb, MARGIN + 22, y + 62, { spec: '400 16px', color: THEME.muted });
        drawLabel(ctx, `Est. ranks  ${info.ranks}`, WIDTH - MARGIN, y + 36, THEME.faint, 12, 'right');

        const top = y + SECTION_HEAD;
        for (const [j, club] of section.clubs.entries()) {
            const col = j % COLUMNS;
            const row = Math.floor(j / COLUMNS);
            await drawCard(ctx, club, MARGIN + col * (cardW + GUTTER), top + row * (CARD_H + GUTTER), cardW, accent);
        }
        y += sectionHeights[i]! + SECTION_GAP;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, height - footerH + 6, WIDTH - MARGIN * 2, THEME.line, 1);
    drawText(ctx, options.footer ?? 'Want in? Open a post in #apply-for-club with your trainer ID.', MARGIN, height - 26, { spec: '500 18px', color: THEME.gold });
    drawText(ctx, 'Members and ranks from uma.moe', WIDTH - MARGIN, height - 26, { spec: '400 13px', color: THEME.faint, align: 'right' });

    return canvas.encode('png');
}
