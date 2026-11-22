import type { ExtraSection } from './image/renderClubPoster';

/**
 * Clubs on the Japanese server, written down by hand for the club poster.
 *
 * uma.moe does not track them, so nothing here updates itself: edit this
 * file when one changes. Every other club on the poster comes from the
 * database and uma.moe. The section is drawn after the tiers.
 *
 * 風と風船: from its leader, 2026-11-21. Aims for B+ to A (set as B+), no
 * quota or daily requirement, 29 members.
 */
export const JP_SECTION: ExtraSection = {
    title: 'JP',
    color: 0xff4646,
    clubs: [
        {
            id: 'jp-kaze-to-fuusen',
            name: '風と風船',
            // assets/clubs/kazetofuusen.png; the Japanese name has no words to match.
            avatar: 'kazetofuusen',
            rank: 'B_PLUS',
            headcount: 29,
            quotaText: 'None',
            dailyRequirement: null,
            monthlyRank: null,
        },
    ],
};
