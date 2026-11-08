/** Timer-ping openers, common and rare. Kept apart so the scheduler and the rare tally share them. */

/**
 * Openers for an expiry ping. {user} is the trainer's mention; it leads
 * most lines but can sit anywhere. Written by the server's staff: keep the
 * wording as given.
 */
export const PING_OPENERS: readonly string[] = [
    '{user} Time! Your Independent Training is complete!',
    '{user} The timer has reached zero! Go again?',
    '{user} Training complete! Prepare yourself for the next one!',
    '{user} Excellent! Your run is done! Rest a moment, then go again!',
    '{user} Tick tock, the clock has reached its end!',
    '{user} Your uma has been calling; get back to her soon!',
    '{user} Trainer-san, the training has been completed. Please get back to your uma soon.',
];

/**
 * A boost a special gives the trainer who gets it: for the next `runs`
 * pings, an extra `chance` (on top of the usual special chance) of a
 * special from the same set carrying `tag`. Getting it again restarts the
 * count; it does not stack.
 */
export interface SpecialBoost {
    tag: string;
    chance: number;
    runs: number;
}

/** One special line. `{user}` is the trainer's mention; `{set_name}` is its set's name. */
export interface Special {
    /** Shown in the Specials lists once found. Also the key a set's `requires` names. */
    name: string;
    text: string;
    /** Labels a boost can draw on, e.g. `collab`. */
    tags?: readonly string[];
    boost?: SpecialBoost;
}

/** One special set: a group of special lines that can be turned on or off. */
export interface SpecialSet {
    /** Stable id, stored in trainers' settings; never rename one in use. */
    id: string;
    /** Shown in Settings. */
    name: string;
    /**
     * The name of a special in another set. Until a trainer has found it,
     * this set is locked for them: its lines never come up and its toggle
     * is greyed out.
     */
    requires?: string;
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
        name: 'Set 1',
        openers: [
        { name: 'Matikanetannhauser', text: "Wasshoi~ *trips* Oooooow!... ooh- *tears up, sniffles*, I'm okay, {user}! You're here now! Please come take a look at your trainee!" },
        { name: 'Overslept?!', text: '{user} zzzzzzzzz- OOOH AEUHHHH! Oh, right. Trainer, trainer, the timer!' },
        { name: 'Agnes Tachyon', text: '{user} Hayaku, はやく! Tachyon is hungry, so get to finishing the training and cook her some food! And then some guinea pigging activities too...' },
        { name: 'Mihono Bourbon', text: "{user} Master-san, I have been provided intel of your underling's completion. Please proceed at haste. I will provide chocolate afterwards." },
        { name: 'Rulership', text: "{user} Yada yada yadaaaaaaaaaaa! Why are you ignoring me?! Didn't you promise you'd game with me after finishing the run?! Where are you at HAEH? Get back here, you gotta play with 「dominare」! YADAAAAAA! >.<" },
        { name: 'Aston Machan', text: '{user} *tugs at shirt* Machan wants your attention...  can we hang out after you finish the run...' },
        { name: 'Taiki Shuttle', text: "Torena-san, there's a new burger place in town! I'll ask El and Grass to come too, so come with me, okay {user}? We can host a party afterwards too! I can't wait..." },
        { name: 'Mejiro Family', text: 'The Mejiro Estate welcomes your return, {user}. Please attend to your trainee as soon as possible. We have provided detailed updates on her development.' },
        { name: 'Rice Shower', text: "{user} Onii-samaaa~ I don't want to cause much trouble, but the independent run has finished! Will you come take a look with me?" },
        { name: 'Symboli Rudolf', text: 'Your trainer has declared her in-dependence from the pack. A mare-velous revolution. ...ehem. Anyways, please look into it, {user}.' },
        { name: 'Air Groove', text: '...Teio probably heard one of her *horrible* jokes again, so you will have to excuse this da- *meeting*... as I cater to her, {user}. Want to come to my garden later?' },
        { name: 'Tokai Teio', text: "I don't want to have to wait for my leg! I want to meet your trainee! Teio wants to runnnn >.< Can I meet her, please {user}?" },
        { name: "Curren Chan", text: "{user}-channnn~! Here you are! Heard you've been handling #Trainee runs, but see, Curren has #DefinitelyAccidentally leaked that you're #TheBestManager that Tracen has so... You're coming with me, #SpecialCollabs full week! #LookAtCurren #ManagerDebut" },
        ],
    },
    {
        id: 'online-sensations',
        name: '#OnlineSensations',
        requires: 'Curren Chan',
        openers: [
            { name: "Celebrate", text: "{user}, it's time to #Celebrate! It took so much #Preparation but we finally got #ThreeMillionFollowers on release! Thank you for being my #FavoriteManager, and it's time to get a bazillion more! #WorkHard" },
            { name: "For Your Eyes Only", text: "{user}, it's such a long dayyyy~ #SoTired It was fun but a #DozenDresses takes so long for the producers... So I just want to *closes door behind* show you something #ForYourEyesOnly~\n...ya like it, m'fated #BelovedManager? shh, it's only for you now... and maybe when we truly #BecomeAPair~" },
            { name: "Copano Rickey", text: "Hey {user}, have you seen that #Viral Umastagram photo? The #Rickey☆Buzz one? She wanted to raise 15 million #ChristmasOrnies... Either way, that's why we're streaming with her to garner more support! Here comes the #FengShui train! #CurrenxRickey #RickeyLuckyHappy", tags: ['collab'] },
            { name: "Loves Only You", text: "#Woah #Surprised Loves? What are you doing here?! I'm surprised you'd be #WalkingAround- oh my god you're #LiveStreaming! {user}, get in here! Introducing to everyone, #TheBestManager that Tracen can ask for! And also mine~ #CurrensManager #CurrenxLoves\n-# {user} became so famous that even Montjeu #L'ArcChampion requested a collaboration! For the next 50 runs, gain a 4% chance of getting a #SpecialCollab in {set_name}.", tags: ['collab'], boost: { tag: 'collab', chance: 0.04, runs: 50 } },
            { name: "Tosen Jordan", text: "You know Tosen right? Yeah, her #FancyNails are amazing! Look how that fits her #CircusCostume though! We *have* to make one- yes {user}-chan... #ComeOn have you not seen Gojo-kun?! You can do the same! #CurrenxTosen #IWantGojoKun #MakeMeMarin", tags: ['collab'] },
            { name: "Gold City", text: "Ugh, I want to actually do a #RealCollab with Gold City but she's always busy... Last time she even asked if you'd be her #UmastaCameraman; when are you doing *my* photos huh {user}-chan? Come onnn, at least act like a #RealMan~ #CityWaitingRoom #SpoilYourPrincess", tags: ['collab'] },
            { name: "Transcend", text: "Transcend said thanks for the collab, {user}-chan! Her followers went #Explosive overnight, and she called Curren a total #Charisma~ Now she's offering a whole jar of #Hachimi for intel on #TheBestManager... sorry Trans-chan, that scoop is #NotForSale! #CurrenxTranscend", tags: ['collab'] },
            { name: "Smart Falcon", text: "#TwoTrillionFans has become so popular #OhMyFreakinGod! Smart Falcon is so #UmadolFamoussss it's insane! {user}, we have to come support one of her #GrandLive concerts, please please-please#PWEASE! I will even do #ProperTraining this time! #FalconConcertIncoming #MoodBoost", tags: ['collab'] },
            { name: "Hishi Akebono", text: "{user}-chan, have you thought of #VarietyPosting? Yeah, Akebono is soooo good at it #Exasperated (It's a #FancyWord I just learned!) Yes {user}, we must do something #NewAndCool today- What do you mean we have #StaminaTraining?! Nooooo! #ReleaseCurren", tags: ['collab'] },
            { name: "Taiki Shuttle", text: "Ugh, Taiki just doesn't #NoticeMyRivalry at all! She's so #PartyFun and her Texan burgers are so #Deliciousss... That's right! {user}, time to make some noise in UmaTube! Surely we can get a collab out of her! #MakeCurrenNoticeableAgain", tags: ['collab'] },
            { name: "Biko Pegasus", text: "Biko's got a new #UmaTokPost? Oh my GAWDDD I love Biko! Have you seen her animations? Her #PowerRanger series is also soooo cool... wait... You got me a #RangerCollab?! No weiii! (#PalmerHelios taught me that!) Thank you shooo much {user}! Time to get my #DressUp ready! #CurrenxBiko #PinkRanger", tags: ['collab'] },
            { name: "Daitaku Helios", text: "Wei weeeiiii! {user}, I've heard of how gyatdamnnn vibey you are! So here's the thing Torepiii *wink*: Gold City and I have been doing a pretty s'mexy looksmaxxing Zombie☆Makeover, and I think Curren be such a cutieee, frfr! I'll be looking for six or seven- HAHAH SIX SEVENNN- more ladies, so hook me up... and also ||teach me how to bag Daiichi-ojou too pweaseee!|| See ya, Helios☆Out! #LookAtHelios #ScaryCurren #DoveyVibey", tags: ['collab'] },
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
export const RARE_OPENER_CHANCE = 0.04;

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
export function pickOpener(r: number, rarePool: readonly string[] = RARE_PING_OPENERS): string {
    if (r < RARE_OPENER_CHANCE && rarePool.length > 0) {
        return rarePool[Math.min(rarePool.length - 1, Math.floor((r / RARE_OPENER_CHANCE) * rarePool.length))]!;
    }
    // A rare roll with every special set off falls back to a common line.
    const share = r < RARE_OPENER_CHANCE ? r / RARE_OPENER_CHANCE : (r - RARE_OPENER_CHANCE) / (1 - RARE_OPENER_CHANCE);
    return PING_OPENERS[Math.min(PING_OPENERS.length - 1, Math.floor(share * PING_OPENERS.length))]!;
}

/** The special texts in the sets that are neither turned off (`disabledSets`) nor locked (`lockedSets`). */
export function rarePoolFor(disabledSets: readonly string[], lockedSets: readonly string[] = []): string[] {
    return RARE_OPENERS.filter((o) => !disabledSets.includes(o.set) && !lockedSets.includes(o.set)).map((o) => o.text);
}

/** The special that grants `boost` (by text) and the set it draws from, or undefined. */
export function boostOf(text: string): { set: string; boost: SpecialBoost } | undefined {
    const special = RARE_OPENERS.find((o) => o.text === text);
    return special?.boost ? { set: special.set, boost: special.boost } : undefined;
}

/**
 * The lines a set's boost draws on: that set's specials with the boost's
 * tag, except the one that grants it, so a boost never renews itself.
 */
export function boostPool(setId: string, tag: string): string[] {
    return RARE_OPENERS.filter((o) => o.set === setId && o.tags?.includes(tag) && !o.boost).map((o) => o.text);
}

/**
 * Specials locked to one trainer until that trainer has found them:
 *
 *   - nobody else can get it: their special share (4%) is spread evenly
 *     over the other specials;
 *   - the owner gets it at `ownerChance` per ping (2%), and the rest of
 *     their special share (the other 2%) is spread evenly over the other
 *     specials. Their total special chance stays 4%.
 *
 * Once the owner has had it, the lock is over and it is a normal special for
 * everyone (the finds say so), so an entry can stay here harmlessly or be
 * removed.
 */
export const SPECIAL_LOCKS: readonly { name: string; owner: string; ownerChance: number }[] = [
    { name: 'Matikanetannhauser', owner: '457773317739380738', ownerChance: 0.02 },
];
