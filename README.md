# Akikawa Discord Bot

Club management bot for the Tracen Academy Umamusume Discord.

## Setup

```bash
cp .env.example .env    # then fill it in
npm install
```

## Running

### Railway

See [`docs/deploying.md`](docs/deploying.md). Two services: this repo and a
Postgres database. `railway.json` pins the Dockerfile builder so migrations run
on deploy — do not remove it.

### Docker (recommended for local)

```bash
docker compose up --build
```

Migrations are applied automatically by `docker-entrypoint.sh` before the bot
starts. Set `DATABASE_URL` host to `postgres` (the Compose service name), not
`localhost`.

### Local

```bash
npx prisma migrate deploy    # required — creates the tables
npm run dev                  # slash commands register themselves on start
```

> **If every `/club` command fails**, the database is almost certainly not
> migrated. The bot now detects this at startup and logs it explicitly; run
> `npx prisma migrate deploy`. See `DEVELOPMENT_LOG.md` for the full write-up.

## Independent Training timer

`/timer panel` posts the control panel (Club Managers only). Pin it.

| Action | Effect |
| --- | --- |
| **Start** | Begins a 50-minute run, or resets the one you have |
| **Stop** | Cancels your run; it does not count |
| **My Stats** | Your statistics card |
| **Leaderboard** | This week's standings, live |

Also available as `/timer stats [trainer]` and `/timer leaderboard [period]`
(this week live, last week final, last 30 days, all time).

### Rewards

Weeks run Monday 00:00 to Sunday 24:00 JST. Club Managers set them up:

- `/timer rewards top_role:<role> channel:<channel>`: the week's top 3 by
  runs get the role about 15 minutes after the week ends, and last week's
  holders lose it. The week's final leaderboard posts in the channel, pinging
  the winners. With no options it shows the setup and the live top 3;
  `off:true` stops it. The first setup awards last week straight away and
  posts its board, so set the role and the channel in the same command.
- `/timer publish [channel] [ping]`: posts last week's final leaderboard
  once, now: in the given channel, else the rewards channel, else where it
  is used. It pings the top 3 unless `ping:false`. It does not change roles.
- `/timer milestone add runs:<n> role:<role>`: a role kept for good at `n`
  completed runs, given the moment someone reaches it (and straight away to
  everyone already past it). `/timer milestone remove runs:<n>` stops it.

The bot can only give roles below its own highest role.

Timers are stored in Postgres, so a run that ends while the bot is offline
still pings you when it comes back, and still counts toward your streak.
Streak days are bucketed in `TIMER_STREAK_TIMEZONE` (default `Asia/Tokyo`).

## Club fan tracking

Backed by the [uma.moe](https://uma.moe) API, which needs an API key — the
circle endpoints reject unauthenticated callers. Set `EXTERNAL_API_KEY`.

| Command | Purpose |
| --- | --- |
| `/fans report` | Club quota leaderboard |
| `/fans trainer` | One trainer's report |
| `/fans benchmark` | Top 10 / 30 / 100 cutoffs |
| `/fans link` | Link a Discord account to a uma.moe trainer |
| `/fans circle add\|config\|sync\|list` | Manage tracked circles (Club Managers) |

Report and alert channels can be threads. The daily job pulls from uma.moe and
posts reports automatically; see `docs/quota-math.md` for how every column is
derived and verified.

When anyone is behind, the alert lists them by name and pings the club's staff
roles (its Trainer and Assistant roles, or the roles set in `/club admin`).
Trainers themselves are not tagged. Club Managers pick how often in
`/club admin`: daily, every 3 days, weekly, or never. For the ping to notify, each staff
role must be mentionable, or the bot needs the "Mention @everyone, @here, and
All Roles" permission.

The report image comes in several themes (`PALETTES` in
`src/lib/image/theme.ts`) and two layouts: tall (one column, for phones)
and wide (three panels, for computers). A club's staff pick both in the
`/club reports` form, with the report time and time zone. At least one
layout must be ticked; ticking both posts a tall and a wide image with every
report. Changing the look replies with the current report in it, and
`Default` goes back to Rose. The quota is set in the `/club fancount` form
(a bare number is millions; empty clears it), and the expected rank by Club
Managers in `/club admin`.

Behind-quota alerts post in the club's report channel. A separate alert
channel can still be set with `/fans circle config alert_channel:` or on the
dashboard.
`scripts/palettes.ts` renders a preview of every theme and checks contrast.

## Dashboard

Runs inside the bot process — no second container. Set `DISCORD_CLIENT_SECRET`,
`DASHBOARD_BASE_URL` and `DASHBOARD_GUILD_ID` to enable it; leave them blank
and the bot starts without it. Session cookies are signed with a key derived
from `DISCORD_TOKEN`, so no separate secret is needed.

Add `<DASHBOARD_BASE_URL>/auth/callback` to your Discord application's OAuth2
redirect URIs. Any guild member can read; only `OFFICER_ROLE_IDS` holders can
change anything.

## Tests

```bash
DATABASE_URL=postgresql://... npm test
```

Both suites run against a real Postgres and clean up after themselves. Point
them at a scratch database, not production.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm run deploy-commands` | Register slash commands without starting the bot (not needed for a normal deploy) |
| `npm run prisma:migrate` | Create and apply a migration (development) |
| `npm test` | Run the timer and scheduler test suites |

The bot registers its slash commands on every startup. Set `DEV_GUILD_ID` to
register to a single guild instantly; leave it empty to register globally,
which can take up to an hour to propagate.
