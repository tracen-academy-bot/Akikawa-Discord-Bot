import type { ClubTier } from '@prisma/client';

/**
 * The club tiers: what each means and its colour, shared by the club
 * directory and the club poster (which draws each tier's blurb and ranks).
 */

/** What a tier means, as the club poster explains it. */
export interface TierInfo {
    label: string;
    title: string;
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
