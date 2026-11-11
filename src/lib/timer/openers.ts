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
        // Paused (owner, 2026-11-10): no new finds until the lines are redesigned.
        paused: true,
        openers: [
            { id: 'mejiro.grandmother', name: "Grandmother", text: "Ah. So you are {user}, the trainer the girls cannot stop writing home about. Welcome to the Mejiro Estate. Tea will be served in the east garden at three. Do mind the pond, and do keep McQueen away from the dessert cart until after dinner; I am told she has a plan." },
            { id: 'mejiro.mcqueen', name: "Mejiro McQueen", text: "Welcome to the Mejiro Estate, {user}-san. I shall be your guide this afternoon, desu wa. The garden, the pond, the tea room... and the patisserie cart, which simply happens to lie on our route. *Ahem.* One parfait a week is perfectly reasonable. ...Is that the baseball broadcast in the parlour? N-not that I would know. Shall we?", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ryan', name: "Mejiro Ryan", text: "{user}-san! Grandmother made me wear a dress tonight... it's frilly. Very frilly. Everyone keeps saying it looks nice, but they're just being polite, right? ...Right? Ugh, this is exactly the chapter where the heroine flees to the balcony. I am not fleeing to the balcony. I'm just... getting some air.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.dober', name: "Mejiro Dober", text: "{user}, don't wander off. ...Too many people tonight, and half of them are men in suits. Not that I need you here. You're just the only one I can stand next to without my ears going flat. And if Dad calls me 'Bell-chan', you heard nothing.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.palmer', name: "Mejiro Palmer", text: "{user}! So I complimented Grandmother's gown last Christmas and she made me dance. Tonight it's your turn, I already told her. Two rules: don't step on her feet, and do NOT panic and bolt halfway through. Running away at full speed is my move.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ardan', name: "Mejiro Ardan", text: "Shall we dance, {user}-san? Only a waltz; the doctor was very clear about my legs. ...Please don't look so worried. The garden is lit for this one evening, and I intend to shine for every second of it. Sister is watching, you know. Let us give her something worth looking at.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.bright', name: "Mejiro Bright", text: "Ah~ {user}-sama, good evening~ ...Or is it morning? I napped in the sunroom and lost track~ Ryan-oneesama's dress looks lovely, doesn't it~? I sewed one just like it for Maki-chan~ Please don't tell her, it's a surprise~", after: ['mejiro.grandmother'] },
            { id: 'mejiro.ramonu', name: "Mejiro Ramonu", text: "{user}. You'll do; escort me. ...Surely you didn't think I would walk into my own family's gathering alone, dressed like this? Look, then, for as long as you like. Only know that you are my second love. The first is waiting for me on the turf.", after: ['mejiro.grandmother'] },
            { id: 'mejiro.photo', name: "The Family Photograph", text: "Everyone, gather round. Grandmother in the centre, if you would. McQueen, the cake can wait. Ryan, it looks lovely, stop tugging the hem. Dober, the camera, not the floor; nobody else is looking. Palmer, wake Bright. Ardan, beside your sister. Ramonu... yes, we know, you are radiant. And {user}, here, with the family. ...There. One for the album.", after: ['mejiro.grandmother', 'mejiro.mcqueen', 'mejiro.ryan', 'mejiro.dober', 'mejiro.palmer', 'mejiro.ardan', 'mejiro.bright', 'mejiro.ramonu'] },
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

/** The special texts in the sets that are neither turned off (`disabledSets`), locked (`lockedSets`) nor paused. */
export function rarePoolFor(disabledSets: readonly string[], lockedSets: readonly string[] = []): string[] {
    return RARE_OPENERS.filter((o) => !disabledSets.includes(o.set) && !lockedSets.includes(o.set) && !PAUSED_SETS.includes(o.set)).map((o) => o.text);
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
    { owner: '457773317739380738', chance: 0.03, label: 'Ei, Ei, Mun!: Machitan cheers on her Leading Mambologist' },
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
