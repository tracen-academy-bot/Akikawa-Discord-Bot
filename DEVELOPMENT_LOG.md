# Development Log

## 2026-10-01 — Prefix `;role add` / `;role remove` (Dyno replacement)

**Why:** Dyno deprecated prefix commands, so `;role add <user> <role>` stopped working.
Officers still type it. Akikawa now handles it.

**Usage**
```
;role add <member> <role>
;role remove <member> <role>
```
- `<member>`: mention, ID, username, nickname, or the start of one. Quote it if it has spaces (`"Mara M"`).
- `<role>`: mention, ID, or full/partial role name. Everything after the member is the role.
- Matching order (case-insensitive): exact, then prefix, then substring (roles only).
  Several hits in the same tier is reported as ambiguous instead of guessing.
- Needs **Manage Roles**. Prefix comes from `COMMAND_PREFIX` (default `;`).

**Files**
- `src/prefix/index.ts` — `messageCreate` dispatcher, tokenizer (supports `"quoted args"`).
- `src/prefix/role.ts` — the command.
- `src/lib/resolvers.ts` — text -> member/role. Member names use the REST member-search
  endpoint, so the privileged GuildMembers intent is NOT needed.
- `src/lib/roleAssignment.ts` — club-role rules, moved out of `src/commands/role.ts` so
  `/role` and `;role` share them.

**Behaviour changes to `/role`**
- Now refuses roles at/above the caller's highest role (Discord's own rule; owner exempt),
  roles at/above the bot's highest role, managed roles, and @everyone. Before, anyone with
  Manage Roles could hand out any role below the bot.
- Role changes now carry an audit-log reason.

**Deployment requirements**
- Enable **Message Content Intent** in the developer portal (Bot -> Privileged Gateway
  Intents). Without it the bot fails to log in with "Used disallowed intents".
- Dyno still answers `;` with its deprecation notice. Change or disable Dyno's prefix,
  or set `COMMAND_PREFIX` to something else.

**Verification**
- `tsc --noEmit` passes with zero errors once `prisma generate` has run.
  (`prisma generate` needs `DATABASE_URL` set, even a placeholder, because
  `prisma.config.ts` uses `env()`; the Dockerfile already sets one.)
- `ts-node src/index.ts` compiles and reaches Discord login with the env vars set.
- An earlier note here claimed `tsc` and `ts-node` were broken. That was wrong: both
  failures came from the test sandbox (no `DATABASE_URL`, a test file outside `src/`).
