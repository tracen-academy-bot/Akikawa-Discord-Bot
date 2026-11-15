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

### 2. Mejiro McQueen (Tune; the owner's text)

```text
ごきげんよう, {user}-san. Welcome to the Mejiro Estate. I shall be your guide this afternoon, desu wa. The garden, the pond, the trophy room where the Tenno Sho shield shall one day hang... and the patisserie cart, which simply happens to lie on our route. *Ahem.* You know me, Trainer-san, one parfait is perfectly reasonable.
...Gold Ship? ...Why the h- why would she be in the hedge? I refuse to dignify it. Shall we?
```

- Kept: "desu wa", *ahem* (コホン), the sweets weakness, which pays off
  Grandmother's dessert-cart warning. "You know me" makes her self-aware
  about it.
- Added: ごきげんよう (gokigenyou, her greeting) in Japanese, the Tenno Sho
  shield ("toward the honour of the shield", her own line), and Gold Ship
  (her line about Gold Ship's Cossack dance, voice 91000). "Why the h-" is
  her composure slipping and catching itself, as her brief describes.
- Dropped: the secret baseball broadcast (three tics stacked read like a
  checklist).
- Edits to the owner's text: a comma after "You know me"; "I refuse to
  bother" became "I refuse to dignify it" (open: "I shan't even ask" or
  "I refuse to bother with her").

### 3. Mejiro Ryan (Rework; the owner's text)

```text
{user}-san, glad to see you here! *waves* Grandmother made me wear a dress tonight, for you, and... it's frilly. Very frilly... I told myself it's fine: shoulders back, chin up, it's basically posture training. Let's Muscle!
...It's not working. *sigh* Everyone keeps saying it looks nice, but they're just being polite, right? Kuu~... this is exactly the chapter where the heroine flees to the balcony...
...Oh, did I say that out loud? W-well, we do have a batting cage out back. Want to come with me? ...McQueen insists it's for guests.
```

- Was: no muscle at all (the fix for "too much muscle" overshot).
- Now: one "Let's Muscle!" (her catchphrase) as a cover for the dress
  insecurity, which stays the heart of the line; "Kuu~" is her flustered
  squeal at shoujo-manga moments (voice 10005). She catches herself saying
  the balcony line aloud and escapes to the batting cage.
- The batting cage: the owner recalls Ryan with baseball in a support
  card's art (not in the voice data, so not checked here). The closing
  "...McQueen insists it's for guests." is a nod to McQueen, who secretly
  loves watching baseball (voice 91004 and 91025), cut from her own line.
- Edits to the owner's text: "for you, and. It's frilly" became "for you,
  and... it's frilly"; "baseball machine" became "batting cage"; "Oh"
  capitalised, "W-well" added.

### 4. Mejiro Dober (Rework; the owner's text)

```text
{user}. ...You came. I'd rather you didn't wander off now. ...Look, I know the Mejiros have appearances to keep up, but having the Satonos over tonight is a bit much for me. Men in suits, and everyone looks so poised... I just feel small next to them.
You always say I'm enough, just the way I am. ...F-forget I said that. And what do you mean my ears are twitching? 別に... Just shut up and have this ginger tea that definitely wasn't premade.
"Bell-chan~?" Oh, my dad? ...I'll go pummel him real quick. And *you* too, if you ever *tattle*.
```

- Was: all defence, no reveal ("feels like it's just missing").
- Now: she was hoping the trainer would come; the guard drops (she feels
  she falls short of the poised family, her canon arc); "enough" answers
  it; "forget I said that" (忘れて, what she says after an earnest slip)
  and 別に (betsu ni, her tsundere denial, 10 uses), with twitching ears
  giving her away; ginger tea with a tsundere excuse (canon); "Bell-chan"
  from her father (voice 91000) as the closer, without a stage cue.
- Foreshadows the Satono Diamond guest visit ("men in suits": the Satono
  Group).
- Edits to the owner's text: "{u-user}-san" (the bot fills only `{user}`;
  Dober never says "-san") became "{user}. ...You came."; brackets filled
  as "have appearances to keep up" and "enough"; "meek" became "small";
  "teeter" became "tattle" (the owner meant telling anyone about it).

### 5. Mejiro Palmer (Tune; the owner's text)

```text
{user}! Okay, so I, Palmer-san, complimented Grandmother's gown last Christmas, and she made me dance. Tonight it's your turn, I already told her. Sorry not sorry~
Two rules: don't step on her feet, and do NOT bolt halfway through. Running away at full speed is Palmer-san's move, ssho~?
Oh, Helios? It's for a surprise, okay? Besties gotta protect 'em #SweetieSecrecies! Sounds just like her, eh?
```

- Same scene (canon: voice 91020), in her voice: "Palmer-san", "~ssho"
  (her casual "right?").
- Foreshadows the Helios guest visit (the after-party). The hashtag is
  Palmer imitating Helios and catching it, a joke about the set's
  no-hashtags rule rather than a break of it.
- Edits to the owner's text: "so she made me dance" became "and she made
  me dance"; "'eh?" became ", eh?". Open: #SweetieSecrecies as written, or
  #BestieSecrets.

### 6. Mejiro Ardan (Rework; the owner's text, with UKronis)

```text
Good evening, {user}-san. ...My my, you look tired. Business talk with the Satonos, I take it? No overdoing it, Trainer-san... めっ！ Fufu, Creek-san taught me that one.
I had the kitchen brew a pot of herbal tea. Oh yes, Baaya's recipe; she swears by it. I added a few notes of my own. And yes, before any dancing. ...You're fine, you say? Fufu. Hush, and drink. The moon is lovely tonight, isn't it?
Oh dear, your shoulders are up by your ears again. Nervous, are we? I've watched you practise; you are far better than you think, and "I can't dance" is not an answer I accept tonight. 参りましょう。
```

- Was: all about Ardan (her legs, her shine, her sister); "something
  quintessential Ardan missing".
- Now (from a discussion with UKronis): what sets her apart from McQueen
  is care. McQueen tends to you when you are sick; Ardan stops you getting
  sick. Gentle and polite, playful like a kind elder sister, and she puts
  her foot down ("Hush, and drink"; "not an answer I accept"). A partner,
  not a parent: she calls the trainer "my partner" once in canon, and her
  praise is "you and I", never "good child".
- "The moon is lovely tonight, isn't it?": the 月が綺麗ですね trope (an
  indirect "I love you"), kept in English so it stays a quiet reference.
  The scene is about the trainer (tired, nervous about dancing), not her
  legs; "before any dancing" carries the dance.
- Canon: Creek's めっ！ trick (voice 90004); herbal tea and medicinal
  cooking (her likes); her nanny ばあや (Baaya); dance; 参りましょう. The
  broth from an earlier draft was dropped (UKronis: too Sakura Chitose O).
- Ties: "the Satonos" (Dober and the guests).
- Edits to the owner's text: "I added some notes" became "I added a few
  notes of my own". The earlier "*Sit.* ...that's my good Trainer~ *pats*"
  was cut as too much like Super Creek (UKronis) in favour of the owner's
  "Hush, and drink. The moon is lovely tonight, isn't it?"

### 7. Mejiro Bright (Rework; the owner's text)

```text
...zzz... oh? Ah~ {user}-sama, good evening~ I dozed off while sewing, desu wa~ Look: a tiny suit for Maki-chan, just like yours~ Now she can come to the party with you too. Ufufu~
You came to fetch me for... the party? Oh, right. I'll be down in a moment~ But hold still first... Yes, the length is perfect~ Oh, what was I measuring? It gets rather cold here in winter, so I'm knitting you a scarf. Well, the beginnings of one anyway. It will be ready by winter... next winter, perhaps. Good things take their time, after all~
```

- Was: a checklist (sleepy, Ryan's dress, Maki-chan, sewing, a stated
  hidden fire, surprises). A draft where she waited at the door "since
  lunch" read as sad (pining); a draft where she was still choosing
  ribbons put her at the centre with the trainer as a helper.
- Now: a light scene about the trainer. She wakes mid-line (her own "I
  seem to have fallen asleep~"), has sewn her doll a suit matching the
  trainer's (sewing doll clothes, Maki-chan: canon), and is knitting the
  trainer a scarf, very slowly (knitting "very slowly" is in her likes).
  "Good things take their time" is her canon patience, turned warm.
- No romance beat on purpose: the set already has Ryan, Dober, Ardan and
  Ramonu for that.
- Edits to the owner's text: "you woke me up since... the party?" became
  "You came to fetch me for... the party?"; the second "just a moment"
  became "But hold still first..."; one "desu wa~" and one "Ufufu~"
  removed; "[prototype of one]" became "the beginnings of one"; "it gets
  pretty cold around here" became "it gets rather cold here in winter".
  The owner then cut the scarf stage cue (too long) for "Oh, what was I
  measuring?", which reads as Bright, half asleep, forgetting mid-task.

### 8. Mejiro Ramonu (Rework; the owner's text)

```text
Ah, {user}. Your arrival is appreciated. Offer me your arm. Mmm... you're warm.
...Still thinking about our training analysis? How... boorish of you. First the Symbolis, and now this. Eyes here, if you please. ...There we go. Good. Look all you want; I did *not* dress like this for no one, after all.
Ardan is dancing tonight, you see. Isn't her stubbornness lovely? You had better keep up too. The track can wait until tomorrow... tonight, it's just you and me.
```

Then **one outcome**, rolled each time this line comes up:

| Chance | Footer | Effect |
| --- | --- | --- |
| 75% | `-# Ramonu is still not quite satisfied with how distracted you were, and has insisted you join her next dance practice. She will summon you for a lesson sometime in the next 25 runs.` | The Rehearsal is scheduled on a run picked at random from the next 25 (owner, 2026-11-15: replaced the +10% boost); it comes up no other way, and a second lesson does not stack. |
| 25% | `-# Ramonu remains unimpressed... but your footwork convinced her your attention was where it belonged. For the next 50 runs, gain a 5% chance of meeting another Mejiro.` | +5% Mejiro lines for 50 runs. |

- Canon: boorishness (無粋) is her weak spot, with the trainer still working
  on a beautiful night as the example (voice 91023); she invites being
  looked at (91029); she demands an escort (91028). The trainer-bound beat
  is her catching them distracted.
- "The track can wait until tomorrow... tonight, it's just you and me":
  her first love is racing (40004), so this is the line's reveal.
- Ties: "First the Symbolis" sets up the Symboli guest visit; "Isn't her
  stubbornness lovely?" pays off Ardan (UKronis's read).
- Edits to the owner's text: the second `{user}` became "You had better
  keep up too"; "Hey. Eyes here please" became "Eyes here, if you
  please"; "dress to impress nobody" became "dress like this for no one";
  "The track can wait tomorrow" became "until tomorrow".

### 8b. Ramonu's Remedial Rehearsal (an extra; the owner's design)

Unlocked by meeting Ramonu (not by the photo, unlike the guests). Does not
count toward set completion; its own points like the guests (15 new, 3
repeat).

```text
Ah, {user}. Welcome back. We both know why you are here: your footwork has become... rather insufficient. Eyes on me, not on your feet. Now, shall we begin?
```

Then **50/50**:

| Outcome | Footer | Effect |
| --- | --- | --- |
| Win | `-# Your practice paid off. As a pair, your steps flow a little smoother now. For the next 25 runs, gain a 3% chance of meeting another Mejiro.` | +3% Mejiro lines for 25 runs. |
| Lose: tail | `-# You tried. Admittedly. You still stepped on her tail, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson.` | The next ping is the Rehearsal again (guaranteed). |
| Lose: dress | `-# You tried. Admittedly. You still caught the hem of her dress, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson.` | Same. |
| Lose: feet | `-# You tried. Admittedly. You still trod on her toes, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson.` | Same. |

- A loss picks one of the three mishaps (about 16.7% each), never one
  already used in the current losing streak. So three losses in a row are
  always the tail, the dress and the feet, once each.
- **After three losses in a row, the 4th lesson is a forced success:**

  ```text
  Finally, {user} succeeded in not failing. Ramonu couldn't help but crack a tiny smile, amused by how pleased you were with yourself... and, secretly, already missing your clumsiness.
  -# You obtained @Ramonu's Second Love.
  ```

  - The prize is the role **Ramonu's Second Love** (no Mejiro boost). If
    the trainer already has it: `-# Ramonu's Second Love, still.`
  - Optional, the owner's aside: a Ramonu-only reinvite on top (e.g. +3%
    chance of Ramonu's line for 25 runs). Not decided.
  - The name: racing is her first love (40004), so second is the highest a
    person can rank; earned by being clumsy three times in a row.
- The numbers: a trip reaches the role with $0.5^3 = 12.5\%$ (about one
  trip in eight); lessons per trip average $1 + 0.5 + 0.25 + 0.125 =
  1.875$, at most 4. A loss only costs the next ping (usually a reminder
  line).
- Build needs: the role created in Discord and given to the bot (a
  setting or its ID); the bot needs Manage Roles, with its own role above
  this one. New mechanics: a line that rolls one of several outcomes, a
  boost on one special, a guaranteed next ping, and a losing streak count.
- Edits to the owner's text: "[worriedness]" read as distraction; "[another
  meeting in the Estate]" as any Mejiro line; "sleep over" became "cleared
  your schedule: your next run ends in another lesson"; "your celebratory
  state" became "how pleased you were with yourself"; "obtain {role}"
  became "You obtained @Ramonu's Second Love".

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

### First wave: five visits (latest; ids for the build)

Each pays off a tease in the Mejiro lines. Multi-voice dialogue is allowed
for guests only.

1. **`guest.helios`, "Daitaku Helios"**: pays off Palmer's "It's for a
   surprise". Helios keeps her hashtags.

   ```text
   Weeei, Tore-pi! Surprise~! Pama-chin snuck my decks into the ballroom, and Grandmother said "one hour". Yoichomaru, that's basically forever! {user}, get on the floor, Palmer-san's already age-age! #MejiroAfterParty #ZuttomoDJ
   ```

2. **`guest.satono`, "Satono Diamond & Kitasan Black"**: pays off "the
   Satonos" in Dober's and Ardan's lines. Diamond has regular tea with
   McQueen (canon); Kitasan is her plus-one.

   ```text
   Diamond: "Good evening, {user}-san. McQueen-san invited the Satono house to dinner, and I may have brought a plus-one... fufu."
   Kitasan: "Wasshoi! Dia-chan, this place is HUGE! Can we have a festival in the east garden? Just a little one? Dodon!"
   Diamond: "Kita-chan, it's a dinner party. ...Fumu fumu. Then again, nobody has ever tried. A jinx worth breaking, perhaps? Trainer-san, would you hold the lanterns?"
   ```

3. **`guest.goldship`, "Gold Ship"**: pays off McQueen's hedge. The
   owner's text: a failed dropkick on McQueen, "I always miss her", a KFC
   bucket and a parfait for McQueen, then the next escapade (the
   chandelier, the trainer on rope duty). The dropkick is anime and fandom,
   not voice data.

   ```text
   Gorushi-chan, out of the hedge and into the ballroom! Target: McQueen! GORUSHI DROPKIIICK~!! ...She dodged?! Kkaa! {user}, you saw that, right? Missed her again. I always miss her... Not like THAT. Oi, I *said* don't look at me like that.
   Anyways. Here, hold this: a KFC bucket, family size. And yes, a parfait for McQueen... what? Don't ask where I got it. I'm so nice, you know?☆
   Now listen up: I may have failed this time, but next time, I'll come in through the chandelier with my water gun! ...What do you mean you don't want to get involved? You're on rope duty, end of story. Yes, you have to! Gorushi-sama has spoken~ じゃあね, gotta prepare my next escapade!
   ```

4. **`guest.symboli`, "Symboli Rudolf & Sirius Symboli"**: pays off
   Ramonu's "First the Symbolis". Ramonu once called lunch with Rudolf
   boring (voice 91002); Rudolf's puns; Sirius calls the trainer "puppy".

   ```text
   Rudolf: "Good evening, {user}-kun. Ramonu once called our lunches boring, so tonight I intend to prove otherwise. Our two houses at one table... rather Symboli-c, wouldn't you say?"
   Sirius: "...And that's why she calls them boring. Stay close, puppy. I came to watch the Emperor squirm."
   ```

5. **`guest.teio`, "Tokai Teio"**: comes as Rudolf's plus-one (she
   worships "Kaichou"), through Ramonu's Symboli dinner; there to see
   McQueen's face (her rival, six mentions in McQueen's lines).

   ```text
   Hey hey, {user}! Kaichou brought me along as her plus-one, so Teio-sama is officially Symboli-house company tonight. I promised to behave! ...Mostly. Did you see McQueen's face when I walked in? Priceless. Muteki! ...Wait. Is this floor good for a Teio Step?
   ```

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
