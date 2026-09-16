import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, ThreadChannel, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed } from '../lib/embeds';

const TAG_TRANSFER_ID = process.env.TAG_TRANSFER_ID;
const TAG_CLUB_APP_ACCEPTED_ID = process.env.TAG_CLUB_APP_ACCEPTED_ID;

/**
 * Tag choices, built only from IDs that are actually configured.
 *
 * Passing an undefined `value` to `addChoices` throws inside discord.js option
 * validation at module load, which crashed the whole process before it ever
 * signed in — and the resulting `@sapphire/shapeshift` stack trace named
 * neither `/settag` nor the missing variable. Filtering here means an
 * unconfigured tag simply does not appear as a choice.
 */
const TAG_CHOICES = [
    { name: 'Transfer', value: TAG_TRANSFER_ID },
    { name: 'Club App Accepted', value: TAG_CLUB_APP_ACCEPTED_ID },
].filter((choice): choice is { name: string; value: string } => Boolean(choice.value));

export const data = new SlashCommandBuilder()
    .setName('settag')
    .setDescription('Tag this thread and close it (Transfer / Club App Accepted).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .addStringOption((opt) => {
        opt.setName('tag').setDescription('Choose the tag you want to apply.').setRequired(true);
        // With no configured tags the option is left free-text rather than
        // registering an empty choice list, which Discord rejects.
        if (TAG_CHOICES.length > 0) opt.addChoices(...TAG_CHOICES);
        return opt;
    });

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

    if (TAG_CHOICES.length === 0) {
        await interaction.reply({
            embeds: [errorEmbed('No forum tags are configured. Set TAG_TRANSFER_ID and TAG_CLUB_APP_ACCEPTED_ID.')],
        });
        return;
    }

    const tagId = interaction.options.getString('tag', true);
    const tagLabel = TAG_CHOICES.find((t) => t.value === tagId)?.name;
    if (!tagLabel) {
        await interaction.reply({ embeds: [errorEmbed('That tag is not configured on this server.')] });
        return;
    }

    const newTags = thread.appliedTags.includes(tagId) ? thread.appliedTags : [...thread.appliedTags, tagId];
    if (newTags.length > 5) {
        // Previously this replied and then fell through to reply a second
        // time, which throws InteractionAlreadyReplied.
        await interaction.reply({ embeds: [errorEmbed('This thread already has 5 tags.')] });
        return;
    }

    await interaction.reply({ embeds: [successEmbed('Thread Tagged', `Tagging this thread as ${tagLabel} and closing it.`)] });
    // Applies `newTags`, not `[tagId]`. The previous code computed `newTags`
    // and checked it against Discord's five-tag limit, then set only the new
    // tag, silently dropping every tag the thread already had -- which also
    // made that limit check unreachable.
    await thread.setAppliedTags(newTags);
    await thread.setLocked(true, `Tagged as ${tagLabel}`);
    await thread.setArchived(true, `Tagged as ${tagLabel}`);
}