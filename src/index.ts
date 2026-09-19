import { Client, GatewayIntentBits, ChannelType, ThreadChannel, ForumChannel, Events, MessageFlags } from 'discord.js';
import 'dotenv/config';
// Imported before the command modules: several of them read configuration at
// module load, so this must run first to report what is missing in plain
// language rather than letting the first consumer throw something opaque.
import { reportEnvironment } from './lib/env';

if (!reportEnvironment()) process.exit(1);

import { commands } from './commands';
import { assertDatabaseReady } from './db/prisma';
import { classifyError, buildErrorEmbed } from './lib/errors';
import { startScheduler } from './lib/timer/scheduler';
import { startFanScheduler } from './lib/fans/scheduler';
import { startDashboard } from './web/server';
import { registerCommands } from './lib/registerCommands';
import { waitForConnectOutcome } from './lib/startup';
import { handleTimerButton, isTimerButton } from './commands/timer';

/**
 * Builds a client with every handler attached.
 *
 * A function rather than a top-level singleton because gateway intents are
 * fixed at construction, and startup may need a second client with fewer of
 * them (see `start`).
 */
function buildClient(intents: GatewayIntentBits[]): Client {
const client = new Client({ intents });

const COMP_COUNCIL = process.env.COMP_COUNCIL_ROLE_ID!;
const SEMI_COMP_COUNCIL = process.env.SEMI_COMP_COUNCIL_ROLE_ID!;
const CASUAL_COUNCIL = process.env.CASUAL_COUNCIL_ROLE_ID!;

const FORUM_ID = process.env.FORUM_CHANNEL_ID;

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);

    // Self-registering removes the "run deploy-commands from your laptop" step
    // from every deploy. A failure here is logged, not fatal: commands
    // registered by a previous boot keep working, and the bot is still useful
    // for its schedulers and dashboard even if Discord rejects the update.
    try {
        const { count, guildId } = await registerCommands(readyClient);
        console.log(
            guildId
                ? `Registered ${count} slash commands to guild ${guildId}.`
                : `Registered ${count} global slash commands (propagation can take up to an hour).`,
        );
    } catch (e) {
        console.error('Slash command registration failed; previously registered commands remain:', e);
    }

    // Verify the schema before accepting commands. A missing migration used to
    // surface only as a generic in-Discord failure; now it is a fatal startup
    // error. Exiting lets the container restart policy retry, so the bot
    // recovers on its own once the database is migrated.
    try {
        await assertDatabaseReady();
        console.log('Database is reachable and migrated.');

        // Started only after the preflight passes, so the first tick cannot
        // fail against an unmigrated schema. The first tick also delivers any
        // timer that expired while the bot was offline.
        startScheduler(client);
        console.log('Training timer scheduler started.');

        startFanScheduler(client);

        // Warm the member cache so display names resolve immediately. With the
        // GuildMembers intent the cache then stays current from gateway events.
        // Not awaited: a large guild must not delay the rest of startup.
        void Promise.all(
            [...readyClient.guilds.cache.values()].map((guild) =>
                guild.members
                    .fetch()
                    .then((members) => console.log(`Cached ${members.size} members for ${guild.name}.`))
                    .catch((e) => console.warn(`Could not fetch members for ${guild.name}:`, e instanceof Error ? e.message : e)),
            ),
        );

    } catch (e) {
        console.error('FATAL: database preflight failed.');
        console.error(e instanceof Error ? e.message : e);
        await client.destroy();
        process.exit(1);
    }
});
client.on('threadCreate', async (thread: ThreadChannel) => {
    try {
        if (thread.parent?.type != ChannelType.GuildForum) return;
        if (thread.parentId !== FORUM_ID) return;

        const parentForum = thread.parent as ForumChannel;
        const threadRefresh = await thread.fetch();
        const tagIds = threadRefresh.appliedTags; // string[]

        const tagNames = tagIds
            .map((tagId) => parentForum.availableTags.find((t) => t.id == tagId)?.name)
            .filter((name): name is string => Boolean(name))
            .map((name) => name.toLowerCase());
        
        const tierRoleMap: { tags: string[]; role: string; label: string }[] = [
            { tags: ['s+', 's'], role: COMP_COUNCIL, label: 'competitive' },
            { tags: ['a+', 'a'], role: SEMI_COMP_COUNCIL, label: 'semi-competitive' },
            { tags: ['b+'], role: CASUAL_COUNCIL, label: 'casual' }
        ];

        const matchedRoles: string[] = [];
        const matchedLabels: string[] = [];

        for (const tier of tierRoleMap) {
            const tag = tier.tags.some((t) => tagNames.includes(t));
            if (tag && !matchedRoles.includes(tier.role)) {
                matchedRoles.push(tier.role);
                matchedLabels.push(tier.label);
            }
        }

        if (matchedRoles.length === 0) {
            console.log(`Thread "${threadRefresh.name}" has no matching tier tag — skipping ping.`);
            return;
        }

        const role = matchedRoles.map((r) => `<@&${r}>`).join(' ');

        const member = await thread.guild.members.fetch(threadRefresh.ownerId);
        const ownerName = member.displayName;
        const reason = `${ownerName} is looking for ${matchedLabels.join(' and ')} clubs!`;

        await thread.send({
            content: `**[${role}]**\n*${reason}*`,
            allowedMentions: {roles: matchedRoles},
        });
    } catch (e) {
        console.error('Error handling ping: ', e)
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isAutocomplete()) {
            const command = commands.get(interaction.commandName);
            if (!command?.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (e) {
                console.error(`Error running autocomplete for /${interaction.commandName}:`, e);
            }
            return;
        }

    // Panel buttons are routed by custom ID rather than a component collector,
    // so panels posted before a restart keep working afterwards.
    if (interaction.isButton()) {
        if (!isTimerButton(interaction.customId)) return;
        try {
            await handleTimerButton(interaction);
        } catch (e) {
            const classified = classifyError(e);
            const label = classified.incidentId ? `[incident ${classified.incidentId}] ` : '';
            console.error(`${label}Error handling button ${interaction.customId}:`, e);
            try {
                const reply = { embeds: [buildErrorEmbed(classified)] };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ ...reply, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error(`${label}Could not deliver the button error reply:`, replyError);
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    
    const command = commands.get(interaction.commandName);
    if(!command) return;

    try {
        await command.execute(interaction);
    } catch (e) {
        const classified = classifyError(e);

        // Log the incident ID next to the stack trace so a user reporting the
        // ID from Discord can be matched to the exact failure in the logs.
        const label = classified.incidentId ? `[incident ${classified.incidentId}] ` : '';
        console.error(
            `${label}Error running /${interaction.commandName} ` +
                `(user ${interaction.user.id}, guild ${interaction.guildId ?? 'none'}): ${classified.title}`,
            e,
        );

        const errorReply = { embeds: [buildErrorEmbed(classified)] };

        // Reporting the failure must never throw a second time on top of the
        // first. If the interaction token already expired there is nowhere
        // left to reply, and the log above is the only record.
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorReply);
            } else {
                await interaction.reply(errorReply);
            }
        } catch (replyError) {
            console.error(`${label}Could not deliver the error reply to Discord:`, replyError);
        }
    }
});


return client;
}

/** Intents the bot wants. GuildMembers resolves server nicknames for reports. */
const FULL_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];

/** Intents the bot can always get. Names fall back to IDs without GuildMembers. */
const BASE_INTENTS = [GatewayIntentBits.Guilds];

/**
 * Connects, degrading gracefully if a privileged intent is not enabled.
 *
 * Two things learned the hard way:
 *
 * 1. `login()` resolving means nothing. When Discord refuses a privileged
 *    intent it closes the gateway with code 4014; discord.js emits
 *    `shardDisconnect` and stops, without throwing and without ever emitting
 *    `ready`. Earlier versions of this function keyed off a rejection that
 *    never comes, so the bot hung un-ready until the host's health check
 *    killed it -- a restart loop. `waitForConnectOutcome` listens for what
 *    discord.js actually does.
 *
 * 2. The HTTP server must not wait for Discord. It starts before any login,
 *    against a getter that always returns the current client, so /healthz
 *    answers from the first second and reports `discord: false` honestly until
 *    the gateway is up. A Discord problem then degrades one feature instead of
 *    taking the whole container down.
 */
async function start(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    let current: Client = buildClient(FULL_INTENTS);

    // Runs in this process so the dashboard and the bot cannot disagree about
    // the data. Disabled unless configured, but the health check is always
    // served. Bound to a getter: see (2) above.
    startDashboard(() => current);

    const fatal = (message: string, e?: unknown): never => {
        console.error(`FATAL: ${message}`, e instanceof Error ? e.message : (e ?? ''));
        process.exit(1);
    };

    let outcome = waitForConnectOutcome(current);
    await current.login(token).catch((e: unknown) => fatal('Discord login failed:', e));

    if ((await outcome) === 'disallowed-intents') {
        await current.destroy();
        console.warn(
            'Discord refused the GuildMembers intent, so server nicknames will not resolve and names may show as IDs.\n' +
                '  To fix: Discord developer portal -> your application -> Bot -> Privileged Gateway Intents\n' +
                '  -> enable "Server Members Intent" -> Save, then restart the bot.\n' +
                '  Continuing with reduced intents.',
        );
        current = buildClient(BASE_INTENTS);
        outcome = waitForConnectOutcome(current);
        await current.login(token).catch((e: unknown) => fatal('Discord login failed:', e));
    }

    const final = await outcome;
    if (final !== 'ready') {
        fatal(`Discord closed the gateway with an unrecoverable error (${final}). Check DISCORD_TOKEN.`);
    }
}

void start();
