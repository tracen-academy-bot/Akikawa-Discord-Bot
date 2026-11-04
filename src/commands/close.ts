import {
    SlashCommandBuilder,
    MessageFlags,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
    type GuildMember,
    type ThreadChannel,
} from 'discord.js';
import { prisma } from '../db/prisma';
import { errorEmbed } from '../lib/embeds';
import { isAnyClubStaff } from '../lib/applications/permissions';
import { CLOSE_BUTTON_ID, archivePost, closeApplication, isApplicationThread } from '../lib/applications/service';

/**
 * `/close`, and the Close post button on a decision: closes an application
 * post once it is done. An accepted applicant closes it after joining the
 * club; it then reads Joined in the recruitment channel. The applicant or
 * any club's staff may close it.
 *
 * The button is the way in for applicants: a locked post has no message box
 * for them, so they cannot type a slash command there.
 */
export const data = new SlashCommandBuilder().setName('close').setDescription('Close this club application post (after joining the club).');

/** True for the Close post button. */
export function isCloseButton(customId: string): boolean {
    return customId === CLOSE_BUTTON_ID;
}

/** Shared by the command and the button. */
async function run(interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>) {
    const thread = interaction.channel;
    if (!thread?.isThread() || !isApplicationThread(thread)) {
        await interaction.reply({ embeds: [errorEmbed('Use this inside a post in the club application forum.')], flags: MessageFlags.Ephemeral });
        return;
    }
    const app = await prisma.clubApplication.findUnique({ where: { threadId: thread.id } });
    const applicantId = app?.applicantId ?? thread.ownerId;
    if (interaction.user.id !== applicantId && !(await isAnyClubStaff(interaction.member as GuildMember))) {
        await interaction.reply({ embeds: [errorEmbed('Only the applicant or club staff can close this post.')], flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply();
    const { line } = await closeApplication(thread as ThreadChannel);
    await interaction.editReply({ content: line, allowedMentions: { parse: [] } });
    // The decision's button would only error on an archived post; take it off.
    if (interaction.isButton()) await interaction.message.edit({ components: [] }).catch(() => undefined);
    await archivePost(thread as ThreadChannel, `Closed by ${interaction.user.tag}`);
}

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    await run(interaction);
}

export async function handleCloseButton(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;
    await run(interaction);
}
