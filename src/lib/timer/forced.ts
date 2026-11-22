/**
 * Forced pings (owner, 2026-11-22): everything that decides what a trainer's
 * next ping is, whatever the roll. Each source is marked `forced: true` and
 * has a priority. The scheduler asks `nextForcedPing` once per ping: the
 * highest-priority source that is due fires, and every other due source
 * waits, still due, for a later ping. Nothing is lost by waiting.
 *
 * To add a future interaction that forces a ping, add a source here, with a
 * priority and a note, rather than a new special case in the scheduler. The
 * table lives in docs/special-sets/forced-pings.md; keep both in step.
 *
 * Rules every source follows:
 *   - A forced special (`opener`) posts as that special: it is found,
 *     rolls its outcomes, and spends running boosts like any special ping.
 *   - A forced scene (`text`, no special) rolls nothing, so it spends no
 *     boosts. A scheduled lesson still counts it as a run.
 *   - A Fortune Tent curse never blocks a forced ping: it only lowers the
 *     random roll, and a forced ping skips the roll.
 */
import { closedSpecialsFor, guaranteedOpener, type OutcomeState } from './rares';
import { tentIntroDue, tentIntroShown, tentIntroText } from './fortune';

/** A ping that must happen, from one source. */
export interface ForcedPing {
    /** The source's id (`ForcedSource.id`). */
    source: string;
    forced: true;
    /** The special it posts (a forced special), or undefined for a scene. */
    opener?: string;
    /** The scene's text, with the mention filled (a forced scene). */
    text?: string;
    /** Run after it posts (e.g. "the intro was shown"). */
    shown?: () => Promise<void>;
}

/** What a source needs to decide whether it is due. */
export interface ForcedContext {
    guildId: string;
    discordUserId: string;
    state: OutcomeState;
    lockedSets: readonly string[];
    now: Date;
}

/** One kind of forced ping. */
export interface ForcedSource {
    id: string;
    forced: true;
    /** Lower fires first. */
    priority: number;
    /** What it is, for the docs table. */
    note: string;
    due(ctx: ForcedContext): Promise<ForcedPing | null>;
}

/**
 * Every forced ping, by priority. A guaranteed special beats the tent's
 * introduction: a lesson owed (or a guest, or a one-time rig) should not be
 * delayed by a scene, and the scene loses nothing by waiting.
 */
export const FORCED_SOURCES: readonly ForcedSource[] = [
    {
        id: 'guarantee',
        forced: true,
        priority: 1,
        note: "A guaranteed special (`TimerUserSettings.guaranteedSpecialId`): a lost Rehearsal's retry, a scheduled lesson once due, Helios's guest, a one-time rig. Waits while its set is locked or paused, or the special is closed; not while the set is turned off.",
        async due(ctx) {
            const closed = ctx.state.guaranteedSpecialId ? await closedSpecialsFor(ctx.guildId, ctx.discordUserId) : [];
            const opener = guaranteedOpener(ctx.state, ctx.lockedSets, closed);
            return opener ? { source: 'guarantee', forced: true, opener } : null;
        },
    },
    {
        id: 'tent-intro',
        forced: true,
        priority: 2,
        note: "Fuku-chan's Fortune Tent introduction: once, on the run after the unlock (`TimerUserSettings.tentIntroOwed`). A scene, not a special. The Fortune button waits for it.",
        async due(ctx) {
            if (!(await tentIntroDue(ctx.guildId, ctx.discordUserId, false, ctx.now))) return null;
            return {
                source: 'tent-intro',
                forced: true,
                text: tentIntroText(ctx.discordUserId),
                shown: () => tentIntroShown(ctx.guildId, ctx.discordUserId),
            };
        },
    },
];

/** The forced ping this ping must be, or null: the highest-priority source that is due. */
export async function nextForcedPing(ctx: ForcedContext, sources: readonly ForcedSource[] = FORCED_SOURCES): Promise<ForcedPing | null> {
    for (const source of [...sources].sort((a, b) => a.priority - b.priority)) {
        const ping = await source.due(ctx);
        if (ping) return ping;
    }
    return null;
}
