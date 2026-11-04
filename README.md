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
- `/timer panel`: posts the live leaderboard (this week on the left, today
  on the right) with the timer panel under it, at the bottom of the channel.
  Running it again deletes the old pair and posts a fresh one there. The
  board redraws itself after runs finish (at most every 30 seconds) and at
  midnight JST. When the weekly results or `/timer publish` post in the same
  channel, the pair is reposted under them.
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
Trainers themselves are not tagged. It posts with each report; the club's
staff or a Club Manager can untick it in `/club reports` to post the picture
only, with no pings and no list. For the ping to notify, each staff
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

## Club applications

Posts in the application forum (`FORUM_CHANNEL_ID`, #apply-for-club) are
handled by the bot. When a post opens, it finds the trainer ID (9 to 12
digits) in the title or the body. The ID can be bare, in brackets, in
groups split by spaces or dashes (`[467 492 654 277]`), in four groups of
three split by commas or dots (`467,492,654,277`), or in full-width digits.
With no ID, the bot pings the applicant to send it, and picks it up when
they reply in the post. Once it has the ID, it scouts the trainer on
uma.moe:

- **In the post:** the trainer's card. It shows fans per day over the last
  30 days as a line, the 3- and 6-month averages, and a table of the last
  months. The table lists the club, that club's rank that month, fans
  gained, average fans per day while in the club (with the days), and how
  they compare with an average member (with place). 100% means an average
  member's share. Only members still in the club at month end count: anyone
  who left or was kicked is removed from both the fans and the headcount.
  The comparison covers only the days the trainer was in the club, so a
  mid-month joiner is compared fairly.
- **In #recruitment** (`RECRUITMENT_CHANNEL_ID`): one live board, edited in
  place on every change. **Available** lists open applications, oldest
  first: the applicant, their 30-day pace, how long the post has been open,
  and the post. **Going to** lists accepted applicants who have not closed
  their post yet, grouped by club. Rejected, closed and joined applications
  are not on it.
- **In #serious-discussion-only** (`STAFF_DISCUSSION_CHANNEL_ID`): the card
  and the pace, pinging the recruiting role of each tier tag the post has,
  exactly. S+ and S ping "S recruiting", A+ pings "A+ recruiting", A pings
  "A recruiting", and B+ and Casual ping "Casual recruiting". The roles are
  found by name, and a role that does not exist is skipped.

| Command | Who | Purpose |
| --- | --- | --- |
| `/scout [id]` | Everyone | A trainer's card. In a post, it re-scouts the post or sets its ID. |
| `/resolve outcome:<club or Rejected> [note]` | A club's staff, Club Managers | Decides the post: tags it, locks it and posts the decision. Accepting needs the trainer ID; rejecting does not. Staff accept into their own club only. Accepting gives the applicant the club's role and takes off their other club roles and Tracen Applicant; visas and other roles stay. |
| `/close` | The applicant, club staff | Closes the post (archives it). An accepted post becomes Joined, and the applicant's Discord is linked to their trainer, as `/uma-id` does. |
| `/applications backfill` | Club Managers | Imports every old post (open and archived) and matches each applicant to uma.moe and our clubs. Replies with a summary and a CSV. |

The backfill uses one uma.moe profile request per trainer, about 3 per
second, so a few hundred posts take a few minutes. It decides each post's
status in this order:

1. **Joined:** the trainer is in one of our clubs now.
2. **Accepted:** the post has an accepted tag. The club recorded is the
   latest of ours they were in since posting.
3. **Rejected:** the post has a rejected tag.
4. **Closed:** the post is archived or locked with no decision tag, so the
   outcome is unknown.
5. **Open:** none of the above.

It posts nothing per post. Old posts still open appear on the recruitment
board, which it refreshes once at the end. A second run imports only posts
with no row yet. For
posts already done (any status except Open) whose trainer uma.moe knows, it
links the applicant's Discord to the trainer.

Links are made only when a post is closed, never while it is open, and an
existing link is never overwritten: not the member's, and not one another
member already has for that trainer.

The club's role is the one in `CLUB_ROLE_IDS` whose name matches the
club, by the same name matching as staff roles; Trainer, Assistant and
Visa roles are never it. If no role matches, or two do, nothing is changed
and the staff member who resolved is told why. The bot's own role must sit
above the club roles.

A locked post has no message box for the applicant, so the decision comes
with a **Close post** button. Applicants use that button, not `/close`.

Averages are per calendar day. uma.moe's own `avg_daily` divides by days
with a gain, which flatters trainers who skip days. Daily figures come from
the `daily_fans` of each circle the trainer was in. Where uma.moe has a gap
(no snapshot, often a circle it does not track), the rise across the gap is
spread evenly over its days, and the card says which days. The month table
shows totals, not per-day figures. Club rank badges come from
`src/assets/ranks/<RANK>.png` (`B_PLUS.png`, `D_PLUS.png`, `SS.png`); a rank
without a picture (none since 2026-11-04; all of D to SS have one) is drawn
as an outlined label. Months uma.moe
has no record of are left out of the averages, not counted as zero. The
first month on record is also left out, because it may be partial.

`/club poster [channel]` draws every club with a tier on one picture, for
#club-bio. The picture shows tiers, avatars, expected ranks, quotas and open
spots. It does not update itself; run it again after clubs change.

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
