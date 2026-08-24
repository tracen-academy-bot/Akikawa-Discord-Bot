import { Client, GatewayIntentBits, ChannelType, ThreadChannel, ForumChannel, Events, EmbedBuilder} from 'discord.js';
import 'dotenv/config';
import { commands } from './commands';

const client = new Client({intents: [GatewayIntentBits.Guilds]});

const COMP_COUNCIL = process.env.COMP_COUNCIL_ROLE_ID!;
const SEMI_COMP_COUNCIL = process.env.SEMI_COMP_COUNCIL_ROLE_ID!;
const CASUAL_COUNCIL = process.env.CASUAL_COUNCIL_ROLE_ID!;

const FORUM_ID = process.env.FORUM_CHANNEL_ID;

client.once('ready', () => console.log(`Logged in as ${client.user?.tag}`));
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

    if (!interaction.isChatInputCommand()) return;
    
    const command = commands.get(interaction.commandName);
    if(!command) return;

    try {
        await command.execute(interaction);
    } catch (e) {
        console.error(`Error running /${interaction.commandName}:`, e);
        const errorReply = {
            embeds: [
                new EmbedBuilder().setColor(0xed4245).setTitle('Error').setDescription('Something went wrong running that command.'),
            ]
        };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorReply);
        } else {
            await interaction.reply(errorReply);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);