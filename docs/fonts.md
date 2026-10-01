# Fonts in rendered images

## Bundled, not installed

The renderers use fonts shipped in `src/assets/fonts` and registered at
startup by `src/lib/image/fonts.ts`. Output is therefore identical on every
machine and container. Previously the look depended on whatever `apt` had
installed, which differed per host and, on a bare Debian image, rendered every
Japanese trainer name as tofu boxes.

| Family | Role | Weights | Licence |
| --- | --- | --- | --- |
| IBM Plex Sans JP | Everything: Latin, digits, CJK | 400, 700 | SIL OFL 1.1 |
| IBM Plex Mono | Identifiers only (`mono: true`) | 400, 500, 700 | SIL OFL 1.1 |

Licence texts sit beside the files. Total ~5 MB.

## Why these

`@napi-rs/canvas` resolves one family per draw call and does **not** fall back
per glyph, so the stack must be explicit and the CJK family must actually be
present. Plex Sans JP covers Latin and CJK in one family, so a row mixing
`Lucrezia` and `ハルウララ` reads as a single typeface.

Its digits are tabular: every figure 0-9 measures 12.60px at 20px in both
weights (checked with `measureText`). That matters because the canvas API has
no way to enable a font's `tnum` feature, so a proportional-digit face would
make every numeric column wobble. Until 2026-10 the images used Plex Mono for
this reason; Plex Sans JP gives the same alignment and reads far better.

Plex Sans JP ships **400 and 700 only**. Other weights in a spec snap to one of
those, so the renderers use only those two.

## Usage

Never write a font string by hand. Go through the helpers in
`src/lib/image/theme.ts`:

```ts
drawText(ctx, 'Freakrose', x, y, { spec: '700 18px', color: THEME.text });
drawText(ctx, '424242', x, y, { spec: '400 13px', color: THEME.faint, mono: true });
drawLabel(ctx, 'Total', x, y, THEME.muted);          // uppercase, tracked
```

or, at the lowest level, `font('700 18px')` / `monoFont(...)` from `fonts.ts`,
which append the shared stacks.

## Fallback

`FONT_STACK` ends with `"DejaVu Sans", "WenQuanYi Zen Hei", sans-serif`,
and the Dockerfile still installs those packages. This is a safety net only:
if bundled registration ever fails, CJK stays legible rather than becoming
boxes. A warning is logged at startup when that happens.

## Swapping

Drop `.ttf`/`.otf` files into `src/assets/fonts`, update `FONT_STACK` with the
family names the files declare, restart. Check what canvas sees with:

```bash
node -e "console.log(require('@napi-rs/canvas').GlobalFonts.families.map(f=>f.family))"
```
