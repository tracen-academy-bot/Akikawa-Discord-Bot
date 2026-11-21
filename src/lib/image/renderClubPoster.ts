import * as path from 'node:path';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
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

/**
 * The page behind the rows: its fill, the rows' and bands' base, and the
 * colours of what is drawn straight on it (header, column labels, footer).
 * Rows and bands always sit on `row`, so they read the same on any page.
 */
export interface Backdrop {
    fill(ctx: SKRSContext2D, height: number): void | Promise<void>;
    /** Height of the header the title sits in; taller to show a picture. */
    headerH?: number;
    row: string;
    rowAlt: string;
    /** Title, big figures. */
    ink: string;
    /** Labels and the footer's small print. */
    inkMuted: string;
    /** The "Tracen Academy" label, the header rule and the footer line. */
    accent: string;
    /** The open-spots total in the header. */
    highlight: string;
    /** A soft shadow under the header text, for a page with a picture behind it. */
    textShadow?: string;
    /** A rounded panel behind the header figures, where the picture is too bright for them. */
    statsPanel?: string;
}

/** A flat fill. */
function flat(color: string): Backdrop['fill'] {
    return (ctx, height) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, WIDTH, height);
    };
}

/** The beach picture (`assets/scenes/club-poster-beach.jpg`), loaded once; null when missing. */
let beach: Promise<Image | null> | undefined;
function beachImage(): Promise<Image | null> {
    beach ??= loadImage(path.join(__dirname, '..', '..', 'assets', 'scenes', 'club-poster-beach.jpg')).catch(() => null);
    return beach;
}

/** Height of the beach banner: the picture at full width, cropped at the bottom. */
const BEACH_H = 470;

/**
 * The beach picture across the top at full width, over a heavily blurred,
 * darkened copy of itself that fills the whole page, so its colours carry
 * down behind the rows. The sharp banner fades out into that copy rather
 * than into flat dark. Without the picture, the page is plain dark.
 */
async function beachFill(ctx: SKRSContext2D, height: number) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);
    const img = await beachImage();
    if (!img) return;

    // The whole page: the picture, scaled to cover it, blurred to colour fields.
    const cover = Math.max(WIDTH / img.width, height / img.height);
    const cw = img.width * cover;
    const ch = img.height * cover;
    ctx.save();
    ctx.filter = 'blur(60px)';
    ctx.drawImage(img, (WIDTH - cw) / 2, (height - ch) / 2, cw, ch);
    ctx.restore();
    // Darker further down, so the colour is strongest under the banner.
    const dim = ctx.createLinearGradient(0, BEACH_H - 120, 0, height);
    dim.addColorStop(0, 'rgba(12, 11, 11, 0.45)');
    dim.addColorStop(1, 'rgba(12, 11, 11, 0.82)');
    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, WIDTH, height);

    // The sharp banner, faded out at the bottom with an alpha mask.
    const shown = Math.min(BEACH_H + 60, (img.height * WIDTH) / img.width);
    const banner = createCanvas(WIDTH * SCALE, Math.ceil(shown * SCALE));
    const b = banner.getContext('2d');
    b.scale(SCALE, SCALE);
    b.drawImage(img, 0, 0, img.width, (shown * img.width) / WIDTH, 0, 0, WIDTH, shown);
    const mask = b.createLinearGradient(0, BEACH_H - 200, 0, shown);
    mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
    b.globalCompositeOperation = 'destination-in';
    b.fillStyle = mask;
    b.fillRect(0, 0, WIDTH, shown);
    ctx.drawImage(banner, 0, 0, WIDTH, shown);
}

/** Backdrops to choose from; `dark` is the bot's usual theme. */
export const BACKDROPS = {
    dark: { fill: flat(THEME.bg), row: THEME.bg, rowAlt: THEME.bgRaised, ink: THEME.text, inkMuted: THEME.muted, accent: THEME.gold, highlight: THEME.green },
    /** #ff4646 darkened to a near-black red. */
    darkRed: { fill: flat('#1c0909'), row: '#1c0909', rowAlt: '#260d0d', ink: THEME.text, inkMuted: '#b08a86', accent: '#ff4646', highlight: THEME.green },
    /** #ff4646 at the top, fading to the dark red behind the rows. */
    gradient: {
        fill: (ctx, height) => {
            const g = ctx.createLinearGradient(0, 0, 0, Math.min(height, 700));
            g.addColorStop(0, '#ff4646');
            g.addColorStop(0.32, '#8a1f1f');
            g.addColorStop(1, '#1c0909');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, WIDTH, height);
        },
        row: '#1c0909',
        rowAlt: '#260d0d',
        ink: '#ffffff',
        inkMuted: '#f1c9c5',
        accent: '#ffffff',
        highlight: '#ffffff',
    },
    /** The beach picture as a banner over the usual dark page. */
    beach: {
        fill: beachFill,
        headerH: BEACH_H,
        // See-through, so the blurred picture tints the rows too.
        row: 'rgba(12, 11, 11, 0.78)',
        rowAlt: 'rgba(26, 22, 20, 0.78)',
        ink: '#ffffff',
        inkMuted: '#e6e0d6',
        accent: THEME.gold,
        highlight: THEME.green,
        textShadow: 'rgba(0, 0, 0, 0.75)',
        statsPanel: 'rgba(12, 11, 11, 0.55)',
    },
    /** Full #ff4646, rows on dark panels. */
    red: { fill: flat('#ff4646'), row: '#170707', rowAlt: '#210b0b', ink: '#ffffff', inkMuted: '#3d0b0b', accent: '#3d0b0b', highlight: '#ffffff' },
} satisfies Record<string, Backdrop>;

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
function drawOpen(ctx: SKRSContext2D, open: number | null, right: number, cy: number, under: string) {
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
    drawText(ctx, text, right - w / 2, cy + 6, { spec: '700 17px', color: open > 0 ? under : THEME.faint, align: 'center', tracking: 1.5 });
}

/** One club's row. */
async function drawRow(ctx: SKRSContext2D, club: PosterClub, y: number, color: number, shaded: boolean, page: Backdrop) {
    const cy = y + ROW_H / 2;
    ctx.fillStyle = shaded ? page.rowAlt : page.row;
    ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, ROW_H);

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

    drawOpen(ctx, openSpots(club), COL.open, cy, THEME.bg);
}

/** A tier's band: its colour, title, what it means and its estimated ranks. */
function drawBand(ctx: SKRSContext2D, tier: ClubTier, y: number, page: Backdrop) {
    const info = TIERS[tier];
    ctx.fillStyle = page.row;
    ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, BAND_H);
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
function drawStat(ctx: SKRSContext2D, label: string, value: string, right: number, color: string, page: Backdrop) {
    drawLabel(ctx, label, right, 76, page.inkMuted, 12, 'right');
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
export async function renderClubPoster(clubs: PosterClub[], options: { title?: string; footer?: string; updatedAt?: Date; backdrop?: Backdrop } = {}): Promise<Buffer> {
    const sections = TIER_ORDER.map((tier) => ({ tier, clubs: posterOrder(clubs.filter((c) => c.tier === tier)) })).filter((s) => s.clubs.length > 0);
    const body = sections.reduce((sum, s) => sum + BAND_H + s.clubs.length * ROW_H + SECTION_GAP, 0);
    const page: Backdrop = options.backdrop ?? BACKDROPS.dark;
    const headerH = page.headerH ?? HEADER_H;
    const height = headerH + (sections.length > 0 ? COLUMN_HEAD_H + body : 80) + FOOTER_H;

    const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    await page.fill(ctx, height);

    // ── Header: title, then the totals an applicant cares about ──────────────
    ctx.save();
    if (page.textShadow) {
        ctx.shadowColor = page.textShadow;
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 1;
    }
    drawLabel(ctx, 'Tracen Academy', MARGIN, 64, page.accent, 14);
    drawText(ctx, options.title ?? 'Our Clubs', MARGIN, 120, { spec: '700 52px', color: page.ink });
    const tracked = clubs.filter((c) => c.headcount !== null);
    const right = WIDTH - MARGIN;
    if (page.statsPanel) {
        const left = tracked.length > 0 ? right - 470 : right - 130;
        roundRect(ctx, left, 44, WIDTH - 24 - left, 98, 16);
        ctx.fillStyle = page.statsPanel;
        ctx.fill();
    }
    if (tracked.length > 0) {
        const open = tracked.reduce((sum, c) => sum + (openSpots(c) ?? 0), 0);
        const members = tracked.reduce((sum, c) => sum + c.headcount!, 0);
        drawStat(ctx, 'Open spots', String(open), right, open > 0 ? page.highlight : page.inkMuted, page);
        drawStat(ctx, 'Trainers', members.toLocaleString('en-US'), right - 190, page.ink, page);
        drawStat(ctx, 'Clubs', String(clubs.length), right - 380, page.ink, page);
    } else {
        drawStat(ctx, 'Clubs', String(clubs.length), right, page.ink, page);
    }
    drawRule(ctx, MARGIN, headerH - 30, WIDTH - MARGIN * 2, page.accent, 2);

    let y = headerH;
    if (sections.length === 0) {
        drawText(ctx, 'No clubs have a tier yet.', MARGIN, y + 40, { spec: '400 18px', color: page.inkMuted });
        y += 80;
    } else {
        // Column labels, once, over every tier.
        const labelY = y + 16;
        drawLabel(ctx, 'Club', COL.name, labelY, page.inkMuted, 11);
        drawLabel(ctx, 'Rank', COL.rank, labelY, page.inkMuted, 11, 'center');
        drawLabel(ctx, 'Quota', COL.quota, labelY, page.inkMuted, 11);
        drawLabel(ctx, 'Per day', COL.perDay, labelY, page.inkMuted, 11);
        drawLabel(ctx, 'Members', COL.members, labelY, page.inkMuted, 11);
        drawLabel(ctx, 'Open', COL.open - 12, labelY, page.inkMuted, 11, 'right');
        y += COLUMN_HEAD_H;
    }
    ctx.restore();

    // ── Tiers ─────────────────────────────────────────────────────────────────
    for (const section of sections) {
        drawBand(ctx, section.tier, y, page);
        y += BAND_H;
        for (const [i, club] of section.clubs.entries()) {
            await drawRow(ctx, club, y, TIERS[section.tier].color, i % 2 === 1, page);
            y += ROW_H;
        }
        y += SECTION_GAP;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, height - FOOTER_H + 10, WIDTH - MARGIN * 2, page.inkMuted, 1);
    drawText(ctx, options.footer ?? 'Want in? Open a post in #apply-for-club with your trainer ID.', MARGIN, height - 32, { spec: '600 19px', color: page.accent });
    const source = options.updatedAt ? `Members and ranks from uma.moe, ${shortDate(options.updatedAt)}` : 'Members and ranks from uma.moe';
    drawText(ctx, source, WIDTH - MARGIN, height - 32, { spec: '400 13px', color: page.inkMuted, align: 'right' });

    return canvas.encode('png');
}
