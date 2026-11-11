# Review: The Mejiro Estate and the Fortune Tent

Written 2026-11-11 for the owner. Two parts per feature: the **lines**
(checked against the voice briefs in `docs/uma-reference/briefs/` and the
owner's earlier notes) and the **mechanics** (simulated). Nothing here
changes code; the Estate stays paused and the Tent stays a draft.

Sources: `docs/special-sets/mejiro-estate.md` (current Estate text, same as
in code), `docs/special-sets/fortune-tent.md` (Tent draft), the briefs, and
the owner's 2026-11-10 notes: "Dober is a bit wary of men, Ramonu... she's
an interesting species, McQueen should have the desu wa, over-reliance on
muscling on Ryan ... it's also public perception."

## Summary

1. **The Estate takes far too long to finish.** At base odds, the median
   trainer reaches the Family Photograph after about 1,750 pings: roughly
   3 months for a top trainer and 8 months for an average one. Almost a
   third of that is spent waiting for the photo alone, after all eight
   others are found.
2. **The cheapest fix:** once all eight are found, every Mejiro roll gives
   the photo (Grandmother's rule, mirrored). Simulated, that takes the
   median finale from about 1,750 to about 1,270 pings (474 fewer).
3. **The Estate lines are mostly sound** against the briefs. The weak
   spots: the sweets joke appears three times (Grandmother, McQueen, the
   photo); Ryan swung from too much muscle to none; Palmer has no gyaru
   voice; Bright has no ladylike endings and no hidden fire; Ramonu's
   opener is lifted almost word for word from her own voice line.
4. **The Tent's lines are in character**, with one canon liberty (the
   "not sisters" line) and one deliberate twist (tea stalks that do not
   sink). The risk is repetition: daily draws from 12 lines repeat often.
5. **The Tent unlocks late:** both Matikanes take a median of about 490
   pings (about a month for a top trainer, over two months for an average
   one). Its daily boost is small in expected value; the point is the
   swing, which the curses deliver.

## Part 1: The Mejiro Estate

### The lines, one by one

Verdicts: **Keep** (in character, no change needed), **Tune** (small
fix), **Rework** (misses something central).

| Line | Verdict | What works | What is off | Suggested direction |
| --- | --- | --- | --- | --- |
| Grandmother | Tune | Formal, warm, a strong opener; the "girls cannot stop writing home" hook sells the trainer's place. | The McQueen dessert-cart joke is the first of three sweets jokes in the set (see McQueen, the photo). | Swap the McQueen aside for a different granddaughter (e.g. Palmer's dance, which is canon, voice 91020), or for the Tenno Sho dream the family carries. |
| McQueen | Tune | "desu wa", sweets, *ahem* (コホン), the secret sports broadcast: all canon. | Three tics stacked in one line reads like a checklist. Missing her core: the family's Tenno Sho dream and "as a Mejiro Uma Musume" pride. Public perception: the Gold Ship chaos ("Cossack dance", her own sample line) is what the fandom knows her for. | Keep "desu wa" and one weakness; add the pride beat or a Gold Ship intrusion. Drop the sweets if Grandmother or the photo keep theirs. |
| Ryan | Rework | Dress insecurity and the shoujo-manga "heroine flees to the balcony" are canon (90006, 10005). | Over-corrected: the owner flagged too much muscle, and the line now has none. "Let's Muscle!" is what she is known for. | One muscle beat, played against the dress (e.g. the frills hide her shoulders, or she counts the dance as cardio), then the insecurity. Muscle as the cover, not the whole line. |
| Dober | Keep | Wary of men (the owner's note), "men in suits", the trainer as her exception (10001), "Bell-chan" (91000), the tsundere denial. | Nothing central. "Ears going flat" is a nice touch. | Optional: one "betsu ni" (it's not like...) to land the tsundere voice. |
| Palmer | Tune | The dance with Grandmother after praising her outfit is canon (91020); the runaway (bakunige) joke fits. | No gyaru register: no "~ssho", "age", "Palmer-san", "weei". It reads as generic casual. | Same scene, in her voice: refers to herself as Palmer-san, a "~ssho?" and some hype. |
| Ardan | Keep | Glass legs, the infirmary, "now", shining, the fleeting moment, "Sister": all her core tics. | None. | Optional: open with her "mairimashou" (shall we go). |
| Bright | Tune | Sleepy and slow, "Ryan-oneesama", the doll Maki-chan (canon, her profile), sewing doll clothes. | No "desu wa~" (her most common ending) and no hidden fire ("a voice in my heart says win"), which is what makes her more than sleepy. | Add the elongated "~desu wa~" and one line of quiet competitiveness. |
| Ramonu | Tune | Racing as her first love is exactly her (40004); the escort demand fits (91028); aloof, languid. | The opener ("You'll do. Escort me. Surely you didn't think...") is her own voice line almost word for word. The owner's "interesting species" also points at her amused, possessive watch over Ardan and Ryan, which the line skips. | Paraphrase the escort beat instead of quoting it, and give her one amused remark about Ardan (her own line: "Ardan is lovely, isn't she?"). |
| The Family Photograph | (superseded) | Every member gets a beat. | The in-code text is the old roll-call. The planned rework (Grandmother takes the photo, the mokumoku_warabi art, "Welcome to the Mejiro Family") is in `drafts.md` and not yet in code. | Replace with the reworked text when the art file is ready. |

Cross-set issue: **the sweets joke appears three times** (Grandmother,
McQueen, the photo's "McQueen, the cake can wait"). One is a callback;
three is the joke carrying the set. Keep it in one place.

### The mechanics

**Pings until each milestone** (Monte Carlo, 3,000 trainers, base odds
only: 6% special plus the 1% #OnlineSensations unlock bonus; no other
boosts; the Estate treated as unpaused). The simulation script was a
one-off and is not in the repo.

| Milestone | Median pings | 90th percentile |
| --- | --- | --- |
| Set 1 "Mejiro Family" (unlocks the Estate) | 188 | 813 |
| Grandmother | 238 | 867 |
| All seven members | 1,216 | 2,118 |
| Family Photograph (finale) | 1,750 | 2,925 |

**In days**, using the live board of Wed Nov 11 08:42 JST (about 2.4
days into the week): the top trainer had 44 runs (about 18 a day); the
average was 529 runs over 32 trainers (about 7 a day). These rates are an
estimate from one partial week.

| Milestone | Top trainer (about 18/day) | Average trainer (about 7/day) |
| --- | --- | --- |
| Grandmother | about 13 days | about 34 days |
| All seven | about 68 days | about 174 days |
| Family Photograph | about 97 days | about 250 days |

Why it is slow: once open, the Estate is 9 of 35 specials, so a Mejiro
line comes up on about $0.06 \times 9/35 \approx 1.5\%$ of pings. Finishing
needs about 25 Mejiro rolls:

- Grandmother: 1 roll (every Mejiro roll gives her first).
- The seven: with $k$ members still unmet, a Mejiro roll gives a new one
  with probability $(k+1)/9$ (the closed photo slot also redirects to an
  unmet member). Expected rolls:
  $\sum_{k=1}^{7} 9/(k+1) = 9(H_8 - 1) \approx 15.5$, where $H_8$ is the
  8th harmonic number.
- The photo: one slot in nine, so about 9 more rolls on average, about
  530 pings, with nothing new to find in the meantime.

**Recommendations**, cheapest first:

1. **Photo redirect:** once all eight are found, every Mejiro roll gives
   the photo (the same rule as Grandmother). The photo phase drops from
   about 9 Mejiro rolls to 1. Simulated: median finale 1,746 to 1,272
   pings; 90th percentile 2,959 to 2,221.
2. **Grandmother's invitation** (already drafted in `drafts.md`): each
   Mejiro met raises the chance of the next. It targets the seven-member
   phase, which is the longest.
3. If both are still too slow, a small Estate unlock bonus (like
   #OnlineSensations' 1%) would roughly double the Mejiro rate.

## Part 2: The Fortune Tent (draft)

### The lines

| Line | Verdict | Notes |
| --- | --- | --- |
| Fuku's find line | Keep | "mumu", Shiraoki-sama, crystal ball, "namu, namu"; teases the tent without showing a lock. |
| Introduction | Tune | Built on canon (morning fortunes 91004, the charm 91016, "the one special luck" 10001, answering cheers 91020). **"Not sisters, just roommates"** asserts a fact the game never states: the data shows no family link, and "roommates" rests on the wiki, not the game. Low risk, but it is the one line that invents canon. Softer: "No relation, as far as anyone knows!" |
| Oracle (Sky) | Keep | Maneki-neko joke (91019) and nyaa-san (70015) are both canon; Sky's "Sei-chan" and "nyahaha" are her voice. Long, but it is a 1-in-100 event. |
| 超吉 (Rickey) | Keep | "Rikkii Rakkii", "daikisshou", lucky direction, "feng shui is statistics": all from her brief. |
| 大吉 tea stalks | Keep | Deliberately inverts canon (in 91010 the stalks sink). That is the joke; worth knowing it is a twist. |
| 大吉 Taiki | Keep | Fortune cookies with Fuku (her brief), "Howdy", "Yippee-ki-yay", stretched "dēsu". |
| 吉 Rice | Keep | Plays her bad-luck belief kindly: she draws a blessing too. |
| 吉 blue and potato salad | Keep | Machitan's colour and food. |
| 吉 Suzuka | Keep | Fuku prays for her (1117); "the view from the front", "fufu". |
| 小吉 Machitan | Keep | Her "ordinary" self-image. |
| 小吉 Nature | Keep | "My usual 3rd place! Just kidding" is near-verbatim from her sample line. Fine as a quote, but like Ramonu's opener it borrows her words directly. |
| 凶 cloudy ball | Keep | |
| 凶 Doto | Keep | Tangled charm strings (91018), constant apologies, "someone like me". |
| 大凶 black cat | Keep | Great curse plus black cat (20010), the Charm Army. |

**Repetition:** a daily draw over a month (30 draws) shows each 吉 line
about 2.5 times and each 大吉 line about 2.3 times. Options: the same
no-repeat rule as the reminder lines (no repeat within the last few
draws), or more lines for the common tiers later.

### The mechanics

**Unlock time** (same simulation, Fukukitaru added to Set 1, which grows to
14 lines): median 490 pings, 90th percentile 1,490. That is about 27 days
for a top trainer and about 70 days for an average one. Adding Fuku also
makes every other Set 1 line slightly rarer (one more line to share the
draw), and pushes the Estate finale from 1,750 to about 1,810 pings.

**Value of a draw:** the expected change is $+0.445$ percentage points on
special chance for the day. For a trainer at 7 pings a day, that is about
$7 \times 0.00445 \approx 0.03$ extra specials a day: negligible on
average. The feature is about the swing, not the average:

- 5% of draws (Oracle or 超吉) are big days: +5% or +3%.
- 30% of draws hurt: -1% or -2% on a 6% base is a 17% or 33% cut for the
  day.
- Drawing is optional, so a curse is a risk the trainer chose. The
  expected value stays positive, so drawing is still the better bet.

**Edge cases to settle before building:**

- **Curses and Boosts off:** the draft says curses do not pause. Since
  drawing is opt-in, that is fair; the result text should say so on the
  first curse.
- **Curses and Tylina's +3%:** they stack normally (her +3% is a boost; a
  curse lowers the base). No conflict.
- **Daily reset:** midnight JST, the same as streaks. A trainer who draws
  at 23:59 gets one minute of effect. Either accept it, or make a draw
  last 24 hours from the draw. Simpler to accept and say "until the daily
  reset" (as the draft does).

## Suggested order of work

1. Estate: photo redirect (small code change, big effect).
2. Estate: line fixes (Ryan rework; McQueen, Palmer, Bright, Ramonu tuning;
   one sweets joke), then unpause.
3. Estate: the Family Photograph rework once the art file is ready.
4. Tent: settle the intro wording and repetition rule, then build.
5. Estate: Grandmother's invitation and guests, later.

## Caveats

- The simulation uses base odds only. Collab boosts, Early Start and
  personal boosts make every milestone somewhat faster; the order of
  magnitude stands.
- Runs per day come from one partial week of the live board; a slower
  week makes every "days" figure longer.
- "Public perception" points (McQueen and Gold Ship, Ryan's "Let's
  Muscle!") come from the briefs' sample lines and general fandom
  knowledge, not from a survey.
