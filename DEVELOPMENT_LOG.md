# Development Log

Newest first. Each entry records what changed and, more importantly, why.

---

## 2026-10-04 — /fans check all, club and me

The club asked for quota checks grouped by who runs them, rather than an
`all` flag that would be easy to fire by accident. `/fans check` is now a
group:

- `all` (Club Managers): syncs every active circle and posts each report and
  alert to its configured channels, or into the current channel as a public
  follow-up when it has none; the caller gets a private summary, and one
  circle failing does not stop the rest. Discord turns the first follow-up
  after a deferred reply into an edit of that reply, so the private reply is
  filled in before the first follow-up is sent.
- `club` (that club's Trainers and Assistants, and Club Managers): run in a circle's thread,
  syncs that circle and posts its report and alert there, publicly.
- `me` (everyone): run in a circle's thread, shows the caller's own progress
  privately. It replaces `/fans me`.

A thread belongs to the circle whose report or alert channel it is. "Trainer"
is the `/club` role, so a circle has to be linked to its club record first:
`/fans circle config club:` sets the link (`None` unlinks). Until a circle is
linked, only Club Managers can run `club` on it. The club's Assistants may run
it too (asked for after the first version allowed Trainers only).

`club` also runs in #staff-commands (`1427571157120450733`, overridable with
`STAFF_COMMANDS_CHANNEL_IDS`; empty means the default). There is no thread
to name the circle, so it is the one linked to the caller's own `/club`, or
the one given with the new `circle:` option, which Club Managers and staff on
several clubs need. Permission is checked against that circle the same way,
and the report posts in the staff channel.

---

## 2026-10-04 — Daily, weekly and biweekly quotas are checkpoints, not resets

The first version of quota periods measured each week or day on its own:
totals reset at every boundary and people were judged against a pro-rated
share every day. The club's actual rule is different. Totals are always
month-to-date, the requirement steps up by one quota at each period end (14M
weekly is 14M due by day 7, 28M by day 14; 2.5M daily is 2.5M by end of day
1, 5M by day 2), and nobody is reported until a checkpoint has passed.

`computeCircleProgress` keeps its MONTH path exactly as it was (the reference
rows still reproduce) and computes checkpoint periods separately: the last
checkpoint passed, the next one, what was due and what will be due, with the
day in progress never judged (`currentDay`, passed in for the current month).
The daily job's alert now posts only on the day after a checkpoint closes; a
manual `/fans check` always includes it. The dashboard and image show every
column in every period and a "next check end of day N · X due" line.

---

## 2026-10-04 — /fans me and /fans trainer find the circle themselves

In a server tracking several circles, `/fans me` refused to run without a
`circle` option, though the caller's trainer link already says who they are.
Both commands now look up the circles the trainer is currently in
(`circlesForTrainer`, using the same membership rule as the reports, so a
circle they left does not match). `/fans me` shows one card per circle;
`/fans trainer` uses the first by name. Naming a circle still works.

---

## 2026-10-04 — /fans check and /fans me

Asked for an on-demand quota check like another bot's `/force_check`, plus
a personal version. `/fans check` (Club Managers) syncs the circle from
uma.moe, then posts the report image and the behind-quota alert exactly as
the daily job does: to the configured channels with a private confirmation,
or into the current channel when none is set. If the sync fails or no key
is set, it reports from stored data and says so. To share that path, the
scheduler's `postReport` was split into `buildCircleReport` (render and
alert text) and the posting itself. The alert now gives the true number of
trainers behind rather than the number listed, which is capped at ten.

`/fans me` shows the caller's own window total, expectation, status, rank
among current members, need per day and projection, privately. A trainer who
has left is told they are not a current member.

A bare quota under 1,000 was briefly going to be refused as a probable
missing "M" (Primrose's quota is stored as 90). Dropped before shipping:
quotas are taken literally, and some circles deliberately use tiny quotas
for one-fan checks. No code path drops a typed suffix; Primrose was saved as
"90" and needs re-entering as 90M.

---

## 2026-10-04 — Leavers no longer count; fans count only while in the circle; biweekly quotas

People who had left a circle were still in its report. uma.moe keeps a leaver
in that month's member list with zeros from the day they left, and the bot
never deleted the rows it had already stored, so every leaver kept their
partial month in the table, the circle total and the circle target. A data
probe of 30 top circles' September payloads confirmed the shape (leavers
trailing zeros, joiners leading zeros, no mid-month gap shared by a whole
circle) and showed two things the spec does not: `daily_fans` has 32
entries, not 31, and a member can carry negative values in a circle they are
not really in. Negatives were already dropped at ingest.

`metrics.ts` now works out membership from the snapshots themselves.
`circleSnapshots` marks which indices the circle has at all, and
`isCurrentMember` drops anyone without a value at the latest one, before any
figure is computed. `monthGains` takes that mask and counts a day only when
the member had a snapshot at both ends of it, so a joiner counts from
joining, a returning member loses the gap and anything earned during it, and
a gap the whole circle shares still reads as a skipped scrape that catches
up. Quota days follow the same mask. The trainer report returns nothing for
a leaver, and the benchmark's club line uses current members only. For
members present all month nothing changes, so the 24 reference rows still
reproduce. Past months follow the same rule, so a September report no longer
lists people who left during September.

A BIWEEKLY quota period joins DAY, WEEK and MONTH: days 1-14, 15-28, then a
2-3 day stub whose goal scales, the same restart-on-the-1st rule as weeks.
The enum migration only adds a value. Windows are labelled by the weekly
weeks they cover, so the stub reads "Week 5 · days 29–31" in both modes.

---

## 2026-10-01 — Fans this month were lifetime totals; hourly sync and history backfill

Production showed fish@duck with 1,122,234,894 fans on game day 1, while
uma.moe's own page showed a monthly gain of +258,774. uma.moe's `daily_fans`
are lifetime counts, and the bot had treated them as counts that restart each
month. The API spec also says the game month starts on the 2nd JST, which is
why the first snapshot is a starting value with no gain of its own.
`monthGains` in `metrics.ts` now subtracts each member's starting snapshot,
and the member table, trainer report and the benchmark's club line all go
through it. It also records each member's first owing day explicitly, so a
trainer who earned nothing on their first days still counts as present.
Stored rows did not change, so no data migration was needed. Rewritten in
lifetime form, the reference fixture still reproduces all 24 rows exactly,
and a check uses the fish@duck numbers to assert +258,774.

`currentGameMonth` now rolls over on the 2nd JST like uma.moe, so on the 1st
the dashboard still shows the month that is ending, and report dates put game
day 1 on the 2nd.

uma.moe refreshes live figures hourly for most circles (every 5 minutes for
the top 100), so the scheduler now syncs every active circle and the
benchmark hourly and still posts reports once a day. Past months are
imported once per circle (`backfillOnce`), newest first, up to 12 months or
until uma.moe returns an empty month, without overwriting the circle's
current name or rank. The hourly job runs it for every circle, including ones
added before this change, and adding a circle starts it at once. Creating the
`backfill:<id>` JobRun marker acts as the lock, so concurrent callers cannot
double-import or throw. `scripts/test-backfill.ts` covers this against a
local stand-in for uma.moe.

---

## 2026-10-01 — Incident: restart loop after the master merge

After the merge into master, production restart-looped with "FATAL: Discord
login failed: Used disallowed intents" and the site returned 502. The merge
asked for MessageContent on the first connection attempt, and that toggle is
off in the developer portal. The intent fallback added in the same merge never
ran, because with @discordjs/ws 1.2.x a refused intent can surface as
`login()` rejecting, and startup treated every login rejection as fatal. The
earlier incident notes said login never rejects; I relied on that without
testing the refusal path.

`connect()` in `src/lib/startup.ts` now returns 'disallowed-intents' for
either signal (the 4014 close event or that rejection) and rethrows anything
else, and startup uses it for every attempt. Four new checks in
`test-startup` cover it, including the exact production rejection. I also ran
the built bot with `login()` stubbed to refuse MessageContent: it logged which
toggle to enable, fell back to Guilds + GuildMembers, and `/healthz` returned
200 with `messageContentIntent: false`.

---

## 2026-10-01 — Daily, weekly or monthly quotas

### Why

Requested: "allow daily/weekly (cuts off on the 1st too) or monthly". Decided
with the user: weeks are days 1-7, 8-14, ... of the game month; the short
final week's goal scales by its days; the quota is entered per period.

### What

- `TrackedCircle.quotaPeriod` (`DAY` | `WEEK` | `MONTH`, default `MONTH`).
  The amount field is `quota` in code but keeps its `monthlyQuota` column via
  `@map`, so the migration only adds the enum and column; no data moves.
- `computeCircleProgress` measures inside the current window; see the new
  section in `docs/quota-math.md`. `CircleProgress` gains `period`, `quota`,
  `windowStart`, `windowEnd`, `windowLabel`.
- `/fans circle add|config` take `period`; the dashboard forms get a "Per"
  selector. An omitted period keeps the current one on update.
- Reports say "weekly report", show the window ("week 2 · days 8–14") and
  flag a scaled short week. DAY mode hides avg/day, need/day, latest-day gain
  and projection, which would only repeat the day's total or its shortfall. Applied to the current
  report design; the visual redesign is held back separately.
- `parseQuota` also accepts thousands separators ("80,000,000", "1,500M").
  K/M/B suffixes already worked.

### Verified

37 new metric checks (window edges incl. February and short weeks, weekly and
daily pace, mid-week joiner, rank reset), 5 parser checks, 8 dashboard checks
(set, reject, keep period). MONTH reference rows unchanged. Weekly and daily
reports rendered through the real maths and inspected.

---

## 2026-10-01 — Fix: adding a circle failed with "Cannot convert undefined to a BigInt"

### Root cause

uma.moe's OpenAPI spec marks **no** property as required, but
`src/lib/umamoe/types.ts` typed optional fields as `T | null`, i.e. always
present. `syncCircle` guarded `previous_circle_id` and `next_month_start` with
`=== null`; when uma.moe omitted them, `undefined` passed the guard and
`BigInt(undefined)` threw. Adding a circle runs a sync immediately and rolls
back on failure, so the error surfaced on the dashboard's add-circle form.

Reproduced end to end: a local fake uma.moe returning a member without those
fields makes the old `syncCircle` fail with exactly that message against a real
Postgres; the fixed one writes the rows with `null`.

### Fix

- Every uma.moe field is now `?: T | null`, so the compiler flags any unsafe
  use. It found ~20, all in `ingest.ts`, `client.ts` and `/fans circle search`.
- `normalizeMember` (pure, tested) resolves one raw member: absent = `null`,
  no `viewer_id` = skipped, missing year/month = the requested month.
- A response with no `circle` object now fails with a readable message.
- `scripts/test-fans.ts` gains 10 checks for omitted fields.

Also carries the September date-bomb fix for `scripts/test-fans.ts` (see the
redesign entry), since CI on this branch is red without it from 2026-10-01.

---

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
  Intents). Without it `;role` stays off. Since the merge into master the bot no
  longer fails to log in over it: startup steps down `INTENT_LADDER` in
  `src/index.ts` and logs which intent to enable; `/healthz` reports
  `messageContentIntent`.
- Dyno still answers `;` with its deprecation notice. Change or disable Dyno's prefix,
  or set `COMMAND_PREFIX` to something else.

**Verification**
- `tsc --noEmit` passes with zero errors once `prisma generate` has run.
  (`prisma generate` needs `DATABASE_URL` set, even a placeholder, because
  `prisma.config.ts` uses `env()`; the Dockerfile already sets one.)
- `ts-node src/index.ts` compiles and reaches Discord login with the env vars set.
- An earlier note here claimed `tsc` and `ts-node` were broken. That was wrong: both
  failures came from the test sandbox (no `DATABASE_URL`, a test file outside `src/`).

---

## 2026-09-19 — Incident: restart loop after enabling the GuildMembers intent

### What happened

Requesting the `GuildMembers` intent took the bot offline. It is a privileged
intent that must also be enabled in the Discord developer portal; it was not,
so Discord refused the gateway connection. Two follow-up fixes ("exit with a
clear message", then "fall back to base intents") both changed nothing,
because both keyed off `client.login()` rejecting — and it never does.

### Root cause

`discord.js/src/client/websocket/WebSocketManager.js`, lines 249–259: on an
unrecoverable close code (4014 DisallowedIntents among them) the manager sets
the shard to `Disconnected`, emits `shardDisconnect`, logs at debug level, and
**returns**. No throw, no rejection, no `ready`. The process sat un-ready
forever. The dashboard — and with it `/healthz` — was started inside the
`ClientReady` handler, so nothing ever bound the port. Railway's health check
failed after 300 s, the container was killed and restarted, and the public URL
alternated between a hard timeout and a 502 indefinitely.

Two independent mistakes compounded: assuming a library rejects on failure
without checking, and coupling HTTP liveness to Discord readiness.

### Fix

- `src/lib/startup.ts`: `waitForConnectOutcome(client)` listens for `ready`
  and for unrecoverable `shardDisconnect` codes and resolves to `ready`,
  `disallowed-intents` or `fatal`. Recoverable blips are ignored.
- `start()` races that against `login()`. On `disallowed-intents` it destroys
  the client, logs the exact portal path, and reconnects with the base
  intents. On `fatal` it exits naming the token.
- The dashboard starts **before** any login, bound to a getter for the current
  client. `/healthz` answers from the first second and reports
  `discord: false` until the gateway is up. A Discord failure now degrades one
  feature instead of taking the container down.
- Tested without a network by driving a bare `Client`'s emitter (8 assertions,
  including that the helper's listener is removed on settle, measured against
  discord.js's own baseline listener).

Both newest migrations were replayed against a production-shaped database
while diagnosing, to rule them out. They apply cleanly.

### Correction to the diagnosis

While waiting for the fix to deploy I read a second cause into the timing --
a ~2-minute 502 window looked like the entrypoint's migration retry loop, so
I proposed a stuck migration (P3009) on the production database. That was
wrong. When the fix finally went live, `/healthz` showed migrations applied on
attempt 1. The real reason the fix "wasn't working" was simpler: five pushes
in 25 minutes, and Railway builds them sequentially at 3–5 minutes each, so
the commit I was probing for had not been deployed yet. The gateway-hang root
cause was correct; the migration theory was over-fitted to timing.

The migration-in-process change stands regardless: it made `/healthz` show
the answer directly, which is what ended the guessing.

### Also this session

- CI added: Postgres service, migrate, typecheck, all suites, build, and a
  Docker image build with a font-registration smoke test inside the image. The
  first run proved the Dockerfile builds; the only failure was the smoke test
  running through the migration entrypoint, fixed with `--entrypoint node`.
- `/fans circle debug` and stored transfer signals, for the late-joiner
  question.

---

## 2026-09-19 — Dashboard retheme, training heatmap, monthly rank

### Dashboard

Moved onto the same system as the rendered images: IBM Plex served to the
browser from the bundled files via `/fonts`, the theme palette in CSS,
tracked uppercase headings, flat hairline panels, placement tints and the
"behind" bar as a left border on table rows, em dashes for empty cells.

Added: sortable tables (a tiny dependency-free script; numeric cells compare
as numbers after stripping separators, dashes sort last), a month picker on
the circle page backed by `listCircleMonths`, and the projected column. The
training table now resolves display names through the bot's member cache
rather than printing raw IDs.

Verified by driving the real app in headless Chromium against seeded data and
inspecting every page. Playwright is installed with `--no-save` for that, so
it stays out of `package.json`.

### Training heatmap

`getHourlyHeatmap` buckets completed runs by weekday and hour in the streak
timezone; the stats card draws it as a 7×24 grid under the bar chart. Tested
with runs that cross the date line: Monday 15:30 UTC lands on Tuesday 00h JST,
Sunday 14:00 UTC on Sunday 23h JST. Without that, the heatmap would be offset
by nine hours and show people training at times they were asleep.

### Monthly rank

`syncCircle` received uma.moe's `monthly_rank` and discarded it, so every
report header read "UNRANKED". Stored on `TrackedCircle` (nullable, additive
migration) and passed to all three render sites.

---

## 2026-09-19 — Visual restyle and richer reports

### Direction

Reference supplied by the user: uma-legends-cup's race tables. Monospace
throughout, tracked uppercase headings, one accent (gold) for structure and
targets, red reserved for a single meaning, warm near-black, placement tints on
a left bar, em dashes for empty cells. Every renderer now sits on
`src/lib/image/theme.ts`, which owns the palette and the text helpers.

### Fonts

IBM Plex Mono (Latin, digits) and IBM Plex Sans JP (CJK), bundled in
`src/assets/fonts` and registered at import. One superfamily, so mixed-script
rows read as a single face. Plex Mono's digits are tabular by nature; canvas
cannot toggle `tnum`, so a proportional face would make numeric columns wobble.
Details in `docs/fonts.md`.

### Additions (no extra API calls; all derived from ingested data)

**Fan report** — seven-day sparkline per member scaled to their own range, so
it shows the shape of the week rather than magnitude; straight-line month-end
projection per member and for the club; a club-wide progress bar with a tick
at where the club *should* be today, so it reads as pace rather than
accumulation. Club-level figures stay in millions throughout.

**Trainer report** — rank and percentile in the circle, best single day this
month, consecutive days at or above the daily quota, and the daily quota drawn
as a guide line on the chart so each day is read against the target.

**Benchmark** — the club overlaid as a fourth series, with its current
fans/member/day and where that places it ("outside top 100"). Turns "what does
it take" into "where are we".

### Fixes found while restyling

- Chart point labels collided with the legend when the peak sat at the top of
  the plot. The plot now reserves headroom when point labels are on.
- A patch script swapped a colour literal before a regex that matched on it,
  leaving the club directory on the old gradient. Replaced with a flat fill.

### Not restyled

Rank tier badges and headcount bar colours on the club directory encode
meaning (tier, fill level) and were left alone.

---

## 2026-09-19 — Removed the session secret; commands self-register

### `DASHBOARD_SESSION_SECRET` is no longer required

Asking an operator with no terminal to "generate 32 random bytes" was a bad
requirement. The bot already holds a secret nobody else has — its Discord
token — and anyone in possession of that token owns the bot outright, so
deriving the cookie-signing key from it adds no new attack surface.

The key is `HMAC-SHA256(DISCORD_TOKEN, "akikawa:dashboard-session:v1")`, not
the raw token, so what ends up in cookie signatures cannot be replayed against
Discord. Rotating the bot token rotates the key and signs everyone out, which
is the right outcome. An explicit `DASHBOARD_SESSION_SECRET` still overrides
the derivation, for anyone who wants sessions to survive a token rotation.

Verified: dashboard starts without the variable; derived key is 64 hex chars,
stable across loads, distinct per token, and not equal to the token; a cookie
sealed with it verifies through the real app; explicit override wins.

### Slash commands register on startup

`npm run deploy-commands` from a developer's machine is no longer part of a
deploy. The bot bulk-PUTs its command set on `ClientReady`, using the
application ID from the logged-in client. Idempotent, so every boot simply
re-asserts the set. Failure is logged, not fatal. The script remains for
pushing commands without starting the bot.

---

## 2026-09-17 — Hosting on Railway

Everything runs in one process, so Railway needs two services: this repo and a
Postgres database.

### `railway.json` is load-bearing

Railway's default builder ignores the `Dockerfile`. The `Dockerfile`'s
entrypoint is what runs `prisma migrate deploy`, so building with anything else
would leave the schema empty and reproduce the original P2021 outage exactly.
`builder: "DOCKERFILE"` is pinned to prevent that.

Also set: `sleepApplication: false` (a sleeping container drops the gateway and
stops the schedulers), `numReplicas: 1` (timer delivery is already
exactly-once via `DELETE … RETURNING`, but two replicas would race the daily
job marker and could double-post reports), and a health check with a 300s
timeout for the migration step on a cold deploy.

### Port binding

The dashboard read `DASHBOARD_PORT` only. Every PaaS injects `PORT` and routes
traffic to it — binding anything else means the health check never connects and
no traffic arrives. Precedence is now `PORT` → `DASHBOARD_PORT` → `3000`, and
the server binds `0.0.0.0` explicitly rather than loopback.

`DASHBOARD_BASE_URL` now falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, so the
OAuth callback URL does not have to be hand-copied and kept in sync. An
explicit value still wins, for custom domains and local runs.

### `/healthz`

Unauthenticated and registered before every other route — a probe that
redirected to the login flow would read as unhealthy and restart-loop the
container. It checks the database as well as the process, so a deploy that
cannot reach Postgres fails loudly.

This was validated by accident: Postgres stopped mid-session and the endpoint
correctly returned `503 {"ok":false,"error":"database unreachable"}`, then
`200 {"ok":true,"discord":true}` once it came back.

### Removed Redis

`ioredis` and the Compose `redis` service were never imported anywhere in
`src/`. On Railway that would have been a third service costing money to sit
idle. Dependency and service both dropped; lockfile verified in sync so
`npm ci` still succeeds.

### Not verified here

No Docker daemon in this environment, so the image was not built. Verified
instead: the entrypoint is valid `sh`, both font packages resolve in Debian,
the lockfile matches `package.json`, TypeScript compiles, and all 272
assertions pass. The first Railway build is the real test of the image.

---

## 2026-09-16 — Dashboard, and two more startup bugs

### Dashboard

Self-hosted, Discord OAuth, running **inside the bot process**. One container,
one connection pool, and no way for the dashboard's view of the data to drift
from the bot's. Disabled unless configured, so the bot still starts without it.

Sessions are a signed, stateless cookie: nothing to lose on restart, no session
store, and the Discord access token is used once during callback and then
discarded rather than being kept in the cookie.

Charts on the dashboard are the bot's own PNG renderers served as `<img>`, so
every figure has exactly one implementation.

Reading is open to any guild member. Every mutation requires a Club Manager
role **and** a CSRF token. `scripts/test-dashboard.ts` drives the real app over
HTTP and covers the parts that are expensive to get wrong:

| Concern | Covered |
| --- | --- |
| Anonymous access | pages redirect, images refuse, no data leaks |
| Forged cookie | tampered signature rejected |
| Role separation | members cannot see or perform mutations |
| CSRF | missing and wrong tokens both refused, state unchanged |
| XSS | a circle named `<script>alert(1)</script>` renders escaped |
| Open redirect | `https://evil` and `//evil` both refused |
| Tenancy | another guild's circle is a 404 |
| Bad input | non-numeric IDs 404 rather than crash |

42 assertions, all passing.

### Second startup bug: /settag crashed the whole bot

Found while smoke-testing the compiled build. With `TAG_TRANSFER_ID` or
`TAG_CLUB_APP_ACCEPTED_ID` unset, `setTag.ts` passed `{ value: undefined }` to
`addChoices`, which throws inside discord.js option validation **at module
load** — the process died before it ever signed in, with a
`@sapphire/shapeshift` stack trace that named neither `/settag` nor the missing
variable.

Same class as the P2021 outage: a one-line configuration problem presenting as
an opaque failure somewhere else entirely.

Fixed three ways:

1. **`src/lib/env.ts`** validates the environment at startup and reports every
   missing variable at once, in plain language, separating what stops the bot
   from what merely disables a feature. Imported before the command modules,
   since several read configuration at load time.
2. **`setTag.ts`** builds its choice list only from IDs that are configured,
   and skips `addChoices` entirely when none are. An unconfigured tag now
   simply does not appear.
3. The command checks at runtime that the chosen tag is configured.

### Third bug: /settag wiped a thread's existing tags

`setAppliedTags([tagId])` replaced every tag on the thread, while the code
immediately above computed `newTags` (append) and checked it against Discord's
five-tag limit. The computed value was discarded, which also made that limit
check unreachable. Now applies `newTags`.

Also fixed: the five-tag guard replied and then fell through to reply a second
time, throwing `InteractionAlreadyReplied`.

### Test suite

`npm test` — 272 assertions across five suites, all passing:

| Suite | Assertions | Covers |
| --- | --- | --- |
| metrics | 148 | quota maths against a real reference report |
| fans | 34 | snapshot round-trip, quota parsing, gap handling |
| dashboard | 42 | auth, CSRF, XSS, redirects, tenancy |
| timer | 33 | streaks, leaderboards, lifecycle |
| scheduler | 15 | offline recovery, exactly-once delivery |

---

## 2026-09-16 — Independent Training timer

A 50-minute Independent Training timer with a button panel, persistence across
restarts, and statistics.

### Fixed duration, on purpose

The timer models one specific game mechanic, so there are no custom or preset
durations. `TRAINING_MINUTES` is a constant, not configuration.

### Timers survive downtime

The reference bot discards any timer that reaches zero while it is offline.
Ours does not. Timers are rows in Postgres, never in-process `setTimeout`
handles, and the scheduler is a 10-second poll over an indexed `expiresAt`
column. On boot the first tick runs immediately, so everything that came due
during downtime is delivered at once. The ping says so explicitly:

> This run ended about 40 minutes ago while the bot was offline. It still counted.

Runs are credited to their scheduled `expiresAt`, not to delivery time, so a
late ping cannot distort daily counts or streaks. `deliveryLagS` records the
gap for diagnostics.

Expiry claiming uses a single `DELETE ... RETURNING` statement. Two overlapping
ticks therefore cannot both claim the same timer and double-ping a trainer.

### Engagement

Statistics exist to make accumulated effort visible:

- `/timer stats` renders a card: total runs, current streak, runs this week,
  total time trained, guild placement, and a 14-day bar chart.
- `/timer leaderboard` renders a ranked table with bars scaled to the leader,
  over 7 / 30 / all-time windows.
- Expiry pings call out run milestones (1, 10, 25, 50, 100, 250, 500, 1000,
  2500) and new personal-best streaks.
- The panel shows a live roster, runs completed guild-wide today, and who is
  leading today.

Streaks are bucketed by calendar day in `TIMER_STREAK_TIMEZONE` (default
`Asia/Tokyo`, matching the game reset), not UTC. A streak stays alive if the
trainer trained yesterday but not yet today, so it is not reported as broken
partway through a day.

### Panel

Countdowns use Discord relative timestamps (`<t:unix:R>`), which tick client
side, so the roster stays live without the bot editing the message on a timer.
Buttons route by custom ID rather than through a component collector, so panels
posted before a restart keep working afterwards.

### Notification cleanup

Expiry pings are deleted after 10 minutes. Pending deletions live in their own
table rather than on the timer row, so a trainer can start their next run the
instant they are pinged instead of waiting out the notification's lifetime.

### Tests

`npm test` runs both suites against a real Postgres.

- `scripts/test-timer.ts` — 33 assertions covering streaks (gaps, multiple runs
  per day, month boundaries, yesterday-anchored streaks), leaderboard windows,
  ranking, and the start/reset/stop lifecycle. All passing.
- `scripts/test-scheduler.ts` — 15 assertions driving the real scheduler with a
  stub Discord client, covering offline expiry recovery, in-progress timers
  being left alone, exactly-once delivery across ticks, lag recording, and
  notification auto-deletion. All passing.

---

## 2026-09-16 — Fix: every Prisma-backed command failed

### Symptom

`/club list` and `/club create` both replied with the embed
`Error — Something went wrong running that command.` Other commands that never
touch the database (`/role`, `/settag`) kept working.

### Root cause

Prisma error **P2021**: `The table 'public.Club' does not exist in the current
database.` Reproduced locally against a real Postgres 16 instance by running
the exact queries both subcommands issue.

Nothing in the deployment path ever applied migrations:

- `npm ci` triggers `postinstall` → `prisma generate`, which only generates the
  TypeScript client. It never contacts the database.
- The `Dockerfile` went straight from `npm run build` to `node dist/index.js`.
- `docker compose up` creates an **empty** `pgdata` volume on first boot.

So the container started fine, logged in to Discord, registered commands, and
then failed on the first query against a table that had never been created.
Both failing commands hit Prisma before doing anything else, which is why they
failed identically while the non-database commands were unaffected.

### Fixes

1. **`docker-entrypoint.sh` (new)** — runs `prisma migrate deploy` before
   `exec`ing the bot, with bounded backoff retries so a slow Postgres on first
   boot does not crash-loop the container. This is the actual fix.
2. **`Dockerfile`** — `ENV DATABASE_URL=<placeholder>` became `ARG`. As an
   `ENV` it was baked into the runtime image, where it would satisfy the bot's
   `if (!process.env.DATABASE_URL)` guard while pointing at a database that
   does not exist. That turned a loud misconfiguration into a silent one.
3. **`docker-compose.yml`** — `depends_on` now waits on a Postgres
   `healthcheck` (`condition: service_healthy`) instead of mere container
   start, removing the boot race.
4. **`src/db/prisma.ts`** — added `assertDatabaseReady()`, which checks
   connectivity and verifies the `Club` table exists via `to_regclass`.
   Called on `ClientReady`; a failure logs a specific reason and exits, so the
   restart policy retries and the container log states the problem on line one.
5. **`src/lib/errors.ts` (new)** — classifies thrown errors into actionable
   messages. Known Prisma and Discord REST codes get a specific explanation;
   anything else gets a short incident ID that is also written to the log for
   correlation. This is the meta-fix: the generic message is what made a
   one-line configuration problem expensive to diagnose.
6. **`.env.example` (new)** — `src/db/prisma.ts` told users to "see
   .env.example" but the file did not exist. Documents every variable and calls
   out that inside Compose the database host is `postgres`, not `localhost`.

### Verified

| Database state | `assertDatabaseReady()` |
| --- | --- |
| Migrated | passes |
| Reachable, no tables | fails with "not migrated: the Club table does not exist. Run `npx prisma migrate deploy`" |
| Server down | fails with Prisma P1001, classified as "Database Unreachable" |

After `prisma migrate deploy`, both originally failing queries succeed.

### Also corrected

`src/lib/api.ts` sent `Authorization: BEARER <key>`. uma.moe's OpenAPI spec
(`https://uma.moe/api/docs/openapi.yaml`) declares `ApiKeyAuth` as
`in: header, name: X-API-Key`. The old header would have been ignored and every
call rejected with `403 browser_proof_required`. Not the cause of this outage —
nothing calls this module yet — but the same class of latent bug.
