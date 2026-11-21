import type { ClubRank, ClubTier } from '@prisma/client';

/**
 * The club tiers: what each means and its colour, shared by the club
 * directory and the club poster (which draws each tier's title and ranks).
 */

/** What a tier means, as the club poster explains it. */
export interface TierInfo {
    label: string;
    title: string;
    /** What the tier is for. Not shown anywhere since 2026-11-21; kept for the wording. */
    blurb: string;
    ranks: string;
    color: number;
}

export const TIERS: Record<ClubTier, TierInfo> = {
    G1: {
        label: 'G1',
        title: 'G1 [Competitive]',
        blurb: 'The top clubs in our network, pushing for gold!',
        ranks: 'S to S+ (Top 100)',
        color: 0xf5c84c,
    },
    G2: {
        label: 'G2',
        title: 'G2 [Semi Competitive+]',
        blurb: 'Our more intense and active semi-competitive clubs that aim for strong monthly results.',
        ranks: 'A to A+ (Top 300~500)',
        color: 0xa7d8f5,
    },
    G3: {
        label: 'G3',
        title: 'G3 [Semi-Competitive]',
        blurb: 'Our mid-range clubs that offer a good balance between activity and commitment!',
        ranks: 'B+ to A',
        color: 0xd9784a,
    },
    DEBUT: {
        label: 'Debut',
        title: 'Debut [Casual]',
        blurb: 'Our clubs for trainers who just want to relax and have fun!',
        ranks: 'C+ to B+',
        color: 0x4ade80,
    },
};

/** Tiers in directory order. */
export const TIER_ORDER: ClubTier[] = ['G1', 'G2', 'G3', 'DEBUT'];

/**
 * The tier a club's expected rank puts it in, when a Club Manager has not
 * picked one. The published ranges overlap: A is in both G2 ("A to A+") and
 * G3 ("B+ to A"), and B+ in both G3 and Debut. A goes to G2 and B+ to G3;
 * Casual is Debut. A tier picked in `/club profile` always wins.
 */
export const TIER_FOR_RANK: Record<ClubRank, ClubTier> = {
    S_PLUS: 'G1',
    S: 'G1',
    A_PLUS: 'G2',
    A: 'G2',
    B_PLUS: 'G3',
    CASUAL: 'DEBUT',
};

/** The tier a club is listed under: the one picked, else its expected rank's, else none. */
export function effectiveTier(club: { tier: ClubTier | null; rank: ClubRank | null }): ClubTier | null {
    return club.tier ?? (club.rank ? TIER_FOR_RANK[club.rank] : null);
}
