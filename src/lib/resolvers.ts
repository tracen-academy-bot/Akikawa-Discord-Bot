import { Guild, GuildMember, Role, Collection } from 'discord.js';

/**
 * Text -> Discord entity resolvers for prefix commands, modelled on how Dyno
 * matched arguments: mentions and IDs first, then exact names, then partial
 * (prefix, then substring) matches. All name matching is case-insensitive.
 *
 * Each resolver returns one of:
 *   { ok: true,  value }        - a single unambiguous match
 *   { ok: false, error }        - nothing matched, or the match is ambiguous
 */

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

const SNOWFLAKE = /^\d{17,20}$/;
const USER_MENTION = /^<@!?(\d{17,20})>$/;
const ROLE_MENTION = /^<@&(\d{17,20})>$/;

/** Max candidates listed when a query is ambiguous. */
const MAX_LISTED = 5;

/**
 * Walks through increasingly loose match tiers and returns the first tier
 * that has any hits. One hit wins; several hits in the same tier is ambiguous.
 */
function pickByTiers<T>(
    items: T[],
    tiers: ((item: T) => boolean)[],
    label: (item: T) => string,
    kind: string,
    query: string,
): Resolved<T> {
    for (const tier of tiers) {
        const hits = items.filter(tier);
        if (hits.length === 1) return { ok: true, value: hits[0]! };
        if (hits.length > 1) {
            const listed = hits.slice(0, MAX_LISTED).map((h) => `\`${label(h)}\``).join(', ');
            const more = hits.length > MAX_LISTED ? ` and ${hits.length - MAX_LISTED} more` : '';
            return { ok: false, error: `\`${query}\` matches several ${kind}s: ${listed}${more}. Be more specific.` };
        }
    }
    return { ok: false, error: `No ${kind} found matching \`${query}\`.` };
}

/**
 * Resolves a member from a mention, ID, username, global name or nickname.
 *
 * Name lookups use Discord's member search endpoint (REST), which matches the
 * start of a username or nickname. That avoids needing the privileged
 * GuildMembers intent to keep the whole member list cached.
 */
export async function resolveMember(guild: Guild, query: string): Promise<Resolved<GuildMember>> {
    const mention = USER_MENTION.exec(query);
    const id = mention?.[1] ?? (SNOWFLAKE.test(query) ? query : null);
    if (id) {
        const member = await guild.members.fetch(id).catch(() => null);
        return member ? { ok: true, value: member } : { ok: false, error: `No member with ID \`${id}\` in this server.` };
    }

    // Legacy "name#1234" tags: search on the name part only.
    const q = query.replace(/#\d{4}$/, '').toLowerCase();
    if (!q) return { ok: false, error: 'No member given.' };

    const found: Collection<string, GuildMember> = await guild.members.search({ query: q, limit: 25 });
    const candidates = [...found.values()];
    const names = (m: GuildMember) =>
        [m.user.username, m.user.globalName, m.nickname]
            .filter((n): n is string => Boolean(n))
            .map((n) => n.toLowerCase());

    return pickByTiers(
        candidates,
        [
            (m) => m.user.username.toLowerCase() === q,
            (m) => names(m).includes(q),
            (m) => names(m).some((n) => n.startsWith(q)),
        ],
        (m) => `${m.displayName} (${m.user.username})`,
        'member',
        query,
    );
}

/** Resolves a role from a mention, ID, or (partial) role name. */
export function resolveRole(guild: Guild, query: string): Resolved<Role> {
    const mention = ROLE_MENTION.exec(query);
    const id = mention?.[1] ?? (SNOWFLAKE.test(query) ? query : null);
    if (id) {
        const role = guild.roles.cache.get(id);
        return role ? { ok: true, value: role } : { ok: false, error: `No role with ID \`${id}\` in this server.` };
    }

    const q = query.replace(/^@/, '').toLowerCase();
    if (!q) return { ok: false, error: 'No role given.' };

    // Skip @everyone; highest roles first so ambiguity lists read top-down.
    const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position);

    return pickByTiers(
        roles,
        [
            (r) => r.name.toLowerCase() === q,
            (r) => r.name.toLowerCase().startsWith(q),
            (r) => r.name.toLowerCase().includes(q),
        ],
        (r) => r.name,
        'role',
        query,
    );
}
