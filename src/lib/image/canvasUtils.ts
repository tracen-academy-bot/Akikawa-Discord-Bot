import { SKRSContext2D, Image, loadImage } from "@napi-rs/canvas";
import * as path from 'path';
import * as fs from 'fs';
import { ClubRank } from '@prisma/client';
import { font } from './fonts';
import { THEME } from './theme';

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export const RANK_COLORS: Record<ClubRank, string> = {
    S_PLUS: '#ffd166',
    S: '#f4b13f',
    A_PLUS: '#7ee787',
    A: '#56d364',
    B_PLUS: '#79c0ff',
    B: '#58a6ff'
};

export const RANK_LABELS: Record<ClubRank, string> = {
    S_PLUS: 'S',
    S: 'S',
    A_PLUS: 'A',
    A: 'A',
    B_PLUS: 'B',
    B: 'B'
};

const rankIconCache = new Map<ClubRank, Image | null>();
const clubIconCache = new Map<string, Image | null>();

export async function loadRankIcon(rank: ClubRank): Promise<Image | null> {
    if (rankIconCache.has(rank)) return rankIconCache.get(rank)!;

    const filePath = path.join(__dirname, '..', '..', 'assets', 'ranks', `${rank}.png`);
    if (!fs.existsSync(filePath)) {
        rankIconCache.set(rank, null);
        return null;
    }

    try {
        const img = await loadImage(filePath);
        rankIconCache.set(rank, img);
        return img;
    } catch {
        rankIconCache.set(rank, null);
        return null;
    }
}

export async function drawRankBadge(ctx: SKRSContext2D, rank: ClubRank, cx: number, cy: number, r: number, labelFontSize: number) {
    const icon = await loadRankIcon(rank);

    if (icon) {
        ctx.drawImage(icon, cx - r, cy - r, r*2, r*2);
        return;
    }

    const color = RANK_COLORS[rank];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.lineWidth = Math.max(2, r/12);
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.font = font(`bold ${labelFontSize}px`);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RANK_LABELS[rank], cx, cy + 2);
}

export async function loadClubIcon(clubId: string): Promise<Image | null> {
    if (clubIconCache.has(clubId)) return clubIconCache.get(clubId)!;

    const filePath = path.join(__dirname, '..', '..', 'assets', 'clubs', `${clubId}.png`);
    if (!fs.existsSync(filePath)) {
        clubIconCache.set(clubId, null);
        return null;
    }

    try {
        const img = await loadImage(filePath);
        clubIconCache.set(clubId, img);
        return img;
    } catch {
        clubIconCache.set(clubId, null);
        return null;
    }
}

export async function drawClubIcon(ctx: SKRSContext2D, club: { id: string; name: string; rank: ClubRank }, cx: number, cy: number, r: number, labelFontSize: number) {
    const icon = await loadClubIcon(club.id);

    if (icon) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(icon, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, r / 20);
        ctx.strokeStyle = THEME.line;
        ctx.stroke();
        return;
    }

    const color = RANK_COLORS[club.rank];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = font(`bold ${labelFontSize}px`);
    ctx.fillStyle = THEME.bg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(club.name[0]?.toUpperCase() ?? '?', cx, cy + 2);
}