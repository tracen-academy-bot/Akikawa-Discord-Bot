"""Shrink UmaViewer chibi screenshots into small scene pictures.

UmaViewer saves full-window screenshots (about 1920 x 1000, a few MB each),
mostly empty transparent space around a small character. The report scenes
draw a character at most about 140 px tall (280 px in the 2x image), so each
picture only needs to be the character, cropped tight and about 440 px tall:
roughly 50 to 150 KB instead of several MB.

For every ``.png`` in the input folder this:

1. crops to the character, using the alpha channel (pixels with alpha above
   ``ALPHA_FLOOR`` count as the character, so faint edge noise is ignored);
2. scales it so its height is at most ``--height`` pixels (never up);
3. saves it, optimised, under the same name in the output folder.

Usage (needs Pillow: ``pip install pillow``)::

    python scripts/shrink_chibis.py "C:/Users/you/Downloads/UmaViewer/.../Screenshots" shrunk
    python scripts/shrink_chibis.py screenshots shrunk --height 220

Use the default 440 for a scene's main character (``mambo-calm.png`` and so
on) and 220 is plenty for crowd chibis (``mambo-crowd/``).
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

#: Alpha at or below this is treated as empty when finding the character.
ALPHA_FLOOR = 8

#: Default tallest height, in pixels, of a shrunk picture.
DEFAULT_HEIGHT = 440


def shrink(source: Path, target: Path, max_height: int) -> tuple[int, int] | None:
    """Crop one screenshot to its character, scale it down and save it.

    Args:
        source: The screenshot to read (a PNG with transparency).
        target: Where to write the shrunk picture.
        max_height: The tallest the result may be, in pixels.

    Returns:
        The saved picture's (width, height), or None when the screenshot has
        no visible pixels to crop to.
    """
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
    # The character's bounds: where alpha is clearly above zero.
    mask = rgba.getchannel("A").point(lambda a: 255 if a > ALPHA_FLOOR else 0)
    box = mask.getbbox()
    if box is None:
        return None
    character = rgba.crop(box)
    if character.height > max_height:
        width = round(character.width * max_height / character.height)
        character = character.resize((width, max_height), Image.LANCZOS)
    character.save(target, optimize=True)
    return character.size


def main() -> int:
    """Shrink every PNG in the input folder into the output folder."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=Path, help="folder of UmaViewer screenshots")
    parser.add_argument("output", type=Path, help="folder to write the shrunk pictures to")
    parser.add_argument(
        "--height",
        type=int,
        default=DEFAULT_HEIGHT,
        help=f"tallest height in pixels (default {DEFAULT_HEIGHT}; 220 suits crowd chibis)",
    )
    args = parser.parse_args()

    if not args.input.is_dir():
        print(f"Not a folder: {args.input}", file=sys.stderr)
        return 1
    args.output.mkdir(parents=True, exist_ok=True)

    before = after = 0
    for source in sorted(args.input.glob("*.png")):
        target = args.output / source.name
        size = shrink(source, target, args.height)
        if size is None:
            print(f"skipped {source.name}: nothing visible")
            continue
        before += source.stat().st_size
        after += target.stat().st_size
        print(f"{source.name}: {size[0]} x {size[1]}, {target.stat().st_size / 1024:.0f} KB")
    print(f"\n{before / 1_048_576:.1f} MB in, {after / 1_048_576:.1f} MB out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
