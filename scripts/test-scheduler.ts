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
import { PING_OPENERS, RARE_OPENER_CHANCE, RARE_PING_OPENERS, buildPingContent, pickOpener, startScheduler } from '../src/lib/timer/scheduler';

/** The base special chance, and how many of `n` even steps it covers. */
const P = RARE_OPENER_CHANCE;
const stepsOf = (n: number, chance = P) => Math.round(n * chance);

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
    check('openers: every one names the trainer at least once', allOpeners.every((o) => o.split('{user}').length >= 2), true);
    check('openers: below the base chance a rare one, spread evenly', [pickOpener(0), pickOpener(P - 1e-7), pickOpener(P / 2)], [RARE_PING_OPENERS[0], RARE_PING_OPENERS[RARE_PING_OPENERS.length - 1], RARE_PING_OPENERS[Math.floor(RARE_PING_OPENERS.length / 2)]]);
    check('openers: from the base chance up a common one, spread evenly', [pickOpener(P), pickOpener(P + (1 - P) * 0.5), pickOpener(0.9999)], [PING_OPENERS[0], PING_OPENERS[3], PING_OPENERS[6]]);
    let rare = 0;
    for (let i = 0; i < 100000; i += 1) if (RARE_PING_OPENERS.includes(pickOpener(i / 100000))) rare += 1;
    check('openers: the base chance is 6%, and rare ones are 6% of the range', [P, rare], [0.06, stepsOf(100000)]);
    check('openers: the mention can sit mid-sentence', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never, 0, null, () => (RARE_PING_OPENERS.findIndex((o) => o.startsWith('Torena')) + 0.5) / RARE_PING_OPENERS.length * P), "Torena-san, there's a new burger place in town! I'll ask El and Grass to come too, so come with me, okay <@u1>? We can host a party afterwards too! I can't wait...");

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
    type ViewJson = { embeds: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string } }[]; components: { components: { custom_id: string; label?: string; disabled?: boolean; placeholder?: string; options?: { label: string; value: string }[] }[] }[] };
    const json = (v: { embeds: { toJSON(): unknown }[]; components: { toJSON(): unknown }[] }) => ({ embeds: v.embeds.map((e) => e.toJSON()), components: v.components.map((c) => c.toJSON()) }) as ViewJson;
    const { SPECIAL_SETS: SETS } = await import('../src/lib/timer/openers');
    const page0 = json(rares.specialsView(tally, rares.SPECIALS_FIRST_PAGE));
    const embed = page0.embeds[0]!;
    const col = (n: number) => embed.fields?.[n]?.value.split('\n') ?? [];
    check('specials: one set per page, three columns', [embed.title, embed.description, embed.fields?.map((f) => f.name), col(0).length, col(2).length], [
        `Specials found: 2 of ${RARE_PING_OPENERS.length}`,
        `**Set 1: ${SETS[0]!.name}**: 2 of ${SETS[0]!.openers.length} found`,
        ['Special', 'Times', 'First found by'],
        SETS[0]!.openers.length,
        SETS[0]!.openers.length,
    ]);
    check('specials: unfound rows hide the name', [col(0)[0], col(1)[0], col(2)[0]], ['**1.** ???', '—', '—']);
    check('specials: a found row shows name, count and finder', [col(0)[1], col(1)[1], col(2)[1]?.startsWith('<@u1> <t:')], [`**2.** ${RARE_OPENERS[1]!.name}`, '**×2**', true]);
    check('specials: no line text is ever shown', RARE_PING_OPENERS.some((t) => JSON.stringify(page0).includes(t.replace('{user}', '').trim().slice(0, 20))), false);
    const nav0 = page0.components[0]!.components;
    check('pages: the server list opens on Set 1, Back to Set 0', nav0.map((b) => [b.label, b.custom_id, b.disabled ?? false]), [
        ['Back', `${rares.SPECIALS_PAGE_PREFIX}all:0`, false],
        ['Next', `${rares.SPECIALS_PAGE_PREFIX}all:2`, false],
    ]);
    const set0 = json(rares.specialsView(tally, 0));
    check('set 0: the reminders, in full, Back off', [set0.embeds[0]!.title, PING_OPENERS.every((o) => set0.embeds[0]!.description?.includes(o.replaceAll('{user}', '@trainer'))), set0.components[0]!.components[0]!.disabled, set0.components.length], ['Set 0: Reminders', true, true, 1]);
    check('set 0: the same for a trainer, no toggle', json(rares.specialsView(tally, 0, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true })).components[0]!.components.map((b) => b.label), ['Back', 'Next']);
    const last = json(rares.specialsView(tally, SETS.length));
    check('pages: the last page, numbered within its set, Next off', [last.embeds[0]!.description?.startsWith(`**Set ${SETS.length}: ${SETS.at(-1)!.name}**`), last.embeds[0]!.fields?.[0]?.value.split('\n')[0], last.components[0]!.components.at(-1)?.disabled, last.embeds[0]!.footer?.text.endsWith(`Page ${SETS.length + 1} of ${SETS.length + 1}`)], [true, '**1.** ???', true, true]);
    check('pages: a page out of range is clamped', [json(rares.specialsView(tally, 99)).embeds[0]!.description, json(rares.specialsView(tally, -5)).embeds[0]!.title], [last.embeds[0]!.description, 'Set 0: Reminders']);
    const { buildPanel, BUTTON_SPECIALS } = await import('../src/lib/timer/panel');
    const panelJson = JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never));
    check('panel: has the Specials button', [panelJson.includes(BUTTON_SPECIALS), panelJson.includes('"label":"Specials"')], [true, true]);
    const noExtras = { lockedSets: [] as string[], disabledSets: [] as string[], boosts: [], boostsOn: true };
    const mineView = json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, noExtras));
    const mine = mineView.embeds[0]!;
    const mcol = (n: number) => mine.fields?.[n]?.value.split('\n') ?? [];
    check('specials: your own list counts only your finds', [mine.title, mcol(0)[1], mcol(1)[1], mcol(0)[4]], [`Your specials: 1 of ${RARE_PING_OPENERS.length}`, `**2.** ${RARE_OPENERS[1]!.name}`, '**×1**', '**5.** ???']);
    check('specials: your own list shows when, not who', [mine.fields?.[2]?.name, mcol(2)[1]?.startsWith('<t:'), mine.footer?.text.startsWith('1 special ping for you')], ['First got', true, true]);
    check('pages: your page has Back, the set\'s toggle, Next', mineView.components[0]!.components.map((b) => [b.label, b.custom_id]), [
        ['Back', `${rares.SPECIALS_PAGE_PREFIX}mine:0`],
        [`${SETS[0]!.name}: On`, `${rares.SPECIALS_SET_PREFIX}${SETS[0]!.id}`],
        ['Next', `${rares.SPECIALS_PAGE_PREFIX}mine:2`],
    ]);
    check('pages: a set turned off says so', [json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, { ...noExtras, disabledSets: ['set1'] })).components[0]!.components[1]!.label, json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, { ...noExtras, disabledSets: ['set1'] })).embeds[0]!.description?.includes('Off:')], [`${SETS[0]!.name}: Off`, true]);
    // Reading an unlocked special in full. u2 found only special 2 (index 1); u3 found index 4.
    const menu = mineView.components[1]?.components[0];
    check('read menu: only your unlocked specials of this set', [menu?.custom_id, menu?.options?.map((o) => [o.label, o.value])], [rares.READ_MENU_ID, [[`2. ${RARE_OPENERS[1]!.name}`, RARE_OPENERS[1]!.id]]]);
    check('read menu: none when nothing is unlocked', json(rares.specialsView(await rares.rareTally(RG, 'nobody'), 1, noExtras)).components.length, 1);
    check('read menu: none on the server list', page0.components.length, 1);
    const read = await rares.readSpecial(RG, 'u2', RARE_OPENERS[1]!.id);
    check('read: an unlocked special shows in full, as you', [read?.name, read?.text === RARE_OPENERS[1]!.text.replace('{user}', '<@u2>')], [RARE_OPENERS[1]!.name, true]);
    check("read: someone else's special stays locked", await rares.readSpecial(RG, 'u2', RARE_OPENERS[4]!.id), null);
    check('read: a forged choice reveals nothing', [await rares.readSpecial(RG, 'u2', 'x'), await rares.readSpecial(RG, 'u2', '1')], [null, null]);
    // Sets: a set turned off never comes up.
    const openers = await import('../src/lib/timer/openers');
    const allIds = openers.RARE_OPENERS.map((o) => o.id);
    check('ids: every special has a unique id', new Set(allIds).size, allIds.length);
    check('ids: each id starts with its set', openers.RARE_OPENERS.every((o) => o.id.startsWith(o.set === 'online-sensations' ? 'os.' : `${o.set}.`)), true);
    check('ids: prerequisites and locks name real specials', [...openers.SPECIAL_SETS.flatMap((x) => (x.requires ? [x.requires] : [])), ...openers.SPECIAL_LOCKS.map((l) => l.id)].every((id) => openers.specialById(id) !== undefined), true);
    // A reworded special keeps its finds: they follow the id, not the text.
    const IG = `test-ids-${Date.now()}`;
    await rares.recordRareOpener(IG, 'u1', RARE_OPENERS[2]!.text);
    await prisma.rareOpenerHit.updateMany({ where: { guildId: IG }, data: { opener: 'the old wording of this line' } });
    check('ids: a find survives rewording', [(await rares.rareTally(IG, 'u1'))[2]?.count, (await rares.readSpecial(IG, 'u1', RARE_OPENERS[2]!.id))?.name], [1, RARE_OPENERS[2]!.name]);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: IG } });
    check('sets: every special belongs to a set', openers.RARE_OPENERS.every((o) => openers.SPECIAL_SETS.some((set) => set.id === o.set)), true);
    check('sets: all on gives every special', openers.rarePoolFor([]).length, RARE_PING_OPENERS.length);
    check('sets: a set off leaves its specials out', openers.rarePoolFor(['set1']).length, RARE_PING_OPENERS.length - openers.SPECIAL_SETS[0]!.openers.length);
    check('sets: with no special on, a rare roll gives a common line', PING_OPENERS.includes(openers.pickOpener(0.001, [])), true);

    // The lock: Matikanetannhauser is locked to its owner, guaranteed on their next ping, until they have it.
    const lock = openers.SPECIAL_LOCKS[0]!;
    const lockedText = RARE_OPENERS.find((o) => o.id === lock.id)!.text;
    const LG = `test-locks-${Date.now()}`;
    const pool = openers.rarePoolFor([]);
    /** Picks across the whole random range in `steps` even steps; counts per opener. */
    const sweep = async (user: string, steps = 20000) => {
        const counts = new Map<string, number>();
        for (let k = 0; k < steps; k += 1) {
            const o = await rares.chooseOpener(LG, user, k / steps, pool);
            counts.set(o, (counts.get(o) ?? 0) + 1);
        }
        const special = [...counts].filter(([o]) => rares.isRareOpener(o));
        return { locked: counts.get(lockedText) ?? 0, specials: special.reduce((n, [, c]) => n + c, 0), others: special.filter(([o]) => o !== lockedText).map(([, c]) => c) };
    };
    const owner = await sweep(lock.owner, 2000);
    check('lock: guaranteed, the owner gets it on every roll', [lock.ownerChance >= 1, owner.locked], [true, 2000]);
    const other = await sweep('someone-else');
    check('lock: nobody else gets it', other.locked, 0);
    check('lock: everyone else keeps the base chance, spread evenly over the rest', [other.specials, other.others.length, Math.max(...other.others) - Math.min(...other.others) <= 2], [stepsOf(20000), RARE_PING_OPENERS.length - 1, true]);
    await rares.recordRareOpener(LG, 'someone-else', lockedText);
    check('lock: still on while only someone else has it', (await sweep('someone-else', 2000)).locked, 0);
    await rares.recordRareOpener(LG, lock.owner, lockedText);
    const afterOther = await sweep('someone-else');
    const afterOwner = await sweep(lock.owner);
    check('lock: over once the owner has it, the base chance over all for everyone', [afterOther.specials, afterOther.locked > 0, afterOwner.specials, afterOwner.locked > 0 && afterOwner.locked < 400], [stepsOf(20000), true, stepsOf(20000), true]);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: LG } });

    // #OnlineSensations: locked behind Curren Chan, a collab boost, and {set_name}.
    const XG = `test-boosts-${Date.now()}`;
    const curren = RARE_OPENERS.find((o) => o.name === 'Curren Chan')!;
    const loves = RARE_OPENERS.find((o) => o.id === 'os.loves')!;
    check('sets: Curren Chan is the last of Set 1', [curren.set, openers.SPECIAL_SETS[0]!.openers.at(-1)?.name], ['set1', 'Curren Chan']);
    check('fill: every {user} and {set_name}', [openers.fillOpener(loves.text, 'u9').includes('{'), openers.fillOpener(loves.text, 'u9').split('<@u9>').length - 1, openers.fillOpener(loves.text, 'u9').includes('in #OnlineSensations.')], [false, 2, true]);
    check('locks: the set is locked until Curren Chan', await rares.lockedSetsFor(XG, 'u1'), ['online-sensations']);
    check('locks: a locked set is out of the pool', openers.rarePoolFor([], ['online-sensations']).length, openers.SPECIAL_SETS[0]!.openers.length);
    await rares.recordRareOpener(XG, 'u1', curren.text);
    check('locks: open once Curren Chan is found', [await rares.lockedSetsFor(XG, 'u1'), await rares.lockedSetsFor(XG, 'u2')], [[], ['online-sensations']]);
    const collabs = openers.boostPool('online-sensations', 'collab');
    check('boost: covers every #OnlineSensations line, Loves and #Celebrate included', [collabs.length, collabs.includes(loves.text), RARE_OPENERS.filter((o) => collabs.includes(o.text)).map((o) => o.name).includes('#Celebrate')], [openers.SPECIAL_SETS[1]!.openers.length, true, true]);
    check('boost: a plain special grants nothing', await rares.grantBoost(XG, 'u1', curren.text), false);
    check('boost: Loves grants 50 runs', [await rares.grantBoost(XG, 'u1', loves.text), await rares.activeBoosts(XG, 'u1')], [true, [{ setId: 'online-sensations', runsLeft: 50 }]]);
    await rares.spendBoosts(XG, 'u1');
    await rares.spendBoosts(XG, 'u1');
    check('boost: each ping spends one', (await rares.activeBoosts(XG, 'u1'))[0]?.runsLeft, 48);
    await rares.grantBoost(XG, 'u1', loves.text);
    check('boost: getting Loves again restarts it, no stacking', await rares.activeBoosts(XG, 'u1'), [{ setId: 'online-sensations', runsLeft: 50 }]);
    for (let k = 0; k < 50; k += 1) await rares.spendBoosts(XG, 'u1');
    check('boost: gone after 50', await rares.activeBoosts(XG, 'u1'), []);
    await rares.grantBoost(XG, 'u1', loves.text);
    const { extraChances } = await import('../src/lib/timer/scheduler');
    const us0 = await import('../src/lib/timer/userSettings');
    const base = { dmPing: false, earlyRiser: true, boosts: true, disabledSets: [] as string[] };
    const fullPool = openers.rarePoolFor([]);
    // A time with no seasonal buff running, so the checks below see only boosts.
    const OFF_SEASON = new Date('2026-01-01T00:00:00Z');
    check('extras: boost plus early start', (await extraChances(XG, 'u1', base, [], true, fullPool, OFF_SEASON)).map((e) => [e.chance, e.pool.length]), [[0.04, openers.SPECIAL_SETS[1]!.openers.length], [0.01, fullPool.length], [0.01, openers.SPECIAL_SETS[1]!.openers.length]]);
    check('extras: the unlock bonus only once the set is unlocked', (await extraChances(XG, 'u1', base, ['online-sensations'], false, fullPool, OFF_SEASON)).length, 0);
    check('extras: early start without Early Riser too', (await extraChances(XG, 'u1', { ...base, earlyRiser: false }, [], true, fullPool, OFF_SEASON)).map((e) => e.chance), [0.04, 0.01, 0.01]);
    check('extras: none with Boosts off', await extraChances(XG, 'u1', { ...base, boosts: false }, [], true, fullPool, OFF_SEASON), []);
    check('extras: none for a set turned off', (await extraChances(XG, 'u1', { ...base, disabledSets: ['online-sensations'] }, [], false, fullPool, OFF_SEASON)).length, 0);
    // The chances add: 4% boost + 1% early + 1% unlock bonus + the base 6% = 12%, the base intact.
    const extras = await extraChances(XG, 'u1', base, [], true, fullPool, OFF_SEASON);
    const counts = new Map<string, number>();
    const STEPS = 20000;
    for (let k = 0; k < STEPS; k += 1) {
        const o = await rares.chooseOpener(XG, 'someone', k / STEPS, fullPool, extras);
        counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const specialCount = [...counts].filter(([o]) => rares.isRareOpener(o)).reduce((n, [, c]) => n + c, 0);
    const collabCount = [...counts].filter(([o]) => collabs.includes(o)).reduce((n, [, c]) => n + c, 0);
    const commonCounts = PING_OPENERS.map((o) => counts.get(o) ?? 0);
    const guaranteed = openers.SPECIAL_LOCKS.find((l) => l.ownerChance >= 1);
    if (guaranteed) {
        const gText = RARE_OPENERS.find((o) => o.id === guaranteed.id)!.text;
        check('lock: a guarantee beats the boosts too', await rares.chooseOpener(XG, guaranteed.owner, 0.001, fullPool, extras), gText);
    }
    check('odds: special chance is 4% + 1% + 1% + 6% = 12%', Math.abs(specialCount - stepsOf(STEPS, 0.04 + 0.01 + 0.01 + P)) <= 1, true);
    // Collab lines: all of the 4% boost, plus their share of the 1% and 6%
    // (spread over every special but the locked Matikanetannhauser).
    const shareOf = (n: number, of: number) => Math.round((STEPS * n * collabs.length) / of);
    check('odds: the collab lines get the whole boost', Math.abs(collabCount - (stepsOf(STEPS, 0.04) + shareOf(0.01, fullPool.length - 1) + shareOf(P, fullPool.length - 1) + shareOf(0.01, openers.SPECIAL_SETS[1]!.openers.length))) <= 3, true);
    // The sweep is discrete, so step boundaries can shift a count by one either way.
    const commonEach = (STEPS - stepsOf(STEPS, 0.04 + 0.01 + 0.01 + P)) / PING_OPENERS.length;
    check('odds: common lines stay even', commonCounts.every((c) => Math.abs(c - commonEach) <= 1), true);
    const lockedPage = json(await rares.mySpecialsView(XG, 'u2', 2));
    check('pages: a locked set hides its rows, toggle greyed out', [lockedPage.embeds[0]!.description, lockedPage.embeds[0]!.fields ?? [], lockedPage.components[0]!.components[1]?.label, lockedPage.components[0]!.components[1]?.disabled], [
        `**Set 2: #OnlineSensations**: 0 of ${openers.SPECIAL_SETS[1]!.openers.length} found\nLocked: find **Curren Chan** to open it.`,
        [],
        '#OnlineSensations: Locked',
        true,
    ]);
    await us0.toggleSetting(XG, 'u1', 'boosts');
    const boostPage = json(await rares.mySpecialsView(XG, 'u1', 1));
    check('specials: your boost is in the footer', boostPage.embeds[0]!.footer?.text.split('\n')[1], 'Boost: +4% #OnlineSensations for 50 more runs (paused: Boosts are off).');
    await prisma.timerUserSettings.deleteMany({ where: { guildId: XG } });
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: XG } });
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId: XG } });

    // Early start: within 3 minutes of the last ping, 4 for early risers.
    const svc = await import('../src/lib/timer/service');
    const EG = `test-early-${Date.now()}`;
    const ago = (s: number) => new Date(Date.now() - s * 1000);
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e1', startedAt: ago(3060), completedAt: ago(60) } });
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e2', startedAt: ago(3270), completedAt: ago(270) } });
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e6', startedAt: ago(3210), completedAt: ago(210) } });
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e3', startedAt: ago(3600), completedAt: ago(600), deliveryLagS: 540 } });
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e4', startedAt: ago(3150), completedAt: ago(150) } });
    await prisma.trainingRun.create({ data: { guildId: EG, discordUserId: 'e5', startedAt: ago(3210), completedAt: ago(210) } });
    check('early: within the window', await svc.inEarlyWindow(EG, 'e1', new Date()), true);
    check('early: 3.5 minutes is in the 4, not the 3', [await svc.inEarlyWindow(EG, 'e6', new Date(), 4), await svc.inEarlyWindow(EG, 'e6', new Date(), 3)], [true, false]);
    check('early: counted from a late ping, not the scheduled end', await svc.inEarlyWindow(EG, 'e3', new Date()), true);
    check('early: no last run, no window', await svc.inEarlyWindow(EG, 'nobody', new Date()), false);
    const s1 = await svc.startTimer(EG, 'c', null, 'e1', 49, true);
    const s2 = await svc.startTimer(EG, 'c', null, 'e2', 49, true);
    const s6 = await svc.startTimer(EG, 'c', null, 'e6', 49, true);
    const s4 = await svc.startTimer(EG, 'c', null, 'e4', 50, false);
    const s5 = await svc.startTimer(EG, 'c', null, 'e5', 50, false);
    // e6 and e5 both pinged 3.5 minutes ago: in time as an early riser, late otherwise.
    check('early: 4 minutes for early risers, 3 for everyone else', [s1.timer.earlyStart, s6.timer.earlyStart, s2.timer.earlyStart, s4.timer.earlyStart, s5.timer.earlyStart], [true, true, false, true, false]);
    check('early: a reset keeps the mark', (await svc.startTimer(EG, 'c', null, 'e1', 49, true)).timer.earlyStart, true);
    await prisma.trainingTimer.deleteMany({ where: { guildId: EG } });
    await prisma.trainingRun.deleteMany({ where: { guildId: EG } });

    // Seasonal buffs: a flat slice on one special, for a time window. None run now;
    // a sample one checks the mechanism.
    const week = openers.SEASONAL_BUFFS[0]!;
    check('season: Curren Chan week, +1% Curren Chan for 7 days', [week.specialId, week.chance, (week.until.getTime() - week.from.getTime()) / 86_400_000, week.label], ['set1.curren', 0.01, 7, 'Curren Chan: meet her in the lobby!']);
    const buff = { label: 'Sample week', specialId: 'set1.curren', chance: 0.01, from: new Date('2026-12-01T00:00:00Z'), until: new Date('2026-12-08T00:00:00Z') };
    const inSeason = new Date(buff.from.getTime() + 60_000);
    const currenText = RARE_OPENERS.find((o) => o.id === buff.specialId)!.text;
    const SN = `test-season-${Date.now()}`;
    const plain = { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] as string[] };
    const LOCKED = ['online-sensations'];
    const seasonal = await extraChances(SN, 's1', plain, LOCKED, false, openers.rarePoolFor([]), inSeason, [buff]);
    check('season: in its window, an extra slice that only draws its special', seasonal.map((e) => [e.chance, e.pool]), [[0.01, [currenText]]]);
    check('season: not before or after the window', [(await extraChances(SN, 's1', plain, LOCKED, false, [], new Date(buff.from.getTime() - 1), [buff])).length, (await extraChances(SN, 's1', plain, LOCKED, false, [], buff.until, [buff])).length], [0, 0]);
    check('season: a prerequisite buff stops once its set is unlocked; the unlock bonus takes over', (await extraChances(SN, 's1', plain, [], false, openers.rarePoolFor([]), inSeason, [buff])).map((e) => [e.chance, e.pool.length]), [[0.01, openers.SPECIAL_SETS[1]!.openers.length]]);
    check('season: not with its set off, or Boosts off', [(await extraChances(SN, 's1', { ...plain, disabledSets: ['set1'] }, LOCKED, false, [], inSeason, [buff])).length, (await extraChances(SN, 's1', { ...plain, boosts: false }, LOCKED, false, [], inSeason, [buff])).length], [0, 0]);

    // The Boosts view: base, each boost, and the next ping's total.
    const { boostsView, BOOSTS_TOGGLE_ID } = await import('../src/lib/timer/boosts');
    await rares.grantBoost(SN, 's1', loves.text);
    await rares.recordRareOpener(SN, 's1', curren.text);
    const bv = (await boostsView(SN, 's1', inSeason)).embeds[0]!.toJSON().description ?? '';
    check('boosts view: base, Loves, the unlock bonus, total 11%', [bv.includes('**Base:** 6%'), bv.includes('**+4%** #OnlineSensations collab lines, 50 runs left'), bv.includes('**+1%** #OnlineSensations: Curren ~~drags~~ invites you for her #SpecialCollabs!'), bv.includes('Curren Chan week'), bv.includes('**Your next ping: 11% chance of a special.**')], [true, true, true, false, true]);
    await us0.toggleSetting(SN, 's1', 'boosts');
    const off = await boostsView(SN, 's1', inSeason);
    const offText = off.embeds[0]!.toJSON().description ?? '';
    check('boosts view: off pauses them, total is the base', [offText.includes('(paused)'), offText.includes('**Your next ping: 6% chance of a special.**'), (off.components[0]!.toJSON().components[0] as { custom_id: string; label: string }).custom_id, (off.components[0]!.toJSON().components[0] as { label: string }).label], [true, true, BOOSTS_TOGGLE_ID, 'Boosts: Off']);
    const quiet = (await boostsView(SN, 'nobody', OFF_SEASON)).embeds[0]!.toJSON().description ?? '';
    check('boosts view: nothing running, with the early-start tip', [quiet.includes('No boosts right now.'), quiet.includes('-# Early Start: start your next run quickly for +1% overall!'), quiet.includes('**Your next ping: 6% chance')], [true, true, true]);
    const inWeek = new Date(week.from.getTime() + 60_000);
    const before = (await boostsView(SN, 'not-unlocked', inWeek)).embeds[0]!.toJSON().description ?? '';
    check('boosts view: Curren Chan week before unlocking, total 7%', [before.includes(`**+1%** Curren Chan: meet her in the lobby! Ends <t:${Math.floor(week.until.getTime() / 1000)}:R>.`), before.includes('**Your next ping: 7% chance')], [true, true]);
    check('names: #OnlineSensations specials are hashtags', openers.SPECIAL_SETS[1]!.openers.every((o) => /^#[A-Za-z]+$/.test(o.name)), true);
    const { BUTTON_BOOSTS } = await import('../src/lib/timer/panel');
    check('panel: has the Boosts button', JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never)).includes(BUTTON_BOOSTS), true);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: SN } });
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId: SN } });
    await prisma.timerUserSettings.deleteMany({ where: { guildId: SN } });

    // Specials leaderboard: sets completed, then specials found, then pings.
    const LB = `test-sboard-${Date.now()}`;
    const set1 = openers.SPECIAL_SETS[0]!.openers.map((o) => o.text);
    const all = RARE_OPENERS.map((o) => o.text);
    const at = (k: number) => new Date(Date.UTC(2026, 10, 1, 0, k));
    const seedHits = async (user: string, texts: string[], from: number) => {
        for (const [k, t] of texts.entries()) await prisma.rareOpenerHit.create({ data: { guildId: LB, discordUserId: user, opener: t, specialId: openers.specialIdOf(t)!, at: at(from + k) } });
    };
    await seedHits('lb-set', set1, 0); // 13 found, Set 1 complete
    await seedHits('lb-wide', all.slice(1, 21), 100); // 20 found, no set complete
    await seedHits('lb-wide-more', [...all.slice(1, 21), all[1]!], 200); // 20 found, one repeat
    await seedHits('lb-wide-late', all.slice(1, 21), 300); // ties lb-wide, but later
    const sb = await rares.specialsBoard(LB);
    // Points: 15 a new special, 3 a repeat, 100 a full set.
    check('specials board: points (15 new, 3 repeat, 100 a set)', rares.SPECIAL_POINTS, { found: 15, repeat: 3, set: 100 });
    check('specials board: ranked by points, a tie to who got there first', sb.rows.map((r) => [r.discordUserId, r.points, r.setsComplete, r.found, r.pings]), [
        ['lb-wide-more', 303, 0, 20, 21],
        ['lb-wide', 300, 0, 20, 20],
        ['lb-wide-late', 300, 0, 20, 20],
        ['lb-set', 295, 1, 13, 13],
    ]);
    check('specials board: limit caps the rows, not the totals', [(await rares.specialsBoard(LB, 3)).rows.length, (await rares.specialsBoard(LB, 3)).trainers], [3, 4]);
    check('specials board: totals', [sb.totalPings, sb.trainers, sb.specialCount, sb.setCount], [13 + 20 + 21 + 20, 4, RARE_OPENERS.length, openers.SPECIAL_SETS.length]);
    const { renderSpecialsLeaderboard } = await import('../src/lib/image/renderSpecialsLeaderboard');
    const png = await renderSpecialsLeaderboard(sb, new Map([['lb-set', 'Tylina']]));
    check('specials board: renders a PNG', [png.subarray(1, 4).toString(), png.length > 1000], ['PNG', true]);
    check('specials board: empty renders too', (await renderSpecialsLeaderboard(await rares.specialsBoard('nobody-here'), new Map())).subarray(1, 4).toString(), 'PNG');
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: LB } });

    // Unlocking a set: the first time the prerequisite comes up, the ping says so.
    const currenLine = RARE_OPENERS.find((o) => o.id === 'set1.curren')!.text;
    check('unlock: Curren Chan opens #OnlineSensations while it is locked, not after', [openers.setsUnlockedBy(currenLine, ['online-sensations']).map((x) => x.name), openers.setsUnlockedBy(currenLine, []).length, openers.setsUnlockedBy(PING_OPENERS[0]!, ['online-sensations']).length], [['#OnlineSensations'], 0, 0]);
    const plainRun = { milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never;
    check('unlock: the ping says Congrats right under the line', buildPingContent('u1', plainRun, 0, null, Math.random, currenLine, ['#OnlineSensations']).split('\n')[1], '**Congrats!** #OnlineSensations unlocked!');

    // Media: #ChuChuChallenge posts its video; the file is in the repo; plain lines post nothing.
    const fs = await import('fs');
    const chu = RARE_OPENERS.find((o) => o.id === 'os.chu')!;
    const chuMedia = openers.specialMediaPath(chu.text);
    check('media: #ChuChuChallenge has its video, and the file exists', [chuMedia?.endsWith('chu-chu-challenge.mp4'), chuMedia ? fs.existsSync(chuMedia) : false], [true, true]);
    check('media: under Discord\'s 10 MB upload limit', chuMedia ? fs.statSync(chuMedia).size < 10 * 1024 * 1024 : false, true);
    check('media: a line without media posts none', [openers.specialMediaPath(RARE_OPENERS[0]!.text), openers.specialMediaPath(PING_OPENERS[0]!)], [null, null]);
    check('chu: grants the collab boost like Loves, and is in its pool like every line', [openers.boostOf(chu.text)?.boost, openers.boostPool('online-sensations', 'collab').includes(chu.text)], [{ tag: 'collab', chance: 0.04, runs: 50 }, true]);
    check('chu: one {user}, and {set_name} fills in', [chu.text.split('{user}').length - 1, openers.fillOpener(chu.text, 'u1').includes('an entry in #OnlineSensations.')], [1, true]);

    // The live board's Today card shows as many trainers as fit beside the week.
    const live = await import('../src/lib/image/renderTimerLeaderboard');
    check('today: 8 fit beside a full week, at least 5 beside a short one', [live.liveDayFit(10, true), live.liveDayFit(10, false), live.liveDayFit(3, true), live.liveDayFit(0, false)], [8, 8, 5, 5]);
    const mkBoard = (n: number) => ({ period: 'thisweek' as const, week: '2026-11-02', rows: Array.from({ length: n }, (_, i) => ({ discordUserId: `t${i}`, runs: 50 - i, minutes: 0 })), totalRuns: 100, trainers: n });
    const liveInfo = { topRoleName: 'A', secondRoleName: 'B', dayLabel: 'Sun Nov 8', updatedLabel: '12:00 JST' };
    const sizeOf = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    const withFive = await live.renderLiveBoard(mkBoard(10), mkBoard(5), new Map(), liveInfo);
    const withTwelve = await live.renderLiveBoard(mkBoard(10), mkBoard(12), new Map(), liveInfo);
    check('today: filling to 8 does not make the image taller', sizeOf(withTwelve), sizeOf(withFive));

    // Settings: DM me too, early riser, boosts, special sets.
    const us = await import('../src/lib/timer/userSettings');
    const SG = `test-usettings-${Date.now()}`;
    check('settings: defaults', await us.getUserSettings(SG, 'u1'), { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] });
    check('settings: default run and ping times', [us.runMinutes(await us.getUserSettings(SG, 'u1')), us.pingMinutes(await us.getUserSettings(SG, 'u1'))], [50, 5]);
    await us.toggleSetting(SG, 'u1', 'dm');
    await us.toggleSetting(SG, 'u1', 'early');
    const on = await us.toggleSetting(SG, 'u1', 'set:set1');
    check('settings: each toggle flips', on, { dmPing: true, earlyRiser: true, boosts: true, disabledSets: ['set1'] });
    check('settings: boosts flip off and back', [(await us.toggleSetting(SG, 'u1', 'boosts')).boosts, (await us.toggleSetting(SG, 'u1', 'boosts')).boosts], [false, true]);
    check('settings: early riser runs 49 and clears in 4', [us.runMinutes(on), us.pingMinutes(on)], [49, 4]);
    check('settings: an unknown set is ignored', (await us.toggleSetting(SG, 'u1', 'set:nope')).disabledSets, ['set1']);
    check('settings: a set flips back on', (await us.toggleSetting(SG, 'u1', 'set:set1')).disabledSets, []);
    const view = JSON.stringify(us.settingsView(on));
    check('settings: the screen shows each setting\'s state', [view.includes('DM Me Too: On'), view.includes('Early Riser: On'), view.includes('Boosts: On')], [true, true, true]);
    check('settings: sets are not on this screen any more', [view.includes('Lobby Loungers:'), us.settingsView(on).components.length], [false, 1]);
    await prisma.timerUserSettings.deleteMany({ where: { guildId: SG } });
    const { BUTTON_SETTINGS } = await import('../src/lib/timer/panel');
    check('panel: has the Settings button', panelJson.includes(BUTTON_SETTINGS) || JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never)).includes(BUTTON_SETTINGS), true);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: RG } });
    const full = buildPingContent('u1', { milestone: 25, newLongestStreak: true, currentStreakDays: 7, firstOfDay: true, totalRuns: 25 } as never, 600, 'role-25', () => P);
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
