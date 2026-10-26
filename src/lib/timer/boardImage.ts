import { AttachmentBuilder, type Guild } from 'discord.js';
import { renderTimerLeaderboard } from '../image/renderTimerLeaderboard';
import { TOP_PLACES, boardForWeek, getBoard, getTimerSettings, weekLabel, type Board, type BoardPeriod } from './rewards';

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

/**
 * The post for a finished week: its final board, the top places named and
 * pinged (when `ping`), and which role they hold. Used by the weekly award
 * and by `/timer publish`.
 */
export async function weekResultsPost(guild: Guild, week: string, ping: boolean) {
    const board = await boardForWeek(guild.id, week, 'lastweek');
    const settings = await getTimerSettings(guild.id);
    const winners = board.rows.slice(0, TOP_PLACES);
    const image = await renderBoardFor(guild, 'lastweek', board);
    const lines = [`**Top runners for ${weekLabel(week)}**`];
    if (winners.length === 0) lines.push('No runs were recorded that week.');
    winners.forEach((w, i) => lines.push(`${i + 1}. <@${w.discordUserId}> · ${w.runs} run${w.runs === 1 ? '' : 's'}`));
    if (settings?.topRoleId && winners.length > 0) {
        lines.push(`${winners.length === 1 ? 'They hold' : `The top ${winners.length} hold`} <@&${settings.topRoleId}> until next week's results.`);
    }
    return {
        content: lines.join('\n'),
        files: [new AttachmentBuilder(image, { name: `training-week-${week}.png` })],
        // Only the winners are pinged, and only when asked; never the role.
        allowedMentions: { users: ping ? winners.map((w) => w.discordUserId) : [] },
    };
}
