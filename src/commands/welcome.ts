import {
    ActionRowBuilder,
    ChannelType,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
    type ChatInputCommandInteraction,
    type GuildMember,
    type ModalSubmitInteraction,
} from 'discord.js';
import { prisma } from '../db/prisma';
import { errorEmbed, successEmbed } from '../lib/embeds';
import { isOfficer } from '../lib/permissions';
import { DEFAULT_WELCOME, WELCOME_MAX_LENGTH, welcomeContext, welcomePayload } from '../lib/welcome';

/**
 * `/welcome`: the message new members get (see `lib/welcome.ts`). Club
 * Managers only.
 *
 *   channel <channel>  turn welcomes on, posting there
 *   message            edit the text, in a form (it can span lines)
 *   test               show the welcome as you would get it, only to you
 *   off                stop welcoming
 */
export const data = new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('The welcome message for new members. Club Managers only.')
    .addSubcommand((sub) =>
        sub
            .setName('channel')
            .setDescription('Turn welcomes on, posting in this channel.')
            .addChannelOption((opt) =>
                opt.setName('channel').setDescription('Where to welcome new members').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            ),
    )
    .addSubcommand((sub) => sub.setName('message').setDescription('Edit the welcome text.'))
    .addSubcommand((sub) => sub.setName('test').setDescription('See the welcome as a new member would, only to you.'))
    .addSubcommand((sub) => sub.setName('off').setDescription('Stop welcoming new members.'));

/** The welcome text form's custom ID; `index.ts` routes it here. */
const MODAL_ID = 'welcome:message';

/** True for the welcome text form. */
export function isWelcomeModal(customId: string): boolean {
    return customId === MODAL_ID;
}

/** The placeholders, as the form and the replies explain them. */
const PLACEHOLDERS = '{user} the new member · {server} · {count} member number · {apply} application forum · {clubs} club directory';

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can change the welcome.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const guildId = interaction.guildId;
    const settings = await prisma.welcomeSettings.findUnique({ where: { guildId } });
    const sub = interaction.options.getSubcommand();

    if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel', true);
        await prisma.welcomeSettings.upsert({ where: { guildId }, create: { guildId, channelId: channel.id }, update: { channelId: channel.id } });
        await interaction.reply({
            embeds: [successEmbed('Welcome on', `New members are welcomed in <#${channel.id}>. Edit the text with \`/welcome message\`; see it with \`/welcome test\`.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (sub === 'off') {
        await prisma.welcomeSettings.upsert({ where: { guildId }, create: { guildId, channelId: null }, update: { channelId: null } });
        await interaction.reply({ embeds: [successEmbed('Welcome off', 'New members are not welcomed. The text is kept for when you turn it back on.')], flags: MessageFlags.Ephemeral });
        return;
    }

    if (sub === 'message') {
        const input = new TextInputBuilder()
            .setCustomId('text')
            .setLabel('Welcome text')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(WELCOME_MAX_LENGTH)
            .setRequired(false)
            .setPlaceholder('Empty goes back to the default.')
            .setValue((settings?.message ?? DEFAULT_WELCOME).slice(0, WELCOME_MAX_LENGTH));
        await interaction.showModal(
            new ModalBuilder().setCustomId(MODAL_ID).setTitle('Welcome message').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
        );
        return;
    }

    // test
    const payload = welcomePayload(settings?.message ?? DEFAULT_WELCOME, await welcomeContext(interaction.member as GuildMember), interaction.member.displayAvatarURL({ size: 256 }));
    const where = settings?.channelId ? `Posts in <#${settings.channelId}>.` : 'Welcomes are off: turn them on with `/welcome channel`.';
    await interaction.reply({ ...payload, content: `-# Preview. ${where} Placeholders: ${PLACEHOLDERS}`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
}

/** Saves the text from the form. */
export async function handleWelcomeModal(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return;
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can change the welcome.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const text = interaction.fields.getTextInputValue('text').trim();
    const message = text && text !== DEFAULT_WELCOME ? text : null;
    await prisma.welcomeSettings.upsert({ where: { guildId: interaction.guildId }, create: { guildId: interaction.guildId, message }, update: { message } });
    await interaction.reply({
        embeds: [successEmbed('Welcome text saved', `${message ? 'Your text is saved.' : 'Back to the default text.'} See it with \`/welcome test\`.\n-# Placeholders: ${PLACEHOLDERS}`)],
        flags: MessageFlags.Ephemeral,
    });
}
