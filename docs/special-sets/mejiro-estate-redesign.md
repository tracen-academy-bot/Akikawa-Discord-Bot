# Draft: The Mejiro Estate, redesigned (lines and guests)

Status: **draft for the owner's review, not in code.** The Estate is paused
in code until this is settled. `{user}` is the trainer's mention, once per
line, placed before any "you" it introduces. No hashtags, except Helios.

Built on: the review of 2026-11-11 (held back from master; in commit
12c23f5), the owner's notes ("Dober is a bit wary of men, Ramonu... she's
an interesting species, McQueen should have the desu wa, over-reliance on
muscling on Ryan ... it's also public perception"), and the voice briefs
in `docs/uma-reference/briefs/`.

## Part 1: The nine lines

Each entry: the new text, then what changed and why. "Was" refers to the
text in code now (`docs/special-sets/mejiro-estate.md`).

### 1. Grandmother (Tune; the owner's text)

```text
Ah, so you are {user}, the trainer the girls cannot stop writing home about. Do come in; you are very welcome here.
You see, this family has chased one dream for a very long time, and I am told you have been helping the girls carry it. They are all rather fond of you.
Tea is at three in the east garden, and I should be glad of your company. Do mind the pond, dear, and do keep McQueen away from the dessert cart until after dinner; I am told she has a plan. Not that she is being terribly discreet about it, hoho.
```

- Someone has already found her (finds are kept by id, so a reword keeps
  it), so every beat of the original stays: the girls writing home, tea in
  the east garden at three, the pond, McQueen's dessert plan.
- Was curt: "Ah. So you are...", then only instructions. Now she welcomes
  the trainer personally, adds the family's long dream and "they are all
  rather fond of you", and turns the tea into an invitation.
- The owner's last sentence read "Not that she is any discreet about it";
  changed to "being terribly discreet" for grammar.
- The dessert joke stays as a running gag: Grandmother sets it up, and
  McQueen's own line ("the patisserie cart, which simply happens to lie on
  our route") pays it off. The photo's sweets line is gone.

### 2. Mejiro McQueen (Tune)

```text
Gokigenyou, {user}-san. Welcome to the Mejiro Estate. I shall be your guide this afternoon, desu wa. The garden, the pond, the trophy room where the Tenno Sho shield shall one day hang... and the patisserie cart, which simply happens to lie on our route. *Ahem.* One parfait is perfectly reasonable. ...Why is Gold Ship in the hedge? No. I refuse to ask. Shall we?
```

- Kept: "desu wa", *ahem* (コホン), the sweets weakness, which pays off
  Grandmother's dessert-cart warning.
- Added: "gokigenyou" (her greeting), the Tenno Sho shield ("toward the
  honour of the shield", her own line), and Gold Ship, whom the fandom
  knows as her chaos (her line about Gold Ship's Cossack dance, voice
  91000).
- Dropped: the secret baseball broadcast (three tics stacked read like a
  checklist).

### 3. Mejiro Ryan (Rework)

```text
{user}-san! Grandmother made me wear a dress tonight. It's frilly. Very frilly. I told myself it's fine: shoulders back, chin up, it's basically posture training. Let's Muscle! ...It's not working. Everyone keeps saying it looks nice, but they're just being polite, right? Kuu~... this is exactly the chapter where the heroine flees to the balcony. I'm not fleeing. I'm just... getting some air.
```

- Was: no muscle at all (the fix for "too much muscle" overshot).
- Now: one "Let's Muscle!" (her catchphrase), used as a cover for the
  dress insecurity, which stays the heart of the line. "Kuu~" is her
  flustered squeal at shoujo-manga moments (voice 10005).

### 4. Mejiro Dober (Keep, one touch)

```text
{user}, don't wander off. ...Too many people tonight, and half of them are men in suits. I-it's not like I need you here. You're just the only one I can stand next to without my ears going flat. And if Dad calls me 'Bell-chan', you heard nothing.
```

- Only change: the tsundere "it's not like..." (her "betsu ni", in
  English) in place of "Not that I need you here".

### 5. Mejiro Palmer (Tune)

```text
{user}! Okay, so Palmer-san complimented Grandmother's gown last Christmas, and she made me dance. Tonight it's your turn, I already told her. Sorry not sorry~ Two rules: don't step on her feet, and do NOT bolt halfway through. Running away at full speed is Palmer-san's move, ssho~?
```

- Same scene (canon: voice 91020), now in her voice: she calls herself
  "Palmer-san", and "~ssho" is her casual "right?".

### 6. Mejiro Ardan (Keep, one touch)

```text
Shall we dance, {user}-san? Only a waltz; the doctor was very clear about my legs. ...Please don't look so worried. The garden is lit for this one evening, and I intend to shine for every second of it. Sister is watching, you know. Let us give her something worth looking at. Mairimashou.
```

- Only change: ends on "mairimashou" (shall we go), her usual line.

### 7. Mejiro Bright (Tune)

```text
Ah~ {user}-sama, good evening~ ...Or is it morning? I napped in the sunroom and lost track, desu wa~ Ryan-oneesama's dress looks lovely, doesn't it~? I sewed one just like it for Maki-chan~ ...Ufufu. Everyone thinks I am only sleepy. But at the next race, I intend to win~ Please don't tell either of them; both are surprises~
```

- Added: her elongated "desu wa~", "ufufu", and the hidden fire ("a voice
  in my heart says win", her own line) that makes her more than sleepy.
- Kept: Maki-chan (her doll, canon), sewing, "Ryan-oneesama".

### 8. Mejiro Ramonu (Tune)

```text
{user}. Good; you'll do. Offer me your arm. ...A Mejiro does not walk into her own family's gathering alone, least of all dressed like this. Look, if you like. Ardan is dancing tonight; isn't she lovely? Do try to keep up with her. And do remember: you are my second love. The first is waiting for me on the turf.
```

- Was: her escort voice line almost word for word.
- Now: the escort demand paraphrased; added her amused, possessive pride
  in Ardan ("Ardan is lovely, isn't she?", her own line), which ties into
  Ardan's dance.

### 9. The Family Photograph (from the planned rework)

```text
Everyone, gather round. No, {user}, I shall take this one myself. [owner's hidden middle] ...There. One for the album. Now then, {user}: how does it feel, knowing that every road these girls ever ran somehow led them to you?
They are all smiling at you, you know. I would say that settles it. Welcome to the Mejiro Family, {user}.
-# Art: <https://x.com/mokumoku_warabi/status/1783425000428757341>
```

- Unchanged from `drafts.md`, and it still needs the owner's hidden middle
  and the image file.
- The only line that uses `{user}` more than once, by the owner's design
  (it is the finale).
- The old roll-call ("McQueen, the cake can wait...") goes, taking the
  third sweets joke with it.

## Part 2: Staging and pacing

Unchanged: Grandmother first (every Mejiro roll gives her until found),
then the seven in any order, then the photo.

**Proposed, from the review:** once all eight are found, every Mejiro roll
gives the photo (Grandmother's rule, mirrored). Simulated at base odds, the
median finale drops from about 1,750 to about 1,270 pings, and the slowest
10% from about 2,960 to about 2,220.

Grandmother's invitation (each Mejiro met raises the chance of the next,
until the photo) stays in `drafts.md` for a later release.

## Part 3: The guests (extras)

### Rules (the owner's, 2026-11-10)

- Guests appear only after the Family Photograph.
- They have their **own slice**: +4% on every ping, carved from the
  common lines, counted toward the total special chance (soft caps
  apply).
- The slice **shrinks** as guests are found and **closes at 0** when all
  of them are; a later wave reopens it.
- Guests do **not** count toward set completion (no +100, not in "found").
  They give their own points: 15 for a new one, 3 for a repeat.
- They are never in the normal pool before the photo; a roll on one
  redirects like the other closed lines.

### First wave: five visits

Each visit is rooted in a tie from the voice data.

1. **Daitaku Helios (with Palmer): the after-party**
   Tie: Palmer's best friend ("zuttomo"), 11 home scenes together; the
   owner's idea. Helios calls the trainer "Tore-pi", lives for "fests", and
   keeps her hashtags.

   ```text
   Weeei! Tore-pi, the Mejiro Estate is officially a FEST now! Pama-chin let me plug my decks into the ballroom and Grandmother said "one hour". Yoichomaru, that's basically forever! {user}, get on the floor, Palmer-san's already age-age! #MejiroAfterParty #ZuttomoDJ
   ```

2. **Satono Diamond (with Kitasan Black): tea with McQueen**
   Tie: Diamond holds regular tea parties with McQueen, her senior and
   inspiration (her brief); Kitasan is her childhood best friend and
   roommate. Diamond's "jinx" and "fumu fumu"; Kita's "wasshoi", "dodon".

   ```text
   Diamond: "Good afternoon, {user}-san. McQueen-san invited me for our usual tea, and I may have brought a plus-one... fufu."
   Kitasan: "Wasshoi! Dia-chan, this place is HUGE! Can we have a festival in the east garden? Just a little one? Dodon!"
   Diamond: "Kita-chan, it's a tea party. ...Fumu fumu. Then again, nobody has ever tried. A jinx worth breaking, perhaps?"
   ```

3. **Gold Ship: the uninvited guest**
   Tie: McQueen's favourite prank target (voice 91000 and more); she once
   gave Bright a pile of sweet potatoes (Bright, voice 91014). Calls
   herself "Gorushi-chan".

   ```text
   Gorushi-chan has entered the estate! Don't ask how; the hedge maze has a back door if you're brave enough. {user}, hold this: a sweet potato for Bright and a cardboard trophy for McQueen. When she screams, that means she likes it.
   ```

4. **Symboli Rudolf and Sirius Symboli: the rival house**
   Tie: Ramonu's childhood friends and rivals; her story has events titled
   "The Mejiro family and the Symboli family" and "the Emperor's
   decision", and she once called lunch with Rudolf boring (voice 91002).
   Rudolf calls the trainer "Trainer-kun" and loves puns; Sirius calls the
   trainer "puppy".

   ```text
   Rudolf: "Good evening, {user}-kun. Ramonu has invited the Symboli house to dinner. She once called our lunches boring, so tonight I intend to prove otherwise... with a pun or two, if the moment allows."
   Sirius: "The moment won't allow. Ramonu invited us to watch the Emperor squirm, and I wouldn't miss it. Stay close, puppy. This will be fun."
   ```

5. **Tokai Teio: McQueen's rival**
   Tie: McQueen's same-year rival and friend (six mentions in McQueen's
   lines); Teio worships Rudolf ("Kaichou"), so the Symboli visit pulls
   her in. "Teio-sama", "muteki", the Teio Step.

   ```text
   Hey hey, {user}! McQueen said I could come if I behaved, so Teio-sama is officially the most behaved guest ever. Muteki! ...Wait. Ramonu invited the Symboli house too? Is Kaichou here?! Quick, does this floor work for a Teio Step?
   ```

Cross-links on purpose: Gold Ship is the one in McQueen's hedge; Teio
hears about the Symboli dinner; Helios is Palmer's plus-one at the party
Palmer mentions in her own line.

### Second-wave candidates (data ties only, no lines yet)

| Guest | Tie |
| --- | --- |
| Sakura Chiyono O (and Yaeno Muteki) | Ardan's roommate; Ardan wakes her every morning and they dance (voice 91009); the 1988 trio. Chiyono O's "Sakura is Sakura, Mejiro is Mejiro" (voice 91020). |
| Taiki Shuttle | Dober's roommate: "Taiki gets lonely if I'm not there when she wakes" (Dober, voice 91009). |
| Tsurumaru Tsuyoshi | Bright's roommate, who wakes her and curls her hair. |
| Ines Fujin | Ryan's friend: picks Ryan's training wear; Ryan picks her shoes. |
| Ikuno Dictus | McQueen's health-management confidante; Palmer's punctilious friend. |

## Open questions

1. Lines: any to change? Ryan's is the only full rework.
2. The photo redirect: in, with the redesign?
3. Guests: these five for the first wave, or a different mix? Satono
   Diamond's visit keeps Kitasan as a plus-one; guests do not need to be
   Mejiro.
4. Guest multi-voice lines (Diamond, Symboli): the set's other lines are
   single-voice. Keep the dialogue format for guests only?
