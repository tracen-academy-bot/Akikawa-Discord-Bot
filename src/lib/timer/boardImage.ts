import type { Guild } from 'discord.js';
import { renderTimerLeaderboard } from '../image/renderTimerLeaderboard';
import { getBoard, getTimerSettings, type Board, type BoardPeriod } from './rewards';

/** A trainer's display name in the guild, or a fallback when they have left. */
export async function displayName(guild: Guild, userId: string, fallback = 'Unknown Trainer'): Promise<string> {
    try {
        return (await guild.members.fetch(userId)).displayName;
    } catch {
        return fallback;
    }
}

/**
 * Renders a leaderboard for `guild`: the board for `period` (or one already
 * fetched), display names, and the weekly role's name for the podium line.
 */
export async function renderBoardFor(guild: Guild, period: BoardPeriod, board?: Board): Promise<Buffer> {
    const shown = board ?? (await getBoard(guild.id, period));
    const names = new Map<string, string>();
    for (const row of shown.rows) names.set(row.discordUserId, await displayName(guild, row.discordUserId));
    const settings = await getTimerSettings(guild.id);
    const role = settings?.topRoleId ? guild.roles.cache.get(settings.topRoleId) : undefined;
    return renderTimerLeaderboard(shown, names, role?.name ?? null);
}
