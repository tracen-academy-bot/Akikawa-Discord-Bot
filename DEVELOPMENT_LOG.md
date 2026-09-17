# Development Log

Newest first. Each entry records what changed and, more importantly, why.

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
