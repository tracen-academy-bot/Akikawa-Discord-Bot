"""Shrink UmaViewer chibi screenshots into small scene pictures.

UmaViewer saves full-window screenshots (about 1920 x 1000, a few MB each),
mostly empty transparent space around a small character. The report scenes
draw a character at most about 140 px tall (280 px in the 2x image), so each
picture only needs to be the character, cropped tight and about 320 px tall,
in 256 colours: roughly 20 to 50 KB instead of several MB.

For every ``.png`` in the input folder this:

1. crops to the character, using the alpha channel (pixels with alpha above
   ``ALPHA_FLOOR`` count as the character, so faint edge noise is ignored),
   or, for a screenshot with no transparency, everything that differs from
   the background colour in its top-left corner (flagged in the output, as
   the background stays in the picture);
2. scales it so its height is at most ``--height`` pixels (never up);
3. reduces it to ``--colors`` colours (256 by default; anime-style art
   barely changes, and the file shrinks about three to four times);
4. saves it, optimised, under the same name in the output folder.

Usage (needs Pillow: ``pip install pillow``)::

    python scripts/shrink_chibis.py "C:/Users/you/Downloads/UmaViewer/.../Screenshots" shrunk
    python scripts/shrink_chibis.py screenshots shrunk-crowd --height 160

Use the default 320 for a scene's main character (``mambo-calm.png`` and so
on) and 160 for crowd chibis (``mambo-crowd/``). ``--colors 0`` keeps full
colour, if a picture ever shows banding.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops

#: Alpha at or below this is treated as empty when finding the character.
ALPHA_FLOOR = 8

#: How far a pixel may differ from an opaque background and still count as it.
BACKGROUND_TOLERANCE = 24

#: Default tallest height, in pixels, of a shrunk picture.
DEFAULT_HEIGHT = 320

#: Default number of colours to reduce to; 0 keeps full colour.
DEFAULT_COLORS = 256


def shrink(source: Path, target: Path, max_height: int, colors: int = DEFAULT_COLORS) -> tuple[int, int, bool] | None:
    """Crop one screenshot to its character, scale it down and save it.

    Args:
        source: The screenshot to read (a PNG with transparency).
        target: Where to write the shrunk picture.
        max_height: The tallest the result may be, in pixels.
        colors: How many colours to keep (at most 256); 0 keeps full colour.

    Returns:
        The saved picture's (width, height, opaque), where opaque is True when
        the screenshot had no transparency and was cropped by its background
        colour instead; or None when there is nothing visible to crop to.
    """
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    opaque = alpha.getextrema()[0] == 255
    if opaque:
        # No transparency: the character is whatever differs from the
        # background colour in the top-left corner.
        background = Image.new("RGB", rgba.size, rgba.getpixel((0, 0))[:3])
        difference = ImageChops.difference(rgba.convert("RGB"), background).convert("L")
        mask = difference.point(lambda d: 255 if d > BACKGROUND_TOLERANCE else 0)
    else:
        # The character's bounds: where alpha is clearly above zero.
        mask = alpha.point(lambda a: 255 if a > ALPHA_FLOOR else 0)
    box = mask.getbbox()
    if box is None:
        return None
    character = rgba.crop(box)
    if character.height > max_height:
        width = round(character.width * max_height / character.height)
        character = character.resize((width, max_height), Image.LANCZOS)
    if colors > 0:
        # Fast octree keeps the alpha channel when quantizing RGBA.
        character = character.quantize(colors=min(colors, 256), method=Image.Quantize.FASTOCTREE)
    character.save(target, optimize=True)
    return character.size[0], character.size[1], opaque


def main() -> int:
    """Shrink every PNG in the input folder into the output folder."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=Path, help="folder of UmaViewer screenshots")
    parser.add_argument("output", type=Path, help="folder to write the shrunk pictures to")
    parser.add_argument(
        "--height",
        type=int,
        default=DEFAULT_HEIGHT,
        help=f"tallest height in pixels (default {DEFAULT_HEIGHT}; 160 suits crowd chibis)",
    )
    parser.add_argument(
        "--colors",
        type=int,
        default=DEFAULT_COLORS,
        help=f"colours to keep, at most 256 (default {DEFAULT_COLORS}; 0 keeps full colour)",
    )
    args = parser.parse_args()

    if not args.input.is_dir():
        print(f"Not a folder: {args.input}", file=sys.stderr)
        return 1
    args.output.mkdir(parents=True, exist_ok=True)

    before = after = count = opaque_count = 0
    for source in sorted(args.input.glob("*.png")):
        target = args.output / source.name
        size = shrink(source, target, args.height, args.colors)
        if size is None:
            print(f"skipped {source.name}: nothing visible")
            continue
        before += source.stat().st_size
        after += target.stat().st_size
        count += 1
        opaque_count += size[2]
        note = "  (no transparency: background kept)" if size[2] else ""
        print(f"{source.name}: {size[0]} x {size[1]}, {target.stat().st_size / 1024:.0f} KB{note}")
    average = after / count / 1024 if count else 0
    print(f"\n{count} pictures: {before / 1_048_576:.1f} MB in, {after / 1_048_576:.1f} MB out, {average:.0f} KB each on average")
    if opaque_count:
        print(f"{opaque_count} had no transparency; export with a transparent background for clean cut-outs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
