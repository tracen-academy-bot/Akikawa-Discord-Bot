import {
    AttachmentBuilder,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type ForumChannel,
    type GuildMember,
} from 'discord.js';
import { errorEmbed } from '../lib/embeds';
import { isOfficer } from '../lib/permissions';
import { FORUM_ID } from '../lib/applications/service';
import { backfillApplications, backfillCsv, type BackfillReport } from '../lib/applications/backfill';

/**
 * `/applications backfill`: imports every post already in the
 * application forum, open or archived, and matches each applicant against
 * uma.moe and the server's clubs. Replies with a summary and a CSV of every
 * imported post. Club Managers only. Running it again imports only posts
 * that have no row yet.
 */
export const data = new SlashCommandBuilder()
    .setName('applications')
    .setDescription('Club application tools.')
    .addSubcommand((sub) =>
        sub
            .setName('backfill')
            .setDescription('Import every old application post and match it to uma.moe and our clubs. Club Managers only.'),
    );

/** The summary embed. */
export function backfillSummary(report: BackfillReport): EmbedBuilder {
    const status = Object.entries(report.byStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s.toLowerCase()} ${n}`)
        .join(' · ');
    const clubs = Object.entries(report.nowInClub)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([c, n]) => `${c} ${n}`)
        .join(' · ');
    const lines = [
        `**Posts in the forum**: ${report.scanned} (${report.alreadyTracked} already tracked)`,
        `**Imported**: ${report.imported}, ${report.withId} with a trainer ID, ${report.foundOnUma} found on uma.moe`,
        `**Outcome**: ${status || 'none'}`,
        `**Now in our clubs**: ${clubs || 'none'}`,
        `**Discord linked to trainer**: ${report.linked} (closed posts only; existing links kept)`,
        '-# Every imported post is in the CSV, with the trainer, where they are now and any problem.',
    ];
    return new EmbedBuilder().setColor(0x5865f2).setTitle('Application backfill').setDescription(lines.join('\n'));
}

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({ embeds: [errorEmbed('Only Club Managers can run the backfill.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const forum = FORUM_ID ? await interaction.client.channels.fetch(FORUM_ID).catch(() => null) : null;
    if (!forum || forum.type !== ChannelType.GuildForum) {
        await interaction.reply({ embeds: [errorEmbed('FORUM_CHANNEL_ID is not set to a forum Akikawa can see.')], flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply();
    const started = Date.now();
    // An interaction can be edited for 15 minutes. A long run reports its
    // result as a plain message in the channel instead.
    const tokenAlive = () => Date.now() - started < 14 * 60_000;
    const report = await backfillApplications(forum as ForumChannel, {
        onProgress: async (done, total) => {
            if (tokenAlive()) await interaction.editReply(`Matching old applications: ${done} of ${total} posts...`).catch(() => undefined);
        },
    });
    const payload = {
        content: '',
        embeds: [backfillSummary(report)],
        files: [new AttachmentBuilder(Buffer.from(backfillCsv(report.rows), 'utf8'), { name: 'application-backfill.csv' })],
    };
    if (tokenAlive()) {
        await interaction.editReply(payload);
    } else if (interaction.channel?.isSendable()) {
        await interaction.channel.send({ ...payload, content: `<@${interaction.user.id}> the backfill finished.`, allowedMentions: { users: [interaction.user.id] } });
    }
}
