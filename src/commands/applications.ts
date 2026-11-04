import {
    AttachmentBuilder,
    ChannelType,
    EmbedBuilder,
    GatewayIntentBits,
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
import { tidyApplications } from '../lib/applications/tidy';

/**
 * `/applications tidy`: see `tidyApplications`.
 *
 * `/applications backfill [rescan]`: imports every post already in the
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
            .setDescription('Import every old application post and match it to uma.moe and our clubs. Club Managers only.')
            .addBooleanOption((opt) =>
                opt.setName('rescan').setDescription('Also re-read imported closed posts with no trainer ID, or one uma.moe did not find'),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('tidy')
            .setDescription('Close every application except the posts still open in the forum. Club Managers only.'),
    );

/**
 * Whether the bot connected with the Message Content intent. Without it,
 * Discord sends empty text for every message, so IDs in post bodies and in
 * replies are never seen. Startup drops the intent instead of failing when
 * the developer portal has it off.
 */
export function messageContentLine(on: boolean): string {
    return on
        ? '**Message Content**: on, so post bodies and replies are read.'
        : '**Message Content**: OFF. Post bodies and replies are not read, so IDs written there are missed. Turn on "Message Content Intent" in the Discord developer portal (Bot, Privileged Gateway Intents) and restart the bot.';
}

/** The summary embed. */
export function backfillSummary(report: BackfillReport, intentOn?: boolean): EmbedBuilder {
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
        `**Imported**: ${report.imported}${report.rescanned > 0 ? `, re-read ${report.rescanned}` : ''}; ${report.withId} with a trainer ID, ${report.foundOnUma} found on uma.moe`,
        ...(report.pinnedSkipped > 0 ? [`**Pinned posts skipped**: ${report.pinnedSkipped}`] : []),
        `**Outcome**: ${status || 'none'}`,
        `**Now in our clubs**: ${clubs || 'none'}`,
        `**Discord linked to trainer**: ${report.linked} (closed posts only; existing links kept)`,
        '-# Every imported post is in the CSV, with the trainer, where they are now and any problem.',
    ];
    if (intentOn !== undefined) lines.push(messageContentLine(intentOn));
    const { withText, empty, failed } = report.starters;
    const read = withText + empty + failed;
    if (read > 0 && withText === 0) {
        lines.push(
            `**Warning**: none of the ${read} opening messages could be read (${empty} came back empty, ${failed} could not be fetched), so IDs in post bodies were missed. ` +
                (empty >= failed
                    ? 'Empty text means the Message Content intent is off: Discord developer portal, Bot, Privileged Gateway Intents.'
                    : 'Failed fetches mean Akikawa lacks Read Message History in the forum.') +
                ' Fix it, then run this again with `rescan:true`.',
        );
    }
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

    if (interaction.options.getSubcommand() === 'tidy') {
        await interaction.deferReply();
        const r = await tidyApplications(forum as ForumChannel);
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('Applications tidied')
                    .setDescription(
                        [
                            `**Open again** (still open in the forum): ${r.reopened}`,
                            `**Closed** (not open in the forum): ${r.closed}`,
                            `**Pinned posts removed**: ${r.removed}`,
                            `**Pace filled in**: ${r.rescouted}`,
                            `**IDs found on a second read**: ${r.idsFound}`,
                            messageContentLine(interaction.client.options.intents.has(GatewayIntentBits.MessageContent)),
                            '-# Applications decided with /resolve were left as they are. The recruitment board is updated.',
                        ].join('\n'),
                    ),
            ],
        });
        return;
    }

    await interaction.deferReply();
    const started = Date.now();
    // An interaction can be edited for 15 minutes. A long run reports its
    // result as a plain message in the channel instead.
    const tokenAlive = () => Date.now() - started < 14 * 60_000;
    const report = await backfillApplications(forum as ForumChannel, {
        rescan: interaction.options.getBoolean('rescan') ?? false,
        onProgress: async (done, total) => {
            if (tokenAlive()) await interaction.editReply(`Matching old applications: ${done} of ${total} posts...`).catch(() => undefined);
        },
    });
    const payload = {
        content: '',
        embeds: [backfillSummary(report, interaction.client.options.intents.has(GatewayIntentBits.MessageContent))],
        files: [new AttachmentBuilder(Buffer.from(backfillCsv(report.rows), 'utf8'), { name: 'application-backfill.csv' })],
    };
    if (tokenAlive()) {
        await interaction.editReply(payload);
    } else if (interaction.channel?.isSendable()) {
        await interaction.channel.send({ ...payload, content: `<@${interaction.user.id}> the backfill finished.`, allowedMentions: { users: [interaction.user.id] } });
    }
}
