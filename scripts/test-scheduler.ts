/**
 * End-to-end test for the timer scheduler.
 *
 * Exercises the path that matters most: a run that reached zero while the bot
 * was offline must still ping the trainer when the bot comes back, rather than
 * being silently dropped. Uses a stub Discord client so no network is needed.
 *
 *   DATABASE_URL=postgresql://... npm run test:scheduler
 */
import { prisma } from '../src/db/prisma';
import { startScheduler } from '../src/lib/timer/scheduler';

const G = 'test-guild-sched';
const CHANNEL = 'chan-1';
let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}

/** Records everything the scheduler tries to send or delete. */
const sent: { content: string; mentions: string[] }[] = [];
const deleted: string[] = [];
let nextMessageId = 1000;

const channelStub = {
    isTextBased: () => true,
    send: async (options: { content: string; allowedMentions?: { users?: string[] } }) => {
        sent.push({ content: options.content, mentions: options.allowedMentions?.users ?? [] });
        return { id: String(nextMessageId++) };
    },
    messages: {
        fetch: async () => ({ edit: async () => undefined }),
        delete: async (id: string) => {
            deleted.push(id);
        },
    },
};

const clientStub = { channels: { fetch: async () => channelStub } } as never;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.timerNotification.deleteMany({ where: { channelId: CHANNEL } });

    // A run that ended 40 minutes ago, i.e. while the bot was down.
    const endedAt = new Date(Date.now() - 40 * 60_000);
    await prisma.trainingTimer.create({
        data: {
            guildId: G,
            channelId: CHANNEL,
            panelMessageId: 'panel-1',
            discordUserId: 'trainer-a',
            startedAt: new Date(endedAt.getTime() - 50 * 60_000),
            expiresAt: endedAt,
        },
    });

    // A run still in progress must be left alone.
    await prisma.trainingTimer.create({
        data: {
            guildId: G,
            channelId: CHANNEL,
            discordUserId: 'trainer-b',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 60_000),
        },
    });

    const stop = startScheduler(clientStub);
    await sleep(1500);

    check('offline expiry delivered one ping', sent.length, 1);
    check('ping mentions the right trainer', sent[0]?.mentions, ['trainer-a']);
    check('ping pings the trainer', sent[0]?.content.includes('<@trainer-a>'), true);
    check('ping explains the delay', sent[0]?.content.includes('while the bot was offline'), true);
    check('ping confirms it still counted', sent[0]?.content.includes('It still counted'), true);
    check('first run is celebrated', sent[0]?.content.includes('First run recorded'), true);

    check('expired timer removed', await prisma.trainingTimer.count({ where: { guildId: G, discordUserId: 'trainer-a' } }), 0);
    check('in-progress timer untouched', await prisma.trainingTimer.count({ where: { guildId: G, discordUserId: 'trainer-b' } }), 1);

    const runs = await prisma.trainingRun.findMany({ where: { guildId: G } });
    check('run recorded exactly once', runs.length, 1);
    check('run credited to its scheduled end time', runs[0]?.completedAt.getTime(), endedAt.getTime());
    check('delivery lag recorded (~2400s)', Math.abs((runs[0]?.deliveryLagS ?? 0) - 2400) < 30, true);

    const notifications = await prisma.timerNotification.findMany({ where: { channelId: CHANNEL } });
    check('ping queued for auto-deletion', notifications.length, 1);

    // Force the notification due and confirm the next tick removes it.
    const messageId = notifications[0]!.messageId;
    await prisma.timerNotification.updateMany({
        where: { channelId: CHANNEL },
        data: { deleteAt: new Date(Date.now() - 1000) },
    });
    await sleep(11_000);

    check('expired ping deleted from the channel', deleted.includes(messageId), true);
    check('notification row cleared', await prisma.timerNotification.count({ where: { channelId: CHANNEL } }), 0);
    check('no duplicate pings across ticks', sent.length, 1);

    stop();
    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
