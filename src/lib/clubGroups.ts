import type { ClubRank } from '@prisma/client';

/**
 * How the club directory and the club poster group clubs: by expected rank,
 * with S+ and S together. Asked for "for simplicity" on 2026-11-21, in place
 * of the G1/G2/G3/Debut tiers, whose published rank ranges overlapped. A
 * club with no expected rank is left out.
 */

export type RankGroup = 'S' | 'A_PLUS' | 'A' | 'B_PLUS' | 'CASUAL';

/** A group's name and colour (0xRRGGBB, close to its rank badge's art). */
export interface GroupInfo {
    label: string;
    color: number;
}

export const GROUPS: Record<RankGroup, GroupInfo> = {
    S: { label: 'S', color: 0xf5c84c },
    A_PLUS: { label: 'A+', color: 0xff8a3d },
    A: { label: 'A', color: 0xd9784a },
    B_PLUS: { label: 'B+', color: 0xf27bbd },
    CASUAL: { label: 'Casual', color: 0x4ade80 },
};

/** Groups in directory order, highest first. */
export const GROUP_ORDER: RankGroup[] = ['S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL'];

/** The group a club's expected rank puts it in; none without a rank. */
export function rankGroup(rank: ClubRank | null): RankGroup | null {
    if (rank === null) return null;
    return rank === 'S_PLUS' ? 'S' : rank;
}
