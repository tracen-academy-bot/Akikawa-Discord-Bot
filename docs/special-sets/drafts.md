# Special-set drafts (not in code)

Working notes for the next releases. Nothing here is live; lines move into
`src/lib/timer/openers.ts` only when the owner asks. `{user}` is the
trainer's mention, placed where the name would be said (before any "you" it
introduces, or as "{user}'s").

## 1. The Mejiro Estate, next release

### The Family Photograph (rework)

Posts the art below, credited. Grandmother takes the photo herself.

```text
Everyone, gather round. No, {user}, I shall take this one myself. [owner's hidden middle] ...There. One for the album. Now then, {user}: how does it feel, knowing that every road these girls ever ran somehow led them to you?
They are all smiling at you, you know. I would say that settles it. Welcome to the Mejiro Family, {user}.
-# Art: <https://x.com/mokumoku_warabi/status/1783425000428757341>
```

- "Family" is capitalised only here: the formal welcome, echoing the Set 1
  line "Mejiro Family" that unlocked the set.
- Needs the image file (the owner's copy of the art).

### Grandmother's invitation (reward for her welcome)

Held from her welcome until the Family Photograph lands (trust). The
mechanism is never shown; the line only says:

```text
-# You hold Grandmother's invitation. Every Mejiro you meet makes the next one easier to find.
```

- Each Mejiro line met (new or repeat) adds to the chance of the next
  Mejiro line. Stronger first: +2%, +1.5%, +1%, +0.5% (total +5%).
- Gradual fade: every 2 pings without a Mejiro, it drains one step.
- Ends when the photo lands. Inside the soft caps.
- For scale: an unlocked trainer meets a Mejiro line at about
  $0.06 \times 9/35 \approx 1.5\%$ a ping; a full +5% makes that about 4x.

### Guests (reward for the photo)

```text
-# The estate is open to guests now. Who knows who might drop by?
```

- Guests are never in the normal pool. After the photo they get their own
  slice: +4%, carved from the common lines, counted toward the total (soft
  caps apply).
- The slice shrinks as the first wave of guests is found and closes at 0
  when all of them are; a later wave reopens it.
- Guests do **not** count toward set completion (the +100 and "found") but
  give their own points (15 new, 3 repeat).
- First wave: Daitaku Helios with Palmer (a DJ party; Helios keeps her
  hashtags), Satono Diamond (a business visit, Kitasan Black as plus-one).

## 2. A "box" for lines with media (Components V2)

discord.js here supports Components V2 (`ContainerBuilder`,
`TextDisplayBuilder`, `MediaGalleryBuilder`, `SeparatorBuilder`; `/help`
already uses them). A special with media would post as one container
instead of text plus a loose attachment:

1. Text: the line (with the mention).
2. Media gallery: the video or image, from the attachment.
3. Separator.
4. Small text: the footer(s) and the credit, exactly where we want them.
5. The bold extras (milestone, streak, Congrats) as a last text block.

Notes: a V2 message has no `content`, so the mention sits in a text block
(check once live that it still pings with `allowedMentions`); the DM copy
and the read view use the same builder. Only lines with media would use the
box; plain lines stay plain.

## 3. Lobby Loungers (Set 1) additions

The lobby is the home screen: girls idling, waiting, getting up to things.
Drafts from each girl's voice data (see `docs/uma-reference/briefs/`).

1. **Special Week**
   `{user}-san, you're back! The run's done, and I saved you half my onigiri... okay, a third. Okay, I ate it. Results first, then lunch? I'm namara hungry!`
2. **Silence Suzuka**
   `The run's done, {user}-san. ...I went around the track a few extra times while I waited. The view from the front was empty and lovely. Will you come see it with me?`
3. **Gold Ship**
   `Pinpon-panpon! Lost and found: one trainer, answers to {user}, last seen ignoring a finished run. Please collect them at the yakisoba stand. Gorushi-chan is not responsible for any missing ballpoint pens.`
4. **Oguri Cap**
   `Mm. The run's done, {user}. I waited. ...I also ate the cafeteria's lunch special. Three of them. Let's look at the results, and then the dinner special.`
5. **Haru Urara**
   `{user}! Urara ran the WHOLE time! Did Urara win? Did Urara win?! ...Ehehe, it doesn't matter, it was fun! Carrots now?`
6. **Seiun Sky**
   `Nyahaha, caught you, {user}. The run finished a while ago; Sei-chan's been napping on the lobby bench this whole time. Results? Go peek. I'll be... right here... zzz.`
7. **Agnes Digital**
   `{user}-san! The run's done! And just now in the lobby, Spe-chan shared her onigiri with Suzuka-san and I nearly ascended... ah, the results! Yes! Go! I'll be a wall!`
8. **Manhattan Cafe**
   `...{user}. The run is over. My Friend finished first, as usual. I made coffee while we waited; there's a cup for you. ...Please don't ask about the third one.`
9. **Nice Nature**
   `Oh, {user}, you're back. Run's done, results are in. Not bad, not great, very me. ...Kidding. Come look. The umekobu tea's ready.`
10. **Twin Turbo**
    `{user}! TURBO RAN ALL FIFTY MINUTES AT FULL THROTTLE!! ...and now Turbo can't feel her legs. Come check the results! And carry Turbo! Please!`
11. **Sakura Bakushin O**
    `Bakushiiin! {user}-san, the run is complete, and as class president I took attendance in the lobby! Everyone was here but you! ...Ah, now you're here! Perfect attendance!`
12. **Super Creek**
    `Ara ara, {user}-san, you're back~ The run's all done, so sit for a moment; you look tired. Here, a sweet, and a good-child, good-child pat~ Then the results, okay?`
13. **T.M. Opera O**
    `Ha-ha-ha-ha! Rejoice, {user}! Your run's final act has ended, and the lobby has become my stage! Come, the curtain call awaits, and the Haou's applause is yours!`
14. **Tamamo Cross**
    `Oi, {user}! Run's done! An' don't think I didn't see ya get lost on the way to the lobby. Nande yanen! C'mon, the results are waitin', and so's the White Lightning!`
15. **Matikanefukukitaru**
    `Mumu! Shiraoki-sama foretold your return, {user}-san! The run is done and the omikuji says Great Blessing! Hurry, before the luck leaves the lobby!`
16. **Daiwa Scarlet & Vodka** (a duo line)
    `{user}, back me up! Scarlet says her run was number one. "It WAS number one!" Yeah? Well, mine was cooler. "That's not a ranking, Vodka!" ...Trainer, the results are in. Go look before she turns it into a contest.`

Already in Set 1 (not repeated): Matikanetannhauser, Agnes Tachyon, Mihono
Bourbon, Rulership, Aston Machan, Taiki Shuttle, the Mejiro Family line,
Rice Shower, Symboli Rudolf, Air Groove, Tokai Teio, Curren Chan.

## 4. What could come next

| Idea | Cast (all in the JP data) | Why it works |
| --- | --- | --- |
| **The Satono Estate** | Satono Diamond, Satono Crown, Kitasan Black (Cheval Grand, Duramente) | The rival household to the Mejiro: jinxes, crane games, Kita-chan's festival energy; the PvP the owner wants. Mirror structure: a welcome, the family, a finale. |
| **Symboli House** | Symboli Rudolf, Sirius Symboli, Symboli Kris S (Speed Symboli as an NPC elder) | Ramonu's childhood rivals; "the Emperor" and her rebel. Cross-links with The Mejiro Estate (a Ramonu guest line). |
| **Golden Generation** | Special Week, Silence Suzuka, El Condor Pasa, Grass Wonder, Seiun Sky, King Halo | The 1998 class; a suggested set in the reference. Clashes with the Lobby drafts above, so pick one home for Spe/Suzuka/Sei. |
| **Opera O's Court** | T.M. Opera O, Meisho Doto, Admire Vega | Theatre all the way down; Doto's apologies against Opera O's applause. |
| **Dirt Crew / Tetra Mystics** | Smart Falcon, Copano Rickey, Hokko Tarumae, Wonder Acute, Transcend | Dirt and its idols; Falco already lives in #OnlineSensations. |
