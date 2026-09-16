# Communications Log

Decisions that changed project direction. Newest first.

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
