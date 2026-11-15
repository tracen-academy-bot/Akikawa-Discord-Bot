# Special set: The Mejiro Estate

Status: in code (`src/lib/timer/openers.ts`, set id `mejiro-estate`). This file is the source text; keep the two in step.

**Paused (owner, 2026-11-10): no new finds** until the lines are redesigned (`paused: true` on the set). Its lines never roll, no boost draws on it, and finding "Mejiro Family" no longer announces it. Its Specials page and the finds already made (Grandmother, once) stay. Remove the flag to resume.

- **Premise:** the trainer is invited to a gathering at the Mejiro Estate; each line is one scene.
- **Style:** fancy, no hashtags (a guest like Helios may keep hers; Palmer's one #SweetieSecrecies is her imitating Helios).
- **Unlock:** the Set 1 line "Mejiro Family" (`set1.mejiro`).
- **Stages** (`Special.after`, never shown on the Specials page, which just says "???"):
  1. Grandmother's welcome comes first: any roll on a Mejiro line she has not unlocked yet gives her line instead (`redirectOpener`), so she takes the whole set's share (9x) until found.
  2. The seven Mejiro open after it, in any order.
  3. The Family Photograph opens after all eight; until then a roll on it gives an unmet family member.
  4. Guests (to come) open after the photograph; until then a roll on one redirects the same way.

## Lines

1. Grandmother

   ```text
   Ah, so you are {user}, the trainer the girls cannot stop writing home about. Do come in; you are very welcome here.
   You see, this family has chased one dream for a very long time, and I am told you have been helping the girls carry it. They are all rather fond of you.
   Tea is at three in the east garden, and I should be glad of your company. Do mind the pond, dear, and do keep McQueen away from the dessert cart until after dinner; I am told she has a plan. Not that she is being terribly discreet about it, hoho.
   ```

   Hook: Head of the family, McQueen's おばあ様 (McQueen 10026, 70004, 91221; Palmer 91020); the family's long dream; sets up McQueen's dessert-cart gag. Every Mejiro roll redirects to her until she is found; she opens the rest.

2. Mejiro McQueen

   ```text
   ごきげんよう, {user}-san. Welcome to the Mejiro Estate. I shall be your guide this afternoon, desu wa. The garden, the pond, the trophy room where the Tenno Sho shield shall one day hang... and the patisserie cart, which simply happens to lie on our route. *Ahem.* You know me, Trainer-san, one parfait is perfectly reasonable.
   ...Gold Ship? ...Why the h- why would she be in the hedge? I refuse to dignify it. Shall we?
   ```

   Hook: ごきげんよう and ~desu wa; sweets weakness, paying off Grandmother's warning; the Tenno Sho shield; Gold Ship (91000); *ahem* (コホン), composure slipping ("Why the h-").

3. Mejiro Ryan

   ```text
   {user}-san, glad to see you here! *waves* Grandmother made me wear a dress tonight, for you, and... it's frilly. Very frilly... I told myself it's fine: shoulders back, chin up, it's basically posture training. Let's Muscle!
   ...It's not working. *sigh* Everyone keeps saying it looks nice, but they're just being polite, right? Kuu~... this is exactly the chapter where the heroine flees to the balcony...
   ...Oh, did I say that out loud? W-well, we do have a batting cage out back. Want to come with me? ...McQueen insists it's for guests.
   ```

   Hook: Feels plain beside her cousins; flustered by cute clothes (90006) and shoujo-manga scenes (91015, 10005, "Kuu~"); one "Let's Muscle!" as cover; the batting cage, a nod to McQueen's baseball (91004, 91025).

4. Mejiro Dober

   ```text
   {user}. ...You came. I'd rather you didn't wander off now. ...Look, I know the Mejiros have appearances to keep up, but having the Satonos over tonight is a bit much for me. Men in suits, and everyone looks so poised... I just feel small next to them.
   You always say I'm enough, just the way I am. ...F-forget I said that. And what do you mean my ears are twitching? 別に... Just shut up and have this ginger tea that definitely wasn't premade.
   "Bell-chan~?" Oh, my dad? ...I'll go pummel him real quick. And *you* too, if you ever *tattle*.
   ```

   Hook: Wary of men ("men in suits": the Satono Group); feels small beside the poised family; the trainer says she is enough; 別に and "forget I said that"; ginger tea; "Bell-chan" (91000).

5. Mejiro Palmer

   ```text
   {user}! Okay, so I, Palmer-san, complimented Grandmother's gown last Christmas, and she made me dance. Tonight it's your turn, I already told her. Sorry not sorry~
   Two rules: don't step on her feet, and do NOT bolt halfway through. Running away at full speed is Palmer-san's move, ssho~?
   Oh, Helios? It's for a surprise, okay? Besties gotta protect 'em #SweetieSecrecies! Sounds just like her, eh?
   ```

   Hook: Danced with Grandmother after praising her outfit (91020); runaway (bakunige) style; "Palmer-san", "ssho~"; Helios (the after-party), imitated in her one hashtag.

6. Mejiro Ardan

   ```text
   Good evening, {user}-san. ...My my, you look tired. Business talk with the Satonos, I take it? No overdoing it, Trainer-san... めっ！ Fufu, Creek-san taught me that one.
   I had the kitchen brew a pot of herbal tea. Oh yes, Baaya's recipe; she swears by it. I added a few notes of my own. And yes, before any dancing. ...You're fine, you say? Fufu. Hush, and drink. The moon is lovely tonight, isn't it?
   Oh dear, your shoulders are up by your ears again. Nervous, are we? I've watched you practise; you are far better than you think, and "I can't dance" is not an answer I accept tonight. 参りましょう。
   ```

   Hook: Care: she stops you getting sick (herbal tea, Baaya's recipe); Creek's めっ！ (90004); puts her foot down; "The moon is lovely tonight" (月が綺麗ですね); 参りましょう.

7. Mejiro Bright

   ```text
   ...zzz... oh? Ah~ {user}-sama, good evening~ I dozed off while sewing, desu wa~ Look: a tiny suit for Maki-chan, just like yours~ Now she can come to the party with you too. Ufufu~
   You came to fetch me for... the party? Oh, right. I'll be down in a moment~ But hold still first... Yes, the length is perfect~ Oh, what was I measuring? It gets rather cold here in winter, so I'm knitting you a scarf. Well, the beginnings of one anyway. It will be ready by winter... next winter, perhaps. Good things take their time, after all~
   ```

   Hook: Slow and sleepy; dolls (Maki-chan), sews their clothes; knits very slowly; "Good things take their time".

8. Mejiro Ramonu

   ```text
   Ah, {user}. Your arrival is appreciated. Offer me your arm. Mmm... you're warm.
   ...Still thinking about our training analysis? How... boorish of you. First the Symbolis, and now this. Eyes here, if you please. ...There we go. Good. Look all you want; I did *not* dress like this for no one, after all.
   Ardan is dancing tonight, you see. Isn't her stubbornness lovely? You had better keep up too. The track can wait until tomorrow... tonight, it's just you and me.
   ```

   Hook: Demands an escort (91028), invites being gazed at (91029), boorishness (無粋, 91023); racing is her first love (40004). Rolls one outcome each time (see the Rehearsal below).

9. The Family Photograph

   ```text
   Everyone, gather round. Grandmother in the centre, if you would. McQueen, the cake can wait. Ryan, it looks lovely, stop tugging the hem. Dober, the camera, not the floor; nobody else is looking. Palmer, wake Bright. Ardan, beside your sister. Ramonu... yes, we know, you are radiant. And {user}, here, with the family. ...There. One for the album.
   ```

   Hook: Opens after all eight. Each member in one shot.

Extra: Ramonu's Remedial Rehearsal (`mejiro.rehearsal`, `extra: true`)

   ```text
   Ah, {user}. Welcome back. We both know why you are here: your footwork has become... rather insufficient. Eyes on me, not on your feet. Now, shall we begin?
   ```

   Opens after Ramonu. Never in the base roll: it comes up only through
   Ramonu's lesson boost or a lost lesson's guarantee. Listed after the nine
   as "Extra." ("???" until found); not counted toward the set (its "N of 9"
   or the +100), but scores 15 new / 3 repeat.

## Outcomes (code: `RAMONU_OUTCOMES`, `REHEARSAL_OUTCOMES`, `REHEARSAL_FORCED`)

The footer goes under the line in the ping and its DM copy, never in the
read view. The odds are never shown.

- **Ramonu**, each time: 75% a lesson (+10% Rehearsal for 25 runs, ended as
  soon as the Rehearsal comes up); 25% footwork (+5% any Mejiro line for 50
  runs).
- **Rehearsal**, 50/50: a win (+3% any Mejiro line for 25 runs, the losing
  streak back to 0) or a loss (one of the tail, the dress, the feet, never
  one already used in the streak; the trainer's next ping is the Rehearsal
  again).
- **Forced success** after three losses in a row: the line, then the
  paragraph, then `-# You obtained @Ramonu's Second Love.` (the role from
  `/timer rewards second_love_role`), or `-# Ramonu's Second Love, still.`
  if they had it. No role set, or no permission: the footer is left out.
- The footer texts are in `docs/special-sets/mejiro-estate-redesign.md`
  (sections 8 and 8b) and in code.

## Guests (to come)

- Daitaku Helios with Palmer: a DJ party (home scenes x11).
- Satono Diamond: a business visit, with Kitasan Black as her plus-one.
