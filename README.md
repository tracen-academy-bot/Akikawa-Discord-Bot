# Akikawa Discord Bot

Club management bot for the Tracen Academy Umamusume Discord.

## Setup

```bash
cp .env.example .env    # then fill it in
npm install
```

## Running

### Docker (recommended)

```bash
docker compose up --build
```

Migrations are applied automatically by `docker-entrypoint.sh` before the bot
starts. Set `DATABASE_URL` host to `postgres` (the Compose service name), not
`localhost`.

### Local

```bash
npx prisma migrate deploy    # required — creates the tables
npm run deploy-commands      # register slash commands with Discord
npm run dev
```

> **If every `/club` command fails**, the database is almost certainly not
> migrated. The bot now detects this at startup and logs it explicitly; run
> `npx prisma migrate deploy`. See `DEVELOPMENT_LOG.md` for the full write-up.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm run deploy-commands` | Register slash commands |
| `npm run prisma:migrate` | Create and apply a migration (development) |

Set `DEV_GUILD_ID` to register commands to a single guild instantly; leave it
empty to register globally, which can take up to an hour to propagate.
