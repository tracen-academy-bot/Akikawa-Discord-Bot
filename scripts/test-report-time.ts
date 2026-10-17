/**
 * Per-club report times: parsing, time-zone arithmetic (daylight saving
 * included), and the scheduler posting each club once per local day at its
 * own time. Uses a stub Discord client, and marks circles freshly synced so
 * no uma.moe request is made.
 *
 *   DATABASE_URL=postgresql://... npm run test:report-time
 */
import { prisma } from '../src/db/prisma';
import { currentGameMonth } from '../src/lib/fans/ingest';
import {
    COMMON_ZONES,
    describeZone,
    formatTimeOfDay,
    isReportDue,
    localDateKey,
    nextReportAt,
    parseTimeOfDay,
    reportTimeOf,
} from '../src/lib/fans/reportTime';
import { postDueReports } from '../src/lib/fans/scheduler';

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

const utc = (iso: string) => new Date(`${iso}Z`);

function parsing() {
    check('24-hour time', parseTimeOfDay('21:00'), 21 * 60);
    check('minutes kept', parseTimeOfDay('9:30'), 9 * 60 + 30);
    check('9pm', parseTimeOfDay('9pm'), 21 * 60);
    check('9:30 PM with a space', parseTimeOfDay('9:30 PM'), 21 * 60 + 30);
    check('12am is midnight', parseTimeOfDay('12am'), 0);
    check('12pm is noon', parseTimeOfDay('12pm'), 12 * 60);
    check('0930', parseTimeOfDay('0930'), 9 * 60 + 30);
    check('a bare hour', parseTimeOfDay('7'), 7 * 60);
    check('24:00 is not a time', parseTimeOfDay('24:00'), null);
    check('13pm is not a time', parseTimeOfDay('13pm'), null);
    check('9:60 is not a time', parseTimeOfDay('9:60'), null);
    check('words are not a time', parseTimeOfDay('soon'), null);
    check('formats with leading zeros', formatTimeOfDay(5 * 60 + 7), '05:07');
    check('every offered zone is real', COMMON_ZONES.every((z) => { try { new Intl.DateTimeFormat('en', { timeZone: z.zone }); return true; } catch { return false; } }), true);
    check('at most 24 offered, leaving room for a custom one', COMMON_ZONES.length <= 24, true);
}

function clock() {
    const jst21 = { minute: 21 * 60, zone: 'Asia/Tokyo' };
    // 21:00 JST is 12:00 UTC.
    check('not due before the time', isReportDue(jst21, utc('2026-10-17T11:59:00'), null), false);
    check('due at the time', isReportDue(jst21, utc('2026-10-17T12:00:00'), null), true);
    check('not due twice on one local day', isReportDue(jst21, utc('2026-10-17T14:00:00'), utc('2026-10-17T12:00:00')), false);
    // 00:30 JST on the 18th: a new local day, but before 21:00.
    check('a new local day waits for the time again', isReportDue(jst21, utc('2026-10-17T15:30:00'), utc('2026-10-17T12:00:00')), false);
    check('due the next local day', isReportDue(jst21, utc('2026-10-18T12:05:00'), utc('2026-10-17T12:00:00')), true);
    check('late but same local day still posts', isReportDue(jst21, utc('2026-10-17T14:50:00'), utc('2026-10-16T12:00:00')), true);
    check('local date follows the zone', localDateKey('Asia/Tokyo', utc('2026-10-17T15:30:00')), '2026-10-18');

    check('next report later today', nextReportAt(jst21, utc('2026-10-17T10:00:00')).toISOString(), '2026-10-17T12:00:00.000Z');
    check('next report tomorrow once passed', nextReportAt(jst21, utc('2026-10-17T12:00:00')).toISOString(), '2026-10-18T12:00:00.000Z');

    // New York leaves daylight saving on 2026-11-01: 09:00 is 13:00 UTC before, 14:00 after.
    const ny9 = { minute: 9 * 60, zone: 'America/New_York' };
    check('09:00 New York in October is 13:00 UTC', nextReportAt(ny9, utc('2026-10-31T00:00:00')).toISOString(), '2026-10-31T13:00:00.000Z');
    check('09:00 New York after the change is 14:00 UTC', nextReportAt(ny9, utc('2026-10-31T20:00:00')).toISOString(), '2026-11-01T14:00:00.000Z');
    check('due by local time after the change', [isReportDue(ny9, utc('2026-11-01T13:30:00'), null), isReportDue(ny9, utc('2026-11-01T14:00:00'), null)], [false, true]);

    check('no setting means the server default in UTC', reportTimeOf({ reportMinute: null, reportTimeZone: null }), { minute: 13 * 60, zone: 'UTC' });
    check('an unknown stored zone falls back to the default', reportTimeOf({ reportMinute: 60, reportTimeZone: 'Mars/Olympus' }).zone, 'UTC');
    check('Japan time reads as JST', describeZone('Asia/Tokyo', utc('2026-10-17T00:00:00')), 'Japan time (JST)');
    check('other zones show their offset', describeZone('America/New_York', utc('2026-10-17T00:00:00')), 'US Eastern (New York), UTC-4');
}

async function scheduler() {
    const GUILD = 'test-guild-report-time';
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });

    const sent: string[] = [];
    const client = {
        channels: {
            fetch: async (id: string) => ({
                isTextBased: () => true,
                send: async () => {
                    sent.push(id);
                    return { id: 'm' };
                },
            }),
        },
    } as never;

    // Synced "in the future" so the scheduler never fetches from uma.moe,
    // including for circles other test files left in this database.
    const fresh = new Date('2099-01-01T00:00:00Z');
    await prisma.trackedCircle.updateMany({ data: { lastSyncedAt: fresh } });
    const make = (name: string, circleId: number, extra: object) =>
        prisma.trackedCircle.create({
            data: { guildId: GUILD, circleId: BigInt(circleId), name, reportChannelId: `r-${name}`, lastSyncedAt: fresh, ...extra },
        });
    const jst = await make('JST', 9_100_001, { reportMinute: 21 * 60, reportTimeZone: 'Asia/Tokyo' }); // 12:00 UTC
    const ny = await make('NY', 9_100_002, { reportMinute: 6 * 60, reportTimeZone: 'America/New_York' }); // 10:00 UTC (EDT)
    const def = await make('Default', 9_100_003, {}); // 13:00 UTC
    await prisma.trackedCircle.create({ data: { guildId: GUILD, circleId: BigInt(9_100_004), name: 'NoChannel', lastSyncedAt: fresh } });
    await make('Paused', 9_100_005, { active: false });

    // Each needs data this game month, or there is no report to post.
    const { year, month } = currentGameMonth();
    for (const c of [jst, ny, def]) {
        for (const day of [1, 2]) {
            await prisma.fanSnapshot.create({
                data: { trackedCircleId: c.id, viewerId: BigInt(1), trainerName: 'T', year, month, day, cumulativeFans: BigInt(1_000_000 * day) },
            });
        }
    }

    const step = async (iso: string) => {
        sent.length = 0;
        await postDueReports(client, utc(iso));
        return sent.filter((id) => id.startsWith('r-')).sort();
    };
    check('09:00 UTC: nothing due', await step('2026-10-17T09:00:00'), []);
    check('10:05 UTC: New York (06:00 EDT) posts', await step('2026-10-17T10:05:00'), ['r-NY']);
    check('10:10 UTC: not again', await step('2026-10-17T10:10:00'), []);
    check('12:00 UTC: Japan (21:00 JST) posts', await step('2026-10-17T12:00:00'), ['r-JST']);
    check('13:00 UTC: the default posts; no channel and paused never do', await step('2026-10-17T13:00:00'), ['r-Default']);
    check('15:30 UTC (00:30 JST): a new Japan day, but before 21:00', await step('2026-10-17T15:30:00'), []);
    check('next day: each posts again at its own time',
        [await step('2026-10-18T10:00:00'), await step('2026-10-18T12:00:00'), await step('2026-10-18T13:00:00')],
        [['r-NY'], ['r-JST'], ['r-Default']]);
    check('the marker is stored', (await prisma.trackedCircle.findUniqueOrThrow({ where: { id: jst.id } })).lastReportAt?.toISOString(), '2026-10-18T12:00:00.000Z');

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
}

async function main() {
    parsing();
    clock();
    await scheduler();
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    if (fail > 0) process.exit(1);
}

void main();
