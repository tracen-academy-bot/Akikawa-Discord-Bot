import { prisma } from '../db/prisma';

/**
 * A club's staff roles, found by name.
 *
 * The server already gives club staff roles like "Cosmos Trainer" and
 * "Cosmos Assistant". Rather than make Club Managers add every Trainer and
 * Assistant with `/club member`, the bot reads the server's roles and matches
 * them to clubs by name. A Club Manager can override the list with
 * `/club edit`; a club with a stored list uses that list only, and a club
 * with an empty one uses the name matches.
 *
 * Matching works on words: names are lower-cased, accents and emoji dropped,
 * and split on anything that is not a letter or digit. A club matches a role
 * when the club's words, run together, equal a run of the role's words run
 * together. So "Cosmos" matches "Cosmos Trainer" and "Alt Lair" matches
 * "AltLair Assistant", but "Cosmos" does not match "CosmosX Trainer" or
 * "Cosmo Trainer". When one club's match sits inside a longer club's match,
 * the longer one wins, so "Cosmos II Trainer" goes to "Cosmos II" and not to
 * "Cosmos". Matches in different parts of the name all count, so a
 * "Cosmos Primrose Trainer" role belongs to both clubs.
 *
 * A role must also have a staff word in it (Trainer or Assistant), so a
 * plain "Cosmos" member role does not make every member club staff.
 *
 * Home channels are not matched by name (yet); they are set with `/club edit`.
 */

/** The parts of a club this module reads. */
export interface LinkableClub {
    id: string;
    name: string;
    staffRoleIds: string[];
}

/** The parts of a role this module reads. */
export interface NamedThing {
    id: string;
    name: string;
}

/** The parts of a guild this module reads; a discord.js `Guild` fits. */
export interface LinkableGuild {
    id: string;
    roles: { cache: { values(): Iterable<NamedThing> } };
}

/** Words that say what a role is for. */
const STAFF_WORDS = new Set(['trainer', 'trainers', 'assistant', 'assistants']);
/** Words left out of a club's name when matching, unless nothing else is left. */
const GENERIC_WORDS = new Set(['the', 'club', 'circle']);

/** Splits a name into lower-case words, dropping accents, emoji and punctuation. */
export function nameWords(name: string): string[] {
    return name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** A club's name as matched: its words without generic ones, run together. */
function clubKey(name: string): string {
    const words = nameWords(name);
    const specific = words.filter((w) => !GENERIC_WORDS.has(w));
    return (specific.length > 0 ? specific : words).join('');
}

/** A run of words, from `start` up to but not including `end`. */
interface Span {
    start: number;
    end: number;
}

/** Every run of `words` that, run together, equals `key`. */
function spansOf(words: string[], key: string): Span[] {
    const spans: Span[] = [];
    if (!key) return spans;
    for (let start = 0; start < words.length; start += 1) {
        let joined = '';
        for (let end = start; end < words.length && joined.length < key.length; end += 1) {
            joined += words[end];
            if (joined === key) spans.push({ start, end: end + 1 });
        }
    }
    return spans;
}

/** True when `outer` covers `inner` and is longer. */
function strictlyCovers(outer: Span, inner: Span): boolean {
    return outer.start <= inner.start && inner.end <= outer.end && outer.end - outer.start > inner.end - inner.start;
}

/**
 * The clubs a role name belongs to: those whose name it contains,
 * leaving out a club whose every match sits inside a longer club's match.
 * Empty when none match.
 */
export function clubsForName<C extends { name: string }>(clubs: C[], targetName: string): C[] {
    const words = nameWords(targetName);
    const matches = clubs.map((club) => ({ club, spans: spansOf(words, clubKey(club.name)) })).filter((m) => m.spans.length > 0);
    return matches
        .filter((m) => !m.spans.every((inner) => matches.some((o) => o !== m && o.spans.some((outer) => strictlyCovers(outer, inner)))))
        .map((m) => m.club);
}

/** True when a role name says it is a staff role (Trainer or Assistant). */
export function isStaffRoleName(name: string): boolean {
    return nameWords(name).some((w) => STAFF_WORDS.has(w));
}

/** The roles whose names match `club` and name a staff role, by ID. */
export function matchedStaffRoleIds(club: LinkableClub, clubs: LinkableClub[], roles: Iterable<NamedThing>): string[] {
    const ids: string[] = [];
    for (const role of roles) {
        if (!isStaffRoleName(role.name)) continue;
        if (clubsForName(clubs, role.name).some((c) => c.id === club.id)) ids.push(role.id);
    }
    return ids;
}

/** A club's roles (or channels), and whether they were set by hand or matched by name. */
export interface Links {
    ids: string[];
    matched: boolean;
}

/** A club's staff roles: the stored list, or the name matches when it is empty. */
export function staffRolesOf(club: LinkableClub, clubs: LinkableClub[], guild: LinkableGuild): Links {
    if (club.staffRoleIds.length > 0) return { ids: club.staffRoleIds, matched: false };
    return { ids: matchedStaffRoleIds(club, clubs, guild.roles.cache.values()), matched: true };
}

/** Every club in a guild, for matching. Matching needs all of them to pick the longest name. */
export function guildClubs(guildId: string): Promise<LinkableClub[]> {
    return prisma.trackedCircle.findMany({
        where: { guildId },
        select: { id: true, name: true, staffRoleIds: true },
    });
}

/**
 * What to store for a list a Club Manager submitted: nothing when it equals
 * the name matches (so the club keeps following them), the list otherwise.
 */
export function listToStore(submitted: string[], matched: string[]): string[] {
    const a = [...new Set(submitted)].sort();
    const b = [...new Set(matched)].sort();
    return a.length === b.length && a.every((id, i) => id === b[i]) ? [] : submitted;
}
