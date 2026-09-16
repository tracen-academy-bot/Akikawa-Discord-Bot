/**
 * Font stack for every rendered image.
 *
 * `@napi-rs/canvas` resolves a bare `sans-serif` to the first matching system
 * family and does **not** fall back to another family for glyphs that family
 * lacks. On a stock Linux image that resolves to Liberation Sans, which has no
 * CJK coverage, so a Japanese trainer name renders as a row of tofu boxes.
 * Umamusume names are frequently Japanese, so that is a correctness problem,
 * not a cosmetic one.
 *
 * Listing families explicitly makes the fallback work. DejaVu Sans comes first
 * because its Latin is proportional and reads well; WenQuanYi Zen Hei supplies
 * CJK. IPAGothic is deliberately *not* first — it covers CJK but renders Latin
 * at fixed width, which looks wrong for mixed-script tables.
 *
 * The Dockerfile installs both families. See `docs/fonts.md`.
 */
export const FONT_STACK = '"DejaVu Sans", "WenQuanYi Zen Hei", "Noto Sans CJK JP", sans-serif';

/**
 * Builds a canvas font string with the shared fallback stack.
 *
 * @param spec Size and weight, e.g. `'bold 17px'`.
 */
export function font(spec: string): string {
    return `${spec} ${FONT_STACK}`;
}
