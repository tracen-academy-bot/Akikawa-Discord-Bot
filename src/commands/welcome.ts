import {
    ActionRowBuilder,
    ChannelType,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
    type GuildMember,
    type ModalSubmitInteraction,
} from 'discord.js';
import { prisma } from '../db/prisma';
import { errorEmbed, successEmbed } from '../lib/embeds';
import { isOfficer } from '../lib/permissions';
import { DEFAULT_WELCOME, WELCOME_MAX_LENGTH, boostPayload, isWaveButton, recordWave, waveTarget, wavePayload, welcomeContext, welcomePayload, welcomeVariants } from '../lib/welcome';

/**
 * `/welcome`: the message new members get (see `lib/welcome.ts`). Club
 * Managers only.
 *
 *   channel <channel>  turn welcomes on, posting there
 *   message            edit the text, in a form; `---` lines split variants
 *   options            the "Say hi!" button and boost thank-yous, on or off
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
    .addSubcommand((sub) => sub.setName('message').setDescription('Edit the welcome text; lines of just --- split it into variants picked at random.'))
    .addSubcommand((sub) =>
        sub
            .setName('options')
            .setDescription('Turn the "Say hi!" button and boost thank-yous on or off.')
            .addBooleanOption((opt) => opt.setName('wave').setDescription('A "Say hi!" button under each welcome'))
            .addBooleanOption((opt) => opt.setName('boosts').setDescription('Thank members who start boosting, in the welcome channel')),
    )
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

    if (sub === 'options') {
        const wave = interaction.options.getBoolean('wave');
        const boosts = interaction.options.getBoolean('boosts');
        const data = { ...(wave !== null ? { wave } : {}), ...(boosts !== null ? { boosts } : {}) };
        const saved = await prisma.welcomeSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
        await interaction.reply({
            embeds: [
                successEmbed(
                    'Welcome options',
                    [`"Say hi!" button: **${saved.wave ? 'on' : 'off'}**`, `Boost thank-yous: **${saved.boosts ? 'on' : 'off'}**`, saved.channelId ? `Posting in <#${saved.channelId}>.` : 'Welcomes are off: turn them on with `/welcome channel`.'].join('\n'),
                ),
            ],
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
            .setPlaceholder('Empty goes back to the default. A line of just --- starts another variant.')
            .setValue((settings?.message ?? DEFAULT_WELCOME).slice(0, WELCOME_MAX_LENGTH));
        await interaction.showModal(
            new ModalBuilder().setCustomId(MODAL_ID).setTitle('Welcome message').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
        );
        return;
    }

    // test
    const text = settings?.message ?? DEFAULT_WELCOME;
    const payload = welcomePayload(text, await welcomeContext(interaction.member as GuildMember), interaction.member.displayAvatarURL({ size: 256 }), settings?.wave ?? true);
    const where = settings?.channelId ? `Posts in <#${settings.channelId}>.` : 'Welcomes are off: turn them on with `/welcome channel`.';
    const variants = welcomeVariants(text).length;
    const boost = (settings?.boosts ?? true) ? `\n-# Boost thank-you, for example: ${boostPayload(interaction.user.id, interaction.guild.name).content}` : '';
    await interaction.reply({
        ...payload,
        content: `-# Preview, one of ${variants} variant${variants === 1 ? '' : 's'} picked at random. ${where} Placeholders: ${PLACEHOLDERS}${boost}`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
    });
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

export { isWaveButton };

/**
 * A "Say hi!" press: posts a greeting from the presser to the newcomer,
 * once per member per welcome. The newcomer cannot greet themselves.
 */
export async function handleWaveButton(interaction: ButtonInteraction) {
    const target = waveTarget(interaction.customId);
    if (interaction.user.id === target) {
        await interaction.reply({ content: 'This button is for everyone else to greet you. Welcome!', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!recordWave(interaction.message.id, interaction.user.id)) {
        await interaction.reply({ content: 'You already said hi here.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply(wavePayload(interaction.user.id, target));
}
