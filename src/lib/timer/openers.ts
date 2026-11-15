import * as path from 'path';

/** Timer-ping openers, common and rare. Kept apart so the scheduler and the rare tally share them. */

/**
 * Openers for an expiry ping. {user} is the trainer's mention, placed where
 * a person would say the name: before any "you/your" it introduces (a
 * vocative, "{user}-san"), or as "{user}'s" in a third-person line; at the
 * end only when nothing earlier says "you". Written with the server's staff: keep the wording as
 * given.
 */
export const PING_OPENERS: readonly string[] = [
    "Time, {user}! Your Independent Training is complete!",
    "The timer has reached zero, {user}. Go again?",
    "Training complete! Prepare yourself for the next one, {user}!",
    "Excellent work, {user}! Rest a moment, then go again!",
    "Tick tock, {user}, the clock has reached its end!",
    "{user}, your uma has been calling. Get back to her soon!",
    "{user}-san, the training has been completed. Please get back to your uma soon.",
    "The Chairwoman declares {user}'s run complete! Splendid work!",
    "Tazuna-san reports that {user}'s trainee is waiting by the track!",
    "Time's up, {user}! Don't keep a future champion waiting!",
    "{user}, your trainee just crossed the line. Go see how she did!",
    "Ding! Independent Training complete. On to the next, {user}!",
    "There goes the bell! {user}, your trainee awaits!",
    "Run finished, {user}. Your uma is cooling down; check in when you can.",
    "That's another run logged, {user}. Whenever you're ready.",
    "The stopwatch did its job, {user}. Now do yours.",
    "{user}'s trainee is on the bench, swinging her legs and very obviously waiting.",
    "Session over, {user}. Check her condition before the next one.",
    "{user}, your uma came back and is pretending she wasn't waiting for you.",
    "{user}, your uma is stretching very loudly in your general direction.",
];

/**
 * A boost a special gives the trainer who gets it: for the next `runs`
 * pings, an extra `chance` (on top of the usual special chance) of a
 * special from the same set carrying `tag`. Getting it again adds `runs`
 * more to what is left (the runs stack; the chance does not).
 */
export interface SpecialBoost {
    tag: string;
    chance: number;
    runs: number;
}

/**
 * A boost an outcome grants (`SpecialOutcome.boost`): for the next `runs`
 * pings, an extra `chance` of either one special (`special`) or any line of
 * the set `set` (its extras left out). Stored per trainer by `key`; getting
 * the same outcome again adds `runs` more to what is left, as set boosts do.
 */
export interface OutcomeBoost {
    /** Stable storage key; never change one in use. */
    key: string;
    /** The set it draws from (a paused, locked or turned-off set gives nothing). */
    set: string;
    /** One special, by id, instead of the whole set. */
    special?: string;
    chance: number;
    runs: number;
    /** One-time: ends as soon as its target comes up, by any route. */
    endsOnHit?: boolean;
    /** The Boosts view label; `{runs}` becomes "25 runs left". Ends with punctuation. */
    label: string;
}

/**
 * One outcome a special can roll each time it is a ping's opener
 * (`Special.outcomes`): its footer goes under the line in the ping and its
 * DM copy (never in the read view), and its effect applies once.
 */
export interface SpecialOutcome {
    /** Stable id within the special. */
    id: string;
    /** Relative weight: 3 and 1 are 75% and 25%. */
    weight: number;
    /** "-# " line(s) under the line; `{user}` is the trainer's mention. */
    footer?: string;
    /**
     * A loss's mishaps: one is chosen evenly among those not yet used in the
     * trainer's current losing streak, and its footer is shown.
     */
    mishaps?: readonly { id: string; footer: string }[];
    boost?: OutcomeBoost;
    /**
     * Schedules `special` on a run picked at random from the next `within`
     * runs (1 = the very next one): that ping is forced to be it, and it
     * comes up no other way. Not while one is already pending (scheduled, or
     * guaranteed by a loss): it does not stack.
     */
    schedule?: { special: string; within: number };
    /** A win: the losing streak goes back to 0. */
    win?: boolean;
    /** A loss: adds its mishap to the streak and guarantees the trainer's next ping is this special again. */
    lose?: boolean;
}

/**
 * After `after` losses in a row, the special's next showing is a forced
 * success instead of a roll: the line, then `text` (a paragraph, not a "-#"
 * line), then a footer for the role it gives (`TimerSettings.secondLoveRoleId`).
 */
export interface ForcedSuccess {
    after: number;
    text: string;
    /** `{role}` becomes the role's mention. */
    roleFooter: string;
    /** When the trainer already had the role. */
    stillFooter: string;
}

/** One special line. `{user}` is the trainer's mention; `{set_name}` is its set's name. */
export interface Special {
    /**
     * Stable id, `<set>.<slug>`, stored with every find. Never change or reuse
     * one in use: finds, locks and set prerequisites follow it. The text and
     * name can be reworded freely.
     */
    id: string;
    /** Shown in the Specials lists once found. */
    name: string;
    text: string;
    /** Labels a boost can draw on, e.g. `collab`. */
    tags?: readonly string[];
    boost?: SpecialBoost;
    /**
     * Specials (by id) a trainer must have found before this one can come up,
     * e.g. the seven Mejiro after Grandmother's welcome, the Family
     * Photograph after all of them. Until then a roll on it redirects to the
     * first of those still unfound (`redirectOpener`), so Grandmother takes
     * the whole set's share until she is found. Nothing on the Specials page
     * says so: it just shows "???".
     */
    after?: readonly string[];
    /**
     * A file in `src/assets/specials/` (a video or GIF) posted with the line:
     * on the ping, its DM copy, and when the special is read in full.
     */
    media?: string;
    /**
     * Where the media comes from, shown as small text right under it, e.g.
     * "Video: <https://...>" (angle brackets: no second link preview).
     */
    credit?: string;
    /** Rolled each time this line is a ping's opener; see `SpecialOutcome`. */
    outcomes?: readonly SpecialOutcome[];
    forcedSuccess?: ForcedSuccess;
    /**
     * Out of every pool (base and boosts) while the trainer owes this special
     * (by id): it is scheduled or guaranteed for them, or a losing streak on
     * it runs. Back once they pass it (a win or a forced success). Ramonu:
     * no Ramonu until her Remedial Rehearsal is passed (owner, 2026-11-15).
     */
    heldUntilPassed?: string;
    /**
     * An extra: never in the base pool (`rarePoolFor`) or a set-wide boost,
     * only reachable through its own boost or a guarantee (a guest: the guest
     * slice, `guestSlice`). It does not count
     * toward its set's completion (the "N of 9" counts, the set's points),
     * but scores normal find points. Its Specials page lists it after the set's lines.
     */
    extra?: boolean;
    /**
     * A guest (The Mejiro Estate's visitors): always an extra too (`extra:
     * true`), so out of every pool, boost, count and completion an extra is
     * out of. Its only route is the guest slice (`guestSlice`). Listed after
     * the set's lines and other extras as "Guest.".
     */
    guest?: boolean;
}

/** One special set: a group of special lines that can be turned on or off. */
export interface SpecialSet {
    /** Stable id, stored in trainers' settings; never rename one in use. */
    id: string;
    /** Shown in Settings. */
    name: string;
    /**
     * The id of a special in another set. Until a trainer has found it, this
     * set is locked for them: its lines never come up and its toggle is
     * greyed out.
     */
    requires?: string;
    /**
     * For a locked set: once a trainer has unlocked it, this much extra
     * special chance on every ping, drawn only from this set's lines. A boost
     * like the others (Boosts off turns it off; not while the set is off).
     */
    unlockBonus?: number;
    /** Shown in the Boosts view after the unlock bonus, e.g. "+1% <label>". */
    unlockBonusLabel?: string;
    /**
     * Paused: no new finds. Its lines never come up, in the base roll or any
     * boost, and finding its prerequisite does not announce it. Its page and
     * the finds already made stay as they are. Remove the flag to resume.
     */
    paused?: boolean;
    openers: readonly Special[];
}

/**
 * Mejiro Ramonu's outcomes (owner, 2026-11-15): 75% she wants another
 * lesson (the Remedial Rehearsal is scheduled on a run picked at random
 * from the next 25; the only way to get it), 25% your footwork passed (+5%
 * any Mejiro line for 50 runs).
 * The odds are never shown to trainers.
 */
const RAMONU_OUTCOMES: readonly SpecialOutcome[] = [
    {
        id: 'lesson',
        weight: 3,
        footer: "-# Ramonu is still not quite satisfied with how distracted you were, and has insisted you join her next dance practice. She will summon you for a lesson sometime in the next 25 runs.",
        schedule: { special: 'mejiro.rehearsal', within: 25 },
    },
    {
        id: 'footwork',
        weight: 1,
        footer: "-# Ramonu remains unimpressed... but your footwork convinced her your attention was where it belonged. For the next 50 runs, gain a 5% chance of meeting another Mejiro.",
        boost: { key: 'mejiro.ramonu:footwork', set: 'mejiro-estate', chance: 0.05, runs: 50, label: 'The Mejiro Estate: any Mejiro line, {runs}.' },
    },
];

/**
 * Ramonu's Remedial Rehearsal, 50/50: a win (+3% any Mejiro line for 25
 * runs, the losing streak back to 0) or a loss (one of three mishaps not yet
 * used in the streak; the trainer's next ping is the Rehearsal again). After
 * three losses in a row the next one is a forced success, with the role
 * Ramonu's Second Love.
 */
const REHEARSAL_OUTCOMES: readonly SpecialOutcome[] = [
    {
        id: 'win',
        weight: 1,
        footer: "-# Your practice paid off. As a pair, your steps flow a little smoother now. For the next 25 runs, gain a 3% chance of meeting another Mejiro.",
        win: true,
        boost: { key: 'mejiro.rehearsal:win', set: 'mejiro-estate', chance: 0.03, runs: 25, label: 'The Mejiro Estate: any Mejiro line, {runs}, after a lesson well learned.' },
    },
    {
        id: 'lose',
        weight: 1,
        lose: true,
        mishaps: [
            { id: 'tail', footer: "-# You tried. Admittedly. You still stepped on her tail, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson." },
            { id: 'dress', footer: "-# You tried. Admittedly. You still caught the hem of her dress, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson." },
            { id: 'feet', footer: "-# You tried. Admittedly. You still trod on her toes, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson." },
        ],
    },
];

const REHEARSAL_FORCED: ForcedSuccess = {
    after: 3,
    text: "Finally, {user} succeeded in not failing. Ramonu couldn't help but crack a tiny smile, amused by how pleased you were with yourself... and, secretly, already missing your clumsiness.",
    roleFooter: '-# You obtained {role}.',
    stillFooter: "-# Ramonu's Second Love, still.",
};

/**
 * The special sets, in order: rare openers that together come up
 * `RARE_OPENER_CHANCE` of the time. A new set of umas is a new entry here,
 * with its own id. Trainers can turn sets off in the panel's Settings. A
 * special's `name` is what the Specials lists show once it is found, so
 * they never give the lines away.
 */
export const SPECIAL_SETS: readonly SpecialSet[] = [
    {
        id: 'set1',
        name: 'Lobby Loungers',
        openers: [
        { id: 'set1.matikane', name: 'Matikanetannhauser', text: "Wasshoi~ *trips* Oooooow!... ooh- *tears up, sniffles*, I'm okay, {user}! You're here now! Please come take a look at your trainee!" },
        { id: 'set1.overslept', name: 'Overslept?!', text: '{user} zzzzzzzzz- OOOH AEUHHHH! Oh, right. Trainer, trainer, the timer!' },
        { id: 'set1.tachyon', name: 'Agnes Tachyon', text: '{user} Hayaku, はやく! Tachyon is hungry, so get to finishing the training and cook her some food! And then some guinea pigging activities too...' },
        { id: 'set1.bourbon', name: 'Mihono Bourbon', text: "{user} Master-san, I have been provided intel of your underling's completion. Please proceed at haste. I will provide chocolate afterwards." },
        { id: 'set1.rulership', name: 'Rulership', text: "{user} Yada yada yadaaaaaaaaaaa! Why are you ignoring me?! Didn't you promise you'd game with me after finishing the run?! Where are you at HAEH? Get back here, you gotta play with 「dominare」! YADAAAAAA! >.<" },
        { id: 'set1.machan', name: 'Aston Machan', text: '{user} *tugs at shirt* Machan wants your attention...  can we hang out after you finish the run...' },
        { id: 'set1.taiki', name: 'Taiki Shuttle', text: "Torena-san, there's a new burger place in town! I'll ask El and Grass to come too, so come with me, okay {user}? We can host a party afterwards too! I can't wait..." },
        { id: 'set1.mejiro', name: 'Mejiro Family', text: 'The Mejiro Estate welcomes your return, {user}. Please attend to your trainee as soon as possible. We have provided detailed updates on her development.' },
        { id: 'set1.rice', name: 'Rice Shower', text: "{user} Onii-samaaa~ I don't want to cause much trouble, but the independent run has finished! Will you come take a look with me?" },
        { id: 'set1.rudolf', name: 'Symboli Rudolf', text: 'Your trainer has declared her in-dependence from the pack. A mare-velous revolution. ...ehem. Anyways, please look into it, {user}.' },
        { id: 'set1.groove', name: 'Air Groove', text: '...Teio probably heard one of her *horrible* jokes again, so you will have to excuse this da- *meeting*... as I cater to her, {user}. Want to come to my garden later?' },
        { id: 'set1.teio', name: 'Tokai Teio', text: "I don't want to have to wait for my leg! I want to meet your trainee! Teio wants to runnnn >.< Can I meet her, please {user}?" },
        { id: 'set1.curren', name: "Curren Chan", text: "{user}-channnn~! Here you are! Heard you've been handling #Trainee runs, but see, Curren has #DefinitelyAccidentally leaked that you're #TheBestManager that Tracen has so... You're coming with me, #SpecialCollabs full week! #LookAtCurren #ManagerDebut" },
        ],
    },
    {
        id: 'online-sensations',
        name: '#OnlineSensations',
        requires: 'set1.curren',
        // Owner, 2026-11-09: +1% #OnlineSensations once unlocked.
        unlockBonus: 0.01,
        unlockBonusLabel: '#OnlineSensations: Curren ~~drags~~ invites you for her #SpecialCollabs!',
        openers: [
            { id: 'os.celebrate', name: "#Celebrate", text: "{user}, it's time to #Celebrate! It took so much #Preparation but we finally got #ThreeMillionFollowers on release! Thank you for being my #FavoriteManager, and it's time to get a bazillion more! #WorkHard", tags: ['collab'] },
            { id: 'os.eyes-only', name: "#ForYourEyesOnly", text: "{user}, it's such a long dayyyy~ #SoTired It was fun but a #DozenDresses takes so long for the producers... So I just want to *closes door behind* show you something #ForYourEyesOnly~\n...ya like it, m'fated #BelovedManager? shh, it's only for you now... and maybe when we truly #BecomeAPair~", tags: ['collab'] },
            { id: 'os.rickey', name: "#CopanoRickey", text: "Hey {user}, have you seen that #Viral Umastagram photo? The #Rickey☆Buzz one? She wanted to raise 15 million #ChristmasOrnies... Either way, that's why we're streaming with her to garner more support! Here comes the #FengShui train! #CurrenxRickey #RickeyLuckyHappy", tags: ['collab'] },
            { id: 'os.loves', name: "#LovesOnlyYou", text: "#Woah #Surprised Loves? What are you doing here?! I'm surprised you'd be #WalkingAround- oh my god you're #LiveStreaming! {user}, get in here! Introducing to everyone, #TheBestManager that Tracen can ask for! And also mine~ #CurrensManager #CurrenxLoves\n-# {user} became so famous that even Montjeu #L'ArcChampion requested a collaboration! For the next 50 runs, gain a 4% chance of getting an entry in {set_name}.", tags: ['collab'], boost: { tag: 'collab', chance: 0.04, runs: 50 } },
            { id: 'os.tosen', name: "#TosenJordan", text: "You know Tosen right? Yeah, her #FancyNails are amazing! Look how that fits her #CircusCostume though! We *have* to make one- yes {user}-chan... #ComeOn have you not seen Gojo-kun?! You can do the same! #CurrenxTosen #IWantGojoKun #MakeMeMarin", tags: ['collab'] },
            { id: 'os.gold-city', name: "#GoldCity", text: "Ugh, I want to actually do a #RealCollab with Gold City but she's always busy... Last time she even asked if you'd be her #UmastaCameraman; when are you doing *my* photos huh {user}-chan? Come onnn, at least act like a #RealMan~ #CityWaitingRoom #SpoilYourPrincess", tags: ['collab'] },
            { id: 'os.transcend', name: "#Transcend", text: "Transcend said thanks for the collab, {user}-chan! Her followers went #Explosive overnight, and she called Curren a total #Charisma~ Now she's offering a whole jar of #Hachimi for intel on #TheBestManager... sorry Trans-chan, that scoop is #NotForSale! #CurrenxTranscend", tags: ['collab'] },
            { id: 'os.falcon', name: "#SmartFalcon", text: "#TwoTrillionFans has become so popular #OhMyFreakinGod! Smart Falcon is so #UmadolFamoussss it's insane! {user}, we have to come support one of her #GrandLive concerts, please please-please#PWEASE! I will even do #ProperTraining this time! #FalconConcertIncoming #MoodBoost", tags: ['collab'] },
            { id: 'os.akebono', name: "#HishiAkebono", text: "{user}-chan, have you thought of #VarietyPosting? Yeah, Akebono is soooo good at it #Exasperated (It's a #FancyWord I just learned!) Yes {user}, we must do something #NewAndCool today- What do you mean we have #StaminaTraining?! Nooooo! #ReleaseCurren", tags: ['collab'] },
            { id: 'os.taiki', name: "#TaikiShuttle", text: "Ugh, Taiki just doesn't #NoticeMyRivalry at all! She's so #PartyFun and her Texan burgers are so #Deliciousss... That's right! {user}, time to make some noise in UmaTube! Surely we can get a collab out of her! #MakeCurrenNoticeableAgain", tags: ['collab'] },
            { id: 'os.biko', name: "#BikoPegasus", text: "Biko's got a new #UmaTokPost? Oh my GAWDDD I love Biko! Have you seen her animations? Her #PowerRanger series is also soooo cool... wait... You got me a #RangerCollab?! No weiii! (#PalmerHelios taught me that!) Thank you shooo much {user}! Time to get my #DressUp ready! #CurrenxBiko #PinkRanger", tags: ['collab'] },
            { id: 'os.helios', name: "#DaitakuHelios", text: "Wei weeeiiii! {user}, I've heard of how gyatdamnnn vibey you are! So here's the thing Torepiii *wink*: Gold City and I have been doing a pretty s'mexy looksmaxxing Zombie☆Makeover, and I think Curren be such a cutieee, frfr! I'll be looking for six or seven- HAHAH SIX SEVENNN- more ladies, so hook me up... and also ||teach me how to bag Daiichi-ojou too pweaseee!|| See ya, Helios☆Out! #LookAtHelios #ScaryCurren #DoveyVibey", tags: ['collab'] },
            { id: 'os.chu', name: "#ChuChuChallenge", text: "{user}-chan! Everyone on UmaTok is doing the #ChuChuChallenge, so obviously Curren does it the #Kawaiiest~ Got the #FancyCam ready? Here we go! Chu♡ Chu♡ Chu♡... wait, why are you smiling at me like that?! S-stop, Curren’s supposed to be #Unshakeable! Curren is NOT ドキドキ #Flustered right now! ...Ugh, my face is so warm.. Cut, CUT! Another take! バカ！ #CurrenxTrainer #ChuChuChallenge #DummyTrainer #IHateTrainer\n-# As #Revenge, Curren Chan vows to #TireYouOut with more #SpecialCollabs. For the next 50 runs, gain a 4% chance of getting an entry in {set_name}.", tags: ['collab'], boost: { tag: 'collab', chance: 0.04, runs: 50 }, media: 'chu-chu-challenge.mp4', credit: 'Video: <https://youtu.be/hJ78i-6uwGM>' },
        ],
    },
    {
        id: 'mejiro-estate',
        name: 'The Mejiro Estate',
        requires: 'set1.mejiro',
        // Paused 2026-11-10 for the redesign; resumed 2026-11-15 (owner), with the new lines,
        // Ramonu's Remedial Rehearsal and the guests.
        openers: [
            { id: 'mejiro.grandmother', name: "Grandmother", text: "Ah, so you are {user}, the trainer the girls cannot stop writing home about. Do come in; you are very welcome here.\nYou see, this family has chased one dream for a very long time, and I am told you have been helping the girls carry it. They are all rather fond of you.\nTea is at three in the east garden, and I should be glad of your company. Do mind the pond, dear, and do keep McQueen away from the dessert cart until after dinner; I am told she has a plan. Not that she is being terribly discreet about it, hoho." },
            { id: 'mejiro.mcqueen', name: "Mejiro McQueen", text: "ごきげんよう, {user}-san. Welcome to the Mejiro Estate. I shall be your guide this afternoon, desu wa. The garden, the pond, the trophy room where the Tenno Sho shield shall one day hang... and the patisserie cart, which simply happens to lie on our route. *Ahem.* You know me, Trainer-san, one parfait is perfectly reasonable.\n...Gold Ship? ...Why the h- why would she be in the hedge? I refuse to dignify it. Shall we?", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ryan', name: "Mejiro Ryan", text: "{user}-san, glad to see you here! *waves* Grandmother made me wear a dress tonight, for you, and... it's frilly. Very frilly... I told myself it's fine: shoulders back, chin up, it's basically posture training. Let's Muscle!\n...It's not working. *sigh* Everyone keeps saying it looks nice, but they're just being polite, right? Kuu~... this is exactly the chapter where the heroine flees to the balcony...\n...Oh, did I say that out loud? W-well, we do have a batting cage out back. Want to come with me? ...McQueen insists it's for guests.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.dober', name: "Mejiro Dober", text: "{user}. ...You came. I'd rather you didn't wander off now. ...Look, I know the Mejiros have appearances to keep up, but having the Satonos over tonight is a bit much for me. Men in suits, and everyone looks so poised... I just feel small next to them.\nYou always say I'm enough, just the way I am. ...F-forget I said that. And what do you mean my ears are twitching? 別に... Just shut up and have this ginger tea that definitely wasn't premade.\n\"Bell-chan~?\" Oh, my dad? ...I'll go pummel him real quick. And *you* too, if you ever *tattle*.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.palmer', name: "Mejiro Palmer", text: "{user}! Okay, so I, Palmer-san, complimented Grandmother's gown last Christmas, and she made me dance. Tonight it's your turn, I already told her. Sorry not sorry~\nTwo rules: don't step on her feet, and do NOT bolt halfway through. Running away at full speed is Palmer-san's move, ssho~?\nOh, Helios? It's for a surprise, okay? Besties gotta protect 'em #SweetieSecrecies! Sounds just like her, eh?", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ardan', name: "Mejiro Ardan", text: "Good evening, {user}-san. ...My my, you look tired. Business talk with the Satonos, I take it? No overdoing it, Trainer-san... めっ！ Fufu, Creek-san taught me that one.\nI had the kitchen brew a pot of herbal tea. Oh yes, Baaya's recipe; she swears by it. I added a few notes of my own. And yes, before any dancing. ...You're fine, you say? Fufu. Hush, and drink. The moon is lovely tonight, isn't it?\nOh dear, your shoulders are up by your ears again. Nervous, are we? I've watched you practise; you are far better than you think, and \"I can't dance\" is not an answer I accept tonight. 参りましょう。", after: ['mejiro.grandmother'] },
            { id: 'mejiro.bright', name: "Mejiro Bright", text: "...zzz... oh? Ah~ {user}-sama, good evening~ I dozed off while sewing, desu wa~ Look: a tiny suit for Maki-chan, just like yours~ Now she can come to the party with you too. Ufufu~\nYou came to fetch me for... the party? Oh, right. I'll be down in a moment~ But hold still first... Yes, the length is perfect~ Oh, what was I measuring? It gets rather cold here in winter, so I'm knitting you a scarf. Well, the beginnings of one anyway. It will be ready by winter... next winter, perhaps. Good things take their time, after all~", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ramonu', name: "Mejiro Ramonu", text: "Ah, {user}. Your arrival is appreciated. Offer me your arm. Mmm... you're warm.\n...Still thinking about our training analysis? How... boorish of you. First the Symbolis, and now this. Eyes here, if you please. ...There we go. Good. Look all you want; I did *not* dress like this for no one, after all.\nArdan is dancing tonight, you see. Isn't her stubbornness lovely? You had better keep up too. The track can wait until tomorrow... tonight, it's just you and me.", after: ['mejiro.grandmother'], outcomes: RAMONU_OUTCOMES, heldUntilPassed: 'mejiro.rehearsal' },
            { id: 'mejiro.photo', name: "The Family Photograph", text: "Everyone, gather round. Grandmother in the centre, if you would. McQueen, the cake can wait. Ryan, it looks lovely, stop tugging the hem. Dober, the camera, not the floor; nobody else is looking. Palmer, wake Bright. Ardan, beside your sister. Ramonu... yes, we know, you are radiant. And {user}, here, with the family. ...There. One for the album.", after: ['mejiro.grandmother', 'mejiro.mcqueen', 'mejiro.ryan', 'mejiro.dober', 'mejiro.palmer', 'mejiro.ardan', 'mejiro.bright', 'mejiro.ramonu'] },
            // An extra (owner, 2026-11-15): only through Ramonu's lesson boost or a lost lesson's guarantee.
            { id: 'mejiro.rehearsal', name: "Ramonu's Remedial Rehearsal", text: "Ah, {user}. Welcome back. We both know why you are here: your footwork has become... rather insufficient. Eyes on me, not on your feet. Now, shall we begin?", after: ['mejiro.ramonu'], extra: true, outcomes: REHEARSAL_OUTCOMES, forcedSuccess: REHEARSAL_FORCED },
            // Guests (owner, 2026-11-15): extras of their own, only through the guest slice (`guestSlice`), once the Family Photograph is found.
            { id: "guest.helios", name: "Daitaku Helios", text: "Weeei, Tore-pi! Surprise~! Pama-chin snuck my decks into the ballroom, and Grandmother said \"one hour\". Yoichomaru, that's basically forever! {user}, get on the floor, Palmer-san's already age-age! #MejiroAfterParty #ZuttomoDJ", after: ['mejiro.photo'], extra: true, guest: true },
            { id: "guest.satono", name: "Satono Diamond & Kitasan Black", text: "Diamond: \"Good evening, {user}-san. McQueen-san invited the Satono house to dinner, and I may have brought a plus-one... fufu.\"\nKitasan: \"Wasshoi! Dia-chan, this place is HUGE! Can we have a festival in the east garden? Just a little one? Dodon!\"\nDiamond: \"Kita-chan, it's a dinner party. ...Fumu fumu. Then again, nobody has ever tried. A jinx worth breaking, perhaps? Trainer-san, would you hold the lanterns?\"", after: ['mejiro.photo'], extra: true, guest: true },
            { id: "guest.goldship", name: "Gold Ship", text: "Gorushi-chan, out of the hedge and into the ballroom! Target: McQueen! GORUSHI DROPKIIICK~!! ...She dodged?! Kkaa! {user}, you saw that, right? Missed her again. I always miss her... Not like THAT. Oi, I *said* don't look at me like that.\nAnyways. Here, hold this: a KFC bucket, family size. And yes, a parfait for McQueen... what? Don't ask where I got it. I'm so nice, you know?☆\nNow listen up: I may have failed this time, but next time, I'll come in through the chandelier with my water gun! ...What do you mean you don't want to get involved? You're on rope duty, end of story. Yes, you have to! Gorushi-sama has spoken~ じゃあね, gotta prepare my next escapade!", after: ['mejiro.photo'], extra: true, guest: true },
            { id: "guest.symboli", name: "Symboli Rudolf & Sirius Symboli", text: "Rudolf: \"Good evening, {user}-kun. I suppose you're aware already, but we come at Ramonu's invitation in particular. After all, she once called our lunches *boring*, so tonight I intend to prove otherwise. Our two houses at one table... rather Symboli-c, wouldn't you say?\"\nSirius: \"...And that's why she calls them boring. Unbelievable. Evening, Trainer. Hmm... must say you look pretty good tonight, puppy~ Either way, I came to watch the Emperor squirm, so that will be all.\"\nRamonu: \"*Excuse me*, Sirius? Fawn over your own. Good evening, Symbolis; we have things to discuss. And Trainer... you had better not have enjoyed that.\"", after: ['mejiro.photo'], extra: true, guest: true },
            { id: "guest.teio", name: "Tokai Teio", text: "Hey hey, {user}! Kaichou brought me along as her plus-one, so Teio-sama is officially Symboli-house company tonight. I promised to behave! ...Mostly. Did you see McQueen's face when I walked in? Priceless. Muteki! ...Wait. Is this floor good for a Teio Step?", after: ['mejiro.photo'], extra: true, guest: true },
        ],
    },
];

/** Every special, all sets in order, with its set's id. */
export const RARE_OPENERS: readonly (Special & { set: string })[] = SPECIAL_SETS.flatMap((set) =>
    set.openers.map((o) => ({ ...o, set: set.id })),
);

/** The rare openers' texts, in list order. */
export const RARE_PING_OPENERS: readonly string[] = RARE_OPENERS.map((o) => o.text);

/** Chance, across all of them, that a ping opens with a rare line. */
export const RARE_OPENER_CHANCE = 0.06;

/**
 * Soft caps on a ping's total special chance (base plus every boost), as in
 * Uma's stat soft caps (owner, 2026-11-10). Up to 20% counts in full; the
 * raw chance from 20% to 30% counts at half (reaching 25%); beyond that at a
 * quarter; and the effective chance never passes the 30% hard cap (reached
 * at a raw 50%).
 */
export const SPECIAL_SOFT_CAPS: readonly { from: number; rate: number }[] = [
    { from: 0.2, rate: 1 / 2 },
    { from: 0.3, rate: 1 / 4 },
];
export const SPECIAL_HARD_CAP = 0.3;

/** The effective special chance for a raw total `raw`, after the soft caps and the hard cap. */
export function effectiveChance(raw: number): number {
    let effective = Math.min(raw, SPECIAL_SOFT_CAPS[0]!.from);
    SPECIAL_SOFT_CAPS.forEach((cap, i) => {
        const end = SPECIAL_SOFT_CAPS[i + 1]?.from ?? Infinity;
        if (raw > cap.from) effective += (Math.min(raw, end) - cap.from) * cap.rate;
    });
    return Math.min(effective, SPECIAL_HARD_CAP);
}

/**
 * A seasonal buff: from `from` until `until`, every trainer's ping has an
 * extra `chance` of the special `specialId` (a flat slice that only ever
 * draws that line). It counts as a boost, so Boosts off turns it off, and
 * it never comes up while the special's set is off or locked for them.
 * Old entries can stay; they are ignored once `until` has passed.
 */
export interface SeasonalBuff {
    /** Shown in the Boosts view after its chance, e.g. "+1% <label>". */
    label: string;
    specialId: string;
    chance: number;
    from: Date;
    until: Date;
}

export const SEASONAL_BUFFS: readonly SeasonalBuff[] = [
    // Curren Chan week (owner, 2026-11-08): +1% Curren Chan for 7 days. Her
    // line unlocks #OnlineSensations, so it stops for a trainer who has it
    // (see `extraChances`); the set's unlock bonus takes over.
    { label: 'Curren Chan: meet her in the lobby!', specialId: 'set1.curren', chance: 0.01, from: new Date('2026-11-08T11:00:00Z'), until: new Date('2026-11-15T11:00:00Z') },
];

/** The seasonal buffs (of `buffs`, by default all) running at `now`. */
export function activeSeasonals(now: Date, buffs: readonly SeasonalBuff[] = SEASONAL_BUFFS): SeasonalBuff[] {
    return buffs.filter((b) => b.from.getTime() <= now.getTime() && now.getTime() < b.until.getTime());
}

/**
 * Early start: a trainer who starts their next run within the window after
 * their last ping gets `chance` more special chance on that run's ping. The
 * window is `windowMinutes`, or `earlyRiserWindowMinutes` with Early Riser
 * on: a minute more, to reward the trainer who chose to be on time. It
 * leaves time to finish picking in game.
 */
export const EARLY_START = { chance: 0.01, windowMinutes: 3, earlyRiserWindowMinutes: 4 } as const;

/**
 * Fills an opener for a trainer: every `{user}` becomes their mention, and
 * `{set_name}` the name of the special's set.
 */
export function fillOpener(text: string, discordUserId: string): string {
    const set = SPECIAL_SETS.find((s) => s.id === RARE_OPENERS.find((o) => o.text === text)?.set);
    return text.replaceAll('{user}', `<@${discordUserId}>`).replaceAll('{set_name}', set?.name ?? '');
}

/**
 * Picks an opener from one random number: below `RARE_OPENER_CHANCE` a rare
 * one, else a common one, each evenly within its group.
 */
export function pickOpener(r: number, rarePool: readonly string[] = RARE_PING_OPENERS, commons: readonly string[] = PING_OPENERS): string {
    if (r < RARE_OPENER_CHANCE && rarePool.length > 0) {
        return rarePool[Math.min(rarePool.length - 1, Math.floor((r / RARE_OPENER_CHANCE) * rarePool.length))]!;
    }
    // A rare roll with every special set off falls back to a common line.
    const share = r < RARE_OPENER_CHANCE ? r / RARE_OPENER_CHANCE : (r - RARE_OPENER_CHANCE) / (1 - RARE_OPENER_CHANCE);
    return commons[Math.min(commons.length - 1, Math.floor(share * commons.length))]!;
}

/** How many of a trainer's latest reminder lines can't come up again: none repeats within 4 pings in a row. */
export const COMMON_NO_REPEAT = 3;

/** The reminder lines a trainer can get next: all but their last `COMMON_NO_REPEAT` (all, if that left none). */
export function commonsFor(recent: readonly string[]): string[] {
    const left = PING_OPENERS.filter((o) => !recent.includes(o));
    return left.length > 0 ? left : [...PING_OPENERS];
}

/** The ids of the paused sets (`SpecialSet.paused`): no new finds from them. */
export const PAUSED_SETS: readonly string[] = SPECIAL_SETS.filter((s) => s.paused).map((s) => s.id);

/** The special texts in the sets that are neither turned off (`disabledSets`), locked (`lockedSets`) nor paused. Extras (`Special.extra`) are never in it. */
export function rarePoolFor(disabledSets: readonly string[], lockedSets: readonly string[] = []): string[] {
    return RARE_OPENERS.filter((o) => !o.extra && !disabledSets.includes(o.set) && !lockedSets.includes(o.set) && !PAUSED_SETS.includes(o.set)).map((o) => o.text);
}

/**
 * The guest slice (owner, 2026-11-15): once a trainer has found the Family
 * Photograph, an extra chance of a guest, `chance` x (guests they have not
 * found / all guests), drawn from every guest (repeats can come up while it
 * is open). It is content, not a boost: Boosts off does not pause it, but
 * it gives nothing while the set is paused, off or locked for them.
 */
export const GUEST_SLICE = { set: 'mejiro-estate', requires: 'mejiro.photo', chance: 0.04, label: 'The Mejiro Estate: guests are dropping by.' } as const;

/** Every guest (`Special.guest`), in list order. */
export const GUESTS: readonly (Special & { set: string })[] = RARE_OPENERS.filter((o) => o.guest);

/** The guest slice's chance for a trainer who has found `foundIds`: 0 before the photo, and once every guest is found. */
export function guestSliceChance(foundIds: ReadonlySet<string>): number {
    if (GUESTS.length === 0 || !foundIds.has(GUEST_SLICE.requires)) return 0;
    const unfound = GUESTS.filter((g) => !foundIds.has(g.id)).length;
    return (GUEST_SLICE.chance * unfound) / GUESTS.length;
}

/**
 * A trainer's guest slice, or null when it has no chance or its set is
 * paused (`paused`), turned off or locked for them. `content`: not a boost.
 */
export function guestSlice(
    foundIds: ReadonlySet<string>,
    disabledSets: readonly string[],
    lockedSets: readonly string[],
    paused: readonly string[] = PAUSED_SETS,
): { chance: number; pool: string[]; label: string; content: true } | null {
    const set = GUEST_SLICE.set;
    if (paused.includes(set) || disabledSets.includes(set) || lockedSets.includes(set)) return null;
    const chance = guestSliceChance(foundIds);
    if (chance <= 0) return null;
    return { chance, pool: GUESTS.map((g) => g.text), label: GUEST_SLICE.label, content: true };
}

/** A set's lines for a set-wide outcome boost ("any Mejiro line"): all but its extras; none while it is paused. */
export function setLinesPool(setId: string): string[] {
    if (PAUSED_SETS.includes(setId)) return [];
    return RARE_OPENERS.filter((o) => o.set === setId && !o.extra).map((o) => o.text);
}

/** The pool an outcome boost draws on: its one special, or its set's lines; none while its set is paused. */
export function outcomeBoostPool(boost: Pick<OutcomeBoost, 'set' | 'special'>): string[] {
    if (PAUSED_SETS.includes(boost.set)) return [];
    if (boost.special) {
        const special = specialById(boost.special);
        return special ? [special.text] : [];
    }
    return setLinesPool(boost.set);
}

/** The outcome boost stored under `key`, from any special's outcomes, or undefined. */
export function outcomeBoostByKey(key: string): OutcomeBoost | undefined {
    for (const o of RARE_OPENERS) {
        const found = o.outcomes?.find((x) => x.boost?.key === key)?.boost;
        if (found) return found;
    }
    return undefined;
}

/** The special whose current text is `text`, or undefined. */
export function specialByText(text: string): (Special & { set: string }) | undefined {
    return RARE_OPENERS.find((o) => o.text === text);
}

/** What a special rolled when it came up: see `rollOutcome`. */
export interface RolledOutcome {
    /** The special's id. */
    special: string;
    /** The outcome's id; 'forced' for a forced success. */
    outcome: string;
    /** The mishap chosen, for a loss. */
    mishap?: string;
    /** A forced success (`Special.forcedSuccess`). */
    forced: boolean;
    /** The footer to show, a "-#" template (empty for a forced success: see `outcomeLines`). */
    footer: string;
    boost?: OutcomeBoost;
    schedule?: { special: string; within: number };
    win: boolean;
    lose: boolean;
}

/**
 * Rolls `special`'s outcome from one random number `r` in [0, 1), for a
 * trainer whose current losing streak is `streak` (the mishaps used so far,
 * in order). Null for a special without outcomes.
 *
 *   - With `forcedSuccess`, a streak of `after` or more is a forced success,
 *     whatever `r`.
 *   - Otherwise the outcomes cut [0, 1) in order by weight; the share of `r`
 *     within its outcome picks a mishap evenly among those not in `streak`
 *     (all of them, if every one was used).
 */
export function rollOutcome(special: Special, r: number, streak: readonly string[] = []): RolledOutcome | null {
    if (!special.outcomes || special.outcomes.length === 0) return null;
    if (special.forcedSuccess && streak.length >= special.forcedSuccess.after) {
        return { special: special.id, outcome: 'forced', forced: true, footer: '', win: true, lose: false };
    }
    const total = special.outcomes.reduce((sum, o) => sum + o.weight, 0);
    const x = Math.min(Math.max(r, 0), 1 - 1e-12) * total;
    let start = 0;
    let picked = special.outcomes[special.outcomes.length - 1]!;
    for (const o of special.outcomes) {
        if (x < start + o.weight) {
            picked = o;
            break;
        }
        start += o.weight;
    }
    const share = Math.min(Math.max((x - start) / picked.weight, 0), 1 - 1e-12);
    let mishap: { id: string; footer: string } | undefined;
    if (picked.mishaps && picked.mishaps.length > 0) {
        const left = picked.mishaps.filter((m) => !streak.includes(m.id));
        const from = left.length > 0 ? left : picked.mishaps;
        mishap = from[Math.min(from.length - 1, Math.floor(share * from.length))]!;
    }
    return {
        special: special.id,
        outcome: picked.id,
        ...(mishap ? { mishap: mishap.id } : {}),
        forced: false,
        footer: mishap?.footer ?? picked.footer ?? '',
        ...(picked.boost ? { boost: picked.boost } : {}),
        ...(picked.schedule ? { schedule: picked.schedule } : {}),
        win: picked.win ?? false,
        lose: picked.lose ?? false,
    };
}

/**
 * What a rolled outcome adds under the line in the ping (and its DM copy),
 * with `{user}` filled: its footer; for a forced success, the paragraph,
 * then the role footer (`role`: the role given, or `had` when the trainer
 * already had it). With no role (none set, or it could not be given), the
 * role footer is left out.
 */
export function outcomeLines(rolled: RolledOutcome, discordUserId: string, role: { roleId: string; had: boolean } | null = null): string {
    const fill = (t: string) => t.replaceAll('{user}', `<@${discordUserId}>`);
    if (!rolled.forced) return fill(rolled.footer);
    const forced = specialById(rolled.special)?.forcedSuccess;
    if (!forced) return '';
    const footer = role ? (role.had ? forced.stillFooter : forced.roleFooter.replaceAll('{role}', `<@&${role.roleId}>`)) : null;
    return [fill(forced.text), ...(footer ? [footer] : [])].join('\n');
}

/** A boost label for the Boosts view: `{runs}` filled as "25 runs left". */
export function outcomeBoostLabel(boost: Pick<OutcomeBoost, 'label'>, runsLeft: number): string {
    return boost.label.replaceAll('{runs}', `${runsLeft} run${runsLeft === 1 ? '' : 's'} left`);
}

/** The special that grants `boost` (by text) and the set it draws from, or undefined. */
export function boostOf(text: string): { set: string; boost: SpecialBoost } | undefined {
    const special = RARE_OPENERS.find((o) => o.text === text);
    return special?.boost ? { set: special.set, boost: special.boost } : undefined;
}

/**
 * The lines a set's boost draws on: that set's specials with the boost's
 * tag. Every #OnlineSensations line is a collab (with the trainer, at
 * least), so its boost covers the whole set, the lines that grant it
 * included; landing on one of those adds another 50 runs.
 */
export function boostPool(setId: string, tag: string): string[] {
    if (PAUSED_SETS.includes(setId)) return [];
    return RARE_OPENERS.filter((o) => o.set === setId && o.tags?.includes(tag)).map((o) => o.text);
}

/**
 * Specials locked to one trainer until that trainer has found them:
 *
 *   - nobody else can get it: their special share (6%) is spread evenly
 *     over the other specials;
 *   - the owner gets it at `ownerChance` per ping (2%), and the rest of
 *     their special share (the other 2%) is spread evenly over the other
 *     specials. Their total special chance stays 6%.
 *   - an `ownerChance` of 1 or more is a guarantee: the owner's next ping
 *     is that special, whatever the roll.
 *
 * Once the owner has had it, the lock is over and it is a normal special for
 * everyone (the finds say so), so an entry can stay here harmlessly or be
 * removed.
 */
export const SPECIAL_LOCKS: readonly { id: string; owner: string; ownerChance: number }[] = [
    // Guaranteed (Fwoxie, 2026-11-08): Tylina's next ping is this line.
    { id: 'set1.matikane', owner: '457773317739380738', ownerChance: 1 },
];

/**
 * Personal boosts: extra special chance on every ping for one trainer, drawn
 * from their usual special pool. A boost like the others: Boosts off pauses
 * it, and it counts toward the soft caps.
 */
export const PERSONAL_BOOSTS: readonly { owner: string; chance: number; label: string }[] = [
    // Owner, 2026-11-11: Machitan answers her biggest fan's cheers (Tannhauser, voice 91020).
    { owner: '457773317739380738', chance: 0.03, label: 'Ei, Ei, Mun!: Machitan cheers on her Leading Mambologist!' },
    // Owner, 2026-11-12: two at +1.5% each (3% in all). Tachyon hums "fuun", calls the
    // trainer Guinea Pig-kun, and aims 更にその先 ("even beyond that": past faster-than-light,
    // voice 91001); Win Variation dreams of the principal role (ballet).
    { owner: '340238209147600897', chance: 0.015, label: "Faster Than Light: Fuun... for once, Tachyon's experiment takes Guinea Pig-kun 更にその先!" },
    { owner: '340238209147600897', chance: 0.015, label: "Principal's Pirouette: Win Variation cheers you up with a heartfelt valse!" },
];

/** The special with id `id`, or undefined. */
export function specialById(id: string): (Special & { set: string }) | undefined {
    return RARE_OPENERS.find((o) => o.id === id);
}

/**
 * The sets that `opener` unlocks for a trainer whose locked sets are
 * `lockedSets`: those still locked whose prerequisite is this special. Empty
 * for a common line, or when the trainer already had it.
 */
export function setsUnlockedBy(opener: string, lockedSets: readonly string[]): SpecialSet[] {
    const id = specialIdOf(opener);
    return id ? SPECIAL_SETS.filter((s) => s.requires === id && lockedSets.includes(s.id) && !s.paused) : [];
}

/** The id of the special whose current text is `text`, or undefined. */
export function specialIdOf(text: string): string | undefined {
    return RARE_OPENERS.find((o) => o.text === text)?.id;
}

/** Where special media files live: `src/assets/specials` in development, `dist/assets/specials` when built. */
export const SPECIAL_MEDIA_DIR = path.join(__dirname, '..', '..', 'assets', 'specials');

/** The media file posted with `opener` (a special's text), as a full path, or null. */
export function specialMediaPath(opener: string): string | null {
    const media = RARE_OPENERS.find((o) => o.text === opener)?.media;
    return media ? path.join(SPECIAL_MEDIA_DIR, media) : null;
}

/**
 * The specials still closed to a trainer who has found `foundIds`: those
 * with an `after` they have not all found.
 */
export function closedSpecials(foundIds: ReadonlySet<string>): string[] {
    return RARE_OPENERS.filter((o) => o.after?.some((id) => !foundIds.has(id))).map((o) => o.text);
}

/**
 * What a roll on `text` gives a trainer who has found `foundIds`: the line
 * itself if it is open, else (following `after`) the first special it waits
 * on that they have not found, itself redirected the same way.
 */
export function redirectOpener(text: string, foundIds: ReadonlySet<string>): string {
    let special = RARE_OPENERS.find((o) => o.text === text);
    for (let hops = 0; special?.after && hops < RARE_OPENERS.length; hops += 1) {
        const missing = special.after.find((id) => !foundIds.has(id));
        if (!missing) break;
        special = specialById(missing);
    }
    return special?.text ?? text;
}

/** The credit shown under `opener`'s media, or null. */
export function specialCredit(opener: string): string | null {
    return RARE_OPENERS.find((o) => o.text === opener)?.credit ?? null;
}
