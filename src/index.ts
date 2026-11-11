import { Client, GatewayIntentBits, ThreadChannel, Events, MessageFlags } from 'discord.js';
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
import { handleClubRoleDeleted, syncMemberRole, syncMemberRoles } from './lib/roleAssignment';
import { connect } from './lib/startup';
import { runMigrations } from './lib/migrate';
import { handleSpecialRead, handleTimerButton, handleTimerNoticeModal, isSpecialReadMenu, isTimerButton, isTimerNoticeModal } from './commands/timer';
import { onChannelMessage } from './lib/timer/livePanel';
import { handlePostModal, isPostModal } from './commands/post';
import { handleClubModal, isClubModal } from './commands/club';
import { handleProfileModal, isProfileModal } from './commands/clubProfile';
import { handlePrefixMessage } from './prefix';
import { handleHelpSelect, isHelpSelect } from './commands/help';
import { handleCloseButton, isCloseButton } from './commands/close';
import { openApplication, takeIdFromMessage } from './lib/applications/service';
import { startedBoosting, thankBooster, welcomeMember } from './lib/welcome';
import { handleWaveButton, handleWelcomeModal, isWaveButton, isWelcomeModal } from './commands/welcome';

/**
 * Builds a client with every handler attached.
 *
 * A function rather than a top-level singleton because gateway intents are
 * fixed at construction, and startup may need a second client with fewer of
 * them (see `start`).
 */
function buildClient(intents: GatewayIntentBits[]): Client {
const client = new Client({ intents });

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
        // Then put every member's Member role right, catching role changes
        // missed while the bot was offline (a club role deleted during a
        // deploy, say). Not awaited: a large guild must not delay the rest of
        // startup.
        void Promise.all(
            [...readyClient.guilds.cache.values()].map((guild) =>
                guild.members
                    .fetch()
                    .then(async (members) => {
                        console.log(`Cached ${members.size} members for ${guild.name}.`);
                        const { added, removed } = await syncMemberRoles(members.values());
                        console.log(`Member role sync for ${guild.name}: added to ${added}, removed from ${removed}.`);
                    })
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
// A new post in the application forum: scout the trainer, post their card,
// add a recruitment entry and tell staff. The council pings that used to go
// in the post itself now go to the staff channel (see applications/service).
client.on(Events.ThreadCreate, (thread: ThreadChannel, newlyCreated: boolean) => {
    if (!newlyCreated) return;
    void openApplication(thread);
});

// A new member: the welcome set with /welcome. Needs the Server Members intent.
client.on(Events.GuildMemberAdd, (member) => {
    void welcomeMember(member);
});

// A member starting to boost: a thank-you in the welcome channel.
client.on(Events.GuildMemberUpdate, (before, after) => {
    // An uncached `before` has no boost state; it could make any update of
    // a booster look like a new boost, so it is skipped.
    if (!before.partial && startedBoosting(before, after)) void thankBooster(after);
    // The Member role follows the club roles, whoever changed them.
    void syncMemberRole(after);
});

// A club role deleted (a club leaving): members it leaves with no club role lose Member.
client.on(Events.GuildRoleDelete, (role) => {
    void handleClubRoleDeleted(role);
});

client.on(Events.MessageCreate, (message) => {
    void handlePrefixMessage(message);
    // Keeps the timer's sticky (board, panel, notice) under people's posts.
    void onChannelMessage(message).catch((e) => console.error('Timer sticky check failed:', e));
    // An applicant replying with their trainer ID after being asked for it.
    void takeIdFromMessage(message);
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
        const handler = isTimerButton(interaction.customId)
            ? handleTimerButton
            : isCloseButton(interaction.customId)
              ? handleCloseButton
              : isWaveButton(interaction.customId)
                ? handleWaveButton
                : null;
        if (!handler) return;
        try {
            await handler(interaction);
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

    // The /help topic menu, routed by custom ID like the panel buttons.
    // A trainer reading one of the specials they unlocked.
    if (interaction.isStringSelectMenu() && isSpecialReadMenu(interaction.customId)) {
        try {
            await handleSpecialRead(interaction);
        } catch (e) {
            console.error('Error handling the special read menu:', e);
        }
        return;
    }

    if (interaction.isStringSelectMenu() && isHelpSelect(interaction.customId)) {
        try {
            await handleHelpSelect(interaction);
        } catch (e) {
            const classified = classifyError(e);
            const label = classified.incidentId ? `[incident ${classified.incidentId}] ` : '';
            console.error(`${label}Error handling the help menu:`, e);
        }
        return;
    }

    // Modal submits are routed by custom ID, like the panel buttons above.
    if (interaction.isModalSubmit()) {
        const handler = isPostModal(interaction.customId)
            ? handlePostModal
            : isProfileModal(interaction.customId)
              ? handleProfileModal
              : isClubModal(interaction.customId)
                ? handleClubModal
                : isWelcomeModal(interaction.customId)
                  ? handleWelcomeModal
                  : isTimerNoticeModal(interaction.customId)
                    ? handleTimerNoticeModal
                    : null;
        if (!handler) return;
        try {
            await handler(interaction);
        } catch (e) {
            const classified = classifyError(e);
            const label = classified.incidentId ? `[incident ${classified.incidentId}] ` : '';
            console.error(`${label}Error handling modal ${interaction.customId}:`, e);
            try {
                const reply = { embeds: [buildErrorEmbed(classified)] };
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply(reply);
                } else {
                    await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error(`${label}Could not deliver the modal error reply:`, replyError);
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

/**
 * Intent sets to try, most capable first. Two of the intents are privileged
 * and must be switched on in the developer portal:
 *
 *   GuildMembers    resolves server nicknames in reports
 *   MessageContent  lets prefix commands (`;role ...`) read the message
 *
 * Discord's refusal (close code 4014) does not say which one is missing, so
 * startup walks down this list until one connects. GuildMessages is not
 * privileged; it only delivers the messageCreate events.
 */
const INTENT_LADDER: { intents: GatewayIntentBits[]; lost: string }[] = [
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        lost: '',
    },
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        lost: 'prefix commands (;role) are off. Enable "Message Content Intent"',
    },
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        lost: 'server nicknames will not resolve and names may show as IDs. Enable "Server Members Intent"',
    },
    {
        intents: [GatewayIntentBits.Guilds],
        lost: 'prefix commands are off and names may show as IDs. Enable "Server Members Intent" and "Message Content Intent"',
    },
];

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
    let current: Client = buildClient(INTENT_LADDER[0]!.intents);

    // Runs in this process so the dashboard and the bot cannot disagree about
    // the data. Disabled unless configured, but the health check is always
    // served. Bound to a getter: see (2) above.
    startDashboard(() => current);

    // Migrations run here, after the port is bound, so their progress and any
    // failure are visible on /healthz. This resolves only once they apply;
    // until then the bot does not touch Discord, because commands against an
    // unmigrated schema would fail anyway.
    await runMigrations();

    const fatal = (message: string, e?: unknown): never => {
        console.error(`FATAL: ${message}`, e instanceof Error ? e.message : (e ?? ''));
        process.exit(1);
    };

    const login = (client: Client) =>
        connect(client, token).catch((e: unknown) => fatal('Discord login failed:', e));

    let outcome = await login(current);

    for (const step of INTENT_LADDER.slice(1)) {
        if (outcome !== 'disallowed-intents') break;
        await current.destroy();
        console.warn(
            `Discord refused a privileged intent. Retrying with fewer: ${step.lost}.\n` +
                '  To fix: Discord developer portal -> your application -> Bot -> Privileged Gateway Intents\n' +
                '  -> enable the intents named above -> Save, then restart the bot.',
        );
        current = buildClient(step.intents);
        outcome = await login(current);
    }

    const final = outcome;
    if (final !== 'ready') {
        fatal(`Discord closed the gateway with an unrecoverable error (${final}). Check DISCORD_TOKEN.`);
    }
}

void start();
