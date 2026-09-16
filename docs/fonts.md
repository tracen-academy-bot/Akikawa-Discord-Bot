# Fonts in rendered images

## The problem

`@napi-rs/canvas` resolves a font family and stops. Unlike a browser, it does
**not** fall back to another family for individual glyphs the chosen family
lacks.

A bare `sans-serif` resolves to whichever sans family fontconfig ranks first —
on a stock Debian image, Liberation Sans. Liberation Sans has no CJK coverage,
so a Japanese trainer name renders as a row of `□` tofu boxes. Umamusume
trainer names are frequently Japanese, so this is a correctness bug, not a
cosmetic one.

Observed directly: with `sans-serif`, `『 』`, `ハルウララ` and `東海帝王` all
rendered as tofu.

## The fix

`src/lib/image/fonts.ts` defines one stack, used by every renderer through the
`font()` helper:

```
"DejaVu Sans", "WenQuanYi Zen Hei", "Noto Sans CJK JP", sans-serif
```

Order matters:

| Family | Role | Why not first |
| --- | --- | --- |
| DejaVu Sans | Latin | — |
| WenQuanYi Zen Hei | CJK fallback | Latin coverage is weaker |
| Noto Sans CJK JP | CJK, if installed | Not in the base image |

**IPAGothic is deliberately excluded from the front of the stack.** It covers
CJK correctly, but renders Latin at fixed width, so mixed-script tables come out
looking like a terminal dump. Verified by rendering the same sample with
IPAGothic leading: CJK was fine, `Fwoxieee` came out monospaced.

## Usage

```ts
import { font } from './fonts';

ctx.font = font('bold 17px');      // not 'bold 17px sans-serif'
```

## Container requirements

The Dockerfile installs `fonts-dejavu-core` and `fonts-wqy-zenhei` and runs
`fc-cache -f`. Removing either brings the tofu back.

To confirm the container can see them:

```bash
docker compose run --rm bot node -e \
  "console.log(require('@napi-rs/canvas').GlobalFonts.families.map(f=>f.family).join('\n'))"
```

`WenQuanYi Zen Hei` and `DejaVu Sans` must both appear.
