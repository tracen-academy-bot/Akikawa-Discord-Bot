import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/prisma';
import { SPECIAL_SETS } from './openers';
import { NOTIFICATION_LIFETIME_MINUTES, TRAINING_MINUTES } from './service';

/**
 * A trainer's own timer settings, from the panel's Settings button:
 *
 *   - DM me too: the expiry ping also goes to their DMs.
 *   - Early riser: 49-minute runs instead of 50, and their pings are cleared
 *     sooner (2 minutes instead of 3), to suit someone who is there on time.
 *   - Special sets: each can be turned off; a set turned off never comes up.
 *
 * Shown only to the trainer, as buttons that flip each setting in place.
 */

/** Run length for an early riser, in minutes. */
export const EARLY_RISER_MINUTES = 49;

/** How long an early riser's ping stays before it is deleted, in minutes. */
export const EARLY_RISER_NOTIFICATION_MINUTES = 2;

/** A trainer's settings, with the defaults filled in. */
export interface UserSettings {
    dmPing: boolean;
    earlyRiser: boolean;
    disabledSets: string[];
}

/** The settings of a trainer; the defaults when they never changed any. */
export async function getUserSettings(guildId: string, discordUserId: string): Promise<UserSettings> {
    const row = await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } });
    return { dmPing: row?.dmPing ?? false, earlyRiser: row?.earlyRiser ?? false, disabledSets: row?.disabledSets ?? [] };
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

/** Flips one setting, by the key in a settings button's custom ID: `dm`, `early`, or `set:<id>`. Returns the new settings. */
export async function toggleSetting(guildId: string, discordUserId: string, key: string): Promise<UserSettings> {
    const current = await getUserSettings(guildId, discordUserId);
    const next = { ...current };
    if (key === 'dm') next.dmPing = !current.dmPing;
    else if (key === 'early') next.earlyRiser = !current.earlyRiser;
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

/** The Settings screen: what each setting does, and a button to flip each. */
export function settingsView(settings: UserSettings) {
    const embed = new EmbedBuilder()
        .setColor(0xf2a87a)
        .setTitle('Your Trainer Timer settings')
        .setDescription(
            [
                `**DM Me Too**: the pings arrive here *and* in your DMs. Double efficiency!`,
                `**Early Riser**: You get notified after ${EARLY_RISER_MINUTES} minutes. To support your efforts, your pings clear after ${EARLY_RISER_NOTIFICATION_MINUTES} minutes instead of ${NOTIFICATION_LIFETIME_MINUTES}!`,
                `**Special sets**: turn a set off and its specials never come up for you.`,
                '-# Changes apply from your next run.',
            ].join('\n'),
        );
    const rows: ActionRowBuilder<ButtonBuilder>[] = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton('dm', 'DM Me Too', settings.dmPing), toggleButton('early', 'Early Riser', settings.earlyRiser)),
    ];
    for (let i = 0; i < SPECIAL_SETS.length && rows.length < 5; i += 5) {
        rows.push(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                ...SPECIAL_SETS.slice(i, i + 5).map((set) => toggleButton(`set:${set.id}`, set.name, !settings.disabledSets.includes(set.id))),
            ),
        );
    }
    return { embeds: [embed], components: rows };
}
