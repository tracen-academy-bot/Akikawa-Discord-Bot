import type { ClubRank } from '@prisma/client';

/**
 * How the club directory and the club poster group clubs: by expected rank,
 * with S+ and S together. Asked for "for simplicity" on 2026-11-21, in place
 * of the G1/G2/G3/Debut tiers, whose published rank ranges overlapped. A
 * club with no expected rank is left out.
 */

export type RankGroup = 'S' | 'A_PLUS' | 'A' | 'B_PLUS' | 'CASUAL';

/**
 * A group's name, colour (0xRRGGBB, close to its rank badge's art), and the
 * box the directory shows for it: `title` and `blurb`. The blurbs are the
 * old directory's (G1 for S, G2 for A+, G3 for A, Debut for Casual); B+ had
 * none of its own, so its text is new.
 */
export interface GroupInfo {
    label: string;
    color: number;
    title: string;
    blurb: string;
}

export const GROUPS: Record<RankGroup, GroupInfo> = {
    S: { label: 'S', color: 0xf5c84c, title: 'S [Competitive]', blurb: 'The top clubs in our network, pushing for gold!' },
    A_PLUS: { label: 'A+', color: 0xff8a3d, title: 'A+ [Semi Competitive+]', blurb: 'Our more intense and active semi-competitive clubs that aim for strong monthly results.' },
    A: { label: 'A', color: 0xd9784a, title: 'A [Semi-Competitive]', blurb: 'Our mid-range clubs that offer a good balance between activity and commitment!' },
    B_PLUS: { label: 'B+', color: 0xf27bbd, title: 'B+ [Semi-Casual]', blurb: 'Steady clubs with a light quota, for trainers who want some structure without the grind.' },
    CASUAL: { label: 'Casual', color: 0x4ade80, title: 'Casual', blurb: 'Our clubs for trainers who just want to relax and have fun!' },
};

/** Groups in directory order, highest first. */
export const GROUP_ORDER: RankGroup[] = ['S', 'A_PLUS', 'A', 'B_PLUS', 'CASUAL'];

/** The group a club's expected rank puts it in; none without a rank. */
export function rankGroup(rank: ClubRank | null): RankGroup | null {
    if (rank === null) return null;
    return rank === 'S_PLUS' ? 'S' : rank;
}
