import { AttachmentBuilder, type Guild } from 'discord.js';
import { renderTimerLeaderboard } from '../image/renderTimerLeaderboard';
import { SPECIALS_BOARD_ROWS, renderSpecialsLeaderboard } from '../image/renderSpecialsLeaderboard';
import { specialsBoard } from './rares';
import { AWARD_PLACES, TOP_ROLE_PLACES, boardForWeek, getBoard, getTimerSettings, placesLabel, weekLabel, type Board, type BoardPeriod } from './rewards';

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
    const top = settings?.topRoleId ? guild.roles.cache.get(settings.topRoleId) : undefined;
    const second = settings?.secondRoleId ? guild.roles.cache.get(settings.secondRoleId) : undefined;
    return renderTimerLeaderboard(shown, names, top?.name ?? null, second?.name ?? null);
}

/** Renders the specials leaderboard for `guild` (all time), with display names. */
export async function renderSpecialsBoardFor(guild: Guild): Promise<Buffer> {
    const board = await specialsBoard(guild.id, SPECIALS_BOARD_ROWS);
    const names = new Map<string, string>();
    for (const row of board.rows) names.set(row.discordUserId, await displayName(guild, row.discordUserId));
    return renderSpecialsLeaderboard(board, names);
}

/**
 * The post for a finished week: its final board, the top 5 named and
 * pinged (when `ping`), and which role they hold. Used by the weekly award
 * and by `/timer publish`.
 */
export async function weekResultsPost(guild: Guild, week: string, ping: boolean) {
    const board = await boardForWeek(guild.id, week, 'lastweek');
    const settings = await getTimerSettings(guild.id);
    const winners = board.rows.slice(0, AWARD_PLACES);
    const image = await renderBoardFor(guild, 'lastweek', board);
    const lines = [`**Top runners for ${weekLabel(week)}**`];
    if (winners.length === 0) lines.push('No runs were recorded that week.');
    winners.forEach((w, i) => lines.push(`${i + 1}. <@${w.discordUserId}> · ${w.runs} run${w.runs === 1 ? '' : 's'}`));
    // Who holds which weekly role until next week's results.
    const holds = [
        ...(settings?.topRoleId && winners.length > 0 ? [`${placesLabel('top')} hold <@&${settings.topRoleId}>`] : []),
        ...(settings?.secondRoleId && winners.length > TOP_ROLE_PLACES ? [`${placesLabel('second')} hold <@&${settings.secondRoleId}>`] : []),
    ];
    if (holds.length > 0) lines.push(`${holds.join(', ')} until next week's results.`.replace(/^p/, 'P'));
    return {
        content: lines.join('\n'),
        files: [new AttachmentBuilder(image, { name: `training-week-${week}.png` })],
        // Only the winners are pinged, and only when asked; never the role.
        allowedMentions: { users: ping ? winners.map((w) => w.discordUserId) : [] },
    };
}
