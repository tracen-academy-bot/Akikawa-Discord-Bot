/**
 * When each club's daily report is posted.
 *
 * A club sets a time of day and a time zone in `/club reports`. Japan time is
 * the usual choice because the game runs on it; the other zones let a club
 * use its staff's local time, and they follow daylight saving. With neither set, the
 * report goes out at FAN_SYNC_HOUR_UTC in UTC, as before.
 *
 * A report is due once per local day, at or after its time. The scheduler
 * records when it last posted, so a restart never posts the same day twice;
 * a bot that was down at report time posts when it is back, the same day.
 */

/** The game's time zone, offered first. */
export const JAPAN_TIME_ZONE = 'Asia/Tokyo';

/** UTC hour reports go out when a club has not set a time. */
export const DEFAULT_REPORT_HOUR_UTC = Number(process.env.FAN_SYNC_HOUR_UTC ?? 13);

/** A club's report time, in minutes after local midnight, in an IANA zone. */
export interface ReportTime {
    minute: number;
    zone: string;
}

/** The two stored columns, as they come off a club row. */
export interface ReportTimeColumns {
    reportMinute: number | null;
    reportTimeZone: string | null;
}

/** The time a club's reports go out: its own, or the default. */
export function reportTimeOf(club: ReportTimeColumns): ReportTime {
    if (club.reportMinute !== null && club.reportTimeZone && isTimeZone(club.reportTimeZone)) {
        return { minute: club.reportMinute, zone: club.reportTimeZone };
    }
    return { minute: DEFAULT_REPORT_HOUR_UTC * 60, zone: 'UTC' };
}

/** True when a club has set its own time. */
export function hasOwnReportTime(club: ReportTimeColumns): boolean {
    return club.reportMinute !== null && club.reportTimeZone !== null;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * A time of day as minutes after midnight: "21:00", "9:30", "9pm",
 * "9:30 PM", "0930". Null when it is not one.
 */
export function parseTimeOfDay(text: string): number | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, '');
    const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const meridiem = m[3];
    if (minute > 59) return null;
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    }
    if (hour > 23) return null;
    return hour * 60 + minute;
}

/** "21:00". */
export function formatTimeOfDay(minute: number): string {
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Time zones the report form offers, Japan time first. Each follows daylight
 * saving where the place does. A form allows at most 25 options; one is kept
 * free for a club already set to a zone not listed here.
 */
export const COMMON_ZONES: { label: string; zone: string }[] = [
    { label: 'Japan time (JST)', zone: JAPAN_TIME_ZONE },
    { label: 'Korea', zone: 'Asia/Seoul' },
    { label: 'China, Taiwan, Hong Kong, Singapore, Philippines, Malaysia', zone: 'Asia/Singapore' },
    { label: 'Thailand, Vietnam, Indonesia (Jakarta)', zone: 'Asia/Bangkok' },
    { label: 'India', zone: 'Asia/Kolkata' },
    { label: 'Australia East (Sydney, Melbourne)', zone: 'Australia/Sydney' },
    { label: 'Australia West (Perth)', zone: 'Australia/Perth' },
    { label: 'New Zealand', zone: 'Pacific/Auckland' },
    { label: 'UTC', zone: 'UTC' },
    { label: 'UK, Ireland, Portugal', zone: 'Europe/London' },
    { label: 'Central Europe (Paris, Berlin, Madrid)', zone: 'Europe/Berlin' },
    { label: 'Eastern Europe (Athens, Kyiv)', zone: 'Europe/Athens' },
    { label: 'Turkey, Moscow', zone: 'Europe/Istanbul' },
    { label: 'Gulf (Dubai)', zone: 'Asia/Dubai' },
    { label: 'Brazil (São Paulo)', zone: 'America/Sao_Paulo' },
    { label: 'Argentina', zone: 'America/Argentina/Buenos_Aires' },
    { label: 'US Eastern (New York)', zone: 'America/New_York' },
    { label: 'US Central (Chicago)', zone: 'America/Chicago' },
    { label: 'US Mountain (Denver)', zone: 'America/Denver' },
    { label: 'Arizona', zone: 'America/Phoenix' },
    { label: 'US Pacific (Los Angeles)', zone: 'America/Los_Angeles' },
    { label: 'Alaska', zone: 'America/Anchorage' },
    { label: 'Hawaii', zone: 'Pacific/Honolulu' },
];

/** True for a time zone `Intl` accepts. */
export function isTimeZone(zone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

/** "UTC+9" for a zone at `at`. */
export function utcOffsetLabel(zone: string, at: Date): string {
    const minutes = offsetMinutes(zone, at);
    if (minutes === 0) return 'UTC';
    const sign = minutes > 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}

/** How the zone reads in replies: "Japan time (JST)" or "US Eastern (New York), UTC-4". */
export function describeZone(zone: string, at: Date): string {
    if (zone === JAPAN_TIME_ZONE || zone === 'UTC') return COMMON_ZONES.find((z) => z.zone === zone)!.label;
    const label = COMMON_ZONES.find((z) => z.zone === zone)?.label ?? zone;
    return `${label}, ${utcOffsetLabel(zone, at)}`;
}

// ── Clock arithmetic ─────────────────────────────────────────────────────────

/** Wall-clock fields of `at` in `zone`. */
function localParts(zone: string, at: Date): { year: number; month: number; day: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return { year: get('year'), month: get('month'), day: get('day'), minute: get('hour') * 60 + get('minute') };
}

/** Minutes the zone is ahead of UTC at `at`. */
function offsetMinutes(zone: string, at: Date): number {
    const p = localParts(zone, at);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minute);
    return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** `YYYY-MM-DD` of `at` in `zone`. */
export function localDateKey(zone: string, at: Date): string {
    const p = localParts(zone, at);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * True when a club's report should go out now: its local time has passed
 * today, and no scheduled report has gone out yet on this local day.
 */
export function isReportDue(time: ReportTime, now: Date, lastReportAt: Date | null): boolean {
    if (localParts(time.zone, now).minute < time.minute) return false;
    return lastReportAt === null || localDateKey(time.zone, lastReportAt) !== localDateKey(time.zone, now);
}

/**
 * The next time the report is due after `now`: today's time if still ahead,
 * else tomorrow's. Exact across daylight-saving changes; a time skipped by
 * one lands just after the jump.
 */
export function nextReportAt(time: ReportTime, now: Date): Date {
    const today = localParts(time.zone, now);
    for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
        const wall = Date.UTC(today.year, today.month - 1, today.day + dayOffset, 0, time.minute);
        // Two passes settle the offset, including on a daylight-saving day.
        let at = new Date(wall - offsetMinutes(time.zone, new Date(wall)) * 60_000);
        at = new Date(wall - offsetMinutes(time.zone, at) * 60_000);
        if (at.getTime() > now.getTime()) return at;
    }
    return new Date(now.getTime() + 86_400_000);
}
