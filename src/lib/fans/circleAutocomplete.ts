import type { AutocompleteInteraction } from 'discord.js';
import { prisma } from '../../db/prisma';
import { TRACKED } from './ingest';

/** Autocompletes tracked circles (clubs with a uma.moe circle) for this guild by name. */
export async function autocompleteTrackedCircle(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused().toLowerCase();

    const circles = await prisma.trackedCircle.findMany({
        // Fan commands only make sense for clubs with a uma.moe circle.
        where: { guildId: interaction.guildId ?? '', ...TRACKED },
        orderBy: { name: 'asc' },
        take: 25,
    });

    // Filtered in memory: a guild tracks a handful of circles, so this avoids a
    // case-insensitive LIKE for no benefit.
    const matches = circles
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((c) => ({ name: `${c.name}${c.active ? '' : ' (paused)'}`, value: c.id }));

    await interaction.respond(matches);
}
