# Fonts in rendered images

## Bundled, not installed

The renderers use fonts shipped in `src/assets/fonts` and registered at
startup by `src/lib/image/fonts.ts`. Output is therefore identical on every
machine and container. Previously the look depended on whatever `apt` had
installed, which differed per host and, on a bare Debian image, rendered every
Japanese trainer name as tofu boxes.

| Family | Role | Weights | Licence |
| --- | --- | --- | --- |
| IBM Plex Mono | Latin, digits | 400, 500, 700 | SIL OFL 1.1 |
| IBM Plex Sans JP | CJK | 400, 700 | SIL OFL 1.1 |

Licence texts sit beside the files. Total ~5 MB.

## Why these

`@napi-rs/canvas` resolves one family per draw call and does **not** fall back
per glyph, so the stack must be explicit and the CJK family must actually be
present. Plex Mono and Plex Sans JP are one superfamily: a row mixing
`Lucrezia` and `ハルウララ` reads as a single typeface.

Plex Mono's digits are tabular by nature. That matters because the canvas API
has no way to enable a font's `tnum` feature, so a proportional-digit face
(Inter, for example) would make every numeric column wobble.

## Usage

Never write a font string by hand. Go through the helpers in
`src/lib/image/theme.ts`:

```ts
drawText(ctx, 'Freakrose', x, y, { spec: '500 19px', color: THEME.text });
drawLabel(ctx, 'Total', x, y, THEME.muted);          // uppercase, tracked
```

or, at the lowest level, `font('500 19px')` from `fonts.ts`, which appends the
shared stack.

## Fallback

`FONT_STACK` ends with `"DejaVu Sans Mono", "WenQuanYi Zen Hei", monospace`,
and the Dockerfile still installs those packages. This is a safety net only:
if bundled registration ever fails, CJK stays legible rather than becoming
boxes. A warning is logged at startup when that happens.

## Swapping

Drop `.ttf`/`.otf` files into `src/assets/fonts`, update `FONT_STACK` with the
family names the files declare, restart. Check what canvas sees with:

```bash
node -e "console.log(require('@napi-rs/canvas').GlobalFonts.families.map(f=>f.family))"
```
