# Deploying to Railway

The whole bot — gateway client, timer scheduler, daily fan sync and dashboard —
runs in **one process**. Railway therefore needs exactly two services: this
repo, and a Postgres database.

## Why `railway.json` exists

Railway's default builder ignores the `Dockerfile`. That matters more than it
sounds: the `Dockerfile`'s entrypoint is what runs `prisma migrate deploy`
before the bot starts. Build with anything else and migrations never run, the
schema stays empty, and every `/club` and `/fans` command fails with Prisma
P2021 — the exact outage this project already fixed once.

`railway.json` pins `builder: "DOCKERFILE"` so that cannot happen. Do not
remove it.

The same file also sets:

| Setting | Why |
| --- | --- |
| `sleepApplication: false` | A sleeping container drops the Discord gateway connection and stops the schedulers. Timers would still be recovered on wake, but pings would arrive late and the daily sync could be skipped entirely. |
| `numReplicas: 1` | Timer delivery is already exactly-once across instances (`DELETE … RETURNING`), but two replicas would race the daily job marker and could double-post reports. |
| `healthcheckPath: /healthz` | Checks the database too, so a deploy that cannot reach Postgres fails loudly instead of quietly serving errors. |
| `healthcheckTimeout: 300` | Migrations run at boot; a cold first deploy needs headroom. |

## Steps

1. **Create the project** from this GitHub repo. Railway reads `railway.json`
   and builds the `Dockerfile`.

2. **Add a Postgres service** (`+ New` → `Database` → `PostgreSQL`).

3. **Reference the database** from the bot service. Add a variable:

   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```

   Use the reference, not a pasted value — Railway rotates the credential, and
   a copied string silently goes stale.

4. **Generate a public domain** for the bot service (Settings → Networking →
   Generate Domain). Do this *before* the first deploy so
   `RAILWAY_PUBLIC_DOMAIN` exists.

5. **Set the remaining variables** (see `.env.example` for the full list):

   ```
   DISCORD_TOKEN=
   DISCORD_CLIENT_ID=
   DISCORD_CLIENT_SECRET=
   DASHBOARD_SESSION_SECRET=      # openssl rand -hex 32
   DASHBOARD_GUILD_ID=
   OFFICER_ROLE_IDS=
   EXTERNAL_API_KEY=              # uma.moe
   ```

   `DASHBOARD_BASE_URL` and `PORT` are **not** needed. The base URL is derived
   from `RAILWAY_PUBLIC_DOMAIN`, and Railway injects `PORT` itself. Set
   `DASHBOARD_BASE_URL` only for a custom domain.

6. **Add the OAuth redirect** to your Discord application
   (Developer Portal → OAuth2 → Redirects):

   ```
   https://<your-railway-domain>/auth/callback
   ```

   It must match the deployed URL exactly, including scheme, or sign-in fails.

7. **Slash commands register themselves.** The bot pushes its command set to
   Discord on every startup, so there is nothing to run from your machine.
   Global registration can take up to an hour to propagate; set `DEV_GUILD_ID`
   to register to one guild instantly instead.

   `npm run deploy-commands` still exists for pushing commands without starting
   the bot, but a normal deploy never needs it.

## Deploying onto an existing database

Every migration in this repo is **purely additive** — no `DROP`, no `TRUNCATE`,
no column changes. Existing `Club` and `ClubMember` rows are untouched. The new
migrations only add tables: `TrainingTimer`, `TrainingRun`, `TimerNotification`,
`TrackedCircle`, `TrainerLink`, `FanSnapshot`, `BenchmarkSnapshot`, `JobRun`.

There is one case that needs a manual step. Prisma refuses to migrate a
database that already has tables but no migration history, because it cannot
tell what is already applied:

```
Error: P3005
The database schema is not empty.
```

This happens if the schema was created with `prisma db push` or by hand rather
than by `migrate deploy`. Fix it by recording the first migration as already
applied, then deploying normally:

```bash
DATABASE_URL="<railway postgres url>" npx prisma migrate resolve --applied 20260817060850_init
DATABASE_URL="<railway postgres url>" npx prisma migrate deploy
```

Both paths were verified against a real Postgres: a clean apply from empty, and
the P3005 recovery above.

To check which state a database is in:

```bash
psql "<railway postgres url>" -c 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at'
```

An error saying `_prisma_migrations` does not exist means no history — use the
baseline command above if the database also has `Club` in it, or just deploy if
it is empty.

## Verifying a deploy

```bash
curl https://<your-railway-domain>/healthz
# {"ok":true,"discord":true}
```

`ok: false` means the database is unreachable. `discord: false` means the
gateway has not connected — usually a bad `DISCORD_TOKEN`.

The deploy logs should show, in order:

```
[entrypoint] Applying database migrations...
[entrypoint] Migrations applied. Starting bot...
Logged in as <bot>#0000
Registered 5 global slash commands (propagation can take up to an hour).
Database is reachable and migrated.
Training timer scheduler started.
Dashboard listening on 0.0.0.0:<port>
```

A missing variable is named explicitly at startup rather than crashing
somewhere unrelated — see `src/lib/env.ts`.

## Cost shape

Two services: the bot (always on, so billed continuously) and Postgres. Nothing
here is bursty — the bot idles on a websocket and does real work once a day —
so usage tracks the smallest instance size Railway will give it plus the
database volume. Check current rates on [Railway's pricing
page](https://railway.com/pricing); I have not verified what your account is on.

## Local development

`docker compose up --build` still works and is unaffected by `railway.json`.
