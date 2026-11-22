import * as path from 'node:path';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ClubRank } from '@prisma/client';
import { drawClubIcon, drawRankBadge, roundRect } from './canvasUtils';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { fit } from './cards';
import { font } from './fonts';
import { GROUPS, GROUP_ORDER, type RankGroup } from '../clubGroups';

/**
 * Every club on one picture, the last message of the club directory: a band
 * per rank group (S, A+, A, B+, Casual; `clubGroups.ts`) in the group's
 * colour, then one row per club.
 *
 * Landscape: the groups flow, in order, into two columns of rows under a
 * full-width banner, each to the shorter column (`splitColumns`).
 *
 * Rows rather than cards, so the columns line up and clubs compare at a
 * glance: expected rank, quota (as set, and per day so a weekly and a
 * monthly quota can be compared), members, and open spots. Open spots are
 * the right-most column and the only filled shape, since they are what an
 * applicant looks for first.
 *
 * Drawn at twice its layout size so it stays sharp when Discord scales it
 * to the reader's screen, and encoded as JPEG (see the end of `renderClubPoster`).
 */

/** One column of rows; two sit side by side, so the poster is landscape. */
const COLUMN_W = 1104;
const COLUMNS = 2;
const GUTTER = 40;
const MARGIN = 48;
/** Layout width; the image is `SCALE` times this. */
const WIDTH = MARGIN * 2 + COLUMN_W * COLUMNS + GUTTER * (COLUMNS - 1);
const SCALE = 2;
const HEADER_H = 178;
const BAND_H = 62;
const ROW_H = 84;
const SECTION_GAP = 26;
const FOOTER_H = 84;

/** Members a club holds in game. */
const CLUB_SIZE = 30;

/** Positions within a column, from its left edge (left edges, or centres where noted). */
const COL = {
    avatar: 44, // centre
    name: 88,
    rank: 500, // centre
    quota: 552,
    perDay: 760,
    members: 870,
    open: COLUMN_W - 20, // right edge, inset from the row's
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
const BEACH_H = 760;

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

/**
 * Backdrops: `beach` is the poster's (the default), `dark` the bot's usual
 * theme without a picture. (Three #ff4646 versions were tried and dropped.)
 */
export const BACKDROPS = {
    dark: { fill: flat(THEME.bg), row: THEME.bg, rowAlt: THEME.bgRaised, ink: THEME.text, inkMuted: THEME.muted, accent: THEME.gold, highlight: THEME.green },
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
} satisfies Record<string, Backdrop>;

/** Expected ranks, highest first; clubs with none set come last. */
const RANK_ORDER: (ClubRank | null)[] = ['S_PLUS', 'S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL', null];

/** A club as the poster shows it. */
export interface PosterClub {
    id: string;
    name: string;
    /** The rank group it is drawn under (`rankGroup`). */
    group: RankGroup;
    rank: ClubRank | null;
    /** Current members on uma.moe; null when not tracked. */
    headcount: number | null;
    /** e.g. "80.0M/month", or "Not set". */
    quotaText: string;
    /** The quota as fans a day (`clubDailyRequirement`); null when not set. */
    dailyRequirement: number | null;
    /**
     * The avatar file in `assets/clubs` to use, by base name, when the club's
     * name cannot find it (a Japanese name has no words to match on).
     */
    avatar?: string;
    /** uma.moe monthly rank at the last sync, if tracked. */
    monthlyRank: number | null;
}

/**
 * A section drawn after the rank groups, from data written down by hand rather
 * than tracked (see `src/lib/jpClubs.ts`). Its clubs are drawn in the order
 * given.
 */
export interface ExtraSection {
    title: string;
    /** Shown at the band's right. */
    note?: string;
    /** 0xRRGGBB. */
    color: number;
    clubs: Omit<PosterClub, 'group'>[];
}

/** One band and its rows, as drawn. */
interface Section {
    title: string;
    note?: string;
    color: number;
    clubs: Omit<PosterClub, 'group'>[];
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
 * Orders a group's clubs: by expected rank, highest first, then by daily
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
function openSpots(club: Pick<PosterClub, 'headcount'>): number | null {
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
async function drawRow(ctx: SKRSContext2D, club: Omit<PosterClub, 'group'>, x: number, y: number, color: number, shaded: boolean, page: Backdrop) {
    const cy = y + ROW_H / 2;
    ctx.fillStyle = shaded ? page.rowAlt : page.row;
    ctx.fillRect(x, y, COLUMN_W, ROW_H);
    const c = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, x + v])) as typeof COL;

    await drawClubIcon(ctx, club.avatar ? { ...club, name: club.avatar } : club, c.avatar, cy, 28, 24);

    // The name, then the club's uma.moe rank this month as a bare number.
    const rank = club.monthlyRank ? `#${club.monthlyRank.toLocaleString('en-US')}` : '';
    ctx.font = font('500 18px');
    const rankW = rank ? ctx.measureText(rank).width + 12 : 0;
    const name = fit(ctx, club.name, c.rank - 34 - c.name - rankW, '700 27px');
    const nameW = drawText(ctx, name, c.name, cy + 10, { spec: '700 27px', color: THEME.text });
    if (rank) drawText(ctx, rank, c.name + nameW + 12, cy + 10, { spec: '500 18px', color: THEME.muted });

    await drawRankBadge(ctx, club.rank, c.rank, cy, 29, 18);

    const unset = club.quotaText === 'Not set';
    drawText(ctx, unset ? '—' : fit(ctx, club.quotaText, c.perDay - 24 - c.quota, '600 20px'), c.quota, cy + 7, {
        spec: '600 20px',
        color: unset ? THEME.faint : THEME.text,
    });
    if (club.dailyRequirement === null) {
        drawText(ctx, '—', c.perDay, cy + 7, { spec: '600 20px', color: THEME.faint });
    } else {
        const w = drawText(ctx, shortFans(club.dailyRequirement), c.perDay, cy + 7, { spec: '600 20px', color: THEME.text });
        drawText(ctx, '/day', c.perDay + w + 1, cy + 7, { spec: '400 14px', color: THEME.muted });
    }

    if (club.headcount === null) {
        drawText(ctx, '—', c.members, cy + 7, { spec: '600 20px', color: THEME.faint });
    } else {
        drawText(ctx, `${club.headcount}/${CLUB_SIZE}`, c.members, cy + 2, { spec: '600 20px', color: THEME.text });
        const barW = 92;
        roundRect(ctx, c.members, cy + 12, barW, 5, 2.5);
        ctx.fillStyle = THEME.line;
        ctx.fill();
        roundRect(ctx, c.members, cy + 12, Math.max(5, barW * Math.min(1, club.headcount / CLUB_SIZE)), 5, 2.5);
        ctx.fillStyle = hex(color);
        ctx.fill();
    }

    drawOpen(ctx, openSpots(club), c.open, cy, THEME.bg);
}

/** A section's band: its colour, title and note. */
function drawBand(ctx: SKRSContext2D, info: Section, x: number, y: number, page: Backdrop) {
    ctx.fillStyle = page.row;
    ctx.fillRect(x, y, COLUMN_W, BAND_H);
    ctx.fillStyle = tint(info.color, 0.1);
    ctx.fillRect(x, y, COLUMN_W, BAND_H);
    ctx.fillStyle = hex(info.color);
    ctx.fillRect(x, y, 6, BAND_H);
    drawText(ctx, info.title, x + 26, y + 41, { spec: '700 29px', color: hex(info.color) });
    if (info.note) drawText(ctx, info.note, x + COL.open, y + 39, { spec: '600 20px', color: THEME.text, align: 'right' });
}

/** A big figure over its label, right-aligned at `right`. */
function drawStat(ctx: SKRSContext2D, label: string, value: string, right: number, color: string, page: Backdrop) {
    drawLabel(ctx, label, right, 76, page.inkMuted, 12, 'right');
    drawText(ctx, value, right, 120, { spec: '700 38px', color, align: 'right' });
}

/** A section's height: its band, its rows and the gap after it. */
function sectionHeight(s: Section): number {
    return BAND_H + s.clubs.length * ROW_H + SECTION_GAP;
}

/**
 * Splits the sections between two columns, in order, each into whichever
 * column is shorter so far (the left on a tie). Rank order then reads
 * left, right, then down, and the columns end close together. Keeping each
 * column's sections in one run (S, A+, A | the rest) left the 2026-11-22
 * poster at 9 clubs against 5.
 */
export function splitColumns<T>(heights: number[], items: T[]): [T[], T[]] {
    const columns: [T[], T[]] = [[], []];
    let left = 0;
    let right = 0;
    items.forEach((item, i) => {
        if (right < left) {
            columns[1].push(item);
            right += heights[i] ?? 0;
        } else {
            columns[0].push(item);
            left += heights[i] ?? 0;
        }
    });
    return columns;
}

/** "21 Nov 2026" in UTC. */
function shortDate(date: Date): string {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Renders the poster. Within a rank group, clubs are ordered by `posterOrder`;
 * groups with no clubs are left out. `extra` sections follow the groups.
 * No column labels: each value carries its unit ("/month", "/day", "29/30"). `updatedAt` is printed in the footer, so
 * a reader can tell how fresh the members and ranks are.
 */
export async function renderClubPoster(clubs: PosterClub[], options: { title?: string; footer?: string; updatedAt?: Date; backdrop?: Backdrop; extra?: ExtraSection[] } = {},
): Promise<Buffer> {
    const sections: Section[] = [
        ...GROUP_ORDER.map((group) => ({ title: GROUPS[group].label, color: GROUPS[group].color, clubs: posterOrder(clubs.filter((c) => c.group === group)) })),
        ...(options.extra ?? []),
    ].filter((s) => s.clubs.length > 0);
    // Header totals count every club drawn, hand-written ones included.
    const all = sections.flatMap((s) => s.clubs);
    const columns = splitColumns(sections.map(sectionHeight), sections);
    const body = Math.max(...columns.map((col) => col.reduce((sum, s) => sum + sectionHeight(s), 0)));
    const page: Backdrop = options.backdrop ?? BACKDROPS.beach;
    const headerH = page.headerH ?? HEADER_H;
    const height = headerH + (sections.length > 0 ? body : 80) + FOOTER_H;

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
    drawLabel(ctx, 'Tracen Academy', MARGIN, 62, page.accent, 16);
    drawText(ctx, options.title ?? 'Our Clubs', MARGIN, 128, { spec: '700 68px', color: page.ink });
    const tracked = all.filter((c) => c.headcount !== null);
    const right = WIDTH - MARGIN;
    if (page.statsPanel) {
        const left = tracked.length > 0 ? right - 392 : right - 130;
        roundRect(ctx, left, 44, WIDTH - 24 - left, 98, 16);
        ctx.fillStyle = page.statsPanel;
        ctx.fill();
    }
    if (tracked.length > 0) {
        const open = tracked.reduce((sum, c) => sum + (openSpots(c) ?? 0), 0);
        const members = tracked.reduce((sum, c) => sum + c.headcount!, 0);
        drawStat(ctx, 'Open spots', String(open), right, open > 0 ? page.highlight : page.inkMuted, page);
        drawStat(ctx, 'Trainers', members.toLocaleString('en-US'), right - 160, page.ink, page);
        drawStat(ctx, 'Clubs', String(all.length), right - 300, page.ink, page);
    } else {
        drawStat(ctx, 'Clubs', String(all.length), right, page.ink, page);
    }
    drawRule(ctx, MARGIN, headerH - 30, WIDTH - MARGIN * 2, page.accent, 2);

    let y = headerH;
    if (sections.length === 0) {
        drawText(ctx, 'No clubs have an expected rank yet.', MARGIN, y + 40, { spec: '400 18px', color: page.inkMuted });
        y += 80;
    }
    ctx.restore();

    // ── Rank groups, in two columns ───────────────────────────────────────────
    for (const [i, column] of columns.entries()) {
        const x = MARGIN + i * (COLUMN_W + GUTTER);
        let cy = y;
        for (const section of column) {
            drawBand(ctx, section, x, cy, page);
            cy += BAND_H;
            for (const [j, club] of section.clubs.entries()) {
                await drawRow(ctx, club, x, cy, section.color, j % 2 === 1, page);
                cy += ROW_H;
            }
            cy += SECTION_GAP;
        }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    drawRule(ctx, MARGIN, height - FOOTER_H + 10, WIDTH - MARGIN * 2, page.inkMuted, 1);
    drawText(ctx, options.footer ?? 'Want in? Open a post in #apply-for-club with your trainer ID.', MARGIN, height - 32, { spec: '600 19px', color: page.accent });
    const source = options.updatedAt ? `Members and ranks from uma.moe, ${shortDate(options.updatedAt)}` : 'Members and ranks from uma.moe';
    drawText(ctx, source, WIDTH - MARGIN, height - 32, { spec: '400 13px', color: page.inkMuted, align: 'right' });

    // JPEG: the poster is mostly picture, and as PNG it ran to about 6 MB,
    // close to Discord's upload limit. Quality 92 keeps the text crisp.
    return canvas.encode('jpeg', 92);
}
