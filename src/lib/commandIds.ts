/**
 * The IDs Discord gave the slash commands when they were registered, kept so
 * messages can show a command as a mention (`</fans me:123>`), which reads as
 * the command's name and runs it when clicked.
 *
 * `registerCommands` records them on startup. Before that (or in tests) there
 * are none, and `commandMention` falls back to the name in code formatting.
 */

const ids = new Map<string, string>();

/** Records the commands as Discord returned them from registration. */
export function rememberCommandIds(registered: readonly { id: string; name: string }[]): void {
    ids.clear();
    for (const c of registered) ids.set(c.name, c.id);
}

/**
 * A command, subcommand ("fans me") or grouped subcommand ("club member add")
 * as a clickable mention, or as `/name` in code formatting when its ID is not
 * known.
 */
export function commandMention(fullName: string): string {
    const id = ids.get(fullName.split(' ')[0]!);
    return id ? `</${fullName}:${id}>` : `\`/${fullName}\``;
}
