import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { SPECIAL_SETS } from './openers';
import { NOTIFICATION_LIFETIME_MINUTES, TRAINING_MINUTES } from './service';

/**
 * A trainer's own timer settings, from the panel's Settings button:
 *
 *   - DM me too: the expiry ping also goes to their DMs.
 *   - Early riser: 49-minute runs instead of 50, and their pings are cleared
 *     sooner (4 minutes instead of 5), to suit someone who is there on time.
 *   - Boosts: on by default. Off, no boost applies (a set's boost, early
 *     start) and a set boost's remaining runs are paused.
 *   - Special sets: each can be turned off, on its page of the Specials
 *     list (`set:<id>` here); a set turned off never comes up.
 *
 * Shown only to the trainer, as buttons that flip each setting in place.
 */

/** Run length for an early riser, in minutes. */
export const EARLY_RISER_MINUTES = 49;

/**
 * How long an early riser's ping stays before it is deleted, in minutes. Their
 * run is a minute shorter, so this is 3 minutes past a normal run's end.
 */
export const EARLY_RISER_NOTIFICATION_MINUTES = 4;

/** A trainer's settings, with the defaults filled in. */
export interface UserSettings {
    dmPing: boolean;
    earlyRiser: boolean;
    boosts: boolean;
    disabledSets: string[];
}

/** The settings of a trainer; the defaults when they never changed any. */
export async function getUserSettings(guildId: string, discordUserId: string): Promise<UserSettings> {
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } });
    return { dmPing: row?.dmPing ?? false, earlyRiser: row?.earlyRiser ?? false, boosts: row?.boosts ?? true, disabledSets: row?.disabledSets ?? [] };
}

/** Run length for a trainer, in minutes. */
export function runMinutes(settings: UserSettings): number {
    return settings.earlyRiser ? EARLY_RISER_MINUTES : TRAINING_MINUTES;
}

/** How long a trainer's ping stays before it is deleted, in minutes. */
export function pingMinutes(settings: UserSettings): number {
    return settings.earlyRiser ? EARLY_RISER_NOTIFICATION_MINUTES : NOTIFICATION_LIFETIME_MINUTES;
}

/** Custom ID prefix of the settings buttons. Starts with `timer:` so the panel's handler gets them. */
export const SETTINGS_PREFIX = 'timer:settings:';

/** Flips one setting, by the key in a settings button's custom ID: `dm`, `early`, `boosts`, or `set:<id>`. Returns the new settings. */
export async function toggleSetting(guildId: string, discordUserId: string, key: string): Promise<UserSettings> {
    const current = await getUserSettings(guildId, discordUserId);
    const next = { ...current };
    if (key === 'dm') next.dmPing = !current.dmPing;
    else if (key === 'early') next.earlyRiser = !current.earlyRiser;
    else if (key === 'boosts') next.boosts = !current.boosts;
    else if (key.startsWith('set:')) {
        const id = key.slice(4);
        if (SPECIAL_SETS.some((s) => s.id === id)) {
            next.disabledSets = current.disabledSets.includes(id) ? current.disabledSets.filter((s) => s !== id) : [...current.disabledSets, id];
        }
    }
    await prisma.timerUserSettings.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, discordUserId, ...next },
        update: next,
    });
    return next;
}

/** A settings button: green and "On" when on, grey and "Off" when off. */
function toggleButton(key: string, label: string, on: boolean): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`${SETTINGS_PREFIX}${key}`)
        .setLabel(`${label}: ${on ? 'On' : 'Off'}`)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

/** The Settings screen: what each setting does, and a button to flip each. Special sets are turned on and off in the Specials list. */
export function settingsView(settings: UserSettings) {
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle('Your Trainer Timer settings')
        .setDescription(
            [
                `**DM Me Too**: the pings arrive here *and* in your DMs. Double efficiency!`,
                `**Early Riser**: You get notified after ${EARLY_RISER_MINUTES} minutes. To encourage your punctuality, your pings clear after ${EARLY_RISER_NOTIFICATION_MINUTES} minutes instead of ${NOTIFICATION_LIFETIME_MINUTES}!`,
                `**Boosts**: extra special chance from specials, early starts and seasonal events. Off pauses them. See yours with **Boosts**.`,
                `**Special sets**: turn them on or off in **Specials**.`,
                '-# Changes apply from your next run.',
            ].join('\n'),
        );
    const rows: ActionRowBuilder<ButtonBuilder>[] = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton('dm', 'DM Me Too', settings.dmPing), toggleButton('early', 'Early Riser', settings.earlyRiser), toggleButton('boosts', 'Boosts', settings.boosts)),
    ];
    return { embeds: [embed], components: rows };
}
