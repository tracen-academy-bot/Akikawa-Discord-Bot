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

/** One special set: a group of special lines that can be turned on or off. */
export interface SpecialSet {
    /** Stable id, stored in trainers' settings; never rename one in use. */
    id: string;
    /** Shown in Settings. */
    name: string;
    openers: readonly { name: string; text: string }[];
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
        { name: 'Matikanetannhauser', text: "Wassho~ *trips* Oooooow!...  ooh- My nose? It's fine, {user}! You're here now! Please come take a look at your trainee!" },
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
],
    },
];

/** Every special, all sets in order, with its set. */
export const RARE_OPENERS: readonly { name: string; text: string; set: string }[] = SPECIAL_SETS.flatMap((set) =>
    set.openers.map((o) => ({ ...o, set: set.id })),
);

/** The rare openers' texts, in list order. */
export const RARE_PING_OPENERS: readonly string[] = RARE_OPENERS.map((o) => o.text);

/** Chance, across all of them, that a ping opens with a rare line. */
export const RARE_OPENER_CHANCE = 0.04;

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

/** The special texts in the sets not in `disabledSets`. */
export function rarePoolFor(disabledSets: readonly string[]): string[] {
    return RARE_OPENERS.filter((o) => !disabledSets.includes(o.set)).map((o) => o.text);
}

/**
 * Specials locked to one trainer until that trainer has found them:
 *
 *   - nobody else can get it: their special share (4%) is spread evenly
 *     over the other specials;
 *   - the owner gets it at `ownerChance` per ping (2%), and the rest of
 *     their special share (the other 2%) is spread evenly over the other
 *     specials. Their total special chance stays 4%.
 *   - an `ownerChance` of 1 or more is a guarantee: the owner's next ping
 *     is that special, whatever the roll.
 *
 * Once the owner has had it, the lock is over and it is a normal special for
 * everyone (the finds say so), so an entry can stay here harmlessly or be
 * removed.
 */
export const SPECIAL_LOCKS: readonly { name: string; owner: string; ownerChance: number }[] = [
    // Guaranteed (Fwoxie, 2026-11-08): Tylina's next ping is this line.
    { name: 'Matikanetannhauser', owner: '457773317739380738', ownerChance: 1 },
];
