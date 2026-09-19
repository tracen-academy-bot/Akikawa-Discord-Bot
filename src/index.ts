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
import { handleTimerButton, isTimerButton } from './commands/timer';

const client = new Client({intents: [GatewayIntentBits.Guilds]});

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

        // Runs in this process so the dashboard and the bot cannot disagree
        // about the data. Disabled unless it is configured.
        startDashboard(client);
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

client.login(process.env.DISCORD_TOKEN);