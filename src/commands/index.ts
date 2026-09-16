import { Collection, ChatInputCommandInteraction, AutocompleteInteraction, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import * as clubRole from './role';
import * as threadTag from './setTag';
import * as club from './club';
import * as timer from './timer';

export interface Command {
    data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

commands.set(clubRole.data.name, clubRole as Command);
commands.set(threadTag.data.name, threadTag as Command);
commands.set(club.data.name, club as Command);
commands.set(timer.data.name, timer as Command);