import { SlashCommandBuilder, MessageFlags, EmbedBuilder, type ChatInputCommandInteraction, type GuildMember, type ThreadChannel } from 'discord.js';
import { errorEmbed } from '../lib/embeds';
import { extractTrainerId, clubFits } from '../lib/applications/history';
import { headlinePace } from '../lib/applications/scout';
import { isAnyClubStaff } from '../lib/applications/permissions';
import { cardFile, clubsWithQuota, fitsText, isApplicationThread, rescoutApplication, tryScout } from '../lib/applications/service';

/**
 * `/scout [id]`: a trainer's uma.moe card (last 30 days, last 3 and 6
 * months). In an application post it scouts the post's trainer, or sets the
 * post's trainer ID when one is given, and updates the recruitment entry;
 * the applicant or club staff may run it there. Elsewhere it needs an ID and
 * also lists the clubs whose quota the trainer's pace clears.
 */
export const data = new SlashCommandBuilder()
    .setName('scout')
    .setDescription("A trainer's fan history from uma.moe: last 30 days and last months.")
    .addStringOption((opt) => opt.setName('id').setDescription('Trainer ID, 9 to 12 digits. In an application post, defaults to its ID.'));

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const typed = interaction.options.getString('id');
    const id = typed === null ? null : extractTrainerId(typed);
    if (typed !== null && !id) {
        await interaction.reply({ embeds: [errorEmbed('A trainer ID is 9 to 12 digits.')], flags: MessageFlags.Ephemeral });
        return;
    }

    const thread = interaction.channel;
    if (thread?.isThread() && isApplicationThread(thread)) {
        if (interaction.user.id !== thread.ownerId && !(await isAnyClubStaff(interaction.member as GuildMember))) {
            await interaction.reply({ embeds: [errorEmbed('Only the applicant or club staff can scout in this post.')], flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply();
        const { app, outcome } = await rescoutApplication(thread as ThreadChannel, id);
        if (!outcome.report) {
            await interaction.editReply({ embeds: [errorEmbed(outcome.reason)] });
            return;
        }
        await interaction.editReply({
            content: `uma.moe history for **${outcome.report.trainerName ?? outcome.report.viewerId}** (\`${outcome.report.viewerId}\`).`,
            files: [await cardFile(outcome.report, app.tags)],
            allowedMentions: { parse: [] },
        });
        return;
    }

    if (!id) {
        await interaction.reply({ embeds: [errorEmbed('Give a trainer ID, or use this in an application post.')], flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply();
    const outcome = await tryScout(id);
    if (!outcome.report) {
        await interaction.editReply({ embeds: [errorEmbed(outcome.reason)] });
        return;
    }
    const pace = headlinePace(outcome.report);
    const fits = fitsText(clubFits(pace?.perDay ?? null, await clubsWithQuota(interaction.guildId)));
    const lines = [`**Clears the quota of**: ${pace ? fits.clears : 'unknown, no pace'}`];
    if (pace && fits.highestTier) lines.push(`**Highest tier cleared**: ${fits.highestTier}`);
    if (pace) lines.push(`-# Judged on the ${pace.basis}, per calendar day.`);
    const file = await cardFile(outcome.report, []);
    await interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`${outcome.report.trainerName ?? id} · ${id}`)
                .setDescription(lines.join('\n'))
                .setImage(`attachment://${file.name}`),
        ],
        files: [file],
    });
}
