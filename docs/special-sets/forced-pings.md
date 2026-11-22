# Forced pings

A forced ping decides what a trainer's next ping is, whatever the roll.
Every one lives in `FORCED_SOURCES` (`src/lib/timer/forced.ts`), marked
`forced: true`, with a priority. Owner, 2026-11-22: "the intro ping is
guaranteed the same way your next forced lesson is".

## Rules

- **One per ping.** The highest-priority source that is due fires. Every
  other due source waits, still due, for a later ping. Nothing is lost.
- **A forced special** posts as that special: it is found, rolls its
  outcomes, and spends running boosts like any special ping.
- **A forced scene** (no special) rolls nothing, so it spends no boosts. A
  scheduled lesson still counts it as a run.
- **Curses never block a forced ping.** A Fortune Tent curse lowers the
  random roll; a forced ping skips the roll.
- **Adding one:** add a source to `FORCED_SOURCES` and a row below. Do not
  add a special case to the scheduler.

## Sources

| Priority | Id | forced | What | Waits while |
| --- | --- | --- | --- | --- |
| 1 | `guarantee` | yes | A guaranteed special (`TimerUserSettings.guaranteedSpecialId`): a lost Remedial Rehearsal's retry; a scheduled lesson once its run comes (1–25); Helios's guest introduction; a one-time rig (McQueen, 2026-11-18). | Its set is locked or paused, or the special is closed (its `after` not found). Not while the set is turned off. |
| 2 | `tent-intro` | yes | Fuku-chan's Fortune Tent introduction, once, on the run after the unlock (`tentIntroOwed`). A scene. The Fortune button and draws wait until it has been shown. | A guarantee is due (priority 1). |

## Why this order

A lesson owed, a guest, or a rig is a special with consequences (a losing
streak, a role, a find), so a scene should not delay it. The intro loses
nothing by waiting a ping.
