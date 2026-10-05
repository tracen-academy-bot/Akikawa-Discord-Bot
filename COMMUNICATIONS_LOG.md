# Communications Log

Decisions that changed project direction. Newest first.

---

## 2026-10-05 — Rank cutoffs set; B removed

The club set each expected rank's cutoff: "S+ is top 30, S is top 100, A+ is
top 500, A is top 1000, B+ is top 3000. remove B if any. do +/- as you wish,
but don't make radius too big". Chosen: 10% either side, capped at 50 places; then, at the club's
suggestion, 475 to 525 for A+.
This replaces showing T1000 under every competitive rank.

---

## 2026-10-05 — Club directory designed; T1000 shown under competitive ranks

Shown the server's existing directory (Dia's tier posts, then per-club banner
and card posts), the club asked for it to be designed, with each club able
to edit its bio and rules. Decisions taken: tiers are set explicitly by Club
Managers (the published rank ranges overlap); requirements come from the
quota; staff come from roles and `/club member`; club staff edit their own
bio, rules and banner; the directory keeps itself up to date.

The club also asked for the T1000 requirement over the last 7 days, per day,
to appear under the expected-rank selection whenever it is not Casual. A
Discord form cannot react to a selection, so the figures sit under each
competitive option in the dropdown and in the saved confirmation instead.
Then: "you can use the last 7 days in general" (not only this month's), and
"pull the bottom 10% above and below ... top 100: get t90-110 and average ...
design numbers as you wish". Chosen: a band 10% either side, sampled at 21
places, pooled per member. T1000 is shown for every competitive rank as first
asked; other cutoffs per rank (T100 for S, say) are a small change if wanted.
The live uma.moe stats could not be checked from the session (no key).

---

## 2026-10-04 — Club staff roles matched by name; channels deferred

A Cosmos Assistant was refused by `/fans club`: the server's "Cosmos
Trainer" and "Cosmos Assistant" roles meant nothing to the bot. The club
asked for the bot to read the role IDs itself and match them to clubs, and
to connect channels the same way. Roles are now matched by name, with
`/club edit` as the override and `/club links` to check what matched. Channel
matching was built too, then the club asked to skip it and handle it later,
so home channels stay set by hand as decided at the merge.

---

## 2026-10-04 — Clubs and circles merged; live data migration approved

The club said a club and its tracked circle are the same thing and should not
be managed separately. Asked whether merging the tables was risky, the honest
answer was that the data risk is small (copy first, keep a backup table) and
the real cost is code churn. They chose the full merge. The migration that
moves the data was blocked once by the session's safety check as a
production data change; the club then approved it explicitly ("allow").

Which channel belongs to which club is set per club (home channels, threads
included) rather than guessed from channel names.

The old `Club` table survives as `Club_backup_20261004`. Once the merged data
has been checked in production, a later migration can drop it.

---

## 2026-10-04 — Leavers dropped; late-joiner question mostly closed

Asked: people who left should not count at all, and fans should count only
from when someone joins. Leavers are now removed from every figure, and a
member earns (and owes quota) only on days they were in the circle.

A read-only probe of the live API (31 circles including Primrose, using an
API key held by the cloud environment) settled most of the 2026-09-16 open
question: a joiner's values before joining are zero or negative (a count
recorded while they were in another circle), never positive, so the first
positive snapshot is the join and nothing earlier is counted.
`previous_circle_id` is unreliable for mid-month moves and is not used.

A month's last index is lower than `next_month_start` for most members. The
user confirmed this is expected: the game closes monthly counts some hours
before the next month opens, so a month ends at its last index, not at
`next_month_start` (see docs/quota-math.md).

---

## 2026-09-16 — Open question logged for the next session

`docs/quota-math.md` records one unresolved detail in the quota maths. For
members who joined a circle mid-month, the reference report computes `Expected`
over one day fewer than the member's span of fan data. The most likely rule is
days-since-joining-the-circle, which `daily_fans` alone cannot reveal.

`QuotaOptions.quotaDaysOffset` exposes the adjustment and defaults to `0`. The
effect is bounded and errs toward over-stating expectation, never toward
under-reporting who is behind.

**To close it:** capture one real `/api/v4/circles` payload for a circle with a
known mid-month transfer, and compare `previous_circle_id` against that
member's first non-zero day.

---

## 2026-09-16 — Scope set for three workstreams

**Context.** Three requests: build an autorun training timer, diagnose the
`/club` command failures, and evaluate UmaCore with a view to building our own
club fan tracker plus a self-hosted dashboard.

**Research findings.**

- **UmaCore** (`github.com/oHaruki/UmaCore`) is Python 3.10+ on PostgreSQL,
  pulls fan data from the uma.moe API daily, and ships a dashboard at
  `umacore.app`. Its image rendering is adapted from `uma-fan-tally-tool`.
  We are building our own in TypeScript to match this repo's existing stack
  rather than adopting it.
- **uma.moe has a documented API.** OpenAPI 3.1 spec at
  `https://uma.moe/api/docs/openapi.yaml`. Confirmed directly:
  - Auth is an `X-API-Key` header. Unauthenticated calls return
    `403 {"error":"browser_proof_required"}`.
  - `GET /api/v4/circles?circle_id=…&month=…&year=…` returns the circle plus a
    `members[]` array. Each member carries `viewer_id`, `trainer_name`,
    `shame_score`, and `daily_fans` — a 31-element array of **cumulative**
    daily fan totals. That array is sufficient to derive every column in the
    club leaderboard, the per-trainer report, and daily gain charts.
  - Also available: `/api/v4/circles/list`, `/api/v4/circles/rank-thresholds`,
    `/api/v4/rankings/{monthly,alltime,gains}`, `/api/v4/user/profile/{id}`.

**Decisions.**

| Question | Decision |
| --- | --- |
| Dashboard scope | Full admin — edit quotas, link trainers, manage clubs. Slash commands retained in parallel, not replaced. Per-trainer drill-down required. |
| Dashboard auth | Discord OAuth. An OAuth app already exists. |
| uma.moe API key | Obtainable. Build the scheduled live poller as the primary ingest path. |
| Timer scope | Fixed 50-minute Independent Training only. **No preset or custom durations** — the timer models one specific game mechanic. |
| Timer extras | Persist across restarts so timers that expire during downtime still fire; live roster with countdowns; statistics and leaderboards for engagement. |
| Timer chains | Deferred. Mechanism undecided. |

**Target views** (from reference screenshots):

1. Club leaderboard — per-trainer Total, Expected, Behind, Avg/Day, Need/Day,
   Day N, with an on-pace status dot.
2. `/trainer` report — stat tiles (Weekly Fans, Daily Average, Goal Progress,
   Shame Score) over a daily fan chart.
3. `/benchmark` — Top 10/30/100 entry-vs-average fans/member/day, plus a
   14-day growth chart.
