import type { UmaCircleListResponse, UmaCircleResponse } from './types';

/**
 * Client for the uma.moe API.
 *
 * Authentication is an `X-API-Key` header. Unauthenticated callers receive
 * `403 {"error":"browser_proof_required"}` — the browser-proof path is for the
 * site's own frontend and is not usable from a bot, so a key is mandatory.
 * Generate one from a uma.moe account and set `EXTERNAL_API_KEY`.
 */

const BASE_URL = (process.env.EXTERNAL_API_BASE_URL ?? 'https://uma.moe').replace(/\/+$/, '');
const API_KEY = process.env.EXTERNAL_API_KEY;

/** Requests that take longer than this are abandoned. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Attempts per request, including the first. */
const MAX_ATTEMPTS = 3;

/** A non-2xx response, or a transport failure, from uma.moe. */
export class UmaMoeError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        /** True when retrying later could plausibly succeed. */
        public readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'UmaMoeError';
    }
}

/** True when the API key is configured. Callers use this to degrade politely. */
export function isConfigured(): boolean {
    return Boolean(API_KEY);
}

/** Builds a URL, dropping query parameters that are undefined. */
function buildUrl(path: string, query: Record<string, string | number | undefined>): string {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
}

/** Sleeps for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performs a GET with a timeout and bounded retries.
 *
 * Only 429 and 5xx are retried. A 403 means the key is missing or rejected and
 * will never succeed on retry, so it fails immediately with a message that says
 * what to do about it.
 */
async function get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!API_KEY) {
        throw new UmaMoeError(
            0,
            'EXTERNAL_API_KEY is not set. uma.moe rejects unauthenticated requests to the circle endpoints. ' +
                'Generate an API key from your uma.moe account and add it to .env.',
            false,
        );
    }

    const url = buildUrl(path, query);
    let lastError: UmaMoeError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { 'X-API-Key': API_KEY, Accept: 'application/json' },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            if (response.ok) return (await response.json()) as T;

            const retryable = response.status === 429 || response.status >= 500;
            const body = await response.text().catch(() => '');

            let message = `uma.moe ${path} returned ${response.status}`;
            if (response.status === 403) {
                message =
                    `uma.moe rejected the request (403). The API key is missing, invalid, or lacks access. ` +
                    `Check EXTERNAL_API_KEY.`;
            } else if (response.status === 429) {
                message = `uma.moe rate limit hit on ${path}.`;
            } else if (body) {
                message += `: ${body.slice(0, 200)}`;
            }

            lastError = new UmaMoeError(response.status, message, retryable);
            if (!retryable) throw lastError;
        } catch (e) {
            if (e instanceof UmaMoeError) {
                if (!e.retryable) throw e;
                lastError = e;
            } else {
                // Network failure or timeout. Worth retrying.
                lastError = new UmaMoeError(0, `uma.moe ${path} failed: ${e instanceof Error ? e.message : e}`, true);
            }
        }

        if (attempt < MAX_ATTEMPTS) {
            // Exponential backoff: 1s, then 2s.
            await sleep(1000 * 2 ** (attempt - 1));
        }
    }

    throw lastError ?? new UmaMoeError(0, `uma.moe ${path} failed`, true);
}

/**
 * Fetches a circle with every member's daily fan history.
 *
 * @param circleId uma.moe circle ID.
 * @param month    Game month, 1-12. Defaults to the current game month.
 * @param year     Game year. Defaults to the current game year.
 */
export function getCircle(circleId: number, month?: number, year?: number): Promise<UmaCircleResponse> {
    return get<UmaCircleResponse>('/api/v4/circles', { circle_id: circleId, month, year });
}

/** Searches circles by name, for the add-circle autocomplete. */
export function searchCircles(query: string, limit = 25): Promise<UmaCircleListResponse> {
    return get<UmaCircleListResponse>('/api/v4/circles/list', { query, limit, page: 0 });
}

/**
 * Fetches the top circles by monthly points, best first.
 *
 * Used to compute the benchmark cutoffs. `limit` is capped at 100 per page by
 * the API, so larger requests are paged.
 */
export async function getTopCircles(count: number): Promise<UmaCircleListResponse['circles']> {
    const pageSize = 100;
    const circles: UmaCircleListResponse['circles'] = [];

    for (let page = 0; circles.length < count; page += 1) {
        const response = await get<UmaCircleListResponse>('/api/v4/circles/list', {
            limit: pageSize,
            page,
            sort_by: 'monthly_point',
            sort_dir: 'desc',
        });

        circles.push(...response.circles);
        if (response.circles.length < pageSize || page + 1 >= response.total_pages) break;
    }

    return circles.slice(0, count);
}
