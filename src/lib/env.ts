/**
 * Startup environment validation.
 *
 * Missing configuration used to surface as whatever the first module to touch
 * it happened to throw. Absent forum tag IDs, for example, crashed the process
 * inside discord.js option validation — an opaque `@sapphire/shapeshift`
 * error, thrown while building a command, before the bot ever reached Discord.
 * Nothing in that stack trace named the variable that was missing.
 *
 * This module reports every missing variable at once, in plain language, and
 * distinguishes what stops the bot from what merely disables a feature.
 */

/** One configuration variable and what depends on it. */
interface EnvVar {
    name: string;
    /** True when the bot cannot usefully run without it. */
    required: boolean;
    /** What breaks without it, phrased for whoever is reading the logs. */
    purpose: string;
}

const VARIABLES: EnvVar[] = [
    { name: 'DISCORD_TOKEN', required: true, purpose: 'signing in to Discord' },
    { name: 'DATABASE_URL', required: true, purpose: 'the database connection' },

    { name: 'DISCORD_CLIENT_ID', required: false, purpose: 'registering slash commands' },
    { name: 'OFFICER_ROLE_IDS', required: false, purpose: 'Club Manager permission checks (nobody will be an officer)' },
    { name: 'CLUB_ROLE_IDS', required: false, purpose: '/role club-role swapping' },
    { name: 'DEFAULT_ROLE_ID', required: false, purpose: '/role fallback role assignment' },
    { name: 'FORUM_CHANNEL_ID', required: false, purpose: 'tier-tag pings on new forum threads' },
    { name: 'COMP_COUNCIL_ROLE_ID', required: false, purpose: 'competitive tier pings' },
    { name: 'SEMI_COMP_COUNCIL_ROLE_ID', required: false, purpose: 'semi-competitive tier pings' },
    { name: 'CASUAL_COUNCIL_ROLE_ID', required: false, purpose: 'casual tier pings' },
    { name: 'TAG_TRANSFER_ID', required: false, purpose: 'the Transfer choice on /settag' },
    { name: 'TAG_CLUB_APP_ACCEPTED_ID', required: false, purpose: 'the Club App Accepted choice on /settag' },
    { name: 'EXTERNAL_API_KEY', required: false, purpose: 'uma.moe fan tracking (all /fans data commands)' },
];

/** Result of checking the environment. */
export interface EnvReport {
    missingRequired: EnvVar[];
    missingOptional: EnvVar[];
}

/** Returns which configured variables are absent or blank. */
export function checkEnvironment(): EnvReport {
    const absent = VARIABLES.filter((v) => !(process.env[v.name] ?? '').trim());
    return {
        missingRequired: absent.filter((v) => v.required),
        missingOptional: absent.filter((v) => !v.required),
    };
}

/**
 * Logs the environment report.
 *
 * @returns False when a required variable is missing, so the caller can stop.
 */
export function reportEnvironment(): boolean {
    const { missingRequired, missingOptional } = checkEnvironment();

    if (missingOptional.length > 0) {
        console.warn('Some features are disabled because their configuration is missing:');
        for (const v of missingOptional) console.warn(`  - ${v.name} is not set, so ${v.purpose} will not work.`);
        console.warn('  See .env.example for what each variable does.');
    }

    if (missingRequired.length > 0) {
        console.error('FATAL: required configuration is missing.');
        for (const v of missingRequired) console.error(`  - ${v.name} is required for ${v.purpose}.`);
        console.error('  Copy .env.example to .env and fill it in.');
        return false;
    }

    return true;
}
