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
import { PING_OPENERS, RARE_PING_OPENERS, buildPingContent, pickOpener, startScheduler } from '../src/lib/timer/scheduler';

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

// No guilds cached or fetchable: milestone roles are skipped, as for a guild the bot left.
const clientStub = { channels: { fetch: async () => channelStub }, guilds: { cache: new Map(), fetch: async () => null } } as never;

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
    check('ping explains the delay', sent[0]?.content.includes('while I was offline'), true);
    check('ping confirms it still counted', sent[0]?.content.includes('It still counts!'), true);
    check('first run is celebrated', sent[0]?.content.includes('**Debut!** Your very first run is on the record!'), true);
    const allOpeners = [...PING_OPENERS, ...RARE_PING_OPENERS];
    check('ping opens with one of the openers', allOpeners.some((o) => sent[0]?.content.includes(o.replace('{user}', '').trim().slice(0, 30))), true);
    check('openers: every one names the trainer once', allOpeners.every((o) => o.split('{user}').length === 2), true);
    check('openers: below 4% a rare one, spread evenly', [pickOpener(0), pickOpener(0.0399999), pickOpener(0.02)], [RARE_PING_OPENERS[0], RARE_PING_OPENERS[RARE_PING_OPENERS.length - 1], RARE_PING_OPENERS[Math.floor(RARE_PING_OPENERS.length / 2)]]);
    check('openers: from 4% up a common one, spread evenly', [pickOpener(0.04), pickOpener(0.52), pickOpener(0.9999)], [PING_OPENERS[0], PING_OPENERS[3], PING_OPENERS[6]]);
    let rare = 0;
    for (let i = 0; i < 100000; i += 1) if (RARE_PING_OPENERS.includes(pickOpener(i / 100000))) rare += 1;
    check('openers: rare ones are 4% of the range', rare, 4000);
    check('openers: the mention can sit mid-sentence', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never, 0, null, () => (RARE_PING_OPENERS.findIndex((o) => o.startsWith('Torena')) + 0.5) / RARE_PING_OPENERS.length * 0.04), "Torena-san, there's a new burger place in town! I'll ask El and Grass to come too, so come with me, okay <@u1>? We can host a party afterwards too! I can't wait...");

    // Rare lines are recorded and tallied.
    const rares = await import('../src/lib/timer/rares');
    const { RARE_OPENERS } = await import('../src/lib/timer/openers');
    check('specials: Matikanetannhauser is No. 1', RARE_OPENERS[0]?.name, 'Matikanetannhauser');
    const RG = `test-rares-${Date.now()}`;
    check('rares: a rare line is rare, a common one is not', [rares.isRareOpener(RARE_PING_OPENERS[2]!), rares.isRareOpener(PING_OPENERS[0]!)], [true, false]);
    await rares.recordRareOpener(RG, 'u1', RARE_PING_OPENERS[1]!);
    await rares.recordRareOpener(RG, 'u2', RARE_PING_OPENERS[1]!);
    await rares.recordRareOpener(RG, 'u3', RARE_PING_OPENERS[4]!);
    const tally = await rares.rareTally(RG);
    check('rares: tally per line, first finder kept', [tally.length, tally[1]?.count, tally[1]?.firstUserId, tally[4]?.count, tally[0]?.count], [RARE_PING_OPENERS.length, 2, 'u1', 1, 0]);
    const embed = rares.raresEmbed(tally).toJSON();
    const col = (n: number) => embed.fields?.[n]?.value.split('\n') ?? [];
    check('specials: three columns, one row per special', [embed.title, embed.fields?.map((f) => f.name), col(0).length, col(1).length, col(2).length], [
        `Specials found: 2 of ${RARE_PING_OPENERS.length}`,
        ['Special', 'Times', 'First found by'],
        RARE_PING_OPENERS.length,
        RARE_PING_OPENERS.length,
        RARE_PING_OPENERS.length,
    ]);
    check('specials: unfound rows hide the name', [col(0)[0], col(1)[0], col(2)[0]], ['**1.** ???', '—', '—']);
    check('specials: a found row shows name, count and finder', [col(0)[1], col(1)[1], col(2)[1]?.startsWith('<@u1> <t:')], [`**2.** ${RARE_OPENERS[1]!.name}`, '**×2**', true]);
    check('specials: no line text is ever shown', RARE_PING_OPENERS.some((t) => JSON.stringify(embed).includes(t.replace('{user}', '').trim().slice(0, 20))), false);
    const { buildPanel, BUTTON_SPECIALS } = await import('../src/lib/timer/panel');
    const panelJson = JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never));
    check('panel: has the Specials button', [panelJson.includes(BUTTON_SPECIALS), panelJson.includes('"label":"Specials"')], [true, true]);
    const mine = rares.raresEmbed(await rares.rareTally(RG, 'u2'), true).toJSON();
    const mcol = (n: number) => mine.fields?.[n]?.value.split('\n') ?? [];
    check('specials: your own list counts only your finds', [mine.title, mcol(0)[1], mcol(1)[1], mcol(0)[4]], [`Your specials: 1 of ${RARE_PING_OPENERS.length}`, `**2.** ${RARE_OPENERS[1]!.name}`, '**×1**', '**5.** ???']);
    check('specials: your own list shows when, not who', [mine.fields?.[2]?.name, mcol(2)[1]?.startsWith('<t:'), mine.footer?.text.startsWith('1 special ping for you')], ['First got', true, true]);
    // Reading an unlocked special in full. u2 found only special 2 (index 1); u3 found index 4.
    const menuJson = rares.readMenuRow(await rares.rareTally(RG, 'u2'))?.toJSON() as { components: { custom_id: string; options: { label: string; value: string }[] }[] } | undefined;
    check('read menu: only your unlocked specials', menuJson?.components[0]?.options.map((o) => [o.label, o.value]), [[`2. ${RARE_OPENERS[1]!.name}`, '1']]);
    check('read menu: none when nothing is unlocked', rares.readMenuRow(await rares.rareTally(RG, 'nobody')), null);
    const read = await rares.readSpecial(RG, 'u2', '1');
    check('read: an unlocked special shows in full, as you', [read?.name, read?.text === RARE_OPENERS[1]!.text.replace('{user}', '<@u2>')], [RARE_OPENERS[1]!.name, true]);
    check("read: someone else's special stays locked", await rares.readSpecial(RG, 'u2', '4'), null);
    check('read: a forged choice reveals nothing', [await rares.readSpecial(RG, 'u2', 'x'), await rares.readSpecial(RG, 'u2', '99')], [null, null]);
    // Sets: a set turned off never comes up.
    const openers = await import('../src/lib/timer/openers');
    check('sets: every special belongs to a set', openers.RARE_OPENERS.every((o) => openers.SPECIAL_SETS.some((set) => set.id === o.set)), true);
    check('sets: all on gives every special', openers.rarePoolFor([]).length, RARE_PING_OPENERS.length);
    check('sets: a set off leaves its specials out', openers.rarePoolFor(['set1']).length, RARE_PING_OPENERS.length - openers.SPECIAL_SETS[0]!.openers.length);
    check('sets: with no special on, a rare roll gives a common line', PING_OPENERS.includes(openers.pickOpener(0.001, [])), true);

    // The lock: Matikanetannhauser is 95% locked to its owner until someone has it.
    const lock = openers.SPECIAL_LOCKS[0]!;
    const lockedText = RARE_OPENERS.find((o) => o.name === lock.name)!.text;
    const LG = `test-locks-${Date.now()}`;
    const pool = openers.rarePoolFor([]);
    const swapped = await rares.applySpecialLocks(LG, 'someone-else', lockedText, pool, () => 0.5);
    check('lock: someone else rolling it is swapped for another special', [swapped !== lockedText, rares.isRareOpener(swapped)], [true, true]);
    check('lock: the 5% gets through', await rares.applySpecialLocks(LG, 'someone-else', lockedText, pool, () => 0.96), lockedText);
    check('lock: the owner keeps it', await rares.applySpecialLocks(LG, lock.owner, lockedText, pool, () => 0.5), lockedText);
    check('lock: other specials are untouched', await rares.applySpecialLocks(LG, 'someone-else', RARE_PING_OPENERS[3]!, pool, () => 0.5), RARE_PING_OPENERS[3]);
    await rares.recordRareOpener(LG, lock.owner, lockedText);
    check('lock: over once anyone has had it', await rares.applySpecialLocks(LG, 'someone-else', lockedText, pool, () => 0.5), lockedText);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: LG } });

    // Settings: DM me too, early riser, special sets.
    const us = await import('../src/lib/timer/userSettings');
    const SG = `test-usettings-${Date.now()}`;
    check('settings: defaults', await us.getUserSettings(SG, 'u1'), { dmPing: false, earlyRiser: false, disabledSets: [] });
    check('settings: default run and ping times', [us.runMinutes(await us.getUserSettings(SG, 'u1')), us.pingMinutes(await us.getUserSettings(SG, 'u1'))], [50, 3]);
    await us.toggleSetting(SG, 'u1', 'dm');
    await us.toggleSetting(SG, 'u1', 'early');
    const on = await us.toggleSetting(SG, 'u1', 'set:set1');
    check('settings: each toggle flips', on, { dmPing: true, earlyRiser: true, disabledSets: ['set1'] });
    check('settings: early riser runs 49 and clears in 2', [us.runMinutes(on), us.pingMinutes(on)], [49, 2]);
    check('settings: an unknown set is ignored', (await us.toggleSetting(SG, 'u1', 'set:nope')).disabledSets, ['set1']);
    check('settings: a set flips back on', (await us.toggleSetting(SG, 'u1', 'set:set1')).disabledSets, []);
    const view = JSON.stringify(us.settingsView(on));
    check('settings: the screen shows each setting\'s state', [view.includes('DM me too: On'), view.includes('Early riser: On'), view.includes('Set 1: Off')], [true, true, true]);
    await prisma.timerUserSettings.deleteMany({ where: { guildId: SG } });
    const { BUTTON_SETTINGS } = await import('../src/lib/timer/panel');
    check('panel: has the Settings button', panelJson.includes(BUTTON_SETTINGS) || JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never)).includes(BUTTON_SETTINGS), true);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: RG } });
    const full = buildPingContent('u1', { milestone: 25, newLongestStreak: true, currentStreakDays: 7, firstOfDay: true, totalRuns: 25 } as never, 600, 'role-25', () => 0.04);
    check('ping: every celebration on its own bold-led line', full.split('\n'), [
        '<@u1> Time! Your Independent Training is complete!',
        '*Apologies! This run ended about 10 minutes ago while I was offline. It still counts!*',
        '**Milestone!** That makes run #**25**!',
        '**Record!** A new personal best: **7 days** in a row!',
        '**Promotion!** **25 runs** reached, and <@&role-25> is yours!',
    ]);
    check('ping: a plain run is just the opener', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never, 0, null, () => 0.5), '<@u1> Excellent! Your run is done! Rest a moment, then go again!');
    check('ping: an ongoing streak, first run of the day', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 4, firstOfDay: true, totalRuns: 9 } as never, 0, null, () => 0.5).split('\n')[1], '**Persistence!** **4 days** straight! Keep it going!');

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
