import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Discord OAuth2 sign-in for the dashboard.
 *
 * Sessions are stateless: a signed cookie carries the identity, so there is no
 * server-side store to lose on restart and no second container to run. The
 * cookie holds only what the UI needs — ID, display name, avatar, and whether
 * the user holds a Club Manager role — never the Discord access token, which
 * is used once during callback and then discarded.
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** OAuth scopes. `guilds.members.read` is what lets us read the user's roles. */
const SCOPES = ['identify', 'guilds.members.read'];

/** How long a session stays valid. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long an in-flight login may take before its state token expires. */
const STATE_TTL_MS = 10 * 60 * 1000;

export const SESSION_COOKIE = 'akikawa_session';
const STATE_COOKIE = 'akikawa_oauth_state';

/** The signed-in user, as carried in the session cookie. */
export interface SessionUser {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    /** True when the member holds one of OFFICER_ROLE_IDS in the dashboard guild. */
    isOfficer: boolean;
    /** Expiry, epoch milliseconds. */
    exp: number;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: SessionUser;
        }
    }
}

/** Dashboard configuration, read once at startup. */
export interface WebConfig {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    sessionSecret: string;
    guildId: string;
    officerRoleIds: string[];
    port: number;
}

/**
 * Reads and validates dashboard configuration.
 *
 * Returns null when the dashboard is not configured, so the bot starts
 * normally without it rather than refusing to boot.
 */
/**
 * Derives the cookie-signing key from the bot token.
 *
 * The bot token is already a secret that only the bot holds, and anyone who
 * has it owns the bot outright, so deriving from it adds no new attack
 * surface. It spares the operator from generating and managing a second
 * secret for the sole purpose of signing dashboard cookies.
 *
 * HMAC with a fixed context string, rather than the raw token, so the key
 * that ends up in cookie signatures is not the token itself and cannot be
 * used to talk to Discord if it were ever recovered. Rotating the bot token
 * rotates this too, which simply signs everyone out -- the correct outcome.
 */
function deriveSessionSecret(botToken: string): string {
    return createHmac('sha256', botToken).update('akikawa:dashboard-session:v1').digest('hex');
}

export function loadWebConfig(): WebConfig | null {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const guildId = process.env.DASHBOARD_GUILD_ID;
    const botToken = process.env.DISCORD_TOKEN;

    // An explicit secret is honoured, but none is required: absent one, the key
    // is derived from the bot token, which is already present and already
    // secret. See deriveSessionSecret.
    const sessionSecret =
        process.env.DASHBOARD_SESSION_SECRET || (botToken ? deriveSessionSecret(botToken) : undefined);

    // Platform-as-a-service hosts assign the public URL themselves. Railway
    // exposes it as RAILWAY_PUBLIC_DOMAIN (host only, no scheme), so the base
    // URL is derived from it rather than having to be pasted in by hand and
    // kept in sync. An explicit DASHBOARD_BASE_URL always wins, which is what
    // a custom domain or a local run needs.
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const baseUrl =
        process.env.DASHBOARD_BASE_URL || (railwayDomain ? `https://${railwayDomain}` : undefined);

    if (!clientId || !clientSecret || !baseUrl || !sessionSecret || !guildId) return null;

    if (sessionSecret.length < 32) {
        throw new Error(
            'DASHBOARD_SESSION_SECRET must be at least 32 characters. ' +
                'Leave it unset to derive one from the bot token automatically.',
        );
    }

    return {
        clientId,
        clientSecret,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        sessionSecret,
        guildId,
        officerRoleIds: (process.env.OFFICER_ROLE_IDS ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        // PORT is what the platform tells the container to bind, and it is not
        // negotiable: bind anything else on Railway, Render or Fly and the
        // health check fails and no traffic is ever routed to the dashboard.
        // DASHBOARD_PORT stays as the local-development override.
        port: Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 3000),
    };
}

// ─── Cookie signing ───────────────────────────────────────────────────────────

/** Base64url without padding, so the value is cookie-safe. */
function b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Serialises a value into a `payload.signature` cookie string. */
export function seal(value: unknown, secret: string): string {
    const payload = b64url(JSON.stringify(value));
    return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verifies and parses a sealed cookie.
 *
 * Signature comparison is constant-time. A malformed, unsigned or tampered
 * cookie returns null rather than throwing, so a stale cookie logs the user
 * out instead of producing a 500.
 */
export function unseal<T>(cookie: string | undefined, secret: string): T | null {
    if (!cookie) return null;

    const separator = cookie.lastIndexOf('.');
    if (separator <= 0) return null;

    const payload = cookie.slice(0, separator);
    const signature = cookie.slice(separator + 1);

    const expected = Buffer.from(sign(payload, secret));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    } catch {
        return null;
    }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** True when the dashboard is served over HTTPS, which gates the Secure flag. */
function isSecure(config: WebConfig): boolean {
    return config.baseUrl.startsWith('https://');
}

/** Standard cookie options. HttpOnly keeps the session out of reach of scripts. */
function cookieOptions(config: WebConfig, maxAgeMs: number) {
    return {
        httpOnly: true,
        // `lax` still sends the cookie on the OAuth redirect back from Discord,
        // while blocking it on cross-site form posts.
        sameSite: 'lax' as const,
        secure: isSecure(config),
        maxAge: maxAgeMs,
        path: '/',
    };
}

/** Attaches `req.user` when a valid session cookie is present. */
export function sessionMiddleware(config: WebConfig) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const session = unseal<SessionUser>(req.cookies?.[SESSION_COOKIE], config.sessionSecret);
        if (session && session.exp > Date.now()) req.user = session;
        next();
    };
}

/** Rejects anonymous requests, redirecting browsers to the login flow. */
export function requireLogin(req: Request, res: Response, next: NextFunction) {
    if (req.user) return next();
    if (req.method === 'GET') return res.redirect('/login');
    return res.status(401).json({ error: 'Not signed in.' });
}

/** Rejects requests from users without a Club Manager role. */
export function requireOfficer(req: Request, res: Response, next: NextFunction) {
    if (req.user?.isOfficer) return next();
    return res.status(403).json({ error: 'Club Manager role required.' });
}

// ─── OAuth flow ───────────────────────────────────────────────────────────────

/** Begins sign-in: issues a state token and redirects to Discord. */
export function beginLogin(config: WebConfig, req: Request, res: Response) {
    // The state token is signed and short-lived, and is checked on the way back.
    // Without it, an attacker could complete a login in the victim's browser.
    const state = seal({ nonce: randomBytes(16).toString('hex'), exp: Date.now() + STATE_TTL_MS }, config.sessionSecret);
    res.cookie(STATE_COOKIE, state, cookieOptions(config, STATE_TTL_MS));

    const url = new URL(`${DISCORD_API}/oauth2/authorize`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', `${config.baseUrl}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');

    res.redirect(url.toString());
}

/** Completes sign-in. Returns an error string, or null on success. */
export async function completeLogin(config: WebConfig, req: Request, res: Response): Promise<string | null> {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const cookieState = req.cookies?.[STATE_COOKIE];

    res.clearCookie(STATE_COOKIE, { path: '/' });

    if (!code || !state) return 'Discord did not return an authorisation code.';
    if (!cookieState || state !== cookieState) return 'Login state did not match. Start again.';

    const parsedState = unseal<{ exp: number }>(state, config.sessionSecret);
    if (!parsedState || parsedState.exp < Date.now()) return 'Login expired. Start again.';

    // Exchange the code for a token.
    const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${config.baseUrl}/auth/callback`,
        }),
    });

    if (!tokenResponse.ok) return 'Discord rejected the authorisation code.';
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) return 'Discord did not return an access token.';

    const authHeaders = { Authorization: `Bearer ${token.access_token}` };

    const userResponse = await fetch(`${DISCORD_API}/users/@me`, { headers: authHeaders });
    if (!userResponse.ok) return 'Could not read your Discord profile.';
    const user = (await userResponse.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar?: string | null;
    };

    // Guild membership determines access. A user who is not in the guild, or
    // whose roles cannot be read, gets a viewer session rather than an error:
    // the dashboard is readable, and only mutations require a role.
    const memberResponse = await fetch(`${DISCORD_API}/users/@me/guilds/${config.guildId}/member`, {
        headers: authHeaders,
    });

    if (!memberResponse.ok) {
        return 'You are not a member of this server, so the dashboard is not available to you.';
    }

    const member = (await memberResponse.json()) as { roles?: string[]; nick?: string | null };
    const roles = member.roles ?? [];
    const isOfficer = config.officerRoleIds.some((id) => roles.includes(id));

    const session: SessionUser = {
        id: user.id,
        username: user.username,
        displayName: member.nick ?? user.global_name ?? user.username,
        avatarUrl: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
            : null,
        isOfficer,
        exp: Date.now() + SESSION_TTL_MS,
    };

    res.cookie(SESSION_COOKIE, seal(session, config.sessionSecret), cookieOptions(config, SESSION_TTL_MS));
    return null;
}

/** Clears the session cookie. */
export function logout(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ─── CSRF ─────────────────────────────────────────────────────────────────────

/**
 * Issues a CSRF token bound to the signed-in user.
 *
 * SameSite=lax already blocks cross-site form posts in current browsers; this
 * is defence in depth for older ones and for any future JSON endpoint.
 */
export function csrfToken(user: SessionUser, secret: string): string {
    return sign(`csrf:${user.id}`, secret);
}

/** Rejects a mutation whose CSRF token does not match the session. */
export function verifyCsrf(config: WebConfig) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) return res.status(401).json({ error: 'Not signed in.' });

        const provided = String(req.body?._csrf ?? req.get('x-csrf-token') ?? '');
        const expected = csrfToken(req.user, config.sessionSecret);

        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return res.status(403).json({ error: 'Invalid CSRF token. Reload the page.' });
        }
        return next();
    };
}
