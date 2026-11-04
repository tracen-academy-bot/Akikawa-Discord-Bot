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
 * Rare openers: together they come up `RARE_OPENER_CHANCE` of the time.
 * `name` is what `/timer rares` shows for a found line, so the list does
 * not give the lines themselves away.
 */
export const RARE_OPENERS: readonly { name: string; text: string }[] = [
    { name: 'Overslept', text: '{user} zzzzzzzzz- OOOH AEUHHHH! Oh, right. Trainer, trainer, the timer!' },
    { name: 'Agnes Tachyon', text: '{user} Hayaku, はやく! Tachyon is hungry, so get to finishing the training and cook her some food! And then some guinea pigging activities too...' },
    { name: 'Mihono Bourbon', text: "{user} Master-san, I have been provided intel of your underling's completion. Please proceed at haste. I will provide chocolate afterwards." },
    { name: 'Rulership', text: "{user} Yada yada yadaaaaaaaaaaa! Why are you ignoring me?! Didn't you promise you'd game with me after finishing the run?! Where are you at HAEH? Get back here, you gotta play with 「dominare」! YADAAAAAA! >.<" },
    { name: 'Aston Machan', text: '{user} *tugs at shirt* Machan wants your attention...  can we hang out after you finish the run...' },
    { name: 'Taiki Shuttle', text: "Torena-san, there's a new burger place in town! I'll ask El and Grass to come too, so come with me, okay {user}? We can host a party afterwards too! I can't wait..." },
    { name: 'Mejiro Family', text: 'The Mejiro Estate welcomes your return, {user}. Please attend to your trainee as soon as possible. We have provided detailed updates on her development.' },
    { name: 'Matikanetannhauser', text: "Wassho~ *trips* Oooooow!...  ooh- My nose? It's fine, {user}! You're here now! Please come take a look at your trainee!" },
    { name: 'Rice Shower', text: "{user} Onii-samaaa~ I don't want to cause much trouble, but the independent run has finished! Will you come take a look with me?" },
    { name: 'Symboli Rudolf', text: 'Your trainer has declared her in-dependence from the pack. A mare-velous revolution. ...ehem. Anyways, please look into it, {user}.' },
    { name: 'Air Groove', text: '...Teio probably heard one of her *horrible* jokes again, so you will have to excuse this da- *meeting*... as I cater to her, {user}. Want to come to my garden later?' },
    { name: 'Tokai Teio', text: "I don't want to have to wait for my leg! I want to meet your trainee! Teio wants to runnnn >.< Can I meet her, please {user}?" },
];

/** The rare openers' texts, in list order. */
export const RARE_PING_OPENERS: readonly string[] = RARE_OPENERS.map((o) => o.text);

/** Chance, across all of them, that a ping opens with a rare line. */
export const RARE_OPENER_CHANCE = 0.04;

/**
 * Picks an opener from one random number: below `RARE_OPENER_CHANCE` a rare
 * one, else a common one, each evenly within its group.
 */
export function pickOpener(r: number): string {
    if (r < RARE_OPENER_CHANCE) {
        return RARE_PING_OPENERS[Math.min(RARE_PING_OPENERS.length - 1, Math.floor((r / RARE_OPENER_CHANCE) * RARE_PING_OPENERS.length))]!;
    }
    const share = (r - RARE_OPENER_CHANCE) / (1 - RARE_OPENER_CHANCE);
    return PING_OPENERS[Math.min(PING_OPENERS.length - 1, Math.floor(share * PING_OPENERS.length))]!;
}
