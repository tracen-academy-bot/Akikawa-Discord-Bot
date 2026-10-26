import type { Guild } from 'discord.js';
import type { TimerSettings } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { TRAINING_MINUTES, dayKey, getLeaderboard, type LeaderboardRow } from './service';

/**
 * Timer rewards: the weekly top-runner role and milestone roles.
 *
 * Weeks run Monday 00:00 to Sunday 24:00 in the timer's day timezone (JST by
 * default, `TIMER_STREAK_TIMEZONE`), the same day boundaries as streaks. A run
 * belongs to the week its 50 minutes ended in (`completedAt`).
 *
 * After a week ends, its top 3 by runs take the guild's top role, and last
 * week's holders lose it. Ties go to whoever reached their final count first.
 * The award waits `AWARD_GRACE_MS` into the new week so every run of the old
 * one is recorded, and is claimed in the database so it happens once even
 * across restarts or two overlapping ticks.
 *
 * Milestone roles are kept for good: given the moment a run brings a
 * trainer's total to the milestone, and to everyone already past it when the
 * milestone is added.
 */

/** Places that take the weekly role. */
export const TOP_PLACES = 3;

/** How long into a new week the old one is awarded. */
const AWARD_GRACE_MS = 15 * 60_000;

/** A week's standing for one trainer. */
export interface WeekRow extends LeaderboardRow {
    /** When their last run of the week ended: the earlier, the better in a tie. */
    lastAt: Date;
}

/** The `YYYY-MM-DD` key `days` after `key`, on the calendar (no time zone). */
export function shiftKey(key: string, days: number): string {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** The week containing `date`, as its Monday's day key. */
export function weekKey(date: Date): string {
    const today = dayKey(date);
    // 0 is Sunday; Monday starts the week.
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    return shiftKey(today, -((weekday + 6) % 7));
}

/**
 * When the week containing `now` ends: the first moment that is in the next
 * week, to the minute. Found by search rather than time zone arithmetic, so
 * it is right for whatever `TIMER_STREAK_TIMEZONE` says.
 */
export function nextWeekStart(now = new Date()): Date {
    const current = weekKey(now);
    const step = 60 * 60_000;
    let after = now.getTime();
    while (weekKey(new Date(after)) === current) after += step;
    // The change is within the last hour stepped; narrow it to the minute.
    let before = after - step;
    while (after - before > 60_000) {
        const mid = before + Math.floor((after - before) / 2);
        if (weekKey(new Date(mid)) === current) before = mid;
        else after = mid;
    }
    return new Date(Math.ceil(after / 60_000) * 60_000);
}

/** "Oct 19 – Oct 25" for a week key. */
export function weekLabel(week: string): string {
    const format = (key: string) =>
        new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${format(week)} – ${format(shiftKey(week, 6))}`;
}

/**
 * Everyone's runs in a week, most first; ties go to whoever reached their
 * count first.
 */
export async function getWeekStandings(guildId: string, week: string): Promise<WeekRow[]> {
    // A day either side covers any time zone; the day keys then decide.
    const from = new Date(new Date(`${week}T00:00:00Z`).getTime() - 86_400_000);
    const to = new Date(new Date(`${shiftKey(week, 7)}T00:00:00Z`).getTime() + 86_400_000);
    const last = shiftKey(week, 6);
    const runs = await prisma.trainingRun.findMany({
        where: { guildId, completedAt: { gte: from, lt: to } },
        select: { discordUserId: true, completedAt: true },
    });
    const byUser = new Map<string, WeekRow>();
    for (const run of runs) {
        const key = dayKey(run.completedAt);
        if (key < week || key > last) continue;
        const row = byUser.get(run.discordUserId) ?? { discordUserId: run.discordUserId, runs: 0, minutes: 0, lastAt: run.completedAt };
        row.runs += 1;
        row.minutes += TRAINING_MINUTES;
        if (run.completedAt > row.lastAt) row.lastAt = run.completedAt;
        byUser.set(run.discordUserId, row);
    }
    return [...byUser.values()].sort((a, b) => b.runs - a.runs || a.lastAt.getTime() - b.lastAt.getTime());
}

/** Leaderboard windows: this week so far, last week's final standings, and the rolling ones. */
export type BoardPeriod = 'thisweek' | 'lastweek' | 'month' | 'all';

/** A leaderboard and the week it covers, when it is a week. */
export interface Board {
    period: BoardPeriod;
    /** The top `limit` rows. */
    rows: LeaderboardRow[];
    week: string | null;
    /** Runs and trainers over the whole window, not only the rows shown. */
    totalRuns: number;
    trainers: number;
}

/** The leaderboard for a window, top `limit` rows. */
export async function getBoard(guildId: string, period: BoardPeriod, limit = 15, now = new Date()): Promise<Board> {
    if (period === 'thisweek') return boardForWeek(guildId, weekKey(now), period, limit);
    if (period === 'lastweek') return boardForWeek(guildId, shiftKey(weekKey(now), -7), period, limit);
    // Every trainer, so the totals cover the window; a guild has hundreds at most.
    return boardOf(period, null, await getLeaderboard(guildId, period, 100_000), limit);
}

/** The leaderboard for one week; `period` says whether it is shown as live or final. */
export async function boardForWeek(guildId: string, week: string, period: 'thisweek' | 'lastweek', limit = 15): Promise<Board> {
    return boardOf(period, week, await getWeekStandings(guildId, week), limit);
}

/** A board from every trainer's row: the top `limit`, and totals over all. */
function boardOf(period: BoardPeriod, week: string | null, all: LeaderboardRow[], limit: number): Board {
    return {
        period,
        week,
        rows: all.slice(0, limit),
        totalRuns: all.reduce((sum, r) => sum + r.runs, 0),
        trainers: all.length,
    };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** A guild's reward settings, or null before `/timer rewards` was first used. */
export function getTimerSettings(guildId: string): Promise<TimerSettings | null> {
    return prisma.timerSettings.findUnique({ where: { guildId } });
}

/**
 * Saves reward settings. A new row starts as awarded up to the week before
 * last, so the next tick awards last week straight away and posts its
 * results (Fwoxie, 2026-10-26: "probably post last week's results too").
 * Older weeks are never awarded: the award always covers the latest week
 * that has ended.
 */
export function saveTimerSettings(
    guildId: string,
    change: { topRoleId?: string | null; announceChannelId?: string | null },
    now = new Date(),
): Promise<TimerSettings> {
    return prisma.timerSettings.upsert({
        where: { guildId },
        create: { guildId, ...change, lastAwardedWeek: shiftKey(weekKey(now), -14) },
        update: change,
    });
}

/** Milestone roles, smallest first. */
export function getMilestoneRoles(guildId: string) {
    return prisma.timerMilestoneRole.findMany({ where: { guildId }, orderBy: { runs: 'asc' } });
}

/**
 * Why the bot cannot give `roleId`, or null when it can: the role must exist,
 * not belong to an integration, not be @everyone, and sit below the bot's
 * highest role.
 */
export async function roleProblem(guild: Guild, roleId: string): Promise<string | null> {
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) return 'That role no longer exists.';
    if (role.id === guild.id) return 'The @everyone role cannot be given out.';
    if (role.managed) return `\`${role.name}\` belongs to an integration and cannot be given out.`;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me) return 'I could not check my own roles.';
    if (role.position >= me.roles.highest.position) {
        return `\`${role.name}\` is above my highest role, so I cannot give it. Move my role above it in Server Settings → Roles.`;
    }
    return null;
}

/** Adds or removes a role, logging rather than failing when the member left or Discord refuses. */
async function setRole(guild: Guild, userId: string, roleId: string, give: boolean): Promise<boolean> {
    try {
        const member = await guild.members.fetch(userId);
        if (give) await member.roles.add(roleId, 'Timer reward');
        else await member.roles.remove(roleId, 'Timer reward: next week awarded');
        return true;
    } catch (e) {
        console.error(`Timer reward: could not ${give ? 'give' : 'remove'} role ${roleId} for ${userId}:`, e instanceof Error ? e.message : e);
        return false;
    }
}

// ─── Milestones ───────────────────────────────────────────────────────────────

/**
 * Gives the milestone role for exactly `totalRuns`, if there is one. Called
 * after each recorded run, which raises the total by one, so every milestone
 * is met exactly once. Returns the role given, or null.
 */
export async function awardMilestone(guild: Guild, userId: string, totalRuns: number): Promise<string | null> {
    const milestone = await prisma.timerMilestoneRole.findUnique({ where: { guildId_runs: { guildId: guild.id, runs: totalRuns } } });
    if (!milestone) return null;
    return (await setRole(guild, userId, milestone.roleId, true)) ? milestone.roleId : null;
}

/** Gives a milestone's role to everyone already at or past it. Returns how many got it. */
export async function backfillMilestone(guild: Guild, runs: number, roleId: string): Promise<number> {
    const totals = await prisma.trainingRun.groupBy({ by: ['discordUserId'], where: { guildId: guild.id }, _count: { _all: true } });
    let given = 0;
    for (const t of totals) {
        if (t._count._all >= runs && (await setRole(guild, t.discordUserId, roleId, true))) given += 1;
    }
    return given;
}

// ─── Weekly award ─────────────────────────────────────────────────────────────

/** What one week's award did, for the announcement and the logs. */
export interface WeeklyAward {
    guildId: string;
    week: string;
    winners: WeekRow[];
    /** Last week's holders who lost the role. */
    removed: string[];
}

/**
 * Awards every guild whose last week has not been awarded yet, once the new
 * week is `AWARD_GRACE_MS` old. `guildOf` finds a guild the bot is in.
 */
export async function runWeeklyAwards(guildOf: (guildId: string) => Promise<Guild | null>, now = new Date()): Promise<WeeklyAward[]> {
    // Until the grace has passed, "a quarter of an hour ago" is still last week.
    const current = weekKey(new Date(now.getTime() - AWARD_GRACE_MS));
    const due = shiftKey(current, -7);
    const pending = await prisma.timerSettings.findMany({
        where: { OR: [{ lastAwardedWeek: null }, { lastAwardedWeek: { lt: due } }] },
    });
    const done: WeeklyAward[] = [];
    for (const settings of pending) {
        // Claim the week so a second tick or process does not award it twice.
        const claimed = await prisma.timerSettings.updateMany({
            where: { guildId: settings.guildId, lastAwardedWeek: settings.lastAwardedWeek },
            data: { lastAwardedWeek: due },
        });
        if (claimed.count === 0) continue;

        const winners = (await getWeekStandings(settings.guildId, due)).slice(0, TOP_PLACES);
        if (winners.length > 0) {
            await prisma.timerWeeklyAward.createMany({
                data: winners.map((w, i) => ({ guildId: settings.guildId, week: due, place: i + 1, discordUserId: w.discordUserId, runs: w.runs })),
                skipDuplicates: true,
            });
        }

        const removed: string[] = [];
        const guild = settings.topRoleId ? await guildOf(settings.guildId) : null;
        if (guild && settings.topRoleId) {
            const previous = settings.lastAwardedWeek
                ? await prisma.timerWeeklyAward.findMany({ where: { guildId: settings.guildId, week: settings.lastAwardedWeek } })
                : [];
            const keep = new Set(winners.map((w) => w.discordUserId));
            for (const holder of previous) {
                if (keep.has(holder.discordUserId)) continue;
                if (await setRole(guild, holder.discordUserId, settings.topRoleId, false)) removed.push(holder.discordUserId);
            }
            for (const w of winners) await setRole(guild, w.discordUserId, settings.topRoleId, true);
        }
        done.push({ guildId: settings.guildId, week: due, winners, removed });
    }
    return done;
}
