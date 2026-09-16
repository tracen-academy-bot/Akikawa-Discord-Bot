# Development Log

Newest first. Each entry records what changed and, more importantly, why.

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
