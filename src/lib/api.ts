const MOE_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL;
const MOE_API_KEY = process.env.EXTERNAL_API_KEY;

class ExternalApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = "ExternalApiError";
    }
}

function buildUrl(path: string): string {
    if (!MOE_API_BASE_URL) {
        throw new Error('EXTERNAL_API_BASE_URL is not set in the environment.');
    }
    const base = MOE_API_BASE_URL.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MOE_API_KEY) h.authorization = `BEARER ${MOE_API_KEY}`;
    return h;
}

export async function externalApiGet<T>(path: string): Promise<T> {
    const res = await fetch(buildUrl(path), { headers: headers() });
    if (!res.ok) throw new ExternalApiError(res.status, `GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
}

export async function externalApiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(buildUrl(path), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new ExternalApiError(res.status, `POST ${path} failed: ${res.status}`);
    return (await res.json()) as T;
}