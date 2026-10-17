import {
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
 * bio, rules and banner, and can upload longer rules and goals as a Markdown
 * (.md) file. Club Managers also set its tier, which places it in
 * the directory (G1 to Debut); a club with no tier is left out. One of three
 * forms, with `/club reports` and `/club admin` (see `club.ts`).
 *
 * The submit replies with the card as the directory will show it, and
 * refreshes the directory.
 */

const PROFILE_MODAL_PREFIX = 'club:profile:';
const FIELD = {
    tier: 'club:profile:tier',
    bio: 'club:profile:bio',
    rules: 'club:profile:rules',
    files: 'club:profile:files',
    remove: 'club:profile:remove',
} as const;

/** Longest bio and rules. Both fit one card (4096 characters) with room for staff. */
export const MAX_BIO = 1500;
export const MAX_RULES = 1000;
/** Largest banner, in bytes. It is re-uploaded with every directory refresh. */
export const MAX_BANNER_BYTES = 8 * 1024 * 1024;
/** Largest rules file, in bytes. */
export const MAX_RULES_FILE_BYTES = 64 * 1024;
/** Values of the Remove select. */
const REMOVE_BANNER = 'banner';
const REMOVE_RULES_FILE = 'rules-file';
/** Tier select value for "not in the directory". */
const NO_TIER = 'NONE';

/** True for a modal this module owns. */
export function isProfileModal(customId: string): boolean {
    return customId.startsWith(PROFILE_MODAL_PREFIX);
}

/**
 * Builds the profile form, pre-filled. `full` is the Club Manager form, with
 * the tier. One upload field takes the banner and the rules file, and the
 * Remove list appears only when there is one of them to remove: Discord
 * allows five fields, and the Club Manager form uses all five.
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
        new LabelBuilder()
            .setLabel('Rules')
            .setDescription('The rules as text, or a link to your rules post. Longer? Upload a .md file below.')
            .setTextInputComponent(rules),
        new LabelBuilder()
            .setLabel('Banner and rules file')
            .setDescription('A banner image and/or a Markdown (.md) rules file. A new one replaces the current one.')
            .setFileUploadComponent(new FileUploadBuilder().setCustomId(FIELD.files).setRequired(false).setMaxValues(2)),
    );
    const removable = [
        ...(hasBanner ? [{ label: 'Banner', value: REMOVE_BANNER }] : []),
        ...(club.rulesFile ? [{ label: `Rules file (${club.rulesFileName ?? 'rules.md'})`.slice(0, 100), value: REMOVE_RULES_FILE }] : []),
    ];
    if (removable.length > 0) {
        labels.push(
            new LabelBuilder()
                .setLabel('Remove')
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder().setCustomId(FIELD.remove).setRequired(false).setMinValues(0).setMaxValues(removable.length).setPlaceholder('Nothing').addOptions(removable),
                ),
        );
    }
    return new ModalBuilder()
        .setCustomId(`${PROFILE_MODAL_PREFIX}${club.id}:${full ? 'full' : 'staff'}`)
        .setTitle(`${club.name} profile`.slice(0, 45))
        .addLabelComponents(...labels);
}

/** True for a Markdown file name. */
function isMarkdownName(name: string): boolean {
    return /\.(md|markdown)$/i.test(name);
}

/** Downloads an uploaded file. Separate so tests can stand in for Discord's CDN. */
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

    // The one upload field takes a banner image and a Markdown rules file.
    const uploads = [...(interaction.fields.getUploadedFiles(FIELD.files, false)?.values() ?? [])];
    const images = uploads.filter((f) => f.contentType?.startsWith('image/'));
    const markdown = uploads.filter((f) => !f.contentType?.startsWith('image/') && isMarkdownName(f.name));
    if (images.length + markdown.length < uploads.length) {
        return void (await refuse('Upload a banner image (PNG, JPEG, GIF or WebP) and/or a rules file in Markdown (.md). Other files are not accepted.'));
    }
    if (images.length > 1) return void (await refuse('Upload one banner image at most.'));
    if (markdown.length > 1) return void (await refuse('Upload one rules file at most.'));
    const upload = images[0];
    const rulesUpload = markdown[0];
    if (upload && upload.size > MAX_BANNER_BYTES) return void (await refuse('The banner must be 8 MB or smaller.'));
    if (rulesUpload && rulesUpload.size > MAX_RULES_FILE_BYTES) return void (await refuse('The rules file must be 64 KB or smaller.'));

    // Downloading files and drawing the card can take longer than 3 seconds.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const text = (id: string) => interaction.fields.getTextInputValue(id).trim() || null;
    const data: { bio: string | null; rules: string | null; tier?: ClubTier | null; rulesFile?: string | null; rulesFileName?: string | null } = {
        bio: text(FIELD.bio),
        rules: text(FIELD.rules),
    };
    if (full) {
        const tier = interaction.fields.getStringSelectValues(FIELD.tier)[0];
        if (tier === NO_TIER) data.tier = null;
        else if (tier && (TIER_ORDER as string[]).includes(tier)) data.tier = tier as ClubTier;
    }

    const removing = interaction.fields.fields.has(FIELD.remove) ? interaction.fields.getStringSelectValues(FIELD.remove) : [];
    if (rulesUpload) {
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            bytes = await downloadBanner(rulesUpload.url);
        } catch (e) {
            return void (await refuse(`Could not read the rules file: ${e instanceof Error ? e.message : String(e)}. Try uploading it again.`));
        }
        let markdownText: string;
        try {
            // Markdown is text: anything that is not valid UTF-8 is refused.
            markdownText = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim();
        } catch {
            return void (await refuse('The rules file is not text. Save it as a UTF-8 Markdown (.md) file and try again.'));
        }
        if (!markdownText) return void (await refuse('The rules file is empty.'));
        data.rulesFile = markdownText;
        data.rulesFileName = rulesUpload.name;
    } else if (removing.includes(REMOVE_RULES_FILE)) {
        data.rulesFile = null;
        data.rulesFileName = null;
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
    } else if (removing.includes(REMOVE_BANNER)) {
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
