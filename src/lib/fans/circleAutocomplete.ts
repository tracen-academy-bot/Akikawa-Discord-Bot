import type { AutocompleteInteraction } from 'discord.js';
import { prisma } from '../../db/prisma';

/** Autocompletes tracked circles for this guild by name. */
export async function autocompleteTrackedCircle(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused().toLowerCase();

    const circles = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId ?? '' },
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
