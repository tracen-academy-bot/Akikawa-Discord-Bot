# Development Log

Newest first. Each entry records what changed and, more importantly, why.

---

## 2026-10-26 — Distinct top 3 colours; an Oguri Cap scene

Asked for: "top 3 should have different colors", and an Oguri theme that
looks like Oguri, maybe with a free chibi of her.

- **Top 3**: gold and bronze drifted together, most of all once darkened
  for light palettes. 1st vs 3rd measured only 17 to 34 (CIE76 ΔE) in 10
  of 16 palettes. `scripts/palettes.ts` now requires ΔE ≥ 35 between each
  pair of the top 3.
  - Dark palettes use a clear gold (`#ffd23a`) and an orange bronze
    (`#ff8f3f`). The bronze is kept orange, not red, so a top-3 name never
    reads as behind.
  - Light palettes use olive gold `#6f5f00` and copper `#9c4600`.
  - The wide sidebar's "Top 3" list now numbers each place in its colour.
  - Fwoxie then clarified they meant the names. The top 3 names in the
    on-pace table, and in the sidebar's Top 3, are now bold in their place
    colour. This drops the old rule that "a coloured name means behind".
    That rule is safe to drop: the table lists only members on pace, and
    behind names sit in their own card.
  - Silver read as plain text: near-white on dark palettes, dark grey on
    light ones. It is now a steel blue, `#9fb8e6` on dark palettes and
    `#4a6898` on light ones. The check also requires ΔE ≥ 25 between each
    top 3 colour and `text`. Akikawa and Sakura swap their grey for it.
- **Oguri scene** (`scenes.ts`): her blue sky with clouds, a garland of
  pennants in her blue, white and gold, her gold star glowing, and a white
  rail on mown turf. A stack of onigiri stands for her appetite. It
  replaces the starfield backdrop, which only showed as specks.
- **No chibi shipped**: no Oguri chibi with a clear free-use licence turned
  up. Cygames' fan-work guidelines govern what fans may make; they do not
  license other people's art. So a scene takes an optional picture from
  `src/assets/scenes/<scene>.png`, which a club adds only with permission.
  `withScene` is async to load it, and it is cached.

---

## 2026-10-26 — /club fancount is a form; Firework, Confetti, Finish Line themes

Asked for: "just do a form if you do fancount", and more designs.

- **`/club fancount`** opens a form: the quota (pre-filled exactly, e.g.
  "31M") and the period select. The old `amount` and `period` options are
  gone. A bare number still means millions (`parseClubFanAmount`), as the
  command always read it. An odd quota is pre-filled in M, so saving the
  form unchanged keeps it. Empty clears the quota. Saving refreshes the club
  directory, which shows the quota.
- **Scenes** (`scenes.ts`, `PaletteStyle.scene`): the first try drew
  fireworks and confetti as backdrop patterns. Fwoxie: "ew". The backdrop
  only shows in the 16px gaps around the cards, so a picture there reads
  as noise. A palette with a scene now renders the report on a transparent
  background (`drawFrame` skips it). `withScene` then places it on a larger
  canvas with a 170 to 190px band above the cards and 30px margins, and
  paints the scene there.
  - **fireworks:** a night-sky gradient, with stars. It has three kinds of
    burst: small distant ones, older ones that fade and droop, and big
    fresh ones. Each spark trail thins and droops under gravity, drawn with
    additive light. Rockets still climb, and a two-row city skyline sits
    where the cards begin.
  - **confetti:** a warm wash with out-of-focus lights and two twisting
    streamers. The pieces are strips, sequins, triangles and curls. Each
    narrows with its tilt and shows a darker back, near pieces cast a soft
    shadow, and they thin out down the margins.
  - Both come from fixed seeds, so the same report always looks the same.
- **`checker`** backdrop style (`cards.ts`): a chequered flag.
- **Themes**: Firework (dark navy, orange accent, fireworks scene),
  Confetti (light cream, magenta accent, confetti scene) and Finish Line
  (charcoal, square and outlined, racing blue, `checker`). All pass
  `scripts/palettes.ts`. 16 theme choices of Discord's 25.

---

## 2026-10-26 — Oguri theme; report layout ticks; quota moves to /club fancount

Asked for: a palette from Oguri Cap's two main colours (from the
Umamusume wiki), and a tick for tall/wide next to the palette choice, with
both allowed and at least one required.

- **Oguri palette** (`theme.ts`): umamusu.wiki lists her image colours as
  `#3A7AD2` (blue) and `#ECE7E7` (off-white). Light palette: off-white
  cards on a blue frame with off-white stars. The accent is a darker blue
  (`#2a63b5`), because `#3A7AD2` itself is under 4.5:1 on the cards. The
  target is gold (her star), and behind is red (her neckerchief). All
  colours pass `scripts/palettes.ts`.
- **Layouts** (`TrackedCircle.reportLayouts`, default `["tall"]`, additive
  migration `20261026150000_add_report_layouts`): `buildCircleReport`
  renders one image per ticked layout, tall first. Tall keeps its old file
  name. `CircleReport.image` became `images`, and every sender attaches
  all of them.
- **Forms**: Discord allows 5 fields per form, and `/club reports` already
  used all five. A separate `/club look` form went in first. Fwoxie then
  asked to spread the fields across the existing commands instead:
  - `/club reports` (tracked clubs only) now holds report time, time zone,
    theme, and a checkbox group for the layouts (required, 1 to 2 ticks).
    A new theme or layout is answered with a preview.
  - The quota and its period are set only with `/club fancount`. Leaving
    out the period now keeps the current one; before, it reset to month.
    Its reply carries the rank cutoff line that the form used to show.
  - Untracked clubs have no report, so `/club reports` points them to
    `/club fancount`. The form-only helpers (`quotaInputValue`, the quota
    fields) are gone.
- **Fix**: the behind card's key said "cream <1 day", left over from before
  `warn` became yellow. It now says "yellow" on dark palettes and "amber"
  on light ones.

---

## 2026-10-26 — Timer rewards: weekly top 3 role, milestones, live and final boards

Asked for: "collect id when people click the start autorun thing" so top
runners can get roles and there is a leaderboard. The timer already stored
who pressed Start and every completed run; what was missing was rewards.

- **Weeks** run Monday 00:00 to Sunday 24:00 in the timer's day time zone
  (JST, `TIMER_STREAK_TIMEZONE`), the same day keys as streaks. A run counts
  in the week its 50 minutes ended in.
- **Weekly top 3** (`rewards.ts`, `runWeeklyAwards`): 15 minutes into a new
  week the timer loop (checked once a minute) claims the old week in
  `TimerSettings.lastAwardedWeek`, so it is awarded once even across
  restarts, then takes the role off last week's holders (from
  `TimerWeeklyAward`, so only people the bot gave it to) and gives it to the
  new top 3. Ties go to whoever reached their count first. The final board
  posts in the chosen channel, pinging the winners. A new settings row starts
  at last week, so turning it on mid-week does not award an earlier week.
- **Milestones** (`TimerMilestoneRole`): kept for good; given when a run
  makes the total exactly the milestone (runs rise by one, so each is met
  once) and mentioned in the expiry ping without pinging the role; given to
  everyone already past it when added.
- **Commands**: `/timer rewards [top_role] [channel] [off]`, `/timer
  milestone add|remove`, Club Managers only. Roles the bot cannot give
  (above its own, integration roles, @everyone) are refused up front.
- **Leaderboards**: this week (live, the default for the command and panel
  button), last week (final), last 30 days, all time; the dashboard's
  training page uses the same four. The image is redrawn in the report's
  card style: a podium for the top 3 with a line on the role, then bars.
  Header totals cover everyone, not only the rows shown.
- Shared drawing pieces moved from `renderFanReport.ts` to
  `src/lib/image/cards.ts`.

Migration `20261026120000_add_timer_rewards` (three new tables). The
streak leaderboard is deferred.

---

## 2026-10-26 — Hot streaks replace "Closest to the line"

GimmeKiss (2026-10-25): "Closest to the line" listed people 50M ahead as
"close" (it filled the card with whoever came next), and it read as a
shame list for people meeting the requirement. Replaced with **Hot
streaks**: finished days in a row, ending on the last finished day, on
which a member earned at least the daily rate (`quotaPerDay`) while in the
circle (`MemberProgress.streak`). Anyone can have one, behind or not, and
it rewards consistency rather than size. Longest first, then by total; a
short bar against the longest. This month only; no streak without a quota.

Wide layout: the card takes the old card's place (under the shorter of the
table and the behind card, or beside the table when many are behind),
filling its height. Tall layout: the five longest close the report, when
anyone has one.

---

## 2026-10-25 — Rank band; top 3 of the day; lists stretch to fill

- **Rank band** (both layouts): where the club's monthly points sit between
  the cutoffs around its monthly rank. #194 is in the A+ band (#101–500): a
  bar from #500 to #100 with the club marked, "To #100 (S) +579M" and
  "Over #500 (A+) +1.40B". The club's `monthly_point` is now stored on sync
  (`monthlyPoints`, new column), and `refreshCutoff` keeps the points of the
  circle exactly on each cutoff place (`CutoffSeries.points`), which it
  already fetched, so the band costs no extra uma.moe requests.
  `rankBand()` works out the band; the top band has no place above and past
  #3000 there is none below. Both figures come from uma.moe's points, so they
  compare like with like; the edges are up to six hours old (the cutoff
  refresh), the club's own up to an hour.
- **Top 3 of the day** replaces the open-ended best-gains list in the wide
  sidebar, titled "Top 3 · Day 23" and numbered, so it reads as the day's
  best rather than a second copy of the table's leaders.
- **Flex**: table rows, behind entries and closest-to-the-line rows grow to
  fill spare card height, by at most 1.35× (1.25× for behind entries), and
  the sidebar's summary and top-3 rows likewise. A small club still leaves
  some space rather than a few huge rows.

---

## 2026-10-25 — Brighter "close" names; wide layout stress-tested

viinus (2026-10-24): the names "on the edge" (behind by under a day) were
hard to tell from normal names except on Graphite. Every palette's `warn`
was a pale cream (HSV saturation about 0.3), close to white text. It is now
a saturated yellow on dark palettes and a deep amber on light ones.
`scripts/palettes.ts` now also fails a palette whose `warn` is paler than
saturation 0.6 or within 25 degrees of hue of `behind`; that caught Clear,
whose behind is now vermillion (still Okabe-Ito, still colour-blind safe).

Wide layout, rendered across: 5 members; 30 with nobody behind (Paper);
13, 24 and 30 behind; Last 24h with the freeze note and long names; no
data. Found and fixed:

- **All behind**: the table was empty and 30 entries stacked in the right
  column (1600px tall). The behind card now spans the middle and right in
  three columns.
- **Many behind** (24): the table and the closest to the line now sit side
  by side on top, with the behind card in three columns under both. The
  layout picks whichever arrangement is shortest.
- **Capital labels** (Paper, Classic, Turf, Neon): "DAY 23" ran into
  "TARGET/DAY"; columns are spaced wider.
- **Long club names** shrink (to 70%) before they are cut short.
- **No data**: the behind card said "Everyone is on pace"; it now says there
  is no data yet.

Not fixed: a small club (about 10 members or fewer) leaves the wide
layout's cards mostly empty, because the sidebar sets a minimum height.
The tall layout suits them better.

---

## 2026-10-24 — Header and notes cut down

Feedback: turning the pink lines white did not fix them ("scattering pink
to scattering white"), and the notes at the bottom left were useless.

The problem was repetition: the report line under the club name
("biweekly report / second half · days 15–31 / day 23 of 31", wrapped over
three lines in the sidebar) said what the figures below already say. It is
gone; the identity is the name and "Oct 24, 2026 · 29 members", and
Expected's note reads "by day 23 of 31".

The notes are gone too. Headings carry the meaning ("Target/day",
"Days in"), and the behind card's key ("cream <1 day · red more") now fits
beside its title in both layouts. Only the freeze warning remains, when it
applies, so the tall layout has no footer card otherwise. In the wide
sidebar the freed space is one "Day 23" section: club gain, per member, how
many hit the daily quota, then the best gains filling the rest.

---

## 2026-10-24 — Many behind; less pink text

- **More than five behind** (`FULL_BEHIND`): entries go compact, two lines
  of 50px (name and shortfall; a bar with days behind and the daily need),
  in two columns in the tall layout. Fifteen behind is now 8 rows, not 15
  full entries.
- **Wide, many behind**: when the behind card is taller than the table,
  "Closest to the line" moves under the table instead, so both columns
  reach the bottom.
- **Text colour**: placement no longer tints names (the left bar carries
  it), and the report line under the club name is plain text, not the
  accent. A coloured name now only ever means behind; the accent stays on
  bars and structure.

---

## 2026-10-24 — Behind made clearer; wide layout rebuilt as three panels

Feedback: make "behind" clearer; the wide layout "looks really bad" (text
off, "October" should be "Oct", empty space at the end, the behind rows at
the bottom).

- **Behind entries** (both layouts) replace behind table rows: rank and
  name, the shortfall in fans ("−8.61M") and in days of quota ("2.8 days
  behind"), a bar of fans earned against expected by now, and "needs
  4.12M/day". Cream under one day short, red over; the card keys the
  colours where it fits, the wide sidebar notes otherwise.
- **Wide layout**: three panels stretched to the same height, so no frame
  shows below any of them. Sidebar: club, rank, a 2×2 of figures (quota,
  expected, next due, on pace), progress, the day's top gains filling the
  middle, notes at the foot. Middle: the on-pace table, one column
  (circles hold at most 30). Right: the behind card, then "Closest to the
  line", on-pace members by smallest cushion, filling the rest.
- Dates use short month names in both layouts.

---

## 2026-10-24 — Rank moves to /club admin; theme into the reports form; one channel field

Asked to "move rank to admin" so the theme fits in the `/club reports`
form, then to merge the report and alert channel fields so rank fits in the
`/club admin` form (both forms are at Discord's five-field limit).

- **`/club reports`** (club staff): quota, period, report time, time zone,
  report theme. Saving a new theme replies with the current report drawn in
  it (the submit defers first). The `theme:` command option is gone.
- **`/club admin`** (Club Managers): expected rank (with each rank's cutoff
  figures under it, as before), home channels, staff roles, report channel,
  staff pings. Untracked clubs: name, rank, staff roles. Club staff can no
  longer set their own expected rank.
- **One channel field.** An empty `alertChannelId` now means "the report
  channel" (`alertChannelOf`). The admin form sets the report channel; an
  alert channel that matched the old report channel is cleared so it keeps
  following, and a separately set one (`/fans circle config alert_channel:`
  or the dashboard) is kept.
- **Behaviour change:** a club with a report channel and no alert channel
  used to get no alerts. It now gets them in the report channel, unless its
  staff pings are set to Never.

---

## 2026-10-24 — Clubs pick their own report theme

New `reportTheme` column (text, null = default) and a `theme` choice on
`/club reports`: Default plus every palette (13 of Discord's 25). Picking
one saves it and replies with the club's current report drawn in it; with
no theme the command opens the form as before. It is an option, not a form
field, because the form is already at Discord's five-field limit. Stored as
text rather than an enum so a new palette needs no migration; an id that no
longer exists draws in the default (`paletteOf`). The scheduled report,
`/fans` checks and the dashboard image all use the club's theme. The
settings summary names it.

`THEME_CHOICES` sits above the command builder: a `const` declared below it
would throw at module load, which the type checker does not catch.

The slash command changed, so `npm run deploy-commands` is needed for the
option to appear.

---

## 2026-10-24 — Back to Plex Mono; palettes get styles; a wide layout

- **Font.** The report is back in IBM Plex Mono, the bot's own face (asked
  for "our old font"). `sansFont` is removed.
- **Styles, not just colours.** `Palette.style` (`PaletteStyle`): corner
  radius, card outline, glow, label style (plain or tracked capitals) and a
  backdrop pattern (gradient, solid, lanes, stars, grid). Twelve palettes:
  rose (default), classic (square, gold outline, capitals: the original
  terminal look), midnight (stars), jewel, plum, turf (was forest; mown-
  stripe racecourse), graphite, paper, akikawa, clear, and new neon
  (glowing magenta outlines on a cyan grid) and sakura (light, very round).
  All pass the contrast check.
- **Wide layout** (`renderFanReport(..., layout: 'wide')`), 1700px, after
  the ChronoGenesis landscape page: header as a left sidebar with the notes
  at its foot, members down two table columns (first half left, rest
  right; on pace first), behind members in their own card. Reports still
  post the tall layout; nothing selects wide yet. Discord shrinks a 1700px
  image to fit the chat, so it needs a tap to read, more than the tall one.
- Header figures are stacked (label, value, note) so they fit in Mono.
  Long dates and member counts wrap rather than truncate.

---

## 2026-10-24 — Fan report redrawn as cards; Rose palette is the default

Asked to rewrite the report's data for readability in the style of the
ChronoGenesis club page (dark cards on a pink frame), keeping this report's
header placement, with a place for the club's rank badge and its image.

- **Layout.** 900px wide, rounded cards on a gradient frame: header, on
  pace, behind, footer. The header keeps name top-left and rank top-right,
  adds the club image (`assets/clubs`, via `loadClubIcon`) left of the name
  and the expected-rank badge (`assets/ranks`) in the top-right corner.
  Either slot shows an empty circle when there is no picture.
- **Figures.** Compact, two decimals ("107.93M", "+7.08M") in IBM Plex Sans
  JP, whose digits are tabular (checked: 12.60px each at 20px, both
  weights). Targets round up (`shortFans(..., true)`), so the figure shown
  is never a few fans short. Column headings are plain case.
- **Expected** left the table: it is the same for everyone present all
  period, so it is one header figure ("Expected now", the most common
  value). A new **Days** column (`dataDays`) shows who joined late and so
  owes less. The header's other figures: Quota (per day and as set) and
  "Next check" or "Due by month end".
- **Behind** members get their own card. Names are cream (`warn`) when less
  than one day of quota short, red when more, as on the reference page.
- **Palettes** gain `frame`, `frameEnd` and `warn`. New `rose` palette
  (default, `DEFAULT_PALETTE`); the other nine keep their cards and get
  frames. All pass the contrast check.
- The renderer now imports `canvasUtils`, which pulls in the Prisma module,
  so `scripts/palettes.ts` needs `DATABASE_URL` set (no connection is made).

Not done: a wide two-column layout like the reference's landscape version.

---

## 2026-10-24 — Every-3-days staff pings

Asked for "day/3d/wk/none". `AlertFrequency` gains `EVERY_3_DAYS` (its own
migration, `ALTER TYPE ... ADD VALUE`, in case the first one is already
applied). `isAlertDue` is now one rule for all three: due once 1, 3 or 7
days, less 12 hours of slack, have passed since the last ping. That changes
DAILY slightly: it used to ping with every scheduled report, and now skips
one that comes within 12 hours of a ping, such as a `/fans all` earlier the
same day. Reports are a day apart, so otherwise nothing changes.

---

## 2026-10-24 — Alerts ping staff roles on a cadence; Behind column dropped; nine palettes

The club's answers to the earlier entry: keep Daily target over Behind, and
"instead of normal alert, ping all officer roles every given time frame
(day/week/none)".

**Alerts.** The alert no longer tags trainers. It lists who is behind by
name (top ten, then "…and N more") and pings the club's staff roles:
`staffRoleIds`, or else the Trainer and Assistant roles matched by name
(`staffRolesOf`, read from `client.guilds.cache`). "Officer roles" was read
as the club's own staff roles, not the server-wide Club Manager roles
(`OFFICER_ROLE_IDS`), because each alert is about one club. New columns:
`alertFrequency` (DAILY default, WEEKLY, NONE) and `lastAlertAt`, set by
Club Managers in `/club admin` (the `/club reports` form is at Discord's
five-field limit). `isAlertDue`: DAILY every scheduled report; WEEKLY once a
week has passed since the last ping, less 12 hours so minutes of drift do
not push it a day; NONE never. A week with nobody behind sends nothing and
leaves `lastAlertAt` alone, so the next behind day pings at once. `/fans all`
posts the alert whenever the club has not chosen NONE; `/fans club` and the
no-channel path of `/fans all` ping nobody, since staff ran them.

Caveat: Discord only notifies a role mention if the role is mentionable or
the bot has "Mention @everyone, @here, and All Roles". Not checked on the
live server.

**Report.** The Behind column is gone from the image and the dashboard.
Daily target turns the behind colour, and bolder, for anyone behind, so the
column's information stays on the row. Rank slips use `muted` rather than
the behind colour, which means only "behind". The image is 1200px wide; the
subtitle wraps to two lines when it does not fit (the biweekly note was cut
off at the image edge, also at 1600px). The footer no longer repeats the
window label, which ran into the total.

**Palettes.** Nine, each on a different background: classic (warm black),
midnight (navy), jewel (viinus's colours on indigo), plum, forest, graphite
(Discord's grey), paper (light, cream), akikawa (light, peach, avatar hues)
and clear (Okabe-Ito, colour-blind safe). Each palette also has a header
`panel` and a row `stripe` (zebra rows) to help follow a row across.
`scripts/palettes.ts` checks every text colour against all three of `bg`,
`panel` and `stripe`; all pass. Known weak spot: in clear, the behind orange
and target yellow are close on behind rows. Nothing selects a palette per
club yet.

---

## 2026-10-24 — Need/day fixed at the reset; alerts every day; report trimmed; palettes

**Need/day asked for less than pace (MONTH).** Reported from First on
2026-10-21: Brandee, 619 fans behind, was told to earn 7,303,814 a day, below
the 7,967,741 pace. `daysRemaining` was always $D - e + 1$, "today
included". That was right for the reference bot, which posted mid-day. Since
reports moved to the 00:00 JST reset (2026-10-17), day $e$ is finished when
the report posts. It was counted twice: once as owed in Expected, and once as
a day still to play. Now $r = D - \text{finishedDay}$: a mid-day report still
gets $D - e + 1$, a reset report gets $D - e$. Brandee's figure becomes
7,967,797 (pace plus 619 / 11). The reference replay now passes
`currentDay: 14` explicitly, since its day 14 was in progress; all 24 rows
still match. Checkpoint periods already worked this way.

**Alerts post daily in every period.** Cosmos, 2026-10-24: a biweekly report
on day 23 showed Fuzzlekins 12.4M behind, with no alert. Scheduled alerts in
checkpoint periods waited for a checkpoint to close. That rule dates from
when Expected only rose at checkpoints; since 2026-10-12 it grows daily, so
the report flagged people for days without an alert. The gate is gone; every
period alerts like MONTH. Alert lines now say what the daily figure aims at
("needs X a day until month end" / "until the day 31 check").

**Report trimmed (GimmeKiss's feedback, 2026-10-23).** Removed the 7-day
trend and Projected from the image, and Projected from the dashboard and
`/fans me`. "Need/day" is now "Daily target" everywhere, because it was read
as an extra on top of pace; it is the whole daily amount. The image is
1280px wide instead of 1600, so text is larger on phones. Behind and Expected
stay until the club answers (see `COMMUNICATIONS_LOG.md`).

**Palettes.** `theme.ts` gains `Palette` and `PALETTES` (classic, jewel, navy,
akikawa, clear). Each key carries one meaning (accent, target, good, behind,
place). Only the fan report takes a palette for now; nothing selects one per
club yet. `scripts/palettes.ts` renders the report in each palette and
checks WCAG contrast (4.5:1 for figures, 3:1 for `faint`). Classic's `faint`
failed at 2.91:1, which is why Expected was hard to read on phones; it is now
`#6e6a63` (3.66:1), in the images and the dashboard CSS.

---

## 2026-10-17 — Report and alert channels are typed, so threads work

Reported by the user with a screenshot: in `/club admin`, pasting a
thread's ID into the Report channel picker found nothing. Discord's
channel picker does not list threads, and reports often go to one. Both
fields are now text inputs, pre-filled with the current ID. They accept a
bare ID, a `<#id>` mention, or a channel, thread or message link (for a
message link, the channel part is used). On submit, the ID must resolve to
a channel or thread in this server that the bot can see and send to;
otherwise the field is named and nothing is saved. Empty still means no
report or no alerts. Home channels stay a picker, since they are
channels, not threads.

---

## 2026-10-17 — Rules and goals as a Markdown or text file

At the user's request, clubs can upload their rules and goals as a file in
`/club profile`, so they are not held to the form's 1000-character Rules
field. Accepted: `.md`, `.markdown` and `.txt`, all treated as Markdown.
The file must be valid UTF-8 text, up to 64 KB, and not empty; a leading
byte-order mark is dropped. Any other file type is refused, and so is a
file that fails these checks; the stored rules are kept.

The profile form was already at Discord's five-field limit for a Club
Manager with a banner. So the Banner field became **"Banner and rules
file"** (up to two files: an image is the banner, a .md/.txt is the
rules). The "Remove banner" checkbox became a **Remove** list (banner
and/or rules file), shown only when there is something to remove.

**Where it shows.** The rules file never goes on the card. The card says
"Rules and goals: in the messages below this card", and the file follows
in messages of its own (`club:<id>:rules:<n>` in the directory layout).
Those messages are plain text, not embeds, so all of the file's Markdown
renders. The first message starts with a `## <Club>: rules and goals`
heading. A long file becomes several messages of up to 2000 characters
(Discord's limit), split only between lines; a line is broken only if it
alone is over 2000. Mentions in the rules never ping (`NO_PINGS`). The
user first asked for long rules to be cut and then clarified that they
meant split into more messages; an attach-the-file version and a cut
version were both replaced. The `/club profile` reply sends the card, then
the rules messages (ephemeral). Changing how many messages a file needs
changes the directory layout, so the directory is reposted.

Stored as text: `TrackedCircle.rulesFile`, `rulesFileName` (migration
`20261017160000_add_club_rules_file`).

---

## 2026-10-17 — Default report time is the daily reset; reset reports show Day N

At the user's request, the default report time is now **00:00 JST**, the
game's daily reset (confirmed by the user as midnight JST, which matches the
bot's day bucketing). It was FAN_SYNC_HOUR_UTC, 13:00 UTC, which is 22:00
JST and mid-way through a game day. FAN_SYNC_HOUR_UTC now only times the
daily upkeep sync.

A report that posts at the reset shows **"Day N"**: the game day that just
ended, complete. That covers default clubs, and any club whose chosen time
is 00:00 JST in whatever zone (`isAtGameReset`). Reports at any other time
keep "Last 24h". Every "Day N" column now shows the last *finished* day
(`CircleProgress.finishedDay`, `MemberProgress.finishedDayGain`) rather
than the day still in progress. This also fixes the half-finished "Day N"
seen in reports posted mid-day.

On the 2nd JST, the day that just ended was the old month's last
(game day 1 is the 2nd). A reset report then shows **that month's final
standings**, not the new month's nearly empty first day. With no current
day, every checkpoint up to month end is judged, so the month-end alert
goes out with it.

On deploy, default clubs move from 13:00 UTC to 15:00 UTC. A club that got
its 13:00 UTC report earlier that day also gets the 15:00 UTC one, because
that is a new JST day.

Caveat (unverified): uma.moe refreshes most circles hourly. A report at
00:00 JST may be missing up to the final hour of the day it reports. If
that shows up, a default of 01:00 JST would avoid it, at the cost of a
column that is no longer exactly the reset.

---

## 2026-10-17 — Reports show fans earned in the last 24 hours

Now that each club picks its report time, the report's "Day N" column (fans
on the latest game day) is replaced by **"Last 24h"**: fans earned in the 24
hours before the report. Game-day buckets meant a report posted mid-day
showed a half-finished day. Requested by the user, who scoped it to that one
column. Total, Expected, Behind and the 7-day trend stay on game days.

**Why new storage.** `FanSnapshot` holds one total per member per game day
and is overwritten on every sync, so the bot had no record of what anyone
had 24 hours earlier. New table `FanReading` (migration
`20261017140000_add_fan_reading`): each sync of the current month records
every member's lifetime total with its time, pruned after two days. Syncs
run hourly, plus one just before each report.

**The figure** (`src/lib/fans/readings.ts`): the newest batch of readings,
minus the batch taken closest to 24 hours earlier. That batch must be
within 90 minutes of the 24-hour mark; otherwise there is no figure. A
total that went down counts as 0. Someone with no reading a day earlier
(for example a new member) shows "—". Totals are lifetime counts, so
windows across the month change work.

**Month-end freeze.** In the game, fans earned on the 1st from 17:00 to
24:00 JST (08:00–15:00 UTC) do not count. At the user's choice, a window
that overlaps that stretch is shown as is. The column header becomes
"Last 24h*" and the footer explains why.

**Rollout.** For the first ~24 hours after deploy there are no readings
from a day earlier, so the column stays "Day N" with the old figures. The
scheduled report, `/fans report` and the dashboard's report image all use
it; the dashboard image does only for the current month. The dashboard's
HTML table still shows the latest game day.

Tests: `scripts/test-report-time.ts` gains 14 checks covering freeze
overlap at both edges, choosing the closest batch, clamping, members with
no earlier reading, and pruning.

---

## 2026-10-17 — Each club sets its report time; club forms split by who edits them

Every club's daily report used to post at one time for all clubs:
FAN_SYNC_HOUR_UTC, 13:00 UTC by default. A club's staff (or a Club Manager)
now set their own report time and time zone.

**Club forms.** `/club edit` is gone. A club's settings are now three forms,
split by who may change them, within Discord's five-field limit. The user
chose this layout and the name `admin`.

| Form | Who | Fields |
| --- | --- | --- |
| `/club reports` | the club's staff and Club Managers | expected rank, quota, quota period; for a tracked club, report time and time zone |
| `/club profile` | the club's staff; Club Managers also set the tier | bio, rules, banner, tier (unchanged) |
| `/club admin` | Club Managers only | name (untracked club) or home channels (tracked), staff roles; for a tracked club, report and alert channels |

Everything that decides *who* counts as staff, and *where* things post,
is now Club Manager only, in one place. `/club member` was already Club
Manager only. Staff roles matched by name ("Cosmos Trainer") still count
when a club has no stored list. Whoever can assign server roles controls
those; dropping that fallback is an open question for the user.

**Report time** ("21:00", "9pm"; empty means the server default). The time
zone comes from 23 common zones. Japan time is listed first and is the
default, since the game runs on it. The others cover staff local time and
follow daylight saving: "US Eastern" is New York's clock, not a fixed
UTC-5. Replies give the next report as a Discord timestamp, so each reader
sees it in their own local time. `/fans circle config` still sets the
report and alert channels too.

Commands register at startup, so `/club edit` disappears on deploy.

**Scheduler.** The daily job keeps the sync, benchmark and cutoff upkeep at
FAN_SYNC_HOUR_UTC but no longer posts. `postDueReports` runs on the
existing 5-minute check. It posts each active club that has a report
channel once per local day, at or after its time, so a report can be up to
5 minutes late. A club synced in the last 10 minutes is not fetched again;
otherwise it is synced first, and a failed sync still posts the last data.
`TrackedCircle.lastReportAt` is written before the work, so a crash or
restart cannot post twice.

**Migration** `20261017120000_add_club_report_time` adds `reportMinute`,
`reportTimeZone` and `lastReportAt`. It seeds `lastReportAt` from the old
daily job's last run, so a deploy later the same day does not post every
report a second time.

**Known edge.** The behind-quota alert still posts only on the game day
after a checkpoint closes. Each local day has exactly one report, so each
game day normally gets one. Changing the time, or a daylight-saving shift
for a time within an hour of Japan's midnight, can move a report across
that boundary, so a checkpoint's alert could double or be skipped once.
This was accepted rather than adding per-checkpoint alert tracking.

Tests: `scripts/test-report-time.ts` (39 checks: parsing; Japan and New
York times, including New York leaving daylight saving on 2026-11-01; the
scheduler posting three clubs at three times over two days, never posting a
club with no channel or a paused one). `scripts/test-commands.ts` covers
both new forms: their fields for tracked and untracked clubs, pre-filled
values, staff refused from `/club admin`, and the report time round trip.

---

## 2026-10-12 — Club avatars

The 14 club pictures uploaded to `bleh bleh bleh/` are now in
`src/assets/clubs/`, resized from about 400–500 px to 256×256 (roughly
75 KB each instead of about 200 KB). Discord shows thumbnails at about
80 px, and `/club view` draws the icon at 88 px, so 256 px leaves room for
high-DPI screens.

`src/lib/clubAvatar.ts` matches a club to a file when exactly one word of
its name is a file name: "Cosmos" and "Team Cosmos" get `cosmos.png`,
"Checkrose" gets nothing, and a name matching two files gets neither. As
decided, the files are fixed in the repo rather than uploaded per club. A
new or renamed club needs a file in that folder.

The avatar is used in two places:

- Directory cards: it is the card's thumbnail. The message fingerprint
  includes files, so the first refresh after deploy re-edits every card
  once.
- `/club view`: `loadClubIcon` used to look for `assets/clubs/<club id>.png`.
  It now uses the name match, so the avatar replaces the rank badge there.

Per-club colours are still parked.

---

## 2026-10-12 — Biweekly is two halves: days 1-14 and 15 to month end

Biweekly quotas used to run in 14-day blocks: 1-14, 15-28, then a stub
from 29 to month end, with checkpoints at 14, 28 and month end. The club's
rule is two halves, days 1-14 and day 15 to month end, so checkpoints are
now only at the end of day 14 and at month end. Day 28 no longer triggers
the alert.

The second half owes quota × its length / 14. For a 31-day month that is
17/14 of a quota, at the same per-day rate as the first half (decided
2026-10-12). The rate was already quota / 14 per day, so Expected is
unchanged. Only the windows, checkpoints, need/day target and labels
("First half · days 1–14", "Second half · days 15–31") moved. Weekly is
unchanged: its 29-to-month-end stub stays.

Carry-over, also decided 2026-10-12: totals and Expected stay
month-to-date, so a shortfall carries into the next period, and so does a
surplus. Cancelling the surplus at each checkpoint was considered and
deferred, because there was no clear way to show it on the report.

---

## 2026-10-12 — Checkpoint quotas scale daily, like MONTH

This supersedes the "nothing due until a checkpoint" rule from 2026-10-04.
A biweekly Cosmos report on day 11 showed Expected 0 for all 30 members
and nobody behind, because the first check is day 14. That rule is
replaced: in daily, weekly and biweekly periods Expected now grows by
quota / period-length every day, the same way MONTH grows by
quota / days-in-month. A 47.5M biweekly quota on day 11 expects 33.9M
(10/14 of the quota through day 10).

The difference from MONTH: only finished days are judged. Both Expected
and the fans compared against it stop at the last finished day
(`judgedDay`), so a partly played day never flags anyone. Checkpoints
still set need/day (aimed at the next one), the "next check" header line,
and the scheduled alert, which still posts only on the day after a
checkpoint closes. On that day, Behind equals the checkpoint's shortfall.

`/fans me` now uses the MONTH wording ("Expected by now", "On pace (X
ahead)", "Behind by X") for every period.

---

## 2026-10-12 — Missed checkpoints stay flagged

Reported in Discord: the "behind" flags were missing on weekly and daily
quotas. They were. In checkpoint periods, `computeCircleProgress` compared
what was due at the last checkpoint with the month-to-date total. That total
includes fans earned *after* the checkpoint, so the next period's fans paid
off the missed one. With a 14M weekly quota, a trainer earning 1M/day was
shown 6M behind on day 8 (the real miss was 7M), 3M on day 11, and on pace
on day 14. In general, a trainer at a fraction $p$ of quota pace lost the
flag on day $7/p$: day 9 at 80%, day 12 at 60%. Daily quotas had a smaller
version of the same bug: today's fans counted against yesterday's check.

`behind` now uses the fans earned by the checkpoint day
(`cumulativeAt(g, checkpointDay)`), so a miss stands until the next
checkpoint. `total`, `target` and need/day are unchanged, and need/day still
carries the debt forward to the next check. MONTH is unaffected, because its
checkpoint is today.

Three tests in `scripts/test-metrics.ts` had encoded the bug (6M, 5M and 0
behind). They now expect 7M, 7M and 2M. Regression checks were added for
week-1 misses on day 14 and for daily quotas at 95% pace.

---

## 2026-10-05 — A cutoff per expected rank; B removed

Each expected rank now has its own cutoff, as the club set them: S+ is top
30, S top 100, A+ top 500, A top 1000, B+ top 3000 (`CUTOFF_BY_RANK` in
`src/lib/fans/cutoff.ts`). Each rank's option in `/club edit` shows its own
cutoff's figures, and saving shows the chosen rank's. Casual has none.

The band is 10% either side but at most 50 places ("don't make radius too
big"): 27 to 33, 90 to 110, 950 to 1050, 2950 to 3050; A+'s is 475 to 525,
as the club chose (`CUTOFF_RADIUS`). At most
11 places are sampled per band, so all five cutoffs together take about 60
uma.moe requests. A cutoff that fails (the ranking may not reach 3000 early
in a month) keeps its last figures and does not stop the others; the
six-hour staleness is timed from the last attempt, so a failing cutoff does
not make every hourly sync refetch everything.

B is no longer a rank (`20261005100000_remove_club_rank_b`). Postgres cannot
drop an enum value, so the type is rebuilt; a club set to B becomes unset.
The pre-merge backup table's rank column becomes text first, keeping its
values. Checked on a database seeded with a B club and a B backup row, and
on an empty one. The B badge image is removed.

---

## 2026-10-05 — Club profiles, the club directory, and T1000 figures in /club edit

**Club profiles.** `/club profile` opens a second form (`/club edit` already
has Discord's limit of five fields). A club's staff (by `/club member` or by
staff role) and Club Managers edit its bio (1500 characters), rules (1000;
text, or a link shown as one) and banner (an image up to 8 MB, downloaded
from Discord's CDN at submit and stored, since upload URLs expire). Club
Managers also set its tier. The reply is the card as the directory will show
it.

**Tiers** are G1 [Competitive], G2 [Semi Competitive+], G3 [Semi-Competitive]
and Debut [Casual], with the blurbs and estimated ranks from the server's
existing directory post. A tier is set explicitly, not derived from the
expected rank: the ranges overlap (A is in G2 and G3). A club with no tier is
left out of the directory, so nothing appears until Club Managers set them.

**The directory.** `/club directory channel:` (Club Managers) posts, in
order: the tier explainer (four embeds), then per tier with clubs a "Current
G1 Clubs" heading and one card per club by name, then an index embed of jump
links. A card is the banner as an image-only embed (so it sits above, like the
existing banners) and an embed in the tier's colour with Trainers and
Assistants, Requirements (the quota, so it is never typed twice), expected
rank, rules and the bio as a quote. Staff are `/club member` entries plus
holders of the club's staff roles ("Assistant" roles' holders are Assistants);
without the Server Members intent the role itself is mentioned. Nothing pings.

It updates itself after any club change: `/club profile`, `/club edit`,
`/club fancount`, create, delete, staff changes. When the same messages still
fit, it edits in place, and only messages whose content changed (each is
fingerprinted, banners included), so one club's edit does not re-upload every
banner. A new layout (a club added, removed or moved between tiers) deletes
the old run and posts it again, since Discord cannot insert messages. Running
`/club directory` again rewrites every message, which also repairs any deleted
by hand; with no channel it refreshes where it is, with one it moves.
Refreshes queue per guild so two changes in a row cannot post over each
other.

Schema (one additive migration, `20261005090000_add_club_profiles_and_directory`):
`ClubTier` enum; `tier`, `bio`, `rules` on `TrackedCircle`; `ClubBanner`
(kept apart so ordinary club queries never load image bytes); `ClubDirectory`
(channel, layout, message IDs, fingerprints).

**T1000 figures.** A Discord form cannot change as it is filled in, so the
figures cannot appear only after a rank is picked. Instead every competitive
rank option (not Casual) carries them as its dropdown description: fans per
member per day over the last 7 completed game days, oldest first, crossing
into last month when needed. Saving a competitive rank repeats them with
dates in the confirmation. The figure pools a band 10% either side of the
cutoff (ranks 900 to 1100), sampling at most 21 evenly spaced places to keep
it to about 24 uma.moe requests: a day is all sampled circles' fans that day
over all their members in the circle all day, by the `monthGains` rules, with
days next to a skipped scrape left out. They are the circles in the band now,
not whichever were there each day. Worked out at start, hourly when over six
hours old, and in the daily run; kept in memory because a form must open
within 3 seconds. `src/lib/fans/cutoff.ts`; `bandRanks` takes any cutoff
(T100 gives 90 to 110, T500 450 to 550).

Tests: new `test-cutoff` (24 checks: per-day maths, joiners, leavers, skipped
scrapes, the band, page requests, pooling, the month crossing, staleness,
text) with uma.moe stubbed; `test-commands` to 175 (profile forms and saves,
banner upload and refusals, the card, the directory's posting, edit-only-what-
changed, reposting, moving, and the T1000 option lines).

---

## 2026-10-05 — Club staff can set the expected rank

A club's own Trainers and Assistants opening `/club edit` got the quota and
its period only; the expected rank was Club Managers' alone. The club wants
staff to set it too, so the staff form now has Expected rank above the
quota, pre-selected like the Club Manager form, and the submit saves it for
either form. Name, home channels and staff roles stay Club Managers' only.

---

## 2026-10-04 — Club staff roles matched by name

A Cosmos Assistant ran `/fans club` and was refused. Club staff were only the
people added with `/club member`, and nobody had been, although the server
already gives staff roles like "Cosmos Trainer" and "Cosmos Assistant". The
bot now reads the server's roles itself and matches them to clubs by name
(`src/lib/clubLinks.ts`). A role counts as a club's staff role when its name
contains the club's name and the word Trainer or Assistant. Anyone holding
one is that club's staff everywhere `/club member` staff are (`/fans club`,
the `/club edit` quota form, `/club fancount`). `/club member` entries still
count too.

Names are compared as words: lower-cased, accents and emoji dropped, split
on anything that is not a letter or digit, and the club's words run together
must equal a run of the role's words run together. So "Alt Lair" matches
"AltLair Assistant", but "Cosmos" does not match "CosmosX Trainer" or
"Cosmo Trainer", and a plain "Cosmos" member role is not a staff role.
"the", "club" and "circle" are optional in a club's name. When one club's
match sits inside a longer club's ("Cosmos" inside "Cosmos II Trainer") only
the longer club gets it.

`/club edit` has a Staff roles picker, pre-filled with the roles the bot
actually uses. A stored list replaces the name matches. Saving the matches
unchanged, or clearing the picker, stores nothing, so the club keeps
following its name (a role made later is picked up). `/club links` lists
every club's staff roles, marking which were matched by name.

Channels are left alone: the club deferred matching them by name, so home
channels are still set with `/club edit` and `/club links` does not list
them. A first version of this change matched them by name too; it was taken
out before merging.

Schema: `TrackedCircle.staffRoleIds String[]`, an additive migration
(`20261004150000_add_club_staff_roles`). Matching is done live from the
bot's role cache, not stored, since the session has no access to the server
or production database to read the IDs ahead of time.

`test-commands` now has 123 checks: the matching rules, a role holder
allowed and a plain member role or another club's role refused, the form's
pre-fill, a stored list replacing the matches, channels not matched by
name, and `/club links`.

---

## 2026-10-04 — Club form: expected rank, the real quota, headcount from uma.moe

After the merge a club carried two copies of one number: the old club "fan
count" and the fan-tracking quota. The edit form showed the empty fan count
while Primrose's quota was 90M, so it looked as if it had not loaded the
club's values. The form now edits the quota itself, pre-filled exactly (90M
shows as "90M", so saving unchanged keeps the same number), with the quota
periods `/fans` uses. Saving clears the old fan count so it never resurfaces;
it is only shown, and pre-filled, for a club that never had a quota.
`/club fancount` sets the quota too (in millions, as its option says;
monthly unless a period is given). Quotas typed in the form are taken
literally, like everywhere else.

Headcount is no longer typed in. For a tracked club it is uma.moe's current
members by the same rule the reports use, so it matches their member count;
for an untracked club it shows as a dash. The form field and `/club
headcount` are gone. The stored `headcount` column is left in place unused.

"Rank" is now "Expected rank" in the form, `/club create` and the directory,
so it is not confused with uma.moe's monthly rank.

A Casual rank sits below B (`ClubRank` gains `CASUAL`, an additive enum
migration). There is no badge artwork for it, so it uses the drawn badge, a
muted "C".

---

## 2026-10-04 — Clubs and tracked circles are one table

To the club, a club and its uma.moe circle are the same thing, but the bot
kept them apart: a `Club` row (rank, headcount, fan count, staff) and a
`TrackedCircle` row (uma.moe ID, quota, channels, fan history), joined only
by an optional link nobody had set. `/club edit` found nothing because the
only club record had been deleted, while the circles were all there.

They are now one row, kept under the `TrackedCircle` name to avoid renaming
every query. The club fields moved onto it, `circleId` became optional (a
club need not be tracked), and `ClubMember` points at it.

Migration `20261004130000_merge_clubs_into_circles`, approved explicitly by
the club because it moves live data, decides each club's row in order: the
circle already linked to it, else the one circle with the same name ignoring
case that no other club claimed, else a new row of its own (reusing the club
ID, `circleId` NULL, same guild as the existing circles). It copies rank,
headcount and fan count, moves staff (dropping a duplicate if two clubs land
on one row), and renames `Club` to `Club_backup_20261004` rather than
dropping it. Checked by hand on a scratch database seeded with a linked club,
a name-only match in different case, a club with no circle and staff on each,
and on an empty database. The startup "is it migrated" check now looks for
`TrackedCircle`, since `Club` no longer exists under that name.

Behaviour that follows:

- Every fan query spreads `TRACKED` (`circleId` not null), so clubs without a
  uma.moe circle never sync, report or appear in `/fans` or the dashboard;
  `syncCircle` refuses one outright.
- `/club create` takes an optional `circle_id` that starts tracking at once.
  `/fans circle add` (and the dashboard's add form) folds into an untracked
  club with the same uma.moe name instead of making a second club
  (`adoptUntrackedClub`, one transaction).
- `/fans club` staff checks read the row's own staff; the circle-to-club link
  and `/fans circle config club:` are gone.
- Home channels: `/club edit` on a tracked club sets the club's own channels,
  and `/fans club` and `/fans me` work in those and in any thread inside them,
  besides the report and alert channels and #staff-commands. Channel names
  are not matched: the Club Hall's names are too inconsistent to guess safely.
  A tracked club's name comes from uma.moe and is refreshed on sync, so the
  form offers the name only for untracked clubs (a modal holds five fields).
- `/club delete` removes the club's fan history and staff too.

---

## 2026-10-04 — /club edit form, /post, and shorter /fans commands

`/club edit club:` now opens a form pre-filled with the club's info instead of
taking name and rank as options. Club Managers get name, rank, headcount, fan
count and its period; the club's own staff get headcount and fan count only,
the same split `/club headcount` and `/club fancount` already had. The form's
custom ID carries the club and which form it is, and the submit checks
permission again, since it is a separate interaction. An empty fan count
clears it.

`/post` (Club Managers) opens a form to post as Akikawa: channel (a thread
works), Markdown message, optional file, and whether to pin it. Member and
role mentions work; @everyone and @here never ping.

Both forms use Discord's newer modal components (channel and string selects,
file upload, checkbox), supported since discord.js 14.27. Modal submits are
routed by custom-ID prefix in `index.ts`, like the timer panel's buttons, so a
form opened before a restart still submits.

`/fans check all|club|me` lost the `check` level and are now `/fans all`,
`/fans club` and `/fans me`. `/fans link` and `/fans unlink` are gone;
`/uma-id id:` links and `/uma-id remove:true` unlinks, with the same rules.

---

## 2026-10-04 — /uma-id

Members did not find `/fans link`, which is what `/fans check me`, `/fans
trainer` and alert tags rely on. `/uma-id id:` is a top-level shortcut for it;
with no ID it shows the current link. It is not called "register" or
"trainer", since Trainer is a club staff role here. Both commands share
`linkTrainer`, so the rules are identical (Club Managers link others; one
viewer ID per member). Messages that pointed at `/fans link` now point at
`/uma-id`.

---

## 2026-10-04 — club and me run in any circle channel; /club fancount takes ordinary amounts

`/fans check club` and `me` only ran in an actual thread (plus #staff-commands
for `club`). Primrose reports to #bot, a plain channel, so neither could run
there, and `me` was refused in #staff-commands. Both now run in any channel or
thread a circle reports or alerts to, and in #staff-commands. The channel
decides which circles are meant (all of them in #staff-commands); `me` shows
the caller's card for each of those they are currently in, and `club` takes
the named circle, the only one, or the one linked to the caller's club.

`/club fancount` accepted only "50M" written exactly so, while its own option
says "Amount in millions"; "50" or "50 m" were refused. `parseClubFanAmount`
now takes a bare number as millions, plus K/M/B in either case, spaces and
thousands separators.

---

## 2026-10-04 — /fans check all, club and me

The club asked for quota checks grouped by who runs them, rather than an
`all` flag that would be easy to fire by accident. `/fans check` is now a
group:

- `all` (Club Managers): syncs every active circle and posts each report and
  alert to its configured channels, or into the current channel as a public
  follow-up when it has none; the caller gets a private summary, and one
  circle failing does not stop the rest. Discord turns the first follow-up
  after a deferred reply into an edit of that reply, so the private reply is
  filled in before the first follow-up is sent.
- `club` (that club's Trainers and Assistants, and Club Managers): run in a circle's thread,
  syncs that circle and posts its report and alert there, publicly.
- `me` (everyone): run in a circle's thread, shows the caller's own progress
  privately. It replaces `/fans me`.

A thread belongs to the circle whose report or alert channel it is. "Trainer"
is the `/club` role, so a circle has to be linked to its club record first:
`/fans circle config club:` sets the link (`None` unlinks). Until a circle is
linked, only Club Managers can run `club` on it. The club's Assistants may run
it too (asked for after the first version allowed Trainers only).

`club` also runs in #staff-commands (`1427571157120450733`, overridable with
`STAFF_COMMANDS_CHANNEL_IDS`; empty means the default). There is no thread
to name the circle, so it is the one linked to the caller's own `/club`, or
the one given with the new `circle:` option, which Club Managers and staff on
several clubs need. Permission is checked against that circle the same way,
and the report posts in the staff channel.

---

## 2026-10-04 — Daily, weekly and biweekly quotas are checkpoints, not resets

The first version of quota periods measured each week or day on its own:
totals reset at every boundary and people were judged against a pro-rated
share every day. The club's actual rule is different. Totals are always
month-to-date, the requirement steps up by one quota at each period end (14M
weekly is 14M due by day 7, 28M by day 14; 2.5M daily is 2.5M by end of day
1, 5M by day 2), and nobody is reported until a checkpoint has passed.

`computeCircleProgress` keeps its MONTH path exactly as it was (the reference
rows still reproduce) and computes checkpoint periods separately: the last
checkpoint passed, the next one, what was due and what will be due, with the
day in progress never judged (`currentDay`, passed in for the current month).
The daily job's alert now posts only on the day after a checkpoint closes; a
manual `/fans check` always includes it. The dashboard and image show every
column in every period and a "next check end of day N · X due" line.

---

## 2026-10-04 — /fans me and /fans trainer find the circle themselves

In a server tracking several circles, `/fans me` refused to run without a
`circle` option, though the caller's trainer link already says who they are.
Both commands now look up the circles the trainer is currently in
(`circlesForTrainer`, using the same membership rule as the reports, so a
circle they left does not match). `/fans me` shows one card per circle;
`/fans trainer` uses the first by name. Naming a circle still works.

---

## 2026-10-04 — /fans check and /fans me

Asked for an on-demand quota check like another bot's `/force_check`, plus
a personal version. `/fans check` (Club Managers) syncs the circle from
uma.moe, then posts the report image and the behind-quota alert exactly as
the daily job does: to the configured channels with a private confirmation,
or into the current channel when none is set. If the sync fails or no key
is set, it reports from stored data and says so. To share that path, the
scheduler's `postReport` was split into `buildCircleReport` (render and
alert text) and the posting itself. The alert now gives the true number of
trainers behind rather than the number listed, which is capped at ten.

`/fans me` shows the caller's own window total, expectation, status, rank
among current members, need per day and projection, privately. A trainer who
has left is told they are not a current member.

A bare quota under 1,000 was briefly going to be refused as a probable
missing "M" (Primrose's quota is stored as 90). Dropped before shipping:
quotas are taken literally, and some circles deliberately use tiny quotas
for one-fan checks. No code path drops a typed suffix; Primrose was saved as
"90" and needs re-entering as 90M.

---

## 2026-10-04 — Leavers no longer count; fans count only while in the circle; biweekly quotas

People who had left a circle were still in its report. uma.moe keeps a leaver
in that month's member list with zeros from the day they left, and the bot
never deleted the rows it had already stored, so every leaver kept their
partial month in the table, the circle total and the circle target. A data
probe of 30 top circles' September payloads confirmed the shape (leavers
trailing zeros, joiners leading zeros, no mid-month gap shared by a whole
circle) and showed two things the spec does not: `daily_fans` has 32
entries, not 31, and a member can carry negative values in a circle they are
not really in. Negatives were already dropped at ingest.

`metrics.ts` now works out membership from the snapshots themselves.
`circleSnapshots` marks which indices the circle has at all, and
`isCurrentMember` drops anyone without a value at the latest one, before any
figure is computed. `monthGains` takes that mask and counts a day only when
the member had a snapshot at both ends of it, so a joiner counts from
joining, a returning member loses the gap and anything earned during it, and
a gap the whole circle shares still reads as a skipped scrape that catches
up. Quota days follow the same mask. The trainer report returns nothing for
a leaver, and the benchmark's club line uses current members only. For
members present all month nothing changes, so the 24 reference rows still
reproduce. Past months follow the same rule, so a September report no longer
lists people who left during September.

A BIWEEKLY quota period joins DAY, WEEK and MONTH: days 1-14, 15-28, then a
2-3 day stub whose goal scales, the same restart-on-the-1st rule as weeks.
The enum migration only adds a value. Windows are labelled by the weekly
weeks they cover, so the stub reads "Week 5 · days 29–31" in both modes.

---

## 2026-10-01 — Fans this month were lifetime totals; hourly sync and history backfill

Production showed fish@duck with 1,122,234,894 fans on game day 1, while
uma.moe's own page showed a monthly gain of +258,774. uma.moe's `daily_fans`
are lifetime counts, and the bot had treated them as counts that restart each
month. The API spec also says the game month starts on the 2nd JST, which is
why the first snapshot is a starting value with no gain of its own.
`monthGains` in `metrics.ts` now subtracts each member's starting snapshot,
and the member table, trainer report and the benchmark's club line all go
through it. It also records each member's first owing day explicitly, so a
trainer who earned nothing on their first days still counts as present.
Stored rows did not change, so no data migration was needed. Rewritten in
lifetime form, the reference fixture still reproduces all 24 rows exactly,
and a check uses the fish@duck numbers to assert +258,774.

`currentGameMonth` now rolls over on the 2nd JST like uma.moe, so on the 1st
the dashboard still shows the month that is ending, and report dates put game
day 1 on the 2nd.

uma.moe refreshes live figures hourly for most circles (every 5 minutes for
the top 100), so the scheduler now syncs every active circle and the
benchmark hourly and still posts reports once a day. Past months are
imported once per circle (`backfillOnce`), newest first, up to 12 months or
until uma.moe returns an empty month, without overwriting the circle's
current name or rank. The hourly job runs it for every circle, including ones
added before this change, and adding a circle starts it at once. Creating the
`backfill:<id>` JobRun marker acts as the lock, so concurrent callers cannot
double-import or throw. `scripts/test-backfill.ts` covers this against a
local stand-in for uma.moe.

---

## 2026-10-01 — Incident: restart loop after the master merge

After the merge into master, production restart-looped with "FATAL: Discord
login failed: Used disallowed intents" and the site returned 502. The merge
asked for MessageContent on the first connection attempt, and that toggle is
off in the developer portal. The intent fallback added in the same merge never
ran, because with @discordjs/ws 1.2.x a refused intent can surface as
`login()` rejecting, and startup treated every login rejection as fatal. The
earlier incident notes said login never rejects; I relied on that without
testing the refusal path.

`connect()` in `src/lib/startup.ts` now returns 'disallowed-intents' for
either signal (the 4014 close event or that rejection) and rethrows anything
else, and startup uses it for every attempt. Four new checks in
`test-startup` cover it, including the exact production rejection. I also ran
the built bot with `login()` stubbed to refuse MessageContent: it logged which
toggle to enable, fell back to Guilds + GuildMembers, and `/healthz` returned
200 with `messageContentIntent: false`.

---

## 2026-10-01 — Daily, weekly or monthly quotas

### Why

Requested: "allow daily/weekly (cuts off on the 1st too) or monthly". Decided
with the user: weeks are days 1-7, 8-14, ... of the game month; the short
final week's goal scales by its days; the quota is entered per period.

### What

- `TrackedCircle.quotaPeriod` (`DAY` | `WEEK` | `MONTH`, default `MONTH`).
  The amount field is `quota` in code but keeps its `monthlyQuota` column via
  `@map`, so the migration only adds the enum and column; no data moves.
- `computeCircleProgress` measures inside the current window; see the new
  section in `docs/quota-math.md`. `CircleProgress` gains `period`, `quota`,
  `windowStart`, `windowEnd`, `windowLabel`.
- `/fans circle add|config` take `period`; the dashboard forms get a "Per"
  selector. An omitted period keeps the current one on update.
- Reports say "weekly report", show the window ("week 2 · days 8–14") and
  flag a scaled short week. DAY mode hides avg/day, need/day, latest-day gain
  and projection, which would only repeat the day's total or its shortfall. Applied to the current
  report design; the visual redesign is held back separately.
- `parseQuota` also accepts thousands separators ("80,000,000", "1,500M").
  K/M/B suffixes already worked.

### Verified

37 new metric checks (window edges incl. February and short weeks, weekly and
daily pace, mid-week joiner, rank reset), 5 parser checks, 8 dashboard checks
(set, reject, keep period). MONTH reference rows unchanged. Weekly and daily
reports rendered through the real maths and inspected.

---

## 2026-10-01 — Fix: adding a circle failed with "Cannot convert undefined to a BigInt"

### Root cause

uma.moe's OpenAPI spec marks **no** property as required, but
`src/lib/umamoe/types.ts` typed optional fields as `T | null`, i.e. always
present. `syncCircle` guarded `previous_circle_id` and `next_month_start` with
`=== null`; when uma.moe omitted them, `undefined` passed the guard and
`BigInt(undefined)` threw. Adding a circle runs a sync immediately and rolls
back on failure, so the error surfaced on the dashboard's add-circle form.

Reproduced end to end: a local fake uma.moe returning a member without those
fields makes the old `syncCircle` fail with exactly that message against a real
Postgres; the fixed one writes the rows with `null`.

### Fix

- Every uma.moe field is now `?: T | null`, so the compiler flags any unsafe
  use. It found ~20, all in `ingest.ts`, `client.ts` and `/fans circle search`.
- `normalizeMember` (pure, tested) resolves one raw member: absent = `null`,
  no `viewer_id` = skipped, missing year/month = the requested month.
- A response with no `circle` object now fails with a readable message.
- `scripts/test-fans.ts` gains 10 checks for omitted fields.

Also carries the September date-bomb fix for `scripts/test-fans.ts` (see the
redesign entry), since CI on this branch is red without it from 2026-10-01.

---

## 2026-10-01 — Prefix `;role add` / `;role remove` (Dyno replacement)

**Why:** Dyno deprecated prefix commands, so `;role add <user> <role>` stopped working.
Officers still type it. Akikawa now handles it.

**Usage**
```
;role add <member> <role>
;role remove <member> <role>
```
- `<member>`: mention, ID, username, nickname, or the start of one. Quote it if it has spaces (`"Mara M"`).
- `<role>`: mention, ID, or full/partial role name. Everything after the member is the role.
- Matching order (case-insensitive): exact, then prefix, then substring (roles only).
  Several hits in the same tier is reported as ambiguous instead of guessing.
- Needs **Manage Roles**. Prefix comes from `COMMAND_PREFIX` (default `;`).

**Files**
- `src/prefix/index.ts` — `messageCreate` dispatcher, tokenizer (supports `"quoted args"`).
- `src/prefix/role.ts` — the command.
- `src/lib/resolvers.ts` — text -> member/role. Member names use the REST member-search
  endpoint, so the privileged GuildMembers intent is NOT needed.
- `src/lib/roleAssignment.ts` — club-role rules, moved out of `src/commands/role.ts` so
  `/role` and `;role` share them.

**Behaviour changes to `/role`**
- Now refuses roles at/above the caller's highest role (Discord's own rule; owner exempt),
  roles at/above the bot's highest role, managed roles, and @everyone. Before, anyone with
  Manage Roles could hand out any role below the bot.
- Role changes now carry an audit-log reason.

**Deployment requirements**
- Enable **Message Content Intent** in the developer portal (Bot -> Privileged Gateway
  Intents). Without it `;role` stays off. Since the merge into master the bot no
  longer fails to log in over it: startup steps down `INTENT_LADDER` in
  `src/index.ts` and logs which intent to enable; `/healthz` reports
  `messageContentIntent`.
- Dyno still answers `;` with its deprecation notice. Change or disable Dyno's prefix,
  or set `COMMAND_PREFIX` to something else.

**Verification**
- `tsc --noEmit` passes with zero errors once `prisma generate` has run.
  (`prisma generate` needs `DATABASE_URL` set, even a placeholder, because
  `prisma.config.ts` uses `env()`; the Dockerfile already sets one.)
- `ts-node src/index.ts` compiles and reaches Discord login with the env vars set.
- An earlier note here claimed `tsc` and `ts-node` were broken. That was wrong: both
  failures came from the test sandbox (no `DATABASE_URL`, a test file outside `src/`).

---

## 2026-09-19 — Incident: restart loop after enabling the GuildMembers intent

### What happened

Requesting the `GuildMembers` intent took the bot offline. It is a privileged
intent that must also be enabled in the Discord developer portal; it was not,
so Discord refused the gateway connection. Two follow-up fixes ("exit with a
clear message", then "fall back to base intents") both changed nothing,
because both keyed off `client.login()` rejecting — and it never does.

### Root cause

`discord.js/src/client/websocket/WebSocketManager.js`, lines 249–259: on an
unrecoverable close code (4014 DisallowedIntents among them) the manager sets
the shard to `Disconnected`, emits `shardDisconnect`, logs at debug level, and
**returns**. No throw, no rejection, no `ready`. The process sat un-ready
forever. The dashboard — and with it `/healthz` — was started inside the
`ClientReady` handler, so nothing ever bound the port. Railway's health check
failed after 300 s, the container was killed and restarted, and the public URL
alternated between a hard timeout and a 502 indefinitely.

Two independent mistakes compounded: assuming a library rejects on failure
without checking, and coupling HTTP liveness to Discord readiness.

### Fix

- `src/lib/startup.ts`: `waitForConnectOutcome(client)` listens for `ready`
  and for unrecoverable `shardDisconnect` codes and resolves to `ready`,
  `disallowed-intents` or `fatal`. Recoverable blips are ignored.
- `start()` races that against `login()`. On `disallowed-intents` it destroys
  the client, logs the exact portal path, and reconnects with the base
  intents. On `fatal` it exits naming the token.
- The dashboard starts **before** any login, bound to a getter for the current
  client. `/healthz` answers from the first second and reports
  `discord: false` until the gateway is up. A Discord failure now degrades one
  feature instead of taking the container down.
- Tested without a network by driving a bare `Client`'s emitter (8 assertions,
  including that the helper's listener is removed on settle, measured against
  discord.js's own baseline listener).

Both newest migrations were replayed against a production-shaped database
while diagnosing, to rule them out. They apply cleanly.

### Correction to the diagnosis

While waiting for the fix to deploy I read a second cause into the timing --
a ~2-minute 502 window looked like the entrypoint's migration retry loop, so
I proposed a stuck migration (P3009) on the production database. That was
wrong. When the fix finally went live, `/healthz` showed migrations applied on
attempt 1. The real reason the fix "wasn't working" was simpler: five pushes
in 25 minutes, and Railway builds them sequentially at 3–5 minutes each, so
the commit I was probing for had not been deployed yet. The gateway-hang root
cause was correct; the migration theory was over-fitted to timing.

The migration-in-process change stands regardless: it made `/healthz` show
the answer directly, which is what ended the guessing.

### Also this session

- CI added: Postgres service, migrate, typecheck, all suites, build, and a
  Docker image build with a font-registration smoke test inside the image. The
  first run proved the Dockerfile builds; the only failure was the smoke test
  running through the migration entrypoint, fixed with `--entrypoint node`.
- `/fans circle debug` and stored transfer signals, for the late-joiner
  question.

---

## 2026-09-19 — Dashboard retheme, training heatmap, monthly rank

### Dashboard

Moved onto the same system as the rendered images: IBM Plex served to the
browser from the bundled files via `/fonts`, the theme palette in CSS,
tracked uppercase headings, flat hairline panels, placement tints and the
"behind" bar as a left border on table rows, em dashes for empty cells.

Added: sortable tables (a tiny dependency-free script; numeric cells compare
as numbers after stripping separators, dashes sort last), a month picker on
the circle page backed by `listCircleMonths`, and the projected column. The
training table now resolves display names through the bot's member cache
rather than printing raw IDs.

Verified by driving the real app in headless Chromium against seeded data and
inspecting every page. Playwright is installed with `--no-save` for that, so
it stays out of `package.json`.

### Training heatmap

`getHourlyHeatmap` buckets completed runs by weekday and hour in the streak
timezone; the stats card draws it as a 7×24 grid under the bar chart. Tested
with runs that cross the date line: Monday 15:30 UTC lands on Tuesday 00h JST,
Sunday 14:00 UTC on Sunday 23h JST. Without that, the heatmap would be offset
by nine hours and show people training at times they were asleep.

### Monthly rank

`syncCircle` received uma.moe's `monthly_rank` and discarded it, so every
report header read "UNRANKED". Stored on `TrackedCircle` (nullable, additive
migration) and passed to all three render sites.

---

## 2026-09-19 — Visual restyle and richer reports

### Direction

Reference supplied by the user: uma-legends-cup's race tables. Monospace
throughout, tracked uppercase headings, one accent (gold) for structure and
targets, red reserved for a single meaning, warm near-black, placement tints on
a left bar, em dashes for empty cells. Every renderer now sits on
`src/lib/image/theme.ts`, which owns the palette and the text helpers.

### Fonts

IBM Plex Mono (Latin, digits) and IBM Plex Sans JP (CJK), bundled in
`src/assets/fonts` and registered at import. One superfamily, so mixed-script
rows read as a single face. Plex Mono's digits are tabular by nature; canvas
cannot toggle `tnum`, so a proportional face would make numeric columns wobble.
Details in `docs/fonts.md`.

### Additions (no extra API calls; all derived from ingested data)

**Fan report** — seven-day sparkline per member scaled to their own range, so
it shows the shape of the week rather than magnitude; straight-line month-end
projection per member and for the club; a club-wide progress bar with a tick
at where the club *should* be today, so it reads as pace rather than
accumulation. Club-level figures stay in millions throughout.

**Trainer report** — rank and percentile in the circle, best single day this
month, consecutive days at or above the daily quota, and the daily quota drawn
as a guide line on the chart so each day is read against the target.

**Benchmark** — the club overlaid as a fourth series, with its current
fans/member/day and where that places it ("outside top 100"). Turns "what does
it take" into "where are we".

### Fixes found while restyling

- Chart point labels collided with the legend when the peak sat at the top of
  the plot. The plot now reserves headroom when point labels are on.
- A patch script swapped a colour literal before a regex that matched on it,
  leaving the club directory on the old gradient. Replaced with a flat fill.

### Not restyled

Rank tier badges and headcount bar colours on the club directory encode
meaning (tier, fill level) and were left alone.

---

## 2026-09-19 — Removed the session secret; commands self-register

### `DASHBOARD_SESSION_SECRET` is no longer required

Asking an operator with no terminal to "generate 32 random bytes" was a bad
requirement. The bot already holds a secret nobody else has — its Discord
token — and anyone in possession of that token owns the bot outright, so
deriving the cookie-signing key from it adds no new attack surface.

The key is `HMAC-SHA256(DISCORD_TOKEN, "akikawa:dashboard-session:v1")`, not
the raw token, so what ends up in cookie signatures cannot be replayed against
Discord. Rotating the bot token rotates the key and signs everyone out, which
is the right outcome. An explicit `DASHBOARD_SESSION_SECRET` still overrides
the derivation, for anyone who wants sessions to survive a token rotation.

Verified: dashboard starts without the variable; derived key is 64 hex chars,
stable across loads, distinct per token, and not equal to the token; a cookie
sealed with it verifies through the real app; explicit override wins.

### Slash commands register on startup

`npm run deploy-commands` from a developer's machine is no longer part of a
deploy. The bot bulk-PUTs its command set on `ClientReady`, using the
application ID from the logged-in client. Idempotent, so every boot simply
re-asserts the set. Failure is logged, not fatal. The script remains for
pushing commands without starting the bot.

---

## 2026-09-17 — Hosting on Railway

Everything runs in one process, so Railway needs two services: this repo and a
Postgres database.

### `railway.json` is load-bearing

Railway's default builder ignores the `Dockerfile`. The `Dockerfile`'s
entrypoint is what runs `prisma migrate deploy`, so building with anything else
would leave the schema empty and reproduce the original P2021 outage exactly.
`builder: "DOCKERFILE"` is pinned to prevent that.

Also set: `sleepApplication: false` (a sleeping container drops the gateway and
stops the schedulers), `numReplicas: 1` (timer delivery is already
exactly-once via `DELETE … RETURNING`, but two replicas would race the daily
job marker and could double-post reports), and a health check with a 300s
timeout for the migration step on a cold deploy.

### Port binding

The dashboard read `DASHBOARD_PORT` only. Every PaaS injects `PORT` and routes
traffic to it — binding anything else means the health check never connects and
no traffic arrives. Precedence is now `PORT` → `DASHBOARD_PORT` → `3000`, and
the server binds `0.0.0.0` explicitly rather than loopback.

`DASHBOARD_BASE_URL` now falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, so the
OAuth callback URL does not have to be hand-copied and kept in sync. An
explicit value still wins, for custom domains and local runs.

### `/healthz`

Unauthenticated and registered before every other route — a probe that
redirected to the login flow would read as unhealthy and restart-loop the
container. It checks the database as well as the process, so a deploy that
cannot reach Postgres fails loudly.

This was validated by accident: Postgres stopped mid-session and the endpoint
correctly returned `503 {"ok":false,"error":"database unreachable"}`, then
`200 {"ok":true,"discord":true}` once it came back.

### Removed Redis

`ioredis` and the Compose `redis` service were never imported anywhere in
`src/`. On Railway that would have been a third service costing money to sit
idle. Dependency and service both dropped; lockfile verified in sync so
`npm ci` still succeeds.

### Not verified here

No Docker daemon in this environment, so the image was not built. Verified
instead: the entrypoint is valid `sh`, both font packages resolve in Debian,
the lockfile matches `package.json`, TypeScript compiles, and all 272
assertions pass. The first Railway build is the real test of the image.

---

## 2026-09-16 — Dashboard, and two more startup bugs

### Dashboard

Self-hosted, Discord OAuth, running **inside the bot process**. One container,
one connection pool, and no way for the dashboard's view of the data to drift
from the bot's. Disabled unless configured, so the bot still starts without it.

Sessions are a signed, stateless cookie: nothing to lose on restart, no session
store, and the Discord access token is used once during callback and then
discarded rather than being kept in the cookie.

Charts on the dashboard are the bot's own PNG renderers served as `<img>`, so
every figure has exactly one implementation.

Reading is open to any guild member. Every mutation requires a Club Manager
role **and** a CSRF token. `scripts/test-dashboard.ts` drives the real app over
HTTP and covers the parts that are expensive to get wrong:

| Concern | Covered |
| --- | --- |
| Anonymous access | pages redirect, images refuse, no data leaks |
| Forged cookie | tampered signature rejected |
| Role separation | members cannot see or perform mutations |
| CSRF | missing and wrong tokens both refused, state unchanged |
| XSS | a circle named `<script>alert(1)</script>` renders escaped |
| Open redirect | `https://evil` and `//evil` both refused |
| Tenancy | another guild's circle is a 404 |
| Bad input | non-numeric IDs 404 rather than crash |

42 assertions, all passing.

### Second startup bug: /settag crashed the whole bot

Found while smoke-testing the compiled build. With `TAG_TRANSFER_ID` or
`TAG_CLUB_APP_ACCEPTED_ID` unset, `setTag.ts` passed `{ value: undefined }` to
`addChoices`, which throws inside discord.js option validation **at module
load** — the process died before it ever signed in, with a
`@sapphire/shapeshift` stack trace that named neither `/settag` nor the missing
variable.

Same class as the P2021 outage: a one-line configuration problem presenting as
an opaque failure somewhere else entirely.

Fixed three ways:

1. **`src/lib/env.ts`** validates the environment at startup and reports every
   missing variable at once, in plain language, separating what stops the bot
   from what merely disables a feature. Imported before the command modules,
   since several read configuration at load time.
2. **`setTag.ts`** builds its choice list only from IDs that are configured,
   and skips `addChoices` entirely when none are. An unconfigured tag now
   simply does not appear.
3. The command checks at runtime that the chosen tag is configured.

### Third bug: /settag wiped a thread's existing tags

`setAppliedTags([tagId])` replaced every tag on the thread, while the code
immediately above computed `newTags` (append) and checked it against Discord's
five-tag limit. The computed value was discarded, which also made that limit
check unreachable. Now applies `newTags`.

Also fixed: the five-tag guard replied and then fell through to reply a second
time, throwing `InteractionAlreadyReplied`.

### Test suite

`npm test` — 272 assertions across five suites, all passing:

| Suite | Assertions | Covers |
| --- | --- | --- |
| metrics | 148 | quota maths against a real reference report |
| fans | 34 | snapshot round-trip, quota parsing, gap handling |
| dashboard | 42 | auth, CSRF, XSS, redirects, tenancy |
| timer | 33 | streaks, leaderboards, lifecycle |
| scheduler | 15 | offline recovery, exactly-once delivery |

---

## 2026-09-16 — Independent Training timer

A 50-minute Independent Training timer with a button panel, persistence across
restarts, and statistics.

### Fixed duration, on purpose

The timer models one specific game mechanic, so there are no custom or preset
durations. `TRAINING_MINUTES` is a constant, not configuration.

### Timers survive downtime

The reference bot discards any timer that reaches zero while it is offline.
Ours does not. Timers are rows in Postgres, never in-process `setTimeout`
handles, and the scheduler is a 10-second poll over an indexed `expiresAt`
column. On boot the first tick runs immediately, so everything that came due
during downtime is delivered at once. The ping says so explicitly:

> This run ended about 40 minutes ago while the bot was offline. It still counted.

Runs are credited to their scheduled `expiresAt`, not to delivery time, so a
late ping cannot distort daily counts or streaks. `deliveryLagS` records the
gap for diagnostics.

Expiry claiming uses a single `DELETE ... RETURNING` statement. Two overlapping
ticks therefore cannot both claim the same timer and double-ping a trainer.

### Engagement

Statistics exist to make accumulated effort visible:

- `/timer stats` renders a card: total runs, current streak, runs this week,
  total time trained, guild placement, and a 14-day bar chart.
- `/timer leaderboard` renders a ranked table with bars scaled to the leader,
  over 7 / 30 / all-time windows.
- Expiry pings call out run milestones (1, 10, 25, 50, 100, 250, 500, 1000,
  2500) and new personal-best streaks.
- The panel shows a live roster, runs completed guild-wide today, and who is
  leading today.

Streaks are bucketed by calendar day in `TIMER_STREAK_TIMEZONE` (default
`Asia/Tokyo`, matching the game reset), not UTC. A streak stays alive if the
trainer trained yesterday but not yet today, so it is not reported as broken
partway through a day.

### Panel

Countdowns use Discord relative timestamps (`<t:unix:R>`), which tick client
side, so the roster stays live without the bot editing the message on a timer.
Buttons route by custom ID rather than through a component collector, so panels
posted before a restart keep working afterwards.

### Notification cleanup

Expiry pings are deleted after 10 minutes. Pending deletions live in their own
table rather than on the timer row, so a trainer can start their next run the
instant they are pinged instead of waiting out the notification's lifetime.

### Tests

`npm test` runs both suites against a real Postgres.

- `scripts/test-timer.ts` — 33 assertions covering streaks (gaps, multiple runs
  per day, month boundaries, yesterday-anchored streaks), leaderboard windows,
  ranking, and the start/reset/stop lifecycle. All passing.
- `scripts/test-scheduler.ts` — 15 assertions driving the real scheduler with a
  stub Discord client, covering offline expiry recovery, in-progress timers
  being left alone, exactly-once delivery across ticks, lag recording, and
  notification auto-deletion. All passing.

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
