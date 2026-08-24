import { EmbedBuilder } from 'discord.js';

export const COLORS = {
    success: 0x57f287,
    error: 0xed4245,
    info: 0x5865f2,
} as const;

export function successEmbed(title: string, description?: string): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(COLORS.success).setTitle(title).setTimestamp();
    if (description) embed.setDescription(description);
    return embed;
}

export function errorEmbed(description: string): EmbedBuilder {
    return new EmbedBuilder().setColor(COLORS.error).setTitle('Error').setDescription(description).setTimestamp();
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(COLORS.info).setTitle(title).setTimestamp();
    if (description) embed.setDescription(description);
    return embed;
}