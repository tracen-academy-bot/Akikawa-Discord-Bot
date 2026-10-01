# Quota mathematics

How every column of the club fan report is derived, and how those formulas were
verified.

## Source data

`GET /api/v4/circles?circle_id=…` returns each member with:

```
daily_fans: int64[31]   // cumulative fan totals, one per day of the game month
```

The array is **cumulative**, not per-day. Day 1 is index 0. Days not yet
reached, and days before the member joined the circle, are `0`.

## Definitions

Let:

- $Q$ — the configured monthly quota per member (e.g. $80{,}000{,}000$)
- $D$ — days in the game month (e.g. $30$)
- $e$ — days elapsed: the latest day any member has data for
- $f_i$ — member $i$'s first day with data
- $d_i$ — member $i$'s data days, $d_i = e - f_i + 1$
- $T_i$ — member $i$'s cumulative total, $T_i = \text{daily\_fans}[e - 1]$

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

**To close this**: capture one real `/api/v4/circles` payload for a circle with
a known mid-month transfer and compare `previous_circle_id` against that
member's first non-zero day. That pins the rule down in a single observation.

## Quota periods (added 2026-10-01)

A circle's quota applies to a period, set with `/fans circle add|config period:`
or the dashboard's "Per" selector. The amount is entered *for that period*
("72M per week"). Everything above describes MONTH, which is the default and
whose figures are unchanged (the reference rows in `scripts/test-metrics.ts`
still reproduce exactly).

| Period | Window | Per-day rate | Goal for the window |
| --- | --- | --- | --- |
| MONTH | days 1 to month end | `floor(quota / daysInMonth)` | rate × days in month |
| WEEK | days 1-7, 8-14, 15-21, 22-28, 29 to month end | `floor(quota / 7)` | rate × days in window |
| DAY | the latest day with data | `quota` | `quota` |

Weeks restart on the 1st of every game month, so the last week is 2-3 days
long (0 in a 28-day February) and its goal scales: a 3-day week owes 3/7 of
the weekly quota.

Inside the window, every figure is window-relative: `total` is fans earned
since the window opened, `expected` counts days in the window from the
member's first day with data (a mid-week joiner owes only their days),
`needPerDay` spreads the window's shortfall over the days left in it, and the
projection runs to the window's end. Rank movement compares with the previous
day of the same window, so it is empty on a window's first day. The 7-day
trend sparkline is deliberately not clipped to the window.
