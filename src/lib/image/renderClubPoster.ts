import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank, ClubTier } from '@prisma/client';
import { drawClubIcon, drawRankBadge, roundRect } from './canvasUtils';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { fit } from './cards';
import { font } from './fonts';
import { TIERS, TIER_ORDER } from '../clubTiers';

/**
 * Every club on one picture, the last message of the club directory: a band
 * per tier (directory order, in the tier's colour, with what the tier means
 * and its estimated ranks), then one row per club.
 *
 * Rows rather than cards, so the columns line up and clubs compare at a
 * glance: expected rank, quota (as set, and per day so a weekly and a
 * monthly quota can be compared), members, and open spots. Open spots are
 * the right-most column and the only filled shape, since they are what an
 * applicant looks for first.
 *
 * Drawn at twice its layout size so it stays sharp when Discord scales it
 * to the reader's screen.
 */

/** Layout width; the image is `SCALE` times this. */
const WIDTH = 1200;
const SCALE = 2;
const MARGIN = 48;
const HEADER_H = 178;
const COLUMN_HEAD_H = 40;
const BAND_H = 92;
const ROW_H = 84;
const SECTION_GAP = 26;
const FOOTER_H = 84;

/** Members a club holds in game. */
const CLUB_SIZE = 30;

/** Column positions (left edges, or centres where noted). */
const COL = {
    avatar: MARGIN + 44, // centre
    name: MARGIN + 88,
    rank: 548, // centre
    quota: 600,
    perDay: 808,
    members: 918,
    open: WIDTH - MARGIN, // right edge
};

/** Expected ranks, highest first; clubs with none set come last. */
const RANK_ORDER: (ClubRank | null)[] = ['S_PLUS', 'S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL', null];

/** A club as the poster shows it. */
export interface PosterClub {
    id: string;
    name: string;
    tier: ClubTier;
    rank: ClubRank | null;
    /** Current members on uma.moe; null when not tracked. */
    headcount: number | null;
    /** e.g. "80.0M/month", or "Not set". */
    quotaText: string;
    /** The quota as fans a day (`clubDailyRequirement`); null when not set. */
    dailyRequirement: number | null;
    /** uma.moe monthly rank at the last sync, if tracked. */
    monthlyRank: number | null;
}

/** `#rrggbb` from a 0xRRGGBB number. */
function hex(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

/** `rgba(...)` of a 0xRRGGBB number. */
function tint(color: number, alpha: number): string {
    return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${alpha})`;
}

/** A fan count a day, short: "3.3M", "533K", "950". */
export function shortFans(fans: number): string {
    if (fans >= 1_000_000) return `${(fans / 1_000_000).toFixed(1)}M`;
    if (fans >= 1_000) return `${Math.floor(fans / 1_000)}K`;
    return String(Math.round(fans));
}

/**
 * Orders a tier's clubs: by expected rank, highest first, then by daily
 * requirement, highest first (clubs without a quota last), then by name.
 */
export function posterOrder(clubs: PosterClub[]): PosterClub[] {
    return [...clubs].sort(
        (a, b) =>
            RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) ||
            (b.dailyRequirement ?? -1) - (a.dailyRequirement ?? -1) ||
            a.name.localeCompare(b.name),
    );
}

/** Open spots, or null when the headcount is unknown. */
function openSpots(club: PosterClub): number | null {
    return club.headcount === null ? null : Math.max(0, CLUB_SIZE - club.headcount);
}

/** The open-spots pill, right-aligned at `right`, centred on `cy`. */
function drawOpen(ctx: SKRSContext2D, open: number | null, right: number, cy: number) {
    const h = 34;
    if (open === null) {
        drawText(ctx, '—', right - 12, cy + 7, { spec: '600 20px', color: THEME.faint, align: 'right' });
        return;
    }
    const text = open > 0 ? `${open} OPEN` : 'FULL';
    ctx.font = font('700 17px');
    ctx.letterSpacing = '1.5px';
    const w = Math.max(96, ctx.measureText(text).width + 30);
    ctx.letterSpacing = '0px';
    roundRect(ctx, right - w, cy - h / 2, w, h, h / 2);
    if (open > 0) {
        ctx.fillStyle = THEME.green;
        ctx.fill();
    } else {
        ctx.strokeStyle = THEME.faint;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    drawText(ctx, text, right - w / 2, cy + 6, { spec: '700 17px', color: open > 0 ? THEME.bg : THEME.faint, align: 'center', tracking: 1.5 });
}

/** One club's row. */
async function drawRow(ctx: SKRSContext2D, club: PosterClub, y: number, color: number, shaded: boolean) {
    const cy = y + ROW_H / 2;
    if (shaded) {
        ctx.fillStyle = THEME.bgRaised;
        ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, ROW_H);
    }

    await drawClubIcon(ctx, club, COL.avatar, cy, 28, 24);

    drawText(ctx, fit(ctx, club.name, COL.rank - 34 - COL.name, '700 27px'), COL.name, cy - 2, { spec: '700 27px', color: THEME.text });
    drawText(ctx, club.monthlyRank ? `#${club.monthlyRank.toLocaleString('en-US')} on uma.moe this month` : 'not ranked on uma.moe', COL.name, cy + 24, {
        spec: '400 14px',
        color: THEME.faint,
    });

    await drawRankBadge(ctx, club.rank, COL.rank, cy, 24, 18);

    const unset = club.quotaText === 'Not set';
    drawText(ctx, unset ? '—' : fit(ctx, club.quotaText, COL.perDay - 24 - COL.quota, '600 20px'), COL.quota, cy + 7, {
        spec: '600 20px',
        color: unset ? THEME.faint : THEME.text,
    });
    if (club.dailyRequirement === null) {
        drawText(ctx, '—', COL.perDay, cy + 7, { spec: '600 20px', color: THEME.faint });
    } else {
        const w = drawText(ctx, shortFans(club.dailyRequirement), COL.perDay, cy + 7, { spec: '600 20px', color: THEME.text });
        drawText(ctx, '/day', COL.perDay + w + 1, cy + 7, { spec: '400 14px', color: THEME.muted });
    }

    if (club.headcount === null) {
        drawText(ctx, '—', COL.members, cy + 7, { spec: '600 20px', color: THEME.faint });
    } else {
        drawText(ctx, `${club.headcount}/${CLUB_SIZE}`, COL.members, cy + 2, { spec: '600 20px', color: THEME.text });
        const barW = 92;
        roundRect(ctx, COL.members, cy + 12, barW, 5, 2.5);
        ctx.fillStyle = THEME.line;
        ctx.fill();
        roundRect(ctx, COL.members, cy + 12, Math.max(5, barW * Math.min(1, club.headcount / CLUB_SIZE)), 5, 2.5);
        ctx.fillStyle = hex(color);
        ctx.fill();
    }

    drawOpen(ctx, openSpots(club), COL.open, cy);
}

/** A tier's band: its colour, title, what it means and its estimated ranks. */
function drawBand(ctx: SKRSContext2D, tier: ClubTier, y: number) {
    const info = TIERS[tier];
    ctx.fillStyle = tint(info.color, 0.1);
    ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, BAND_H);
    ctx.fillStyle = hex(info.color);
    ctx.fillRect(MARGIN, y, 6, BAND_H);
    drawText(ctx, info.title, MARGIN + 26, y + 40, { spec: '700 29px', color: hex(info.color) });
    drawText(ctx, fit(ctx, info.blurb, WIDTH - MARGIN * 2 - 52, '400 16px'), MARGIN + 26, y + 70, { spec: '400 16px', color: THEME.muted });
    drawLabel(ctx, 'Est. ranks', WIDTH - MARGIN - 22, y + 24, THEME.faint, 11, 'right');
    drawText(ctx, info.ranks, WIDTH - MARGIN - 22, y + 48, { spec: '600 18px', color: THEME.text, align: 'right' });
}

/** A big figure over its label, right-aligned at `right`. */
function drawStat(ctx: SKRSContext2D, label: string, value: string, right: number, color: string) {
    drawLabel(ctx, label, right, 76, THEME.muted, 12, 'right');
    drawText(ctx, value, right, 120, { spec: '700 38px', color, align: 'right' });
}

/** "21 Nov 2026" in UTC. */
function shortDate(date: Date): string {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Renders the poster. Within a tier, clubs are ordered by `posterOrder`;
 * tiers with no clubs are left out. `updatedAt` is printed in the footer, so
 * a reader can tell how fresh the members and ranks are.
 */
export async function renderClubPoster(clubs: PosterClub[], options: { title?: string; footer?: string; updatedAt?: Date } = {}): Promise<Buffer> {
    const sections = TIER_ORDER.map((tier) => ({ tier, clubs: posterOrder(clubs.filter((c) => c.tier === tier)) })).filter((s) => s.clubs.length > 0);
    const body = sections.reduce((sum, s) => sum + BAND_H + s.clubs.length * ROW_H + SECTION_GAP, 0);
    const height = HEADER_H + (sections.length > 0 ? COLUMN_HEAD_H + body : 80) + FOOTER_H;

    const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header: title, then the totals an applicant cares about ──────────────
    drawLabel(ctx, 'Tracen Academy', MARGIN, 64, THEME.gold, 14);
    drawText(ctx, options.title ?? 'Our Clubs', MARGIN, 120, { spec: '700 52px', color: THEME.text });
    const tracked = clubs.filter((c) => c.headcount !== null);
    const right = WIDTH - MARGIN;
    if (tracked.length > 0) {
        const open = tracked.reduce((sum, c) => sum + (openSpots(c) ?? 0), 0);
        const members = tracked.reduce((sum, c) => sum + c.headcount!, 0);
        drawStat(ctx, 'Open spots', String(open), right, open > 0 ? THEME.green : THEME.faint);
        drawStat(ctx, 'Trainers', members.toLocaleString('en-US'), right - 190, THEME.text);
        drawStat(ctx, 'Clubs', String(clubs.length), right - 380, THEME.text);
    } else {
        drawStat(ctx, 'Clubs', String(clubs.length), right, THEME.text);
    }
    drawRule(ctx, MARGIN, HEADER_H - 30, WIDTH - MARGIN * 2, THEME.gold, 2);

    let y = HEADER_H;
    if (sections.length === 0) {
        drawText(ctx, 'No clubs have a tier yet.', MARGIN, y + 40, { spec: '400 18px', color: THEME.faint });
        y += 80;
    } else {
        // Column labels, once, over every tier.
        const labelY = y + 16;
        drawLabel(ctx, 'Club', COL.name, labelY, THEME.muted, 11);
        drawLabel(ctx, 'Rank', COL.rank, labelY, THEME.muted, 11, 'center');
        drawLabel(ctx, 'Quota', COL.quota, labelY, THEME.muted, 11);
        drawLabel(ctx, 'Per day', COL.perDay, labelY, THEME.muted, 11);
        drawLabel(ctx, 'Members', COL.members, labelY, THEME.muted, 11);
        drawLabel(ctx, 'Open', COL.open - 12, labelY, THEME.muted, 11, 'right');
        y += COLUMN_HEAD_H;
    }

    // ── Tiers ─────────────────────────────────────────────────────────────────
    for (const section of sections) {
        drawBand(ctx, section.tier, y);
        y += BAND_H;
        for (const [i, club] of section.clubs.entries()) {
            await drawRow(ctx, club, y, TIERS[section.tier].color, i % 2 === 1);
            y += ROW_H;
        }
        y += SECTION_GAP;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, height - FOOTER_H + 10, WIDTH - MARGIN * 2, THEME.line, 1);
    drawText(ctx, options.footer ?? 'Want in? Open a post in #apply-for-club with your trainer ID.', MARGIN, height - 32, { spec: '600 19px', color: THEME.gold });
    const source = options.updatedAt ? `Members and ranks from uma.moe, ${shortDate(options.updatedAt)}` : 'Members and ranks from uma.moe';
    drawText(ctx, source, WIDTH - MARGIN, height - 32, { spec: '400 13px', color: THEME.faint, align: 'right' });

    return canvas.encode('png');
}
