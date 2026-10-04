import {
    ChannelSelectMenuBuilder,
    ChannelType,
    CheckboxBuilder,
    ChatInputCommandInteraction,
    FileUploadBuilder,
    GuildMember,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { isOfficer } from '../lib/permissions';
import { errorEmbed, successEmbed } from '../lib/embeds';

/**
 * `/post`: post a message as Akikawa, through a form.
 *
 * For Club Managers fixing things up in Discord: rules and info posts, a
 * corrected announcement, a file the bot should be the author of. The form
 * asks for a channel (a thread works), the message (Markdown, several lines),
 * an optional attachment, and whether to pin it.
 *
 * The modal's components are routed by custom ID (`post:` prefix) from the
 * interaction handler in `index.ts`, like the timer panel's buttons.
 */

/** Custom IDs. The `post:` prefix is how `index.ts` routes the submit here. */
export const POST_MODAL_ID = 'post:compose';
const FIELD = {
    channel: 'post:channel',
    content: 'post:content',
    files: 'post:files',
    pin: 'post:pin',
} as const;

/** True for a modal this module owns. */
export function isPostModal(customId: string): boolean {
    return customId.startsWith('post:');
}

/** Discord's message length limit. */
const MAX_CONTENT = 2000;

/** Channels a post may go to. Threads included. */
const POSTABLE = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
] as const;

export const data = new SlashCommandBuilder().setName('post').setDescription('Post a message as Akikawa, with an optional file and pin (Club Managers).');

/** Builds the form, with the current channel picked by default. */
export function buildPostModal(defaultChannelId: string | null): ModalBuilder {
    const channel = new ChannelSelectMenuBuilder()
        .setCustomId(FIELD.channel)
        .setPlaceholder('Where should this go?')
        .setChannelTypes(...POSTABLE)
        .setMinValues(1)
        .setMaxValues(1);
    if (defaultChannelId) channel.setDefaultChannels(defaultChannelId);

    return new ModalBuilder()
        .setCustomId(POST_MODAL_ID)
        .setTitle('Post a message')
        .addLabelComponents(
            new LabelBuilder().setLabel('Channel').setChannelSelectMenuComponent(channel),
            new LabelBuilder()
                .setLabel('Message')
                .setDescription('Markdown works. Enter makes a new line.')
                .setTextInputComponent(
                    new TextInputBuilder().setCustomId(FIELD.content).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(MAX_CONTENT),
                ),
            new LabelBuilder()
                .setLabel('Attachment')
                .setDescription('Optional image or file.')
                .setFileUploadComponent(new FileUploadBuilder().setCustomId(FIELD.files).setRequired(false)),
            new LabelBuilder()
                .setLabel('Pin it')
                .setDescription('For rules and info posts.')
                .setCheckboxComponent(new CheckboxBuilder().setCustomId(FIELD.pin)),
        );
}

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can post as Akikawa.')], flags: MessageFlags.Ephemeral });
        return;
    }
    // A modal must be the first response, so nothing slow may run before it.
    await interaction.showModal(buildPostModal(interaction.channelId));
}

/**
 * Handles the submitted form: posts the message, pins it if asked, and tells
 * the poster where it went. Permission is checked again here, since a submit
 * is a separate interaction from the command that opened the form.
 */
export async function handlePostModal(interaction: ModalSubmitInteraction) {
    if (!interaction.inGuild()) return;
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can post as Akikawa.')], flags: MessageFlags.Ephemeral });
        return;
    }

    const picked = interaction.fields.getSelectedChannels(FIELD.channel, true).first();
    const content = interaction.fields.getTextInputValue(FIELD.content).trim();
    const files = [...(interaction.fields.getUploadedFiles(FIELD.files)?.values() ?? [])];
    const pin = interaction.fields.getCheckbox(FIELD.pin);

    if (!picked) {
        await interaction.reply({ embeds: [errorEmbed('Pick a channel to post in.')], flags: MessageFlags.Ephemeral });
        return;
    }
    if (!content && files.length === 0) {
        await interaction.reply({ embeds: [errorEmbed('Write a message or attach a file; there is nothing to post.')], flags: MessageFlags.Ephemeral });
        return;
    }

    // Re-uploading a large file can take longer than Discord's 3-second reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await interaction.client.channels.fetch(picked.id).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
        await interaction.editReply({ embeds: [errorEmbed(`Akikawa cannot post in <#${picked.id}>.`)] });
        return;
    }

    let message;
    try {
        message = await channel.send({
            ...(content ? { content } : {}),
            files: files.map((f) => ({ attachment: f.url, name: f.name })),
            // Members and roles can be pinged on purpose; @everyone and @here
            // cannot, so a pasted announcement never pings the whole server.
            allowedMentions: { parse: ['users', 'roles'] },
        });
    } catch (e) {
        await interaction.editReply({
            embeds: [errorEmbed(`Could not post in <#${picked.id}>: ${e instanceof Error ? e.message : String(e)}. Check Akikawa can send messages and attach files there.`)],
        });
        return;
    }

    let pinNote = '';
    if (pin) {
        try {
            await message.pin();
            pinNote = ' and pinned it';
        } catch (e) {
            pinNote = `, but could not pin it (${e instanceof Error ? e.message : String(e)}; Akikawa needs Pin Messages there)`;
        }
    }

    await interaction.editReply({ embeds: [successEmbed('Posted', `Posted in <#${picked.id}>${pinNote}: ${message.url}`)] });
}
