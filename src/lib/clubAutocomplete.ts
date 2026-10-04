import { AutocompleteInteraction } from "discord.js";
import { prisma } from '../db/prisma';

export async function autoCompleteClubName(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
    // Clubs are TrackedCircle rows (with or without uma.moe tracking).
    const clubs = await prisma.trackedCircle.findMany({
        where: { guildId: interaction.guildId ?? '', name: { contains: focusedValue, mode: 'insensitive' } },
        take: 25,
        orderBy: { name: 'asc' },
    });
    await interaction.respond(clubs.map((c: { name: any; id: any; }) => ({ name: c.name, value: c.id})));
}