import {
    CheckboxBuilder,
    FileUploadBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type { ClubTier, TrackedCircle } from '@prisma/client';
import { prisma } from '../db/prisma';
import { canManageClubStats, isOfficer, type StaffCandidate } from '../lib/permissions';
import { errorEmbed } from '../lib/embeds';
import { guildClubs } from '../lib/clubLinks';
import { TIERS, TIER_ORDER, clubCard, clubStaff, loadMembers, refreshDirectory, type DirectoryGuild } from '../lib/clubDirectory';

/**
 * `/club profile`: what a club's directory card says about it.
 *
 * The club's own staff (Trainers and Assistants) and Club Managers edit its
 * bio, rules and banner. Club Managers also set its tier, which places it in
 * the directory (G1 to Debut); a club with no tier is left out. A separate
 * form from `/club edit`, which already has Discord's limit of five fields.
 *
 * The submit replies with the card as the directory will show it, and
 * refreshes the directory.
 */

const PROFILE_MODAL_PREFIX = 'club:profile:';
const FIELD = {
    tier: 'club:profile:tier',
    bio: 'club:profile:bio',
    rules: 'club:profile:rules',
    banner: 'club:profile:banner',
    removeBanner: 'club:profile:remove-banner',
} as const;

/** Longest bio and rules. Both fit one card (4096 characters) with room for staff. */
export const MAX_BIO = 1500;
export const MAX_RULES = 1000;
/** Largest banner, in bytes. It is re-uploaded with every directory refresh. */
export const MAX_BANNER_BYTES = 8 * 1024 * 1024;
/** Tier select value for "not in the directory". */
const NO_TIER = 'NONE';

/** True for a modal this module owns. */
export function isProfileModal(customId: string): boolean {
    return customId.startsWith(PROFILE_MODAL_PREFIX);
}

/**
 * Builds the profile form, pre-filled. `full` is the Club Manager form, with
 * the tier. The remove-banner box appears only when there is one to remove.
 */
export function buildProfileModal(club: TrackedCircle, full: boolean, hasBanner: boolean): ModalBuilder {
    const labels: LabelBuilder[] = [];
    if (full) {
        labels.push(
            new LabelBuilder()
                .setLabel('Tier')
                .setDescription('Where the club sits in the directory.')
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder().setCustomId(FIELD.tier).addOptions(
                        ...TIER_ORDER.map((t) => ({ label: TIERS[t].title, value: t, description: `Estimated ranks: ${TIERS[t].ranks}`, default: club.tier === t })),
                        { label: 'Not listed', value: NO_TIER, description: 'Left out of the directory.', default: club.tier === null },
                    ),
                ),
        );
    }
    const bio = new TextInputBuilder().setCustomId(FIELD.bio).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(MAX_BIO);
    if (club.bio) bio.setValue(club.bio);
    const rules = new TextInputBuilder().setCustomId(FIELD.rules).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(MAX_RULES);
    if (club.rules) rules.setValue(club.rules);
    labels.push(
        new LabelBuilder().setLabel('Bio').setDescription('What the club is like. Markdown works; one line per point is fine.').setTextInputComponent(bio),
        new LabelBuilder().setLabel('Rules').setDescription('The rules as text, or a link to your rules post.').setTextInputComponent(rules),
        new LabelBuilder()
            .setLabel('Banner')
            .setDescription(hasBanner ? 'A new image replaces the current one. Leave empty to keep it.' : 'Optional image shown above the card.')
            .setFileUploadComponent(new FileUploadBuilder().setCustomId(FIELD.banner).setRequired(false).setMaxValues(1)),
    );
    if (hasBanner) {
        labels.push(new LabelBuilder().setLabel('Remove banner').setCheckboxComponent(new CheckboxBuilder().setCustomId(FIELD.removeBanner)));
    }
    return new ModalBuilder()
        .setCustomId(`${PROFILE_MODAL_PREFIX}${club.id}:${full ? 'full' : 'staff'}`)
        .setTitle(`${club.name} profile`.slice(0, 45))
        .addLabelComponents(...labels);
}

/** Downloads an uploaded banner. Separate so tests can stand in for Discord's CDN. */
export async function downloadBanner(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Discord returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

/** Handles the submitted profile form. */
export async function handleProfileModal(interaction: ModalSubmitInteraction) {
    const [clubId, kind] = interaction.customId.slice(PROFILE_MODAL_PREFIX.length).split(':');
    const refuse = (text: string) =>
        interaction.deferred
            ? interaction.editReply({ embeds: [errorEmbed(text)] })
            : interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

    const club = clubId ? await prisma.trackedCircle.findFirst({ where: { id: clubId, guildId: interaction.guildId ?? '' } }) : null;
    if (!club) return void (await refuse('That club no longer exists.'));

    const member = interaction.member as StaffCandidate;
    const full = kind === 'full';
    if (full ? !isOfficer(member) : !(await canManageClubStats(member, club))) {
        return void (await refuse(full ? "Only Club Managers can change a club's tier." : `You must be a trainer or assistant of **${club.name}** or a Club Manager to do that.`));
    }

    const upload = interaction.fields.getUploadedFiles(FIELD.banner, false)?.first();
    if (upload && !upload.contentType?.startsWith('image/')) return void (await refuse('The banner must be an image (PNG, JPEG, GIF or WebP).'));
    if (upload && upload.size > MAX_BANNER_BYTES) return void (await refuse('The banner must be 8 MB or smaller.'));

    // Downloading the banner and drawing the card can take longer than 3 seconds.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const text = (id: string) => interaction.fields.getTextInputValue(id).trim() || null;
    const data: { bio: string | null; rules: string | null; tier?: ClubTier | null } = { bio: text(FIELD.bio), rules: text(FIELD.rules) };
    if (full) {
        const tier = interaction.fields.getStringSelectValues(FIELD.tier)[0];
        if (tier === NO_TIER) data.tier = null;
        else if (tier && (TIER_ORDER as string[]).includes(tier)) data.tier = tier as ClubTier;
    }

    if (upload) {
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            bytes = await downloadBanner(upload.url);
        } catch (e) {
            return void (await refuse(`Could not read the banner: ${e instanceof Error ? e.message : String(e)}. Try uploading it again.`));
        }
        const banner = { data: bytes, fileName: upload.name, contentType: upload.contentType ?? 'image/png' };
        await prisma.clubBanner.upsert({ where: { clubId: club.id }, create: { clubId: club.id, ...banner }, update: banner });
    } else if (interaction.fields.fields.has(FIELD.removeBanner) && interaction.fields.getCheckbox(FIELD.removeBanner)) {
        await prisma.clubBanner.deleteMany({ where: { clubId: club.id } });
    }

    const updated = await prisma.trackedCircle.update({ where: { id: club.id }, data, include: { banner: true } });
    const guild = interaction.guild as unknown as DirectoryGuild | null;
    const staff = guild
        ? await clubStaff(updated, await guildClubs(updated.guildId), guild, await loadMembers(guild))
        : { trainers: [], assistants: [] };
    const card = clubCard(updated, staff, updated.banner);
    const listed = updated.tier ? `listed under **${TIERS[updated.tier].title}**` : 'not listed in the directory (a Club Manager sets its tier)';
    await interaction.editReply({ content: `Saved. **${updated.name}** is ${listed}. Its card:`, embeds: card.embeds, files: card.files });

    void refreshDirectory(guild);
}
