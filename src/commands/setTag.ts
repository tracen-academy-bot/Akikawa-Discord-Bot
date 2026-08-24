import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, ThreadChannel, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed } from '../lib/embeds';

const TAG_TRANSFER_ID = process.env.TAG_TRANSFER_ID!;
const TAG_CLUB_APP_ACCEPTED_ID = process.env.TAG_CLUB_APP_ACCEPTED_ID!;
const TAG_CHOICES = [
    { name: "Transfer", value: TAG_TRANSFER_ID },
    { name: "Club App Accepted", value: TAG_CLUB_APP_ACCEPTED_ID },
];

export const data = new SlashCommandBuilder()
    .setName('settag')
    .setDescription('Tag this thread and close it (Transfer / Club App Accepted).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .addStringOption((opt) =>
        opt
            .setName('tag')
            .setDescription('Choose the tag you want to apply.')
            .setRequired(true)
            .addChoices(...TAG_CHOICES)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel?.isThread()) {
        await interaction.reply({
            content: 'This command only works inside a thread.',
        });
        return;
    }

    const thread = interaction.channel as ThreadChannel;

    if (thread.parent?.type !== ChannelType.GuildForum) {
        await interaction.reply({
            content: 'This command only works on forum post threads.'
        });
        return;
    }

    const tagId = interaction.options.getString('tag', true);
    const tagLabel = TAG_CHOICES.find((t) => t.value === tagId)?.name;

    const newTags = thread.appliedTags.includes(tagId) ? thread.appliedTags : [...thread.appliedTags, tagId];
    if (newTags.length > 5) {
        await interaction.reply({ embeds: [errorEmbed('This thread already has 5 tags.')] })
    }

    await interaction.reply({ embeds: [successEmbed('Thread Tagged', `Tagging this thread as ${tagLabel} and closing it.`)] });
    await thread.setAppliedTags([tagId]);
    await thread.setLocked(true, `Tagged as ${tagLabel}`);
    await thread.setArchived(true, `Tagged as ${tagLabel}`);
}