import * as path from 'path';
import {
    AttachmentBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from 'discord.js';

/**
 * Every timer ping, its DM copy and the special read view post as one
 * Components V2 box, so they all look the same:
 *
 *   heading     the special's name (read view only)
 *   main text   the line itself, mention included
 *   subtext     its "-#" lines (e.g. a boost footer)
 *   media       the video or image, from the attachment (lines with media only)
 *   credit      small text right under the media (where it came from)
 *   extras      the ping's bold lines (Milestone, Congrats...), after a divider
 *
 * Parts that are empty are left out; a plain reminder is just its line.
 */

/** The box's accent, the timer's orange. */
const ACCENT = 0xf2a87a;

export interface PingBoxParts {
    /** The filled line, mention included; "-#" lines in it become the subtext. */
    text: string;
    /** Full path of the media file to attach, when the line has one. */
    mediaPath?: string | null | undefined;
    /** Shown under the media as small text, e.g. "Video: <https://...>". Needs `mediaPath`. */
    credit?: string | null | undefined;
    /** The ping's extra lines (Milestone, streak, Congrats), shown last. */
    extraLines?: readonly string[];
    /** Shown above everything, e.g. the special's name in the read view. */
    heading?: string;
}

/** Splits a line into its main text and its "-#" subtext lines. */
export function splitSubtext(text: string): { main: string; sub: string } {
    const lines = text.split('\n');
    return {
        main: lines.filter((l) => !l.startsWith('-# ')).join('\n').trim(),
        sub: lines.filter((l) => l.startsWith('-# ')).join('\n'),
    };
}

/**
 * The Components V2 message for a line: send it as is (add
 * `allowedMentions`, and `Ephemeral` to the flags when needed). `files`
 * holds the media attachment, or nothing for a line without media.
 */
export function pingBox(parts: PingBoxParts) {
    const { main, sub } = splitSubtext(parts.text);
    const box = new ContainerBuilder().setAccentColor(ACCENT);
    if (parts.heading) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${parts.heading}`));
    if (main) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(main));
    if (sub) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(sub));
    const files: AttachmentBuilder[] = [];
    if (parts.mediaPath) {
        files.push(new AttachmentBuilder(parts.mediaPath));
        const name = path.basename(parts.mediaPath);
        box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
        if (parts.credit) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${parts.credit}`));
    }
    if (parts.extraLines && parts.extraLines.length > 0) {
        box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        box.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.extraLines.join('\n')));
    }
    return { components: [box], files, flags: MessageFlags.IsComponentsV2 as const };
}
