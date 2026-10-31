# Scene pictures

Optional pictures for the illustrated report scenes in
`src/lib/image/scenes.ts`. A file named after a scene, such as `oguri.png`,
stands on the right of that scene's sky band, scaled to the band's height
(about 175px). A transparent PNG works best.

None are shipped. A picture of a character belongs to its artist (or to
Cygames, for official art), so only add one you have permission to use.
Without a picture, the scene is complete as drawn.

`food/` holds the Oguri scene's food, cut from UmaViewer screenshots
(burger, rice mountain, and the ramen and hamburg-steak trays). If any of them is missing,
the scene draws its own food instead.

`oguri-run.png` is the same character posed running. The race track uses
it, and does not tilt it further; without it, the race leans `oguri.png`
forward.

`stillinlove-calm.png`, `stillinlove-uneasy.png` and `stillinlove-yandere.png`
are Still in Love's chibi, smiling, worried and teeth gritted, from UmaViewer
(supplied by Fwoxie). The scene picks one by her mood and stands it on the
lace over the club's place. Without them it draws her eyes instead.

`mambo-crowd/` holds small chibis of other Umamusume (any `.png`; each day's
report draws a different shuffle of up to 28 of them) for the Mambo scene: a team on each end of the tug-of-war
rope, leaning back to pull; a few cheering in front of her tent; and the
rest watching from the back of the field in turn with trainers drawn in
suits. Transparent pictures standing upright work best; they are scaled
to about 40px tall. Empty or missing, the trainers watch alone.

UmaViewer screenshots are full-window and mostly empty (a few MB each).
`scripts/shrink_chibis.py` crops each to its character, scales it down and
reduces it to 256 colours (about 20 KB at the default 320px; use
`--height 160` for crowd chibis, about 8 KB):

    pip install pillow
    python scripts/shrink_chibis.py <screenshots folder> <output folder>

Mambo, Nice Nature and Dream Journey take their own pictures the same way
as Still in Love: `mambo-calm.png`, `mambo-uneasy.png`, `mambo-yandere.png`
(and `nature-*`, `journey-*`), or one `mambo.png` for every mood.

The 163 in `mambo-crowd/` are UmaViewer screenshots of the game's chibis
(Cygames' art), supplied by Fwoxie on 2026-10-31: 266 shrunk to 160px and
256 colours with `shrink_chibis.py`, then near-duplicates (the same pose
taken twice) removed, keeping the first of each.
