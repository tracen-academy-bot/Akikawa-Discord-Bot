# Draft: Fuku-chan's Fortune Tent

Status: **draft for the owner's review, not in code.** Idea from a member
(Machitan Mun); tiers, curses and the Oracle tier from the owner.
`{user}` is the trainer's mention, once per line, placed before any "you" it
introduces.

## The idea

Matikanefukukitaru reads Matikanetannhauser's fortune every morning. Once a
trainer has found both of them, the two open a fortune tent in the lobby:
one omikuji a day, and the draw raises (or, on a curse, lowers) the
trainer's chance of a special line until the daily reset.

### Canon it rests on

From `docs/uma-reference/briefs/1056.json` (Fukukitaru) and `1062.json`
(Tannhauser) unless noted.

| Detail | Source |
| --- | --- |
| Fuku reads Machitan's fortune every morning | Machitan, voice 91004 |
| Machitan carries a lucky charm from Fuku | Machitan, voice 91016 |
| They share a room | umamusu.wiki, cited in Machitan's brief |
| No family link between the two Matikanes | `groups.json` ("no in-game kinship evidenced") |
| Only two Matikanes exist | the JP master data has 173 named characters, NPCs included; these are the only two |
| Machitan: "ordinary at everything, but meeting you was the one special luck" | Machitan, voice 10001 |
| Machitan wants to answer her fans' cheers properly | Machitan, voice 91020 |
| Fuku: Shiraoki-sama, omikuji, crystal ball, 大吉 and her invented 超吉, "namu, namu", "mumu" | Fuku's brief, speech and likes |
| Shiraoki-sama's messenger is a cat, "nyaa-san" | Fuku, voice 70015 |
| Fuku suspects Seiun Sky is a maneki-neko in disguise | Fuku, voice 91019 |
| Three tea stalks stood up in her cup | Fuku, voice 91010 (in canon they then sank) |
| Great curse plus a black cat crossing her path | Fuku, voice 20010 |
| The "Charm Army" (お守り軍団さん) she calls on | Fuku's brief, speech tics |
| Fuku prays for Silence Suzuka | Fuku, voice 1117 |
| Fuku and Taiki Shuttle bake fortune cookies | Fuku's brief, relationships |
| Meisho Doto tangled in Fuku's charm strings | Fuku, voice 91018 |
| Rice Shower believes she brings bad luck ("when Rice comes, the signal turns red") | Rice's brief, sample lines |
| Copano Rickey: "Rikkii Rakkii", "daikisshou", lucky directions, "feng shui is statistics" | Rickey's brief |
| Nice Nature: "my usual 3rd place! Just kidding" | Nature's brief, sample lines |
| Machitan: blue is her colour, potato salad her food | Machitan's brief, likes |

## How a trainer gets it

1. **Find Matikanetannhauser** (Lobby Loungers, already live as
   `set1.matikane`). No change.
2. **Find Matikanefukukitaru**, a new Lobby Loungers special. It hints at the
   tent without showing a lock:

   ```text
   Mumu...! {user}-san, Shiraoki-sama's oracle was right, you came! The run is done, and my crystal ball says the results are lucky. ...It also says something about a tent, and Machitan. I'm sure it's nothing! Namu, namu!
   ```

3. **The ping that completes the pair** (whichever Matikane comes second)
   adds the unlock line, like a set unlock:

   ```text
   **Congrats!** Fuku-chan's Fortune Tent unlocked!
   ```

4. **The introduction** shows on the trainer's first press of **Fortune**,
   before their first draw:

   ```text
   Machitan: "Babaan! {user}, welcome to the Matikane Fortune Tent! Every morning, Fuku-chan senpai reads my fortune before breakfast... and this morning it said a very special visitor was coming. Uhihi, and here you are!"
   Fuku: "Mumu! Shiraoki-sama's oracles are never wrong! Machitan carries my charm, I carry the crystal ball, and together we are... the Matikanes! ...Not sisters, by the way. Just roommates."
   Machitan: "Totally ordinary roommates! But I'm ordinary at everything, and meeting you was the one lucky thing that's special. So I want to share the luck back. Ei, ei, mun!"
   Fuku: "One omikuji a day, Trainer-san. Great blessing or great curse, Shiraoki-sama decides! Namu, namu!"
   -# Fuku-chan's Fortune Tent is open: draw one omikuji a day from **Boosts**. Blessings raise your special chance for the day; curses lower it.
   ```

## The draw

- **Where:** a **Fortune** button in the Boosts view, once the tent is
  unlocked. One draw per day; the day resets at midnight JST, like streaks.
  After drawing, the button reads "Drawn today" and is greyed out.
- **What it shows:** only to the trainer, as a box like the pings: a heading
  with the result, the scene, and a small line with the effect.
- **How long it lasts:** until the daily reset.
- **Boosts view:** lists it like the other boosts, e.g. "**+2%** Fortune:
  Great blessing, until the daily reset" or "**-1%** Fortune: Curse, until
  the daily reset".

### Tiers

| Draw | Special chance for the day | Chance of drawing it | Lines |
| --- | --- | --- | --- |
| Shiraoki-sama's Oracle | +5% | 1% | 1 |
| 超吉 Super blessing | +3% | 4% | 1 |
| 大吉 Great blessing | +2% | 15% | 2 |
| 吉 Blessing | +1% | 25% | 3 |
| 小吉 Small blessing | +0.5% | 25% | 2 |
| 凶 Curse | -1% | 20% | 2 |
| 大凶 Great curse | -2% | 10% | 1 |

- Within a tier, each line is equally likely.
- Average draw:
  $0.01(5) + 0.04(3) + 0.15(2) + 0.25(1) + 0.25(0.5) - 0.20(1) - 0.10(2) = 0.445$
  percentage points. Worth drawing on average; 30% of draws hurt.
- **Blessings** are a boost like the others: they add their slice, count
  toward the soft caps (raw over 20% at half, over 30% at a quarter, 30% at
  most), and pause while Boosts is off.
- **Curses** lower the 6% base for the day (to 5% or 4%). They do not pause
  with Boosts off, so turning Boosts off cannot dodge one. Other boosts
  still add on top as usual.

## The lines

Each result's box: a heading, the scene, then its effect line.

| Tier | Heading | Effect line |
| --- | --- | --- |
| Oracle | `### Shiraoki-sama's Oracle` | `-# Shiraoki-sama's Oracle: +5% chance of a special line until the daily reset.` |
| 超吉 | `### 超吉 Super blessing` | `-# Today's fortune: +3% chance of a special line until the daily reset.` |
| 大吉 | `### 大吉 Great blessing` | `-# Today's fortune: +2% chance of a special line until the daily reset.` |
| 吉 | `### 吉 Blessing` | `-# Today's fortune: +1% chance of a special line until the daily reset.` |
| 小吉 | `### 小吉 Small blessing` | `-# Today's fortune: +0.5% chance of a special line until the daily reset.` |
| 凶 | `### 凶 Curse` | `-# Today's fortune: -1% chance of a special line until the daily reset.` |
| 大凶 | `### 大凶 Great curse` | `-# Today's fortune: -2% chance of a special line until the daily reset.` |

### Shiraoki-sama's Oracle (+5%)

1. Seiun Sky

   ```text
   Fuku: "N-nyaa-san...?! {user}-san, don't move! Sky-san dozed off on the table, every cat in Tracen followed her in, and now Shiraoki-sama's own messenger is sitting on the crystal ball! This isn't a fortune, it's an ORACLE! Namu, namu, namu!"
   Sky: "Nyahaha... Sei-chan's just napping. Don't mind me~"
   Machitan: "B-babaaan?! That's good, right?! Ei, ei, MUN!"
   ```

### 超吉 Super blessing (+3%)

2. Copano Rickey

   ```text
   Rickey: "Rikkii Rakkii! I turned the whole tent to face today's lucky direction. Go on, draw!"
   Fuku: "Th-this is beyond great blessing... a SUPER blessing! {user}-san, for today you're invincible!"
   Rickey: "Daikisshou! See? Feng shui is basically statistics!"
   ```

### 大吉 Great blessing (+2%)

3. Tea stalks

   ```text
   Fuku: "Daikichi! {user}-san, three tea stalks stood up in my cup this morning, and not one of them sank! Grab that good fortune before it runs off!"
   Machitan: "Uhihi, that beats mine! I got a small blessing. Very ordinary!"
   ```

4. Taiki Shuttle

   ```text
   Taiki: "Howdy! Fuku and I baked fortune cookies, and this one is for {user}! Crack it open!"
   Fuku: "Mumu! Great blessing! Taiki-san, your cookies have spiritual power!"
   Taiki: "Yippee-ki-yay! Fortune party dēsu!"
   ```

### 吉 Blessing (+1%)

5. Rice Shower

   ```text
   Fuku: "A blessing! {user}-san, a good, honest blessing... and look, Rice-san drew one too!"
   Rice: "R-Rice did? Not a curse? ...Rice really did. Ganbaru zo, oh!"
   Machitan: "Uhihi, a good day for everyone! Mun!"
   ```

6. Blue and potato salad

   ```text
   Fuku: "A blessing! {user}-san, today's lucky colour is blue, and the lucky item is... potato salad?"
   Machitan: "Blue Machitan and potato salad?! Fuku-chan senpai, that's just my lunch! Babaan!"
   ```

7. Silence Suzuka

   ```text
   Fuku: "A blessing! {user}-san, I prayed for Suzuka-san this morning, and some of it must have spilled over onto you!"
   Suzuka: "Fufu... thank you, Fukukitaru. Then I'll run a little extra today. The view from the front should be nice..."
   ```

### 小吉 Small blessing (+0.5%)

8. Machitan

   ```text
   Fuku: "A small blessing! {user}-san, it's small, but a blessing is a blessing! The crystal ball says: take it slow, and don't skip lunch."
   Machitan: "Very ordinary. I love it! Ei, ei, mun!"
   ```

9. Nice Nature

   ```text
   Fuku: "Small blessing! {user}-san, that's not bad at all!"
   Nature: "Not great, not bad... very me. My usual third place! ...Just kidding."
   ```

### 凶 Curse (-1%)

10. Cloudy crystal ball

    ```text
    Fuku: "A curse... {user}-san, I'm so sorry, the crystal ball went all cloudy... namu, namu..."
    Machitan: "Don't cry, Fuku-chan senpai! We'll draw again tomorrow! Ei, ei, mun!"
    ```

11. Meisho Doto

    ```text
    Doto: "Hiee... I only wanted to help hang the charms, and now they're all tangled, and {user}-san drew a curse... someone like me shouldn't touch lucky things... sumimaseeen!"
    Fuku: "Doto-san, the charms aren't cursed, the ribbon is just knotted! ...Mostly."
    ```

### 大凶 Great curse (-2%)

12. Black cat

    ```text
    Fuku: "D-daikyou... a GREAT curse... and a black cat just walked right past the tent... {user}-san, it's hopeless~!"
    Machitan: "Hiii! Fuku-chan senpai, quick, call the Charm Army!"
    ```

Spare, not counted above: a second 大凶 with Air Groove, who got a
Shigaraki tanuki from Fuku (Fuku, voice 91004) and could hand it back "just
in case", with a "mattaku" about the cat.

## Notes for the build

- **Fukukitaru's line** is a Lobby Loungers special (`set1.fukukitaru`), a
  normal find with its 15 points. The tent itself is not a set: no page, no
  completion, no points for draws.
- **Unlock check:** both `set1.matikane` and `set1.fukukitaru` found.
- **Storage:** one row per trainer per day (guild, user, day, tier, line), so
  a redeploy cannot give a second draw, and the Boosts view can show today's
  result.
- **Odds code:** a blessing is one more extra slice from the trainer's usual
  special pool; a curse lowers the base slice for that day. Both go in the
  odds tests.
- **The Curren-style hint stays:** nothing ever says the tent is locked.

## Open questions

1. Lines: any to cut, swap or reword?
2. Should the Oracle also post a short public line in the channel (e.g.
   "@user drew Shiraoki-sama's Oracle!"), given it is a 1-in-100 event?
   Default: no, private like the rest.
3. Air Groove's spare 大凶: in or out?
