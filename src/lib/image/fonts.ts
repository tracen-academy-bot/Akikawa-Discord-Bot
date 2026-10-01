import { GlobalFonts } from '@napi-rs/canvas';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Fonts for every rendered image.
 *
 * The families are bundled in `assets/fonts` and registered here at import,
 * so output looks identical on every machine and container. Relying on
 * whatever `apt` installs produced a different look per host and, on a bare
 * Debian image, tofu boxes for every Japanese trainer name --
 * `@napi-rs/canvas` resolves one family and does not fall back per glyph.
 *
 * IBM Plex Sans JP is the primary face: it carries Latin, digits and CJK in
 * one family, so a mixed-script row reads as one typeface. Its digits are
 * tabular (every figure 0-9 has the same advance), which matters because the
 * canvas API offers no way to enable a font's `tnum` feature and proportional
 * digits would make every numeric column wobble. IBM Plex Mono stays
 * registered for the rare place that wants a code-like face (IDs).
 *
 * Both are SIL Open Font License 1.1; the licence texts sit beside the files.
 * See `docs/fonts.md`.
 */

/** Directory holding the bundled `.ttf` files, resolved for both src/ and dist/. */
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

/**
 * Primary stack. The trailing system families are a safety net only: if
 * registration failed they keep CJK legible rather than rendering as boxes.
 */
export const FONT_STACK = '"IBM Plex Sans JP", "IBM Plex Mono", "DejaVu Sans", "WenQuanYi Zen Hei", sans-serif';

/** Monospace stack, for identifiers and anything that should read as code. */
export const MONO_STACK = '"IBM Plex Mono", "IBM Plex Sans JP", "DejaVu Sans Mono", monospace';

/** Registers every bundled font once. Idempotent; safe to import repeatedly. */
function registerBundledFonts(): void {
    if (!fs.existsSync(FONT_DIR)) {
        console.warn(`Font directory missing at ${FONT_DIR}; falling back to system fonts.`);
        return;
    }

    const files = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
    let registered = 0;

    for (const file of files) {
        try {
            if (GlobalFonts.registerFromPath(path.join(FONT_DIR, file))) registered += 1;
        } catch (e) {
            console.warn(`Could not register font ${file}:`, e instanceof Error ? e.message : e);
        }
    }

    if (registered === 0) {
        console.warn('No bundled fonts registered; rendered images will use system fonts.');
    }
}

registerBundledFonts();

/**
 * Builds a canvas font string with the shared stack.
 *
 * @param spec Weight and size, e.g. `'bold 17px'` or `'500 14px'`.
 */
export function font(spec: string): string {
    return `${spec} ${FONT_STACK}`;
}

/** Like `font`, with the monospace stack. */
export function monoFont(spec: string): string {
    return `${spec} ${MONO_STACK}`;
}
