# Communications Log

Decisions that changed project direction. Newest first.

---

## 2026-11-08 — #OnlineSensations set; specials redesigned

- The Curren Chan collab set is final: `docs/special-sets/online-sensations.md`,
  now in code.
- Its opener (line 0) belongs to Set 1 and unlocks this set.
- Specials are redesigned for it: locked sets (prerequisites), a Boosts
  toggle, set boosts (Loves: +4% on the collab lines for 50 runs), early
  start for everyone (+1% when the next run starts within 3 minutes of the
  ping, 4 for early risers), `{set_name}`, and every `{user}` filled.
- The Specials list pages through sets with Back/Next, and each set's
  On/Off lives on its page instead of in Settings.
- Matikanetannhauser's special is reworded ("Wasshoi~ ... *tears up,
  sniffles*, I'm okay"); her finds carry over.
- `#SpecialCollab` means a collab line of the set; the 4% boost draws only
  on those.
- Curren keeps her flirty lines; that is the character. #PillowPrincess
  was dropped.

---

## 2026-11-08 — Special sets will grow; a reference to write them from

- More special sets are planned. Mejiro Family is next; others follow.
- Set 1 leans on well-known umas because the staff know few of the
  others. The JP `master.mdb` (supplied by the owner) is the source for a
  reference covering every character, so later sets can cover more of the
  roster.
- The Global mdb is not needed: JP data already has English names for all
  but 22 (mostly NPCs).
- The mdb and the full voice dump stay out of git; the English briefs and
  the scripts are in. The viewer is dark by default.

---

## 2026-11-04 — #recruitment is a board; pings are per tier

- #recruitment shows only who is available (30-day pace, time open, post)
  and where accepted applicants are going (grouped by club), as one live
  message.
- The staff notice does not list clubs whose quota the applicant clears.
  It was not wanted.
- Pings go only to the recruiting role of each tier tag. The grouped
  council roles are dropped.

---

## 2026-11-04 — Applications tie Discord to the trainer

Direction: the point of applications beyond deciding is to connect each
Discord member to their trainer when possible. Decisions:

- New applications link only when the post is closed.
- Old posts (backfill) link when they are already done.
- A post without an ID pings the applicant for it, and nothing is decided
  until it is in, except a rejection, which needs no ID.
- Of the ID-format gaps, comma/dot-grouped and full-width IDs are handled.
  Trying every number in a post until one exists on uma.moe was not wanted.

---

## 2026-11-04 — Applications move out of the forum

Direction: forum posts in #apply-for-club now hold only the applicant's
info and staff's decision. Discussion and pings move to
#serious-discussion-only, and the running list of applicants lives in
#recruitment. Staff decide with `/resolve` (a club or Rejected), which
locks the post. The applicant closes it once they have joined.

Choices Claude made that are open to change:
- The applicant's card in the post shows only their own numbers. Which
  clubs' quota they clear is shown to staff only.
- Accepting is limited to the club's own staff (and Club Managers).
  Rejecting is open to any club's staff.
- Casual maps to the casual council ping, beside B+.
- The poster is a one-off post, not part of the auto-updating directory.

Open:
- The exact pings and roles: the user will set them later. For now they are
  the existing `*_COUNCIL_ROLE_ID` variables, keyed by tier tags. The user
  added the recruiting roles held by club runners ("S recruiting", "A+
  recruiting", "A recruiting", "Casual recruiting"). They are pinged by tier
  tag too, found by name: S covers S+, and B+ goes with Casual (Claude's
  call).
- Whether the forum has a "Rejected" tag. Without one, or without
  `TAG_REJECTED_ID`, rejected posts are locked but not tagged.
- Whether the poster should replace or head the #club-bio directory.

---

## 2026-10-30 — Still in Love theme; a private send for later

Fwoxie shaped the Still in Love theme over many rounds (details in
`DEVELOPMENT_LOG.md` and `docs/still-in-love-reference.md`): she stares
rather than races, the screen reddens as more of the club falls behind,
the lace shows the club's place between the two ranks with her blue heart
gem, and her chibi stands on it, changing face with her mood. Not merged
yet.

Open:
- Keep or drop the speech bubble. Fwoxie was shown both; Claude leans to
  dropping it. The code still has it.
- "Design a private send too (for later)": not started. Read as a way to
  send a report privately (to the person asking, or a DM) instead of to
  the club channel; to be confirmed before designing.
- "Do that for Oguri too" (real online pictures for the Oguri scene):
  still unclear what to replace.

---

## 2026-10-26 — The mascot races the rank band

Verillia proposed the mascot running along the top, placed by the club's
position in its rank bracket, and Tylina liked it. Fwoxie rejected the first
cut ("that ain't it"), then came back ("i don't hate the idea"). They asked
for arrow signs, posts matching the rail, and a starting gate, and supplied a
clean chibi. Fwoxie may still redesign the band by hand.

---

## 2026-10-26 — Quota to /club fancount; /club reports is the report's form

Fwoxie asked for a tall/wide tick beside the palette choice, with at least
one required. "Both allowed" was left to Claude, and both are allowed.
Discord caps a form at 5 fields, so the first version put the theme and
layout in a new `/club look`. Fwoxie: "spread the 4 commands normally
then". So `/club reports` now holds time, zone, theme and layout, and the
quota is set with `/club fancount`. `/club admin` and `/club profile` are
unchanged. No `/club look`.

---

## 2026-10-26 — No "closest to the line"; hot streaks instead

GimmeKiss: the closest-to-the-line card felt like a shame list for people
already meeting the requirement. Fwoxie agreed and picked the proposed
replacement, a positive card: who has hit the daily rate the most days in
a row.

---

## 2026-10-24 — Expected rank is a Club Manager setting

Fwoxie: "move rank to admin", then chose to merge the report and alert
channel fields to make room. Club staff now set quota, report time and
theme; Club Managers set the expected rank and channels. Alerts default to
the report channel.

---

## 2026-10-24 — Daily target kept; alerts go to staff roles on a cadence

Fwoxie: keep Daily target ("daily target and ping when behind"); alerts
should "ping all officer roles every given time frame (day/week/none)"
instead of the normal alert; palettes should differ in background too, with
clarity first. Taken as: Behind column dropped; alerts ping each club's
staff roles (Trainer and Assistant), cadence chosen per club in
`/club admin`; nine palettes with distinct backgrounds. Fwoxie is asking
GimmeKiss what they meant about Expected. Still open: which palette, and
whether clubs pick their own.

---

## 2026-10-24 — Report feedback acted on; open questions

GimmeKiss (2026-10-23) called the report ugly and listed: the 7-day trend is
not useful; Projected is useless "because people aren't robots"; Behind and
Need/day fill the same role, keep one; Expected "is not useful stated that
way". They also asked why #24 was 619 behind but needed 7M+ a day, which
was a real bug. Fixed: the bug, trend and Projected removed, Need/day renamed
"Daily target". Cosmos (2026-10-24) expected an alert for a member the report
showed behind; Astaria confirmed it should alert, so alerts now post daily in
every period.

Open: which of Behind and Daily target to keep; what GimmeKiss meant by
Expected "like the one we have"; which palette to use (viinus's jewel tones
are one of five candidates), and whether clubs should each pick their own.

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

## 2026-11-05: Role for every club member

- Request: give a new role (1567786901140807730) to everyone holding any of the 15 club roles.
- The cloud session has no bot token, so it ships `/role give-club-members` for a manager to run.
- Follow-up: the bulk run worked (448 members). The staff asked to remove the command and to keep
  Member synced live. Rule chosen: club roles drive Member. A hand change to Member is reverted;
  removing Member never strips a club role.
