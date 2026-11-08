# Uma reference

English voice briefs for every named character in the JP game data, made to
help staff write timer special sets (`src/lib/timer/openers.ts`).

Viewer: the "Tracen Roster Dossier" artifact (private to the owner; share it
from its Share menu). `index.html` here is its source.

## What is here

| Path | What |
| --- | --- |
| `briefs/<id>.json` | One brief per character (173): personality, speech (first person, how she addresses the trainer, tics with counts), likes, weak spots, relationships with evidence, groups, story arc with source, 4-6 sample lines (JP verbatim + EN), 2 draft timer specials, data gaps. |
| `groups.json` | 59 groups (families, units, teams, strongest home-scene pairs and trios) and 6 suggested next sets. |
| `index.html` | The viewer page. It loads `uma-data.json`, which `build_site_data.py` makes. |
| `../../scripts/uma-reference/` | `extract_umas.py` (mdb to per-character JSON), `build_site_data.py` (merge for the viewer), `validate_briefs.py` (mechanical checks). |

The raw extraction (all 33,631 voice lines) and `master.mdb` are not in git.
Rebuild them from a fresh mdb:

```bash
python3 -I scripts/uma-reference/extract_umas.py /path/to/master.mdb /tmp/uma
```

## Sources and how far to trust them

- **From `master.mdb` (exact):** names, profile fields, voice lines,
  card aptitudes, training event *titles*, home-screen scene casts
  (`home_story_trigger`), name mentions in voice lines, affinity groups.
- **Not in `master.mdb`:** event dialogue. It lives in asset bundles. Story
  arcs come from the event titles plus umamusu.wiki and similar sites; each
  says which in `story_arc.source`.
- **Relationships:** evidence such as "home scenes x7" or a voice_id is game
  data. Evidence marked "web" or "unverified" is outside knowledge.
- Nickname mentions (カイチョー, ユニさん, チケゾー) are not counted by
  the extractor; only full names and short names followed by an honorific
  or punctuation are.

## How the briefs were made

One agent per batch of 5 characters wrote the briefs from the extraction.
A second agent per batch tried to refute every claim against the source and
fixed the files (455 corrections in total, e.g. mistranslations, tics that
only occur in the profile, relationships built on substring matches). Then
`validate_briefs.py` checked every sample line against the source word for
word and every timer draft for exactly one `{user}`. Remaining deliberate
exceptions: ☆ and ♪ in drafts for characters who use them.

Timer drafts are starting points in the Set 1 style. Staff wording wins.
