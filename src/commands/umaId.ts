import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { prisma } from '../db/prisma';
import { infoEmbed } from '../lib/embeds';
import { linkTrainer, unlinkTrainer } from './fans';
import { errorEmbed } from '../lib/embeds';

/**
 * `/uma-id`: link your uma.moe trainer, see which one you are linked to, or
 * remove the link with `remove:true`.
 *
 * Replaces `/fans link` and `/fans unlink`, which members did not find. The link is what
 * `/fans me`, `/fans trainer` and alert tags use to know who a
 * trainer is on Discord. Named for the uma.moe ID rather than "trainer",
 * which on this server means a club's staff role.
 */
export const data = new SlashCommandBuilder()
    .setName('uma-id')
    .setDescription('Link your uma.moe trainer ID, or see which one you are linked to.')
    .addStringOption((opt) =>
        opt.setName('id').setDescription('Your uma.moe viewer ID, from your trainer profile. Leave empty to see your link.'),
    )
    .addUserOption((opt) => opt.setName('member').setDescription('Someone else to link, look up or unlink (Club Managers to change)'))
    .addBooleanOption((opt) => opt.setName('remove').setDescription('Remove the link instead'));

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    const id = interaction.options.getString('id');
    const member = interaction.options.getUser('member');
    if (interaction.options.getBoolean('remove')) {
        if (id !== null) {
            await interaction.reply({ embeds: [errorEmbed('Give an ID to link, or `remove:true` to unlink, not both.')], flags: MessageFlags.Ephemeral });
            return;
        }
        await unlinkTrainer(interaction, member);
        return;
    }
    if (id !== null) {
        await linkTrainer(interaction, id, member);
        return;
    }

    // No ID given: say who they are linked to, and how to change it.
    const subject = member ?? interaction.user;
    const link = await prisma.trainerLink.findUnique({
        where: { guildId_discordUserId: { guildId: interaction.guildId, discordUserId: subject.id } },
    });
    const self = subject.id === interaction.user.id;
    const text = link
        ? `${self ? 'You are' : `<@${subject.id}> is`} linked to uma.moe trainer \`${link.viewerId}\`.${self ? ' Run `/uma-id id:` with another ID to change it.' : ''}`
        : `${self ? 'You are' : `<@${subject.id}> is`} not linked yet. ${self ? 'Run `/uma-id id:` with your viewer ID, from your uma.moe trainer profile.' : ''}`;
    await interaction.reply({ embeds: [infoEmbed('uma.moe ID', text.trim())], flags: MessageFlags.Ephemeral });
}
