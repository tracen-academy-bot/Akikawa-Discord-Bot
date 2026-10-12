import * as fs from 'fs';
import * as path from 'path';
import { nameWords } from './clubLinks';

/**
 * Club avatars: fixed files in `assets/clubs`, one per club, named after it
 * (`cosmos.png`). A club gets the file whose name is one of the words of its
 * own name, so "Cosmos" and "Team Cosmos" both find `cosmos.png`. A name that
 * matches two files gets neither, rather than the wrong one. Adding or
 * renaming a club's picture is a change to that folder.
 */

const AVATAR_DIR = path.join(__dirname, '..', 'assets', 'clubs');

let files: Map<string, string> | null = null;
const bytes = new Map<string, Buffer>();

/** Avatar files by lower-case base name, read once. */
function avatarFiles(): Map<string, string> {
    if (files) return files;
    files = new Map();
    try {
        for (const entry of fs.readdirSync(AVATAR_DIR)) {
            if (entry.toLowerCase().endsWith('.png')) files.set(entry.slice(0, -4).toLowerCase(), path.join(AVATAR_DIR, entry));
        }
    } catch {
        // No folder: no avatars.
    }
    return files;
}

/** Path to a club's avatar, or null when none matches its name exactly once. */
export function clubAvatarPath(clubName: string): string | null {
    const available = avatarFiles();
    const hits = [...new Set(nameWords(clubName))].filter((w) => available.has(w));
    return hits.length === 1 ? available.get(hits[0]!)! : null;
}

/** A club's avatar as PNG bytes, or null. Cached after the first read. */
export function clubAvatar(clubName: string): Buffer | null {
    const file = clubAvatarPath(clubName);
    if (!file) return null;
    let data = bytes.get(file);
    if (!data) {
        data = fs.readFileSync(file);
        bytes.set(file, data);
    }
    return data;
}
