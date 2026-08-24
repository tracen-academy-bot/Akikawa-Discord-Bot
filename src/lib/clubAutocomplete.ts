import { AutocompleteInteraction } from "discord.js";
import { prisma } from '../db/prisma';

export async function autoCompleteClubName(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
    const clubs = await prisma.club.findMany({
        where: { name: { contains: focusedValue, mode: 'insensitive' } },
        take: 25,
        orderBy: { name: 'asc' },
    });
    await interaction.respond(clubs.map((c: { name: any; id: any; }) => ({ name: c.name, value: c.id})));
}