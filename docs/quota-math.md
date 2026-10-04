# Quota mathematics

How every column of the club fan report is derived, and how those formulas were
verified.

## Source data

`GET /api/v4/circles?circle_id=…` returns each member with:

```
daily_fans: int64[32]   // the trainer's LIFETIME fan count, one snapshot per day
```

The spec says 31 elements; the live API sends 32 (index 0 plus up to 31 game
days, checked 2026-10-04).

Corrected 2026-10-01: these are lifetime counts, not counts that restart each
month. A trainer with 1.1B fans shows about 1.1B on every day. The game month
starts on the 2nd JST, so index 0 (taken on the 1st) is the month's starting
value and index $d$ is that plus everything earned over the first $d$ game
days. A member who joins mid-month has their starting value at a later index.
Days not reached, and days before the member joined, are `0`. uma.moe's own
"Monthly Gain" is the latest snapshot minus the starting value, and
`monthGains` in `src/lib/fans/metrics.ts` computes exactly that. Every formula
below works on those gains, with day numbers meaning game days.

## Definitions

Let:

- $Q$ — the configured monthly quota per member (e.g. $80{,}000{,}000$)
- $D$ — days in the game month (e.g. $30$)
- $e$ — game days elapsed: the latest index any member has a snapshot for
- $s_i$ — the index of member $i$'s starting snapshot; their first owing day is $f_i = s_i + 1$
- $d_i$ — member $i$'s data days, $d_i = e - f_i + 1 = e - s_i$
- $T_i$ — member $i$'s fans this month, $T_i = \text{daily\_fans}[e] - \text{daily\_fans}[s_i]$

## Formulas

**Quota per day** is floored, not rounded:

$$q = \left\lfloor \frac{Q}{D} \right\rfloor$$

**Effective quota** re-multiplies that floor:

$$Q_{\text{eff}} = q \cdot D$$

This matters. With $Q = 80{,}000{,}000$ and $D = 30$, $q = 2{,}666{,}666$ and
$Q_{\text{eff}} = 79{,}999{,}980$, which is $20$ fans below the configured
quota. Using the raw $Q$ makes every `Need/Day` figure disagree with the
reference report by about $2$; using $Q_{\text{eff}}$ matches it exactly.

**Expected**, **Behind**, **Average per day**:

$$E_i = q \cdot d_i \qquad B_i = \max(0,\ E_i - T_i) \qquad A_i = \left\lfloor \frac{T_i}{d_i} \right\rfloor$$

**Days remaining** includes today:

$$r = D - e + 1$$

**Need per day**, shown only when the member is behind:

$$N_i = \left\lfloor \frac{Q_{\text{eff}} - T_i}{r} \right\rfloor$$

**Latest day's gain**:

$$G_i = T_i - \text{daily\_fans}[e - 2]$$

## Verification

`scripts/test-metrics.ts` replays an actual Freakrose report — September 2026,
day 14 of 30, quota 80.0M — and asserts every derived column against the
published figures.

**24 of 24 members reproduced exactly; 148 assertions, 0 failures.**

Worked example, Jords:

| Quantity | Computation | Result | Reference |
| --- | --- | --- | --- |
| $q$ | $\lfloor 80{,}000{,}000 / 30 \rfloor$ | $2{,}666{,}666$ | — |
| $E$ | $2{,}666{,}666 \times 14$ | $37{,}333{,}324$ | $37{,}333{,}324$ |
| $B$ | $37{,}333{,}324 - 35{,}702{,}583$ | $1{,}630{,}741$ | $1{,}630{,}741$ |
| $A$ | $\lfloor 35{,}702{,}583 / 14 \rfloor$ | $2{,}550{,}184$ | $2{,}550{,}184$ |
| $N$ | $\lfloor (79{,}999{,}980 - 35{,}702{,}583) / 17 \rfloor$ | $2{,}605{,}729$ | $2{,}605{,}729$ |

## Open question: late joiners

For members present since day 1, `Expected` and `Average per day` use the same
day count, and the formulas above match the reference exactly.

For a small number of members they diverge. In the reference report one member
shows `Expected` computed over $13$ days while `Average per day` divides by
$14$; another shows $12$ against $13$. In both cases `Expected` uses exactly one
day fewer than the member's data span — but a third member present from day 1
uses the same count for both.

The most plausible explanation is that `Expected` counts **days since the
trainer joined the circle**, a signal uma.moe tracks separately (it exposes
`previous_circle_id` and `next_month_start`) and which cannot be recovered from
`daily_fans` alone. A member who transferred in on day 2 has 14 days of fan
data but has only owed this circle's quota for 13 of them.

Rather than guess, `QuotaOptions.quotaDaysOffset` exposes the adjustment
explicitly and defaults to `0`, which counts every day with data as a day the
member owed quota. The effect is bounded: a late joiner's `Expected` may read
one day's quota high, which is the conservative direction — it never
under-reports someone who is behind.

**Partly resolved (2026-10-01).** With snapshots read as lifetime counts, a
member's first snapshot is their starting value, so they owe quota for one day
fewer than their span of snapshots. That is exactly the reference's `Expected`
for late joiners, with no offset needed. The reference's `Average per day` for
those members still divides by the full span, while this bot divides by the
days owed, so a late joiner's average here can read slightly higher than the
reference's. Members present all month are unaffected.

## Membership: leavers and joiners (added 2026-10-04)

Only current members count, and only for days they spent in the circle.

uma.moe keeps a member who left in that month's list, with zeros from the day
they left (checked against 30 top circles' September data on 2026-10-04). A
member who joined mid-month has zeros before joining. Values that are not
positive (the API sometimes sends negatives for someone who is really in
another circle) are never stored, so they read as zeros too. uma.moe scrapes a
circle as a whole, so a snapshot index the circle has at all is one where
every current member has a value.

That gives the rules in `metrics.ts`:

- **Leavers are dropped entirely.** Let $L$ be the latest index any member
  has a value for. A member with no value at $L$ is not a current member and
  appears nowhere: not in the table, the circle total, the circle target, the
  trainer report or the benchmark's club line. For a past month, $L$ is the
  month's last snapshot, so someone who left before month end is dropped
  from that month too.
- **Joiners count from joining.** Their first snapshot is the baseline, so
  fans earned before they joined never count, and they owe quota from their
  first full day in the circle.
- **A gap only one member has is time outside the circle.** Nothing earned
  across it counts, they owe no quota for it, and if they come back their
  first snapshot after returning is a new baseline.
- **A gap the whole circle has is a skipped scrape.** The previous value
  carries forward and the next snapshot catches up. None were seen in the
  September scan, but the rule costs nothing.

The probe (31 circles, September and October) found 83 one-member gaps, all
in three high-churn circles, and the ones cross-checked were members hopping
to another circle and back, not missed scrapes. So treating a one-member gap
as time outside the circle is correct, not merely cautious. In the user's
circle, Primrose (130718412), the rule leaves exactly 27 current members on
3 October, matching uma.moe's `member_count`.

**Open: the last day of a month.** A month's index 30 often differs from
`next_month_start`, which equals the next month's index 0 (they matched for
273 of 908 September rows). Fans earned between those two snapshots fall in
neither month here. Whether uma.moe's own past-month "Monthly Gain" uses
`next_month_start` as the end value has not been checked.

Formally, member $i$ is in the circle on game day $d$ when they have a value at
both index $d-1$ and index $d$ (an index nobody has counts as having one).
$T_i$ is the sum of $\text{daily\_fans}[d] - \text{daily\_fans}[d-1]$ over
those days, and $d_i$ counts them. For someone present all month that is the
same $T_i = \text{daily\_fans}[e] - \text{daily\_fans}[s_i]$ and
$d_i = e - s_i$ as above, so the reference rows are unchanged.

## Quota periods (added 2026-10-01)

A circle's quota applies to a period, set with `/fans circle add|config period:`
or the dashboard's "Per" selector. The amount is entered *for that period*
("72M per week"). Everything above describes MONTH, which is the default and
whose figures are unchanged (the reference rows in `scripts/test-metrics.ts`
still reproduce exactly).

| Period | Window | Per-day rate | Goal for the window |
| --- | --- | --- | --- |
| MONTH | days 1 to month end | `floor(quota / daysInMonth)` | rate × days in month |
| BIWEEKLY | days 1-14, 15-28, 29 to month end | `floor(quota / 14)` | rate × days in window |
| WEEK | days 1-7, 8-14, 15-21, 22-28, 29 to month end | `floor(quota / 7)` | rate × days in window |
| DAY | the latest day with data | `quota` | `quota` |

Weeks restart on the 1st of every game month, so the last week is 2-3 days
long (0 in a 28-day February) and its goal scales: a 3-day week owes 3/7 of
the weekly quota. Biweekly windows follow the same rule (added 2026-10-04):
the stub at month end is 2-3 days and owes 2/14 or 3/14 of the quota. Its
label names the weekly weeks it covers ("Weeks 3–4 · days 15–28", and
"Week 5 · days 29–31" for the stub).

Inside the window, every figure is window-relative: `total` is fans earned
since the window opened, `expected` counts days in the window from the
member's first day with data (a mid-week joiner owes only their days),
`needPerDay` spreads the window's shortfall over the days left in it, and the
projection runs to the window's end. Rank movement compares with the previous
day of the same window, so it is empty on a window's first day. The 7-day
trend sparkline is deliberately not clipped to the window.
