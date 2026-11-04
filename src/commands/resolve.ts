import {
    SlashCommandBuilder,
    MessageFlags,
    type AutocompleteInteraction,
    type ChatInputCommandInteraction,
    type GuildMember,
    type ThreadChannel,
} from 'discord.js';
import { prisma } from '../db/prisma';
import { errorEmbed } from '../lib/embeds';
import { canDecide } from '../lib/applications/permissions';
import { giveClubRole } from '../lib/applications/clubRole';
import { guildClubs } from '../lib/clubLinks';
import { REJECTED, decisionMessage, ensureApplication, isApplicationThread, resolveApplication } from '../lib/applications/service';

/**
 * `/resolve outcome:<club | Rejected> [note]`: decides an application. Used
 * in the post; accepting needs a trainer ID, rejecting does not. Tags it (Club App Accepted, or Rejected), locks it so only
 * staff can write in it, posts the decision with a Close button for the
 * applicant, and updates the recruitment board. Accepting also gives the
 * applicant the club's role and takes off their other club roles (visas
 * stay). Running it again changes the
 * decision.
 */
export const data = new SlashCommandBuilder()
    .setName('resolve')
    .setDescription('Decide this club application: a club, or Rejected. Locks the post.')
    .addStringOption((opt) => opt.setName('outcome').setDescription('The club they go to, or Rejected').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('note').setDescription('Shown to the applicant with the decision').setMaxLength(500));

/** Rejected first, then the clubs whose name matches what is typed. */
export async function autocomplete(interaction: AutocompleteInteraction) {
    const typed = interaction.options.getFocused().trim();
    const clubs = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId ?? '', name: { contains: typed, mode: 'insensitive' } },
        orderBy: { name: 'asc' },
        take: 24,
    });
    const rejected = !typed || 'rejected'.includes(typed.toLowerCase()) ? [{ name: 'Rejected', value: REJECTED }] : [];
    await interaction.respond([...rejected, ...clubs.map((c) => ({ name: c.name, value: c.id }))]);
}

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const thread = interaction.channel;
    if (!thread?.isThread() || !isApplicationThread(thread)) {
        await interaction.reply({ embeds: [errorEmbed('Use this inside a post in the club application forum.')], flags: MessageFlags.Ephemeral });
        return;
    }

    const outcome = interaction.options.getString('outcome', true);
    const club = outcome === REJECTED ? null : await prisma.trackedCircle.findFirst({ where: { id: outcome, guildId: interaction.guildId } });
    if (outcome !== REJECTED && !club) {
        await interaction.reply({ embeds: [errorEmbed('Pick a club from the list, or Rejected.')], flags: MessageFlags.Ephemeral });
        return;
    }
    if (!(await canDecide(interaction.member as GuildMember, club))) {
        const who = club ? `${club.name}'s staff or a Club Manager` : "a club's staff or a Club Manager";
        await interaction.reply({ embeds: [errorEmbed(`Only ${who} can do that.`)], flags: MessageFlags.Ephemeral });
        return;
    }

    // Accepting needs the trainer ID: staff decide on numbers, and closing
    // the post links the applicant to that trainer. Rejecting does not.
    const { app: current } = await ensureApplication(thread as ThreadChannel);
    if (club && current.viewerId === null) {
        await interaction.reply({
            embeds: [errorEmbed(`No trainer ID yet, so it cannot be accepted. <@${current.applicantId}> has been asked to send it here. Rejected works without one.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply();
    const note = interaction.options.getString('note')?.trim() || null;
    const app = await resolveApplication(thread as ThreadChannel, club, interaction.user.id, note);

    // Accepted: the applicant gets the club's role, and loses every other
    // club role and Tracen Applicant. Visas and other roles stay.
    let roleLine = '';
    let roleProblem: string | null = null;
    if (club) {
        const member = await interaction.guild.members.fetch(app.applicantId).catch(() => null);
        const result = member
            ? await giveClubRole(member, club, await guildClubs(interaction.guildId))
            : { ok: false as const, reason: 'they are not in the server, so no roles were changed.' };
        if (result.ok) roleLine = `\nYou now have the **${result.role.name}** role.`;
        else roleProblem = result.reason;
    }

    const message = decisionMessage(app);
    await interaction.editReply({ ...message, content: message.content + roleLine });
    if (roleProblem) {
        await interaction.followUp({ embeds: [errorEmbed(`Accepted, but the club role was not given: ${roleProblem}`)], flags: MessageFlags.Ephemeral });
    }
}
