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
 * A special line with media, laid out as one Components V2 box:
 *
 *   heading     the special's name (read view only)
 *   main text   the line itself
 *   subtext     its "-#" lines (e.g. a boost footer)
 *   media       the video or image, from the attachment
 *   credit      small text right under the media (where it came from)
 *   extras      the ping's bold lines (Milestone, Congrats...), after a divider
 *
 * Plain lines (no media) are not sent this way; they stay plain text.
 */

/** The box's accent, the timer's orange. */
const ACCENT = 0xf2a87a;

export interface MediaMessageParts {
    /** The filled line, mention included; "-#" lines in it become the subtext. */
    text: string;
    /** Full path of the media file to attach. */
    mediaPath: string;
    /** Shown under the media as small text, e.g. "Video: <https://...>". */
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

/** The Components V2 message for a line with media: send it as is (add `allowedMentions`, and `Ephemeral` to the flags when needed). */
export function mediaMessage(parts: MediaMessageParts) {
    const file = new AttachmentBuilder(parts.mediaPath);
    const name = path.basename(parts.mediaPath);
    const { main, sub } = splitSubtext(parts.text);
    const box = new ContainerBuilder().setAccentColor(ACCENT);
    if (parts.heading) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${parts.heading}`));
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent(main));
    if (sub) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(sub));
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
    if (parts.credit) box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${parts.credit}`));
    if (parts.extraLines && parts.extraLines.length > 0) {
        box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        box.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.extraLines.join('\n')));
    }
    return { components: [box], files: [file], flags: MessageFlags.IsComponentsV2 as const };
}
