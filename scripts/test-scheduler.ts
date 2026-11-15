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
    send: async (options: { content?: string; components?: { toJSON(): unknown }[]; allowedMentions?: { users?: string[] } }) => {
        // A ping is a Components V2 box: read its text blocks back in order, as one text.
        const blocks = (options.components ?? []).flatMap((c) => ((c.toJSON() as { components?: { content?: string }[] }).components ?? []));
        const content = options.content ?? blocks.flatMap((b) => (b.content === undefined ? [] : [b.content])).join('\n');
        sent.push({ content, mentions: options.allowedMentions?.users ?? [] });
        return { id: String(nextMessageId++) };
    },
    messages: {
        fetch: async () => ({ edit: async () => undefined }),
        delete: async (id: string) => {
            deleted.push(id);
        },
    },
};

/** The DM copies, read back the same way as channel pings. */
const dms: { content: string }[] = [];
const userStub = {
    send: async (options: { components?: { toJSON(): unknown }[] }) => {
        const blocks = (options.components ?? []).flatMap((c) => ((c.toJSON() as { components?: { content?: string }[] }).components ?? []));
        dms.push({ content: blocks.flatMap((b) => (b.content === undefined ? [] : [b.content])).join('\n') });
        return {};
    },
};

// No guilds cached or fetchable: milestone roles are skipped, as for a guild the bot left.
const clientStub = { channels: { fetch: async () => channelStub }, guilds: { cache: new Map(), fetch: async () => null }, users: { fetch: async () => userStub } } as never;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.timerNotification.deleteMany({ where: { channelId: CHANNEL } });
    await prisma.timerUserSettings.deleteMany({ where: { guildId: G } });
    // DM Me Too on, so the DM copy can be compared with the channel ping.
    await prisma.timerUserSettings.create({ data: { guildId: G, discordUserId: 'trainer-a', dmPing: true } });

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
    check('DM copy: one, the same box as the channel ping', [dms.length, dms[0]?.content === sent[0]?.content], [1, true]);
    check('ping pings the trainer', sent[0]?.content.includes('<@trainer-a>'), true);
    check('ping explains the delay', sent[0]?.content.includes('while I was offline'), true);
    check('ping confirms it still counted', sent[0]?.content.includes('It still counts!'), true);
    check('first run is celebrated', sent[0]?.content.includes('**Debut!** Your very first run is on the record!'), true);
    const allOpeners = [...PING_OPENERS, ...RARE_PING_OPENERS];
    const { fillOpener: fillLine } = await import('../src/lib/timer/openers');
    // The mention can sit anywhere in a line, so compare the whole filled-in line.
    check('ping opens with one of the openers', allOpeners.some((o) => sent[0]?.content.startsWith(fillLine(o, 'trainer-a'))), true);
    check('openers: every one names the trainer at least once', allOpeners.every((o) => o.split('{user}').length >= 2), true);
    check('openers: below the base chance a rare one, spread evenly', [pickOpener(0), pickOpener(P - 1e-7), pickOpener(P / 2)], [RARE_PING_OPENERS[0], RARE_PING_OPENERS[RARE_PING_OPENERS.length - 1], RARE_PING_OPENERS[Math.floor(RARE_PING_OPENERS.length / 2)]]);
    check('openers: from the base chance up a common one, spread evenly', [pickOpener(P), pickOpener(P + (1 - P) * 0.5), pickOpener(0.9999)], [PING_OPENERS[0], PING_OPENERS[Math.floor(PING_OPENERS.length / 2)], PING_OPENERS[PING_OPENERS.length - 1]]);
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
    await rares.recordRareOpener(RG, 'u1', RARE_PING_OPENERS[2]!);
    await rares.recordRareOpener(RG, 'u2', RARE_PING_OPENERS[2]!);
    await rares.recordRareOpener(RG, 'u3', RARE_PING_OPENERS[4]!);
    // Fixed times around the Fortune Tent's opening: before it, Matikanefukukitaru is hidden everywhere.
    const { isOpenAt } = await import('../src/lib/timer/openers');
    const PRE = new Date('2026-11-20T00:00:00Z');
    const POST = new Date('2026-11-23T03:00:00Z');
    const tally = await rares.rareTally(RG);
    check('rares: tally per line, first finder kept', [tally.length, tally[2]?.count, tally[2]?.firstUserId, tally[4]?.count, tally[0]?.count], [RARE_PING_OPENERS.length, 2, 'u1', 1, 0]);
    type ViewJson = { embeds: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string } }[]; components: { components: { custom_id: string; label?: string; disabled?: boolean; placeholder?: string; options?: { label: string; value: string }[] }[] }[] };
    const json = (v: { embeds: { toJSON(): unknown }[]; components: { toJSON(): unknown }[] }) => ({ embeds: v.embeds.map((e) => e.toJSON()), components: v.components.map((c) => c.toJSON()) }) as ViewJson;
    const { SPECIAL_SETS: SETS } = await import('../src/lib/timer/openers');
    const page0 = json(rares.specialsView(tally, rares.SPECIALS_FIRST_PAGE, undefined, PRE));
    const embed = page0.embeds[0]!;
    const col = (n: number) => embed.fields?.[n]?.value.split('\n') ?? [];
    check('specials: one set per page, three columns', [embed.title, embed.description, embed.fields?.map((f) => f.name), col(0).length, col(2).length], [
        `Specials found: 2 of ${RARE_OPENERS.filter((o) => !o.extra && isOpenAt(o, PRE)).length}`,
        `**Set 1: ${SETS[0]!.name}**: 2 of ${SETS[0]!.openers.filter((o) => isOpenAt(o, PRE)).length} found`,
        ['Special', 'Times', 'First found by'],
        SETS[0]!.openers.filter((o) => isOpenAt(o, PRE)).length,
        SETS[0]!.openers.filter((o) => isOpenAt(o, PRE)).length,
    ]);
    check('specials: unfound rows hide the name', [col(0)[0], col(1)[0], col(2)[0]], ['**1.** ???', '—', '—']);
    check('specials: a found row shows name, count and finder', [col(0)[1], col(1)[1], col(2)[1]?.startsWith('<@u1> <t:')], [`**2.** ${RARE_OPENERS[2]!.name}`, '**×2**', true]);
    check('specials: no line text is ever shown', RARE_PING_OPENERS.some((t) => JSON.stringify(page0).includes(t.replace('{user}', '').trim().slice(0, 20))), false);
    const nav0 = page0.components[0]!.components;
    check('pages: the server list opens on Set 1, Back to Set 0', nav0.map((b) => [b.label, b.custom_id, b.disabled ?? false]), [
        ['Back', `${rares.SPECIALS_PAGE_PREFIX}all:0`, false],
        ['Next', `${rares.SPECIALS_PAGE_PREFIX}all:2`, false],
    ]);
    const set0 = json(rares.specialsView(tally, 0, undefined, PRE));
    check('set 0: the reminders, in full, Back off', [set0.embeds[0]!.title, PING_OPENERS.every((o) => set0.embeds[0]!.description?.includes(o.replaceAll('{user}', '@trainer'))), set0.components[0]!.components[0]!.disabled, set0.components.length], ['Set 0: Reminders', true, true, 1]);
    check('set 0: the same for a trainer, no toggle', json(rares.specialsView(tally, 0, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, PRE)).components[0]!.components.map((b) => b.label), ['Back', 'Next']);
    // Pages: Set 0, each set, and a "Set <n>.5" extras page right after a set with extras (owner, 2026-11-15).
    const extrasPages = SETS.filter((x) => RARE_OPENERS.some((o) => o.set === x.id && o.extra)).length;
    const lastPage = SETS.length + extrasPages;
    const last = json(rares.specialsView(tally, lastPage, undefined, PRE));
    check('pages: the last page is the last set\'s extras, numbered on its own, Next off', [last.embeds[0]!.description?.startsWith(`**Set ${SETS.length}.5: ${SETS.at(-1)!.name} Extras**`), last.embeds[0]!.fields?.[0]?.value.split('\n')[0], last.components[0]!.components.at(-1)?.disabled, last.embeds[0]!.footer?.text.endsWith(`Page ${lastPage + 1} of ${lastPage + 1}`)], [true, '???', true, true]);
    check('pages: a set\'s page lists only its lines', json(rares.specialsView(tally, rares.pageOfSet('mejiro-estate'), undefined, PRE)).embeds[0]!.description?.startsWith('**Set 3: The Mejiro Estate**: 0 of 9 found'), true);
    check('pages: a page out of range is clamped', [json(rares.specialsView(tally, 99, undefined, PRE)).embeds[0]!.description, json(rares.specialsView(tally, -5, undefined, PRE)).embeds[0]!.title], [last.embeds[0]!.description, 'Set 0: Reminders']);
    const { buildPanel, BUTTON_SPECIALS } = await import('../src/lib/timer/panel');
    const panelJson = JSON.stringify(buildPanel([], { runsToday: 0, topToday: null } as never));
    check('panel: has the Specials button', [panelJson.includes(BUTTON_SPECIALS), panelJson.includes('"label":"Specials"')], [true, true]);
    const noExtras = { lockedSets: [] as string[], disabledSets: [] as string[], boosts: [], boostsOn: true };
    const mineView = json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, noExtras, PRE));
    const mine = mineView.embeds[0]!;
    const mcol = (n: number) => mine.fields?.[n]?.value.split('\n') ?? [];
    check('specials: your own list counts only your finds (extras left out)', [mine.title, mcol(0)[1], mcol(1)[1], mcol(0)[4]], [`Your specials: 1 of ${RARE_OPENERS.filter((o) => !o.extra && isOpenAt(o, PRE)).length}`, `**2.** ${RARE_OPENERS[2]!.name}`, '**×1**', '**5.** ???']);
    check('specials: your own list shows when, not who', [mine.fields?.[2]?.name, mcol(2)[1]?.startsWith('<t:'), mine.footer?.text.startsWith('1 special ping for you')], ['First got', true, true]);
    check('pages: your page has Back, the set\'s toggle, Next', mineView.components[0]!.components.map((b) => [b.label, b.custom_id]), [
        ['Back', `${rares.SPECIALS_PAGE_PREFIX}mine:0`],
        [`${SETS[0]!.name}: On`, `${rares.SPECIALS_SET_PREFIX}${SETS[0]!.id}`],
        ['Next', `${rares.SPECIALS_PAGE_PREFIX}mine:2`],
    ]);
    check('pages: a set turned off says so', [json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, { ...noExtras, disabledSets: ['set1'] }, PRE)).components[0]!.components[1]!.label, json(rares.specialsView(await rares.rareTally(RG, 'u2'), 1, { ...noExtras, disabledSets: ['set1'] }, PRE)).embeds[0]!.description?.includes('Off:')], [`${SETS[0]!.name}: Off`, true]);
    // Reading an unlocked special in full. u2 found only special 2 (index 2: Fukukitaru, index 1, is not open at PRE); u3 found index 4.
    const menu = mineView.components[1]?.components[0];
    check('read menu: only your unlocked specials of this set', [menu?.custom_id, menu?.options?.map((o) => [o.label, o.value])], [rares.READ_MENU_ID, [[`2. ${RARE_OPENERS[2]!.name}`, RARE_OPENERS[2]!.id]]]);
    check('read menu: none when nothing is unlocked', json(rares.specialsView(await rares.rareTally(RG, 'nobody'), 1, noExtras, PRE)).components.length, 1);
    check('read menu: none on the server list', page0.components.length, 1);
    const read = await rares.readSpecial(RG, 'u2', RARE_OPENERS[2]!.id);
    check('read: an unlocked special shows in full, as you', [read?.name, read?.text === RARE_OPENERS[2]!.text.replace('{user}', '<@u2>')], [RARE_OPENERS[2]!.name, true]);
    check("read: someone else's special stays locked", await rares.readSpecial(RG, 'u2', RARE_OPENERS[4]!.id), null);
    check('read: a forged choice reveals nothing', [await rares.readSpecial(RG, 'u2', 'x'), await rares.readSpecial(RG, 'u2', '1')], [null, null]);
    // Sets: a set turned off never comes up.
    const openers = await import('../src/lib/timer/openers');
    const allIds = openers.RARE_OPENERS.map((o) => o.id);
    check('ids: every special has a unique id', new Set(allIds).size, allIds.length);
    check('ids: each id starts with its set', openers.RARE_OPENERS.every((o) => o.id.startsWith(o.guest ? 'guest.' : ({ 'online-sensations': 'os.', 'mejiro-estate': 'mejiro.' } as Record<string, string>)[o.set] ?? `${o.set}.`)), true);
    check('ids: prerequisites and locks name real specials', [...openers.SPECIAL_SETS.flatMap((x) => (x.requires ? [x.requires] : [])), ...openers.SPECIAL_LOCKS.map((l) => l.id)].every((id) => openers.specialById(id) !== undefined), true);
    // A reworded special keeps its finds: they follow the id, not the text.
    const IG = `test-ids-${Date.now()}`;
    await rares.recordRareOpener(IG, 'u1', RARE_OPENERS[2]!.text);
    await prisma.rareOpenerHit.updateMany({ where: { guildId: IG }, data: { opener: 'the old wording of this line' } });
    check('ids: a find survives rewording', [(await rares.rareTally(IG, 'u1'))[2]?.count, (await rares.readSpecial(IG, 'u1', RARE_OPENERS[2]!.id))?.name], [1, RARE_OPENERS[2]!.name]);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: IG } });
    check('sets: every special belongs to a set', openers.RARE_OPENERS.every((o) => openers.SPECIAL_SETS.some((set) => set.id === o.set)), true);
    // Paused sets (The Mejiro Estate, owner 2026-11-10) give no new finds: never in the pool.
    // A special not open yet (Matikanefukukitaru, until the Fortune Tent opens) is in no pool either.
    const liveSpecials = RARE_OPENERS.filter((o) => !openers.PAUSED_SETS.includes(o.set) && !o.extra && openers.isOpenAt(o)).length;
    const set1Open = openers.SPECIAL_SETS[0]!.openers.filter((o) => openers.isOpenAt(o)).length;
    check('sets: all on gives every special of the sets not paused (extras never)', openers.rarePoolFor([]).length, liveSpecials);
    check('sets: a set off leaves its specials out', openers.rarePoolFor(['set1']).length, liveSpecials - set1Open);
    // The Mejiro Estate was paused 2026-11-10 and resumed 2026-11-15 (owner).
    check('paused: no set is paused', openers.PAUSED_SETS, []);
    check('resumed: the Estate\'s lines roll once it is unlocked', openers.rarePoolFor([], []).some((t) => RARE_OPENERS.some((o) => o.set === 'mejiro-estate' && o.text === t)), true);
    check('resumed: finding the Mejiro Family line announces the Estate', openers.setsUnlockedBy(openers.specialById('set1.mejiro')!.text, ['mejiro-estate']).map((x) => x.name), ['The Mejiro Estate']);
    check('paused: no boost draws on it', openers.boostPool('mejiro-estate', 'collab'), []);
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
    check('lock: everyone else keeps the base chance, spread evenly over the rest', [other.specials, other.others.length, Math.max(...other.others) - Math.min(...other.others) <= 2], [stepsOf(20000), liveSpecials - 1, true]);
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
    check('locks: each gated set is locked until its special (Curren Chan, the Mejiro Family line)', await rares.lockedSetsFor(XG, 'u1'), ['online-sensations', 'mejiro-estate']);
    check('locks: a locked set is out of the pool', openers.rarePoolFor([], ['online-sensations', 'mejiro-estate']).length, set1Open);
    await rares.recordRareOpener(XG, 'u1', curren.text);
    check('locks: open once Curren Chan is found (only that set)', [await rares.lockedSetsFor(XG, 'u1'), await rares.lockedSetsFor(XG, 'u2')], [['mejiro-estate'], ['online-sensations', 'mejiro-estate']]);
    const collabs = openers.boostPool('online-sensations', 'collab');
    check('boost: covers every #OnlineSensations line, Loves and #Celebrate included', [collabs.length, collabs.includes(loves.text), RARE_OPENERS.filter((o) => collabs.includes(o.text)).map((o) => o.name).includes('#Celebrate')], [openers.SPECIAL_SETS[1]!.openers.length, true, true]);
    check('boost: a plain special grants nothing', await rares.grantBoost(XG, 'u1', curren.text), false);
    check('boost: Loves grants 50 runs', [await rares.grantBoost(XG, 'u1', loves.text), await rares.activeBoosts(XG, 'u1')], [true, [{ setId: 'online-sensations', runsLeft: 50 }]]);
    await rares.spendBoosts(XG, 'u1');
    await rares.spendBoosts(XG, 'u1');
    check('boost: each ping spends one', (await rares.activeBoosts(XG, 'u1'))[0]?.runsLeft, 48);
    await rares.grantBoost(XG, 'u1', loves.text);
    check('boost: getting Loves again stacks the runs (48 + 50), not the chance', await rares.activeBoosts(XG, 'u1'), [{ setId: 'online-sensations', runsLeft: 98 }]);
    for (let k = 0; k < 98; k += 1) await rares.spendBoosts(XG, 'u1');
    check('boost: gone once every run is spent', await rares.activeBoosts(XG, 'u1'), []);
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
    // Tylina's personal boost (owner, 2026-11-11): +3% from her usual pool, paused with Boosts off.
    const tylina = openers.PERSONAL_BOOSTS[0]!;
    const hers = await extraChances(XG, tylina.owner, base, ['online-sensations'], false, fullPool, OFF_SEASON);
    check('personal: Tylina gets +3% from her usual pool, as "Ei, Ei, Mun!"', hers.map((e) => [e.chance, e.pool.length, e.label?.startsWith('Ei, Ei, Mun!')]), [[0.03, fullPool.length, true]]);
    check('personal: nobody else gets it', (await extraChances(XG, 'someone-else', base, ['online-sensations'], false, fullPool, OFF_SEASON)).length, 0);
    // A trainer can hold several (owner, 2026-11-12): two at +1.5% each, each its own line.
    const leneya = await extraChances(XG, '340238209147600897', base, ['online-sensations'], false, fullPool, OFF_SEASON);
    check('personal: two boosts are two lines, +1.5% each', leneya.map((e) => [e.chance, e.label?.split(':')[0]]), [[0.015, 'Faster Than Light'], [0.015, "Principal's Pirouette"]]);
    check('personal: paused with her Boosts off', await extraChances(XG, tylina.owner, { ...base, boosts: false }, [], false, fullPool, OFF_SEASON), []);
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
    const lockedPage = json(await rares.mySpecialsView(XG, 'u2', 2, PRE));
    check('pages: a locked set hides its rows, toggle greyed out', [lockedPage.embeds[0]!.description, lockedPage.embeds[0]!.fields ?? [], lockedPage.components[0]!.components[1]?.label, lockedPage.components[0]!.components[1]?.disabled], [
        `**Set 2: #OnlineSensations**: 0 of ${openers.SPECIAL_SETS[1]!.openers.length} found\nLocked: find **Curren Chan** to open it.`,
        [],
        '#OnlineSensations: Locked',
        true,
    ]);
    await us0.toggleSetting(XG, 'u1', 'boosts');
    const boostPage = json(await rares.mySpecialsView(XG, 'u1', 1, PRE));
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
    check('season: Curren Chan week, +1% Curren Chan, extended to the reset of Nov 22 (owner)', [week.specialId, week.chance, week.until.toISOString(), week.label], ['set1.curren', 0.01, '2026-11-22T15:00:00.000Z', 'Curren Chan: meet her in the lobby!']);
    // No bonus is permanent (owner, 2026-11-15): the #OnlineSensations unlock bonus ends at the reset of Nov 22.
    const osBefore = await extraChances(XG, 'os-end', { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] }, [], false, fullPool, new Date('2026-11-20T00:00:00Z'));
    const osAfter = await extraChances(XG, 'os-end', { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] }, [], false, fullPool, new Date('2026-11-22T15:00:00Z'));
    const osLabel = (xs: { label?: string }[]) => xs.find((e) => e.label?.startsWith('#OnlineSensations: Curren'))?.label;
    check('unlock bonus: +1% #OnlineSensations until the reset of Nov 22, then gone', [osLabel(osBefore)?.endsWith(`Ends <t:${Date.UTC(2026, 10, 22, 15) / 1000}:R>.`), osLabel(osAfter)], [true, undefined]);
    // Mejiro week (owner, 2026-11-15): reset to reset; +2% the invitation until the Estate opens, then +2% its lines.
    const [, invite, estateWeek] = openers.SEASONAL_BUFFS;
    check('season: Mejiro week, reset to reset, +2% each', [invite?.specialId, estateWeek?.setId, invite?.chance, estateWeek?.chance, invite?.from.toISOString(), estateWeek?.until.toISOString()], ['set1.mejiro', 'mejiro-estate', 0.02, 0.02, '2026-11-15T15:00:00.000Z', '2026-11-22T15:00:00.000Z']);
    const MW = new Date('2026-11-17T00:00:00Z');
    const mwBase = { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] as string[] };
    const mwLocked = await extraChances(XG, 'mw-new', mwBase, ['online-sensations', 'mejiro-estate'], false, fullPool, MW);
    const mwOpen = await extraChances(XG, 'mw-open', mwBase, ['online-sensations'], false, fullPool, MW);
    check('season: before the Estate opens, +2% on the invitation; after, +2% on its 9 lines', [mwLocked.filter((e) => e.label?.startsWith('Mejiro week')).map((e) => [e.chance, e.pool.length]), mwOpen.filter((e) => e.label?.startsWith('Mejiro week')).map((e) => [e.chance, e.pool.length])], [[[0.02, 1]], [[0.02, 9]]]);
    check('season: Mejiro week also gives Ramonu her own +2% once the Estate is open', [mwLocked.some((e) => e.label?.startsWith('Mejiro Ramonu')), mwOpen.filter((e) => e.label?.startsWith('Mejiro Ramonu: You stayed when it mattered')).map((e) => [e.chance, e.pool.length, e.pool[0] === openers.specialById('mejiro.ramonu')!.text])], [false, [[0.02, 1, true]]]);
    check('season: the Estate label', openers.SEASONAL_BUFFS[2]?.label, 'Mejiro week: Come meet the Mejiros at the Estate!');
    // Ramonu's +2% runs until the server's first Ramonu's Second Love, its end never shown (owner, 2026-11-15).
    const ramonuBuff = mwOpen.find((e) => e.label?.startsWith('Mejiro Ramonu'));
    check('season: Ramonu\'s buff shows no end', ramonuBuff?.label?.includes('Ends'), false);
    const rewardsSL = await import('../src/lib/timer/rewards');
    await rewardsSL.grantSecondLove(null, XG, 'first-lover');
    const mwAfterLove = await extraChances(XG, 'mw-open', mwBase, ['online-sensations'], false, fullPool, MW);
    check('season: the server\'s first Second Love ends Ramonu\'s buff; Mejiro week goes on', [mwAfterLove.some((e) => e.label?.startsWith('Mejiro Ramonu')), mwAfterLove.some((e) => e.label?.startsWith('Mejiro week: Come meet'))], [false, true]);
    check('season: the first is recorded once', (await prisma.timerSecondLove.findUnique({ where: { guildId: XG } }))?.firstUserId, 'first-lover');
    await rewardsSL.grantSecondLove(null, XG, 'second-lover');
    check('season: later winners do not replace the first', (await prisma.timerSecondLove.findUnique({ where: { guildId: XG } }))?.firstUserId, 'first-lover');
    const buff = { label: 'Sample week', specialId: 'set1.curren', chance: 0.01, from: new Date('2026-12-01T00:00:00Z'), until: new Date('2026-12-08T00:00:00Z') };
    const inSeason = new Date(buff.from.getTime() + 60_000);
    const currenText = RARE_OPENERS.find((o) => o.id === buff.specialId)!.text;
    const SN = `test-season-${Date.now()}`;
    const plain = { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] as string[] };
    const LOCKED = ['online-sensations'];
    const seasonal = await extraChances(SN, 's1', plain, LOCKED, false, openers.rarePoolFor([]), inSeason, [buff]);
    check('season: in its window, an extra slice that only draws its special', seasonal.map((e) => [e.chance, e.pool]), [[0.01, [currenText]]]);
    check('season: not before or after the window', [(await extraChances(SN, 's1', plain, LOCKED, false, [], new Date(buff.from.getTime() - 1), [buff])).length, (await extraChances(SN, 's1', plain, LOCKED, false, [], buff.until, [buff])).length], [0, 0]);
    // (This sample week is in December, after the #OnlineSensations unlock bonus ended on Nov 22.)
    check('season: a prerequisite buff stops once its set is unlocked (and by December the unlock bonus is over)', (await extraChances(SN, 's1', plain, [], false, openers.rarePoolFor([]), inSeason, [buff])).map((e) => [e.chance, e.pool.length]), []);
    check('season: not with its set off, or Boosts off', [(await extraChances(SN, 's1', { ...plain, disabledSets: ['set1'] }, LOCKED, false, [], inSeason, [buff])).length, (await extraChances(SN, 's1', { ...plain, boosts: false }, LOCKED, false, [], inSeason, [buff])).length], [0, 0]);

    // The Boosts view: base, each boost, and the next ping's total.
    const { boostsView, BOOSTS_TOGGLE_ID } = await import('../src/lib/timer/boosts');
    await rares.grantBoost(SN, 's1', loves.text);
    await rares.recordRareOpener(SN, 's1', curren.text);
    const bv = (await boostsView(SN, 's1', inSeason)).embeds[0]!.toJSON().description ?? '';
    check('boosts view: base and Loves; the unlock bonus is over by December, total 10%', [bv.includes('**Base:** 6%'), bv.includes('**+4%** #OnlineSensations collab lines, 50 runs left.'), bv.includes('**+1%** #OnlineSensations: Curren ~~drags~~ invites you for her #SpecialCollabs!'), bv.includes('Curren Chan week'), bv.includes('**Your next ping: 10% chance of a special.**')], [true, true, false, false, true]);
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
    await seedHits('lb-set', set1, 0); // 14 found, Set 1 complete
    await seedHits('lb-wide', all.slice(1, 21), 100); // 20 found, no set complete
    await seedHits('lb-wide-more', [...all.slice(1, 21), all[1]!], 200); // 20 found, one repeat
    await seedHits('lb-wide-late', all.slice(1, 21), 300); // ties lb-wide, but later
    const sb = await rares.specialsBoard(LB, 15, POST);
    // Points: 15 a new special, 3 a repeat, 100 a full set.
    check('specials board: points (15 new, 3 repeat, 100 a set)', rares.SPECIAL_POINTS, { found: 15, repeat: 3, set: 100 });
    check('specials board: ranked by points, a tie to who got there first', sb.rows.map((r) => [r.discordUserId, r.points, r.setsComplete, r.found, r.pings]), [
        ['lb-set', 310, 1, 14, 14],
        ['lb-wide-more', 303, 0, 20, 21],
        ['lb-wide', 300, 0, 20, 20],
        ['lb-wide-late', 300, 0, 20, 20],
    ]);
    check('specials board: limit caps the rows, not the totals', [(await rares.specialsBoard(LB, 3, POST)).rows.length, (await rares.specialsBoard(LB, 3, POST)).trainers], [3, 4]);
    check('specials board: totals', [sb.totalPings, sb.trainers, sb.specialCount, sb.setCount], [14 + 20 + 21 + 20, 4, RARE_OPENERS.filter((o) => !o.extra).length + 13, openers.SPECIAL_SETS.length + 1]); // + Set 4's 13 fortunes
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

    // Soft caps: full to raw 20%, half to raw 30% (25%), a quarter beyond, 30% at most.
    const eff = (t: number) => Math.round(openers.effectiveChance(t) * 10000) / 10000;
    check('caps: full, then half, then a quarter, then the 30% hard cap', [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7].map(eff), [0.1, 0.2, 0.225, 0.25, 0.275, 0.3, 0.3]);
    // A big pile of boosts: base 6% + 30% raw extras = raw 36%, so 26.5% effective
    // (25% + 6% / 4); the base slice stays 6% and the extras shrink to 20.5%.
    const CG = `test-caps-${Date.now()}`;
    const bigExtras = [{ chance: 0.3, pool: openers.boostPool('online-sensations', 'collab') }];
    const capCounts = new Map<string, number>();
    for (let k = 0; k < 20000; k += 1) {
        const o = await rares.chooseOpener(CG, 'someone', k / 20000, fullPool, bigExtras);
        capCounts.set(o, (capCounts.get(o) ?? 0) + 1);
    }
    const capSpecials = [...capCounts].filter(([o]) => rares.isRareOpener(o)).reduce((n, [, c]) => n + c, 0);
    check('caps: raw 36% plays as 26.5% (base whole, boosts shrunk)', Math.abs(capSpecials - stepsOf(20000, 0.265)) <= 2, true);

    // The Mejiro Estate: Set 1's Mejiro Family line opens it; Grandmother first (8x), then the seven, then the photograph.
    const mejiro = openers.SPECIAL_SETS.find((x) => x.id === 'mejiro-estate')!;
    const grandma = mejiro.openers.find((o) => o.id === 'mejiro.grandmother')!;
    const seven = mejiro.openers.filter((o) => !o.extra && o.after?.length === 1).map((o) => o.id);
    const photo = mejiro.openers.find((o) => o.id === 'mejiro.photo')!;
    check('mejiro: 9 lines and 1 extra, opened by the Mejiro Family line; 7 wait on Grandmother; the photo on all 8', [mejiro.openers.filter((o) => !o.extra).length, mejiro.openers.filter((o) => o.extra && !o.guest).map((o) => o.id), mejiro.requires, seven.length, photo.after?.length], [9, ['mejiro.rehearsal'], 'set1.mejiro', 7, 8]);
    // The Family Photograph names the trainer three times, by the owner's design (the finale); every other line once.
    check('mejiro: one {user} each, guests included; the photograph three', [mejiro.openers.filter((o) => o.id !== 'mejiro.photo').every((o) => o.text.split('{user}').length === 2), photo.text.split('{user}').length - 1], [true, 3]);
    check('photo: the art, credited, under the finale', [photo.media, photo.credit, openers.specialMediaPath(photo.text) ? (await import('fs')).existsSync(openers.specialMediaPath(photo.text)!) : false, photo.text.endsWith('Welcome to the Mejiro Family, {user}.')], ['mejiro-family-photograph.jpg', 'Art: <https://x.com/mokumoku_warabi/status/1783425000428757341>', true, true]);
    // No hashtags, except Palmer's one: #SweetieSecrecies is Palmer imitating Helios, on purpose.
    check('mejiro: no hashtags, but Palmer\'s one Helios imitation', [mejiro.openers.filter((o) => o.id !== 'mejiro.palmer' && !o.guest).every((o) => !/#\w/.test(o.text)), mejiro.openers.find((o) => o.id === 'mejiro.palmer')!.text.match(/#\w+/g)], [true, ['#SweetieSecrecies']]);
    const sevenTexts = seven.map((id) => openers.specialById(id)!.text);
    check('stages: before Grandmother, the seven and the photo are closed', openers.closedSpecials(new Set()).filter((t) => [...sevenTexts, photo.text].includes(t)).length, 8);
    check('stages: after Grandmother, only the photo waits', openers.closedSpecials(new Set([grandma.id])).filter((t) => [...sevenTexts, photo.text].includes(t)), [photo.text]);
    check('stages: the photo opens once all eight are found', openers.closedSpecials(new Set([grandma.id, ...seven])).includes(photo.text), false);
    const FG = `test-stages-${Date.now()}`;
    // The set is paused, so its pool is built directly: the staging must still work when it resumes.
    const mejiroPool = mejiro.openers.filter((o) => !o.extra).map((o) => o.text);
    const poolBefore = await rares.trainerPool(FG, 'f1', mejiroPool);
    check('redirect: before her welcome, every Mejiro roll is Grandmother (9 of 9)', [poolBefore.length, poolBefore.every((t) => t === grandma.text)], [9, true]);
    await rares.recordRareOpener(FG, 'f1', grandma.text);
    const poolAfter = await rares.trainerPool(FG, 'f1', mejiroPool);
    check('redirect: once found she counts once, the seven open, and a photo roll gives an unmet member', [poolAfter.filter((t) => t === grandma.text).length, poolAfter.length, poolAfter.includes(photo.text), poolAfter.filter((t) => t === sevenTexts[0]).length], [1, 9, false, 2]);
    for (const t of sevenTexts) await rares.recordRareOpener(FG, 'f1', t);
    check('stages: with the whole family found, the photograph joins the pool', (await rares.trainerPool(FG, 'f1', mejiroPool)).includes(photo.text), true);
    const mPage = json(rares.specialsView(await rares.rareTally(FG), 3, undefined, PRE));
    check('stages: the page never shows the lock, just ???', mPage.embeds[0]!.fields?.[0]?.value.split('\n')[8], '**9.** ???');
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: FG } });

    // Outcomes: Ramonu rolls one each time; her Remedial Rehearsal is an extra with a losing streak.
    // The set is paused, so pools are built directly, as the staging checks above do.
    const ramonu = openers.specialById('mejiro.ramonu')!;
    const rehearsal = openers.specialById('mejiro.rehearsal')!;
    check('outcomes: Ramonu rolls 75% lesson, 25% footwork', [0, 0.5, 0.7499, 0.75, 0.9999].map((r) => openers.rollOutcome(ramonu, r)?.outcome), ['lesson', 'lesson', 'lesson', 'footwork', 'footwork']);
    check('outcomes: a special without outcomes rolls nothing', openers.rollOutcome(grandma, 0.3), null);
    const lesson = openers.rollOutcome(ramonu, 0.1)!;
    const footwork = openers.rollOutcome(ramonu, 0.9)!;
    check('outcomes: Ramonu\'s lesson schedules the Rehearsal within 25 runs, with no boost', [lesson.schedule, lesson.boost, lesson.footer.startsWith('-# Ramonu is still not quite satisfied'), lesson.footer.endsWith('She will summon you for a lesson sometime in the next 25 runs.')], [{ special: 'mejiro.rehearsal', within: 25 }, undefined, true, true]);
    check('outcomes: Ramonu\'s footwork is +5% any Mejiro line for 50 runs', [footwork.boost?.special, footwork.boost?.set, footwork.boost?.chance, footwork.boost?.runs, footwork.boost?.endsOnHit ?? false, footwork.footer.endsWith('gain a 5% chance of meeting another Mejiro.')], [undefined, 'mejiro-estate', 0.05, 50, false, true]);
    check('outcomes: the odds are never in a footer', [...(ramonu.outcomes ?? []), ...(rehearsal.outcomes ?? [])].some((o) => /75%|25%|50%/.test(o.footer ?? '')), false);
    check('rehearsal: an extra, out of the base pool and every set-wide pool', [rehearsal.extra, openers.rarePoolFor([], []).includes(rehearsal.text), openers.setLinesPool('mejiro-estate').length, openers.setLinesPool('mejiro-estate').includes(rehearsal.text), RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && !o.extra).length], [true, false, 9, false, 9]);
    check('rehearsal: unlocked by Ramonu, one {user}, its own text', [rehearsal.after, rehearsal.text.split('{user}').length - 1, rehearsal.name], [['mejiro.ramonu'], 1, "Ramonu's Remedial Rehearsal"]);
    check('rehearsal: a boost on it would draw just its line', openers.outcomeBoostPool({ set: 'mejiro-estate', special: 'mejiro.rehearsal' }), [rehearsal.text]);
    check('rehearsal: 50% win, 50% lose', [0, 0.4999, 0.5, 0.9999].map((r) => openers.rollOutcome(rehearsal, r)?.outcome), ['win', 'win', 'lose', 'lose']);
    const win = openers.rollOutcome(rehearsal, 0.2)!;
    check('rehearsal: a win is +3% any Mejiro line for 25 runs and resets the streak', [win.win, win.lose, win.boost?.chance, win.boost?.runs, win.boost?.special, win.footer.startsWith('-# Your practice paid off.'), win.footer.endsWith('gain a 3% chance of meeting another Mejiro.')], [true, false, 0.03, 25, undefined, true, true]);
    check('rehearsal: a loss spreads evenly over the three mishaps', [0.5, 0.7, 0.9].map((r) => openers.rollOutcome(rehearsal, r)?.mishap), ['tail', 'dress', 'feet']);
    check('rehearsal: a loss never repeats a mishap of the streak', [openers.rollOutcome(rehearsal, 0.5, ['tail'])?.mishap, openers.rollOutcome(rehearsal, 0.9, ['tail'])?.mishap, openers.rollOutcome(rehearsal, 0.5, ['dress', 'tail'])?.mishap, openers.rollOutcome(rehearsal, 0.99, ['feet', 'dress'])?.mishap], ['dress', 'feet', 'feet', 'tail']);
    const mishapFooter = openers.rollOutcome(rehearsal, 0.5)!.footer;
    check('rehearsal: the tail footer, word for word', mishapFooter, '-# You tried. Admittedly. You still stepped on her tail, and she was *displeased*. She has cleared your schedule: your next run ends in another lesson.');
    check('rehearsal: three losses in a row are a forced success, whatever the roll', [openers.rollOutcome(rehearsal, 0.1, ['tail', 'dress', 'feet'])?.forced, openers.rollOutcome(rehearsal, 0.9, ['feet', 'tail', 'dress'])?.outcome, openers.rollOutcome(rehearsal, 0.9, ['feet', 'tail'])?.forced], [true, 'forced', false]);

    // The Boosts storage and mechanics, through the database.
    const OG = `test-outcomes-${Date.now()}`;
    const T = 'o1';
    const ping = async (opener: string, r: number, pick = 0.4) => {
        // As the scheduler does after a ping: spend, count the guarantee down, record, end one-time boosts, apply the outcome.
        const state = await rares.outcomeState(OG, T);
        const special = openers.specialByText(opener);
        const rolled = special ? openers.rollOutcome(special, r, state.losingStreak) : null;
        await rares.spendBoosts(OG, T);
        await rares.tickGuarantee(OG, T, opener);
        if (openers.specialIdOf(opener)) {
            await rares.recordRareOpener(OG, T, opener);
            await rares.endBoostsHitBy(OG, T, opener);
            await rares.applyOutcome(OG, T, opener, rolled, () => pick);
        }
        return rolled;
    };
    const stateOf = () => rares.outcomeState(OG, T);
    for (const id of ['mejiro.grandmother', 'mejiro.mcqueen']) await rares.recordRareOpener(OG, T, openers.specialById(id)!.text);
    // Ramonu's lesson (owner, 2026-11-15): the Rehearsal on a run picked at random from the next 25; no boost, no stacking.
    await ping(ramonu.text, 0.1, 0.4);
    check('ramonu: the lesson schedules the Rehearsal 11 runs out (pick 0.4), with no boost', [await stateOf(), await rares.activeBoosts(OG, T)], [{ guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 11, losingStreak: [] }, []]);
    check('ramonu: the pick covers runs 1 to 25', [0, 0.04, 0.5, 0.9999].map((x) => 1 + Math.min(24, Math.floor(x * 25))), [1, 2, 13, 25]);
    check('schedule: not due yet, so no guarantee', rares.guaranteedOpener(await stateOf(), [], []), undefined);
    // No Ramonu until her Rehearsal is passed (owner, 2026-11-15): out of every pool while it is owed.
    const mejiroLines = RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && !o.extra).map((o) => o.text);
    const hasRamonu = async () => (await rares.trainerPool(OG, T, mejiroLines)).includes(ramonu.text);
    check('held: no Ramonu while her lesson is scheduled', await hasRamonu(), false);
    const currenSpecial = openers.specialById('set1.curren')!;
    check('schedule: a guarantee fires only on its run (shown on a live set)', [rares.guaranteedOpener({ guaranteedSpecialId: 'set1.curren', guaranteedInRuns: 2, losingStreak: [] }, [], []), rares.guaranteedOpener({ guaranteedSpecialId: 'set1.curren', guaranteedInRuns: 1, losingStreak: [] }, [], [])], [undefined, currenSpecial.text]);
    await ping(PING_OPENERS[0]!, 0.5);
    check('schedule: every other ping counts it down', (await stateOf()).guaranteedInRuns, 10);
    const usable = { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] as string[] };
    const NOT_OS = ['online-sensations'];
    await ping(ramonu.text, 0.9);
    check('ramonu: footwork adds +5% any Mejiro line for 50 runs; the schedule keeps counting', [(await rares.activeBoosts(OG, T)).map((b) => [b.key, b.runsLeft, b.chance, b.specialId ?? null]), (await stateOf()).guaranteedInRuns], [[['mejiro.ramonu:footwork', 50, 0.05, null]], 9]);
    await ping(ramonu.text, 0.1, 0.99);
    check('ramonu: a second lesson does not stack or move the pending one', await stateOf(), { guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 8, losingStreak: [] });
    await ping(ramonu.text, 0.9);
    check('boosts: outcome boosts do not stack; a repeat tops up to full', (await rares.activeBoosts(OG, T)).find((b) => b.key === 'mejiro.ramonu:footwork')?.runsLeft, 50);
    check('boosts view labels: any Mejiro line, the win', [openers.outcomeBoostLabel(openers.outcomeBoostByKey('mejiro.ramonu:footwork')!, 50), openers.outcomeBoostLabel(openers.outcomeBoostByKey('mejiro.rehearsal:win')!, 25)], ['The Mejiro Estate: any Mejiro line, 50 runs left.', 'The Mejiro Estate: any Mejiro line, 25 runs left, after a lesson well learned.']);
    for (let k = 0; k < 10; k += 1) await ping(PING_OPENERS[0]!, 0.5);
    check('schedule: counts down to 1 and stays due (the set is paused, so it waits)', (await stateOf()).guaranteedInRuns, 1);
    check('boosts: outcome boosts apply, but give nothing with Boosts off or with the set off', [(await extraChances(OG, T, usable, NOT_OS, false, [], OFF_SEASON)).length, (await extraChances(OG, T, { ...usable, boosts: false }, NOT_OS, false, [], OFF_SEASON)).length, (await extraChances(OG, T, { ...usable, disabledSets: ['mejiro-estate'] }, NOT_OS, false, [], OFF_SEASON)).length], [1, 0, 0]);
    // The same storage on a set that is not paused (stored by hand: no Set 1 line has outcomes).
    const UG = `${OG}-live`;
    await prisma.timerSpecialBoost.createMany({ data: [
        { guildId: UG, discordUserId: T, setId: 'set1', key: 'test:one', specialId: 'set1.curren', chance: 0.02, endsOnHit: true, runsLeft: 5 },
        { guildId: UG, discordUserId: T, setId: 'set1', key: 'test:set', chance: 0.03, runsLeft: 1 },
    ] });
    const live1 = await extraChances(UG, T, usable, NOT_OS, false, [], OFF_SEASON);
    check('boosts: on a live set, one special or the set\'s lines, at their own chance, labelled', live1.map((e) => [e.chance, e.pool.length, e.label]), [[0.02, 1, 'Curren Chan, 5 runs left.'], [0.03, set1Open, 'Lobby Loungers: any of its lines, 1 run left.']]);
    await rares.endBoostsHitBy(UG, T, openers.specialById('set1.curren')!.text);
    check('boosts: a one-time boost on a live set ends on its hit, the other stays', (await rares.activeBoosts(UG, T)).map((b) => b.key), ['test:set']);
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId: UG } });
    const footer = json(await rares.mySpecialsView(OG, T, 3, PRE)).embeds[0]!.footer?.text.split('\n') ?? [];
    check('specials: outcome boosts in the footer', footer.some((l) => l.startsWith('Boost: +5% The Mejiro Estate for ')), true);

    // The Rehearsal comes up: the schedule is fulfilled; a loss guarantees the next ping.
    const lost1 = await ping(rehearsal.text, 0.5);
    check('held: still no Ramonu after a lost lesson', await hasRamonu(), false);
    check('rehearsal: a loss starts the streak and guarantees the next ping', [lost1?.mishap, await stateOf()], ['tail', { guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 1, losingStreak: ['tail'] }]);
    await ping(ramonu.text, 0.1, 0.9);
    check('ramonu: a lesson during a losing streak schedules nothing new', await stateOf(), { guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 1, losingStreak: ['tail'] });
    const st = await rares.outcomeState(OG, T);
    check('guarantee: due now, it fires; not while the set is off or locked', [rares.guaranteedOpener(st, [], []), rares.guaranteedOpener(st, ['mejiro-estate'], []), rares.guaranteedOpener(st, [], ['mejiro-estate'])], [rehearsal.text, undefined, undefined]);
    check('guarantee: chooseOpener honours it, whatever the roll and before any boost', [await rares.chooseOpener(OG, T, 0.99, fullPool, [], PING_OPENERS, rehearsal.text), await rares.chooseOpener(OG, T, 0.001, fullPool, extras, PING_OPENERS, rehearsal.text)], [rehearsal.text, rehearsal.text]);
    const lost2 = await ping(rehearsal.text, 0.5);
    const lost3 = await ping(rehearsal.text, 0.5);
    check('rehearsal: three losses are the tail, the dress and the feet, once each', [lost1?.mishap, lost2?.mishap, lost3?.mishap], ['tail', 'dress', 'feet']);
    check('rehearsal: still guaranteed after the third loss', (await rares.outcomeState(OG, T)).guaranteedSpecialId, 'mejiro.rehearsal');
    check('held: still no Ramonu mid losing streak', await hasRamonu(), false);
    const forced = await ping(rehearsal.text, 0.1);
    check('held: Ramonu is back once the lesson is passed (here, forced)', await hasRamonu(), true);
    check('rehearsal: the 4th lesson is a forced success; streak and guarantee reset; no boost', [forced?.forced, await rares.outcomeState(OG, T), (await rares.activeBoosts(OG, T)).map((b) => b.key)], [true, { guaranteedSpecialId: null, guaranteedInRuns: 1, losingStreak: [] }, ['mejiro.ramonu:footwork']]);
    await ping(rehearsal.text, 0.6);
    check('held: a lost lesson takes Ramonu away again', await hasRamonu(), false);
    const won = await ping(rehearsal.text, 0.2);
    check('held: a won lesson brings Ramonu back', await hasRamonu(), true);
    check('rehearsal: a win resets the streak, clears the guarantee, and adds +3% any Mejiro line', [won?.outcome, await rares.outcomeState(OG, T), (await rares.activeBoosts(OG, T)).find((b) => b.key === 'mejiro.rehearsal:win')?.runsLeft], ['win', { guaranteedSpecialId: null, guaranteedInRuns: 1, losingStreak: [] }, 25]);
    check('rehearsal: the next loss can be the tail again (a new streak)', (await ping(rehearsal.text, 0.5))?.mishap, 'tail');

    // The ping text: the line, then the footer; a forced success has the paragraph and the role footer.
    const sched = await import('../src/lib/timer/scheduler');
    const pb = await import('../src/lib/timer/pingBox');
    const lessonPing = sched.pingText(ramonu.text, 'u1', lesson);
    check('ping: the outcome footer goes under the line, as subtext', [lessonPing.startsWith(openers.fillOpener(ramonu.text, 'u1') + '\n-# Ramonu is still'), pb.splitSubtext(lessonPing).sub === lesson.footer], [true, true]);
    const forcedRoll = openers.rollOutcome(rehearsal, 0.3, ['tail', 'dress', 'feet'])!;
    const forcedPing = sched.pingText(rehearsal.text, 'u1', forcedRoll, { roleId: 'role-love', had: false });
    check('forced: line, the paragraph (main text), then the role footer', forcedPing.split('\n'), [
        openers.fillOpener(rehearsal.text, 'u1'),
        "Finally, <@u1> succeeded in not failing. Ramonu couldn't help but crack a tiny smile, amused by how pleased you were with yourself... and, secretly, already missing your clumsiness.",
        '-# You obtained <@&role-love>.',
    ]);
    check('forced: the paragraph is main text, the role footer subtext', pb.splitSubtext(forcedPing).sub, '-# You obtained <@&role-love>.');
    check('forced: "still" when they had it; no footer without a role', [sched.pingText(rehearsal.text, 'u1', forcedRoll, { roleId: 'role-love', had: true }).split('\n').at(-1), sched.pingText(rehearsal.text, 'u1', forcedRoll, null).split('\n').length], ["-# Ramonu's Second Love, still.", 2]);
    // Giving the role: set in /timer rewards; a stub guild stands in for Discord.
    const rewardsMod = await import('../src/lib/timer/rewards');
    const added: string[] = [];
    const guildWith = (has: boolean, fails = false) => ({ members: { fetch: async () => ({ roles: { cache: new Map(has ? [['role-love', {}]] : []), add: async (id: string) => { if (fails) throw new Error('Missing Permissions'); added.push(id); } } }) } }) as never;
    check('second love: no role set gives nothing', await rewardsMod.grantSecondLove(guildWith(false), OG, T), null);
    await rewardsMod.saveTimerSettings(OG, { secondLoveRoleId: 'role-love' });
    check('second love: given, or already had', [await rewardsMod.grantSecondLove(guildWith(false), OG, T), await rewardsMod.grantSecondLove(guildWith(true), OG, T), added], [{ roleId: 'role-love', had: false }, { roleId: 'role-love', had: true }, ['role-love']]);
    check('second love: a refused grant (permissions) gives nothing, without throwing', await rewardsMod.grantSecondLove(guildWith(false, true), OG, T), null);

    // Set completion and the page: the Rehearsal is listed after the 9, never counted.
    const nine = RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && !o.extra).map((o) => o.text);
    const CB = `test-complete-${Date.now()}`;
    for (const t of nine) await rares.recordRareOpener(CB, 'c-nine', t);
    for (const t of [...nine.slice(0, 8), rehearsal.text]) await rares.recordRareOpener(CB, 'c-eight', t);
    const cb = await rares.specialsBoard(CB, 15, POST);
    check('completion: the 9 lines complete the set; the Rehearsal does not stand in for one, but scores 15', cb.rows.map((r) => [r.discordUserId, r.setsComplete, r.found, r.points]), [['c-nine', 1, 9, 9 * 15 + 100], ['c-eight', 0, 8, 9 * 15]]);
    const mejiroPage = json(rares.specialsView(await rares.rareTally(CB, 'c-eight'), 3, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, POST));
    const mNames = mejiroPage.embeds[0]!.fields?.[0]?.value.split('\n') ?? [];
    const mejiroExtras = json(rares.specialsView(await rares.rareTally(CB, 'c-eight'), 4, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, POST));
    check('page: the Mejiro page has just its 9; the Rehearsal is on Set 3.5, counted there only', [mejiroPage.embeds[0]!.description?.startsWith('**Set 3: The Mejiro Estate**: 8 of 9 found'), mNames.length, mejiroExtras.embeds[0]!.description?.startsWith('**Set 3.5: The Mejiro Estate Extras**: 1 of 6 found'), mejiroExtras.embeds[0]!.fields?.[0]?.value.split('\n')[0]], [true, 9, true, "Ramonu's Remedial Rehearsal"]);
    check('page: ??? until found', json(rares.specialsView(await rares.rareTally(CB, 'c-nine'), 4, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, PRE)).embeds[0]!.fields?.[0]?.value.split('\n')[0], '???');
    const readOpts = mejiroExtras.components[1]?.components[0]?.options?.map((o) => o.label) ?? [];
    check('read menu: the Rehearsal can be read once found, from Set 3.5', readOpts, ["Ramonu's Remedial Rehearsal"]);
    const readRamonu = await rares.readSpecial(OG, T, 'mejiro.ramonu');
    check('read: Ramonu in full, without any outcome footer', [readRamonu?.text, readRamonu?.text.includes('-#')], [openers.fillOpener(ramonu.text, T), false]);
    check('read: the Rehearsal without footers', (await rares.readSpecial(OG, T, 'mejiro.rehearsal'))?.text, openers.fillOpener(rehearsal.text, T));
    // Guests (owner, 2026-11-15): the Mejiro Estate's visitors, after the Family Photograph, through their own slice.
    const guests = openers.GUESTS;
    const guestIds = guests.map((g) => g.id);
    check('guests: the five, in the Mejiro Estate, each an extra and a guest, after the photo', [guestIds, guests.map((g) => g.name), guests.every((g) => g.set === 'mejiro-estate' && g.extra === true && g.guest === true && JSON.stringify(g.after) === JSON.stringify(['mejiro.photo']))], [
        ['guest.helios', 'guest.satono', 'guest.goldship', 'guest.symboli', 'guest.teio'],
        ['#MejiroAfterParty', 'Satono & Kita', "Golshi's Crashdown", 'The Symboli-cs', "Teio's Tag-along"],
        true,
    ]);
    check('guests: exactly one {user} each', guests.map((g) => g.text.split('{user}').length - 1), [1, 1, 1, 1, 1]);
    check('guests: Helios keeps her hashtags; Gold Ship her ☆ and じゃあね; multi-voice lines kept', [openers.specialById('guest.helios')!.text.match(/#\w+/g), ['☆', '*said*', 'じゃあね', 'Gorushi-sama has spoken~'].every((x) => openers.specialById('guest.goldship')!.text.includes(x)), openers.specialById('guest.satono')!.text.split('\n').map((l) => l.split(':')[0]), openers.specialById('guest.symboli')!.text.split('\n').map((l) => l.split(':')[0])], [['#DJHelios', '#MusicalEternity', '#MejiroAfterParty', '#ZuttomoDJ', '#BakunigeBPM'], true, ['Diamond', 'Kitasan', 'Diamond', 'McQueen'], ['Rudolf', 'Sirius', 'Ramonu']]);
    const guestTexts = guests.map((g) => g.text);
    const hasGuest = (pool: readonly string[]) => pool.some((t) => guestTexts.includes(t));
    const mejiroLinesLive = RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && !o.extra).map((o) => o.text);
    check('guests: out of every normal pool (base, set-wide, boosts, the photo\'s wait)', [hasGuest(openers.rarePoolFor([], [])), hasGuest(openers.setLinesPool('mejiro-estate')), hasGuest(mejiroLinesLive), hasGuest(openers.boostPool('mejiro-estate', 'collab')), hasGuest(openers.outcomeBoostPool({ set: 'mejiro-estate' })), photo.after?.some((id) => guestIds.includes(id))], [false, false, false, false, false, false]);
    check('guests: closed until the photo', [openers.closedSpecials(new Set([grandma.id, ...seven])).filter((t) => guestTexts.includes(t)).length, openers.closedSpecials(new Set([grandma.id, ...seven, photo.id])).filter((t) => guestTexts.includes(t)).length], [5, 0]);
    // The slice: 4% x unfound / all, only after the photo.
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;
    const withPhoto = (...ids: string[]) => new Set([grandma.id, ...seven, photo.id, ...ids]);
    check('guest slice: 0 before the photo', openers.guestSliceChance(new Set([grandma.id, ...seven])), 0);
    check('guest slice: 4%, then 3.2% after one, 0.8% with one left, 0 after all five', [
        near(openers.guestSliceChance(withPhoto()), 0.04),
        near(openers.guestSliceChance(withPhoto('guest.teio')), 0.032),
        near(openers.guestSliceChance(withPhoto(...guestIds.slice(0, 4))), 0.008),
        openers.guestSliceChance(withPhoto(...guestIds)),
    ], [true, true, true, 0]);
    check('guest slice: none while the set is paused (passed in), some once it is not', [openers.guestSlice(withPhoto(), [], [], ['mejiro-estate']), openers.guestSlice(withPhoto(), [], []) !== null], [null, true]);
    const liveSlice = openers.guestSlice(withPhoto('guest.helios'), [], [], []);
    check('guest slice: once resumed, all five guests (repeats possible), labelled, content not a boost', [near(liveSlice?.chance ?? 0, 0.032), liveSlice?.pool, liveSlice?.label, liveSlice?.content], [true, guestTexts, 'The Mejiro Estate: guests are dropping by.', true]);
    check('guest slice: none with the set off or locked, before the photo, or with every guest found', [openers.guestSlice(withPhoto(), ['mejiro-estate'], [], []), openers.guestSlice(withPhoto(), [], ['mejiro-estate'], []), openers.guestSlice(new Set([grandma.id]), [], [], []), openers.guestSlice(withPhoto(...guestIds), [], [], [])], [null, null, null, null]);
    // Through extraChances and the Boosts view, from the database.
    const GG = `test-guests-${Date.now()}`;
    const GT = 'g1';
    for (const id of ['set1.mejiro', grandma.id, ...seven, photo.id]) await rares.recordRareOpener(GG, GT, openers.specialById(id)!.text);
    {
        const on = (await extraChances(GG, GT, usable, NOT_OS, false, [], OFF_SEASON)).filter((e) => e.content);
        const offExtras = await extraChances(GG, GT, { ...usable, boosts: false }, NOT_OS, false, [], OFF_SEASON);
        check('guest slice: in extraChances with Boosts on, and still there with Boosts off', [on.map((e) => [e.chance, e.pool.length, e.label]), offExtras.map((e) => [e.chance, e.pool.length, e.label])], [[[0.04, 5, 'The Mejiro Estate: guests are dropping by.']], [[0.04, 5, 'The Mejiro Estate: guests are dropping by.']]]);
        check('guest slice: none with the Mejiro Estate off', (await extraChances(GG, GT, { ...usable, boosts: false, disabledSets: ['mejiro-estate'] }, NOT_OS, false, [], OFF_SEASON)).length, 0);
        check('guest slice: its slice comes first in the roll, drawn from the guests', [await rares.chooseOpener(GG, GT, 0.001, fullPool, offExtras), await rares.chooseOpener(GG, GT, 0.039, fullPool, offExtras)], [guestTexts[0], guestTexts[4]]);
        await us0.toggleSetting(GG, GT, 'boosts');
        const gv = (await boostsView(GG, GT, OFF_SEASON)).embeds[0]!.toJSON().description ?? '';
        check('boosts view: the guest slice with Boosts off, not paused, in the total (6% + 4%)', [gv.includes('**+4%** The Mejiro Estate: guests are dropping by.\n'), gv.includes('guests are dropping by. (paused)'), gv.includes('**Your next ping: 10% chance of a special.**')], [true, false, true]);
        await rares.recordRareOpener(GG, GT, openers.specialById('guest.satono')!.text);
        check('guest slice: shrinks as guests are found (3.2% after one)', (await extraChances(GG, GT, { ...usable, boosts: false }, NOT_OS, false, [], OFF_SEASON)).map((e) => near(e.chance, 0.032)), [true]);
    }
    // Helios's introductions (owner, 2026-11-15): the next run is a guest not yet met; never while a Rehearsal is owed.
    const helios = openers.specialById('guest.helios')!;
    const intro = openers.rollOutcome(helios, 0.5)!;
    check('helios: every time, introductions: a guaranteed guest, with the footer', [intro.outcome, intro.guaranteeGuest, intro.footer.startsWith('-# Despite being initially confused by both Helios'), intro.footer.endsWith('introduce you to the other guests in the house!'), helios.heldUntilPassed], ['introductions', true, true, true, 'mejiro.rehearsal']);
    const HG = `test-helios-${Date.now()}`;
    for (const id of ['set1.mejiro', grandma.id, ...seven, photo.id, 'guest.helios']) await rares.recordRareOpener(HG, 'h1', openers.specialById(id)!.text);
    await rares.applyOutcome(HG, 'h1', helios.text, intro, () => 0);
    const unmetFirst = guestIds.filter((id) => id !== 'guest.helios')[0];
    check('helios: the next run is a guest not yet met (never Helios)', await rares.outcomeState(HG, 'h1'), { guaranteedSpecialId: unmetFirst, guaranteedInRuns: 1, losingStreak: [] });
    await rares.applyOutcome(HG, 'h1', openers.specialById(unmetFirst!)!.text, null);
    for (const id of guestIds) await rares.recordRareOpener(HG, 'h1', openers.specialById(id)!.text);
    await rares.applyOutcome(HG, 'h1', helios.text, intro, () => 0.999);
    const allMet = (await rares.outcomeState(HG, 'h1')).guaranteedSpecialId;
    check('helios: once every guest is met, any guest but Helios', [guestIds.includes(allMet!), allMet === 'guest.helios'], [true, false]);
    // Ramonu's lesson overrides a pending guest guarantee.
    await rares.applyOutcome(HG, 'h1', ramonu.text, openers.rollOutcome(ramonu, 0.1), () => 0);
    check('helios: Ramonu\'s lesson overrides a pending guest guarantee', await rares.outcomeState(HG, 'h1'), { guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 1, losingStreak: [] });
    check('helios: no Helios while a Rehearsal is owed', (await rares.trainerPool(HG, 'h1', guestTexts)).includes(helios.text), false);
    await rares.applyOutcome(HG, 'h1', helios.text, intro, () => 0);
    check('helios: introductions do nothing while a Rehearsal is owed', (await rares.outcomeState(HG, 'h1')).guaranteedSpecialId, 'mejiro.rehearsal');

    const symboliRoll = openers.rollOutcome(openers.specialById('guest.symboli')!, 0.5)!;
    check('symboli: the daggers footer, and no effect', [symboliRoll.footer.startsWith('-# Ramonu kept staring daggers at you'), symboliRoll.boost, symboliRoll.schedule, symboliRoll.guaranteeGuest], [true, undefined, undefined, undefined]);

    // Auto-off (owner, 2026-11-15): a finished set rests (all but what its extras need), then turns off once its extras are found too.
    const usA = await import('../src/lib/timer/userSettings');
    const AG = `test-autooff-${Date.now()}`;
    const AU = 'a1';
    const mejiroMain = RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && !o.extra);
    await rares.recordRareOpener(AG, AU, openers.specialById('set1.mejiro')!.text);
    for (const o of mejiroMain.slice(0, 8)) await rares.recordRareOpener(AG, AU, o.text);
    const lastMain = mejiroMain[8]!;
    const done1 = await rares.completionNotice(AG, AU, lastMain.text);
    check('auto-off: the 9th line completes the set: the ping says it rests', done1?.line.startsWith('**Complete!** The Mejiro Estate: every line found! Your lines rest now'), true);
    await rares.recordRareOpener(AG, AU, lastMain.text);
    await done1!.record();
    const restingNow = rares.restingLines('mejiro-estate', await rares.foundSpecialIds(AG, AU), (await usA.getUserSettings(AG, AU)).autoOffSets ?? []);
    check('auto-off: found lines rest, but Ramonu (the Rehearsal needs her) and the photo (the guests) stay', [restingNow.length, restingNow.includes(ramonu.text), restingNow.includes(photo.text)], [7, false, false]);
    const mejiroAll = mejiroMain.map((o) => o.text);
    check('auto-off: the pool leaves resting lines out', (await rares.trainerPool(AG, AU, mejiroAll)).sort(), [ramonu.text, photo.text].sort());
    check('auto-off: a repeat find says nothing more', await rares.completionNotice(AG, AU, lastMain.text), null);
    const restPage = json(await rares.mySpecialsView(AG, AU, rares.pageOfSet('mejiro-estate'), PRE));
    check('auto-off: the page says Resting, and so does its button', [restPage.embeds[0]!.description?.includes('Resting: every line found'), restPage.components[0]!.components[1]?.label], [true, 'The Mejiro Estate: Resting']);
    // Every extra found too: the set turns off.
    const extrasList = RARE_OPENERS.filter((o) => o.set === 'mejiro-estate' && o.extra);
    for (const o of extrasList.slice(0, -1)) await rares.recordRareOpener(AG, AU, o.text);
    const done2 = await rares.completionNotice(AG, AU, extrasList.at(-1)!.text);
    check('auto-off: the last extra completes everything: the ping says it is off', done2?.line.startsWith("**Complete!** The Mejiro Estate: every line found, so it's off for you now"), true);
    await rares.recordRareOpener(AG, AU, extrasList.at(-1)!.text);
    await done2!.record();
    check('auto-off: the set is off for them', (await usA.getUserSettings(AG, AU)).disabledSets, ['mejiro-estate']);
    await usA.toggleSetting(AG, AU, 'set:mejiro-estate');
    const after = await usA.getUserSettings(AG, AU);
    check('auto-off: they can turn it back on, and it stays on (kept)', [after.disabledSets, after.autoOffSets?.includes('mejiro-estate:kept'), await rares.completionNotice(AG, AU, lastMain.text)], [[], true, null]);
    check('auto-off: once kept, nothing rests', rares.restingLines('mejiro-estate', await rares.foundSpecialIds(AG, AU), after.autoOffSets ?? []), []);
    // Resting, then woken by the button without turning the set off.
    const WG = `${AG}-wake`;
    for (const o of mejiroMain) await rares.recordRareOpener(WG, AU, o.text);
    await (await rares.completionNotice(WG, AU, lastMain.text))!.record();
    await usA.toggleSetting(WG, AU, 'set:mejiro-estate');
    const woke = await usA.getUserSettings(WG, AU);
    check('auto-off: pressing Resting wakes the lines and leaves the set on', [woke.disabledSets, rares.isResting('mejiro-estate', woke.autoOffSets ?? [])], [[], false]);
    // A set without extras turns off at once.
    const OGx = `${AG}-set1`;
    const set1Lines = RARE_OPENERS.filter((o) => o.set === 'set1');
    for (const o of set1Lines.slice(0, -1)) await rares.recordRareOpener(OGx, AU, o.text);
    const set1Done = await rares.completionNotice(OGx, AU, set1Lines.at(-1)!.text);
    await rares.recordRareOpener(OGx, AU, set1Lines.at(-1)!.text);
    await set1Done!.record();
    check('auto-off: a set without extras turns off when complete', [set1Done?.line.includes("Lobby Loungers: every line found, so it's off"), (await usA.getUserSettings(OGx, AU)).disabledSets], [true, ['set1']]);

    // Counts and completion: guests never count, but score.
    const GB = `${GG}-board`;
    for (const t of nine) await rares.recordRareOpener(GB, 'g-all', t);
    for (const t of [...guestTexts, guestTexts[0]!]) await rares.recordRareOpener(GB, 'g-all', t);
    for (const t of [...nine.slice(0, 8), ...guestTexts]) await rares.recordRareOpener(GB, 'g-eight', t);
    const gb = await rares.specialsBoard(GB, 15, POST);
    check('guests: not in the set\'s completion or found count, but 15 new and 3 repeat', gb.rows.map((r) => [r.discordUserId, r.setsComplete, r.found, r.points]), [['g-all', 1, 9, 14 * 15 + 3 + 100], ['g-eight', 0, 8, 13 * 15]]);
    check('guests: not in the board\'s special count', gb.specialCount, RARE_OPENERS.filter((o) => !o.extra && !o.guest).length + 13);
    const gEight = json(rares.specialsView(await rares.rareTally(GB, 'g-eight'), 4, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, PRE));
    const gNames = gEight.embeds[0]!.fields?.[0]?.value.split('\n') ?? [];
    check('page: Set 3.5 lists the Rehearsal then the guests, counted on their own, never in the overall total', [gEight.embeds[0]!.title, gEight.embeds[0]!.description?.startsWith('**Set 3.5: The Mejiro Estate Extras**: 5 of 6 found'), gNames], [
        `Your specials: 8 of ${RARE_OPENERS.filter((o) => !o.extra && isOpenAt(o, PRE)).length}`,
        true,
        ['???', ...guests.map((g) => g.name)],
    ]);
    const gNone = json(rares.specialsView(await rares.rareTally(GB, 'nobody'), 4, { lockedSets: [], disabledSets: [], boosts: [], boostsOn: true }, PRE));
    check('page: ??? until found, on Set 3.5', gNone.embeds[0]!.fields?.[0]?.value.split('\n') ?? [], ['???', '???', '???', '???', '???', '???']);
    const gOpts = gEight.components[1]?.components[0]?.options?.map((o) => [o.label, o.value]) ?? [];
    check('read menu: found guests can be read, from Set 3.5', [gOpts, (await rares.readSpecial(GB, 'g-eight', 'guest.teio'))?.text, await rares.readSpecial(GB, 'nobody', 'guest.teio')], [guests.map((g) => [g.name, g.id]), openers.fillOpener(openers.specialById('guest.teio')!.text, 'g-eight'), null]);
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: { in: [GG, GB] } } });
    await prisma.timerUserSettings.deleteMany({ where: { guildId: GG } });
    await prisma.rareOpenerHit.deleteMany({ where: { guildId: { in: [OG, CB] } } });
    await prisma.timerSpecialBoost.deleteMany({ where: { guildId: OG } });
    await prisma.timerUserSettings.deleteMany({ where: { guildId: OG } });
    await prisma.timerSettings.deleteMany({ where: { guildId: OG } });

    // Reminder lines: none repeats within 4 pings in a row.
    check('reminders: 20 lines, each naming the trainer', [PING_OPENERS.length, PING_OPENERS.every((o) => o.includes('{user}'))], [20, true]);
    const NR = `test-norepeat-${Date.now()}`;
    for (const o of PING_OPENERS.slice(0, 5)) await rares.rememberCommon(NR, 'n1', o);
    check('reminders: the latest 3 are remembered, newest last', await rares.recentCommons(NR, 'n1'), PING_OPENERS.slice(2, 5));
    const allowed = openers.commonsFor(await rares.recentCommons(NR, 'n1'));
    check('reminders: those 3 are left out of the next pick', [allowed.length, PING_OPENERS.slice(2, 5).some((o) => allowed.includes(o))], [PING_OPENERS.length - 3, false]);
    const picks = new Set<string>();
    for (let k = 0; k < 2000; k += 1) picks.add(await rares.chooseOpener(NR, 'n1', P + ((1 - P) * k) / 2000, [], [], allowed));
    check('reminders: a common roll never lands on a recent line, and covers all the others', [PING_OPENERS.slice(2, 5).some((o) => picks.has(o)), [...picks].filter((o) => !rares.isRareOpener(o)).length], [false, PING_OPENERS.length - 3]);
    check('reminders: with nothing recent, all are allowed', openers.commonsFor([]).length, PING_OPENERS.length);
    await prisma.timerUserSettings.deleteMany({ where: { guildId: NR } });

    // Media: #ChuChuChallenge posts its video; the file is in the repo; plain lines post nothing.
    const fs = await import('fs');
    const chu = RARE_OPENERS.find((o) => o.id === 'os.chu')!;
    const chuMedia = openers.specialMediaPath(chu.text);
    check('media: #ChuChuChallenge has its video, and the file exists', [chuMedia?.endsWith('chu-chu-challenge.mp4'), chuMedia ? fs.existsSync(chuMedia) : false], [true, true]);
    check('media: under Discord\'s 10 MB upload limit', chuMedia ? fs.statSync(chuMedia).size < 10 * 1024 * 1024 : false, true);
    check('credit: each video or picture is credited in its own field (#ChuChuChallenge, the photograph, Teio\'s pose), never in the text', [RARE_OPENERS.filter((o) => o.credit).map((o) => [o.id, o.credit]), RARE_OPENERS.some((o) => /youtu\.?be/.test(o.text))], [[['os.chu', 'Video: <https://youtu.be/hJ78i-6uwGM>'], ['mejiro.photo', 'Art: <https://x.com/mokumoku_warabi/status/1783425000428757341>'], ['guest.teio', 'Video: <https://youtube.com/shorts/l-8i2u6T4CM>']], false]);
    const teioMedia = openers.specialMediaPath(openers.specialById('guest.teio')!.text);
    check('media: Teio\'s pose clip exists, under 10 MB', [teioMedia?.endsWith('halloween-pose.mp4'), teioMedia ? fs.existsSync(teioMedia) : false, teioMedia ? fs.statSync(teioMedia).size < 10 * 1024 * 1024 : false], [true, true, true]);
    // The media box: main text, subtext, media, credit under it, then the extras.
    const { pingBox, splitSubtext } = await import('../src/lib/timer/pingBox');
    check('box: a line splits into main text and its -# subtext', [splitSubtext('Hi {user}!\n-# Footer one.').main, splitSubtext('Hi {user}!\n-# Footer one.').sub], ['Hi {user}!', '-# Footer one.']);
    const box = pingBox({ text: openers.fillOpener(chu.text, 'u1'), mediaPath: chuMedia!, credit: chu.credit, extraLines: ['**Milestone!** That makes run #**25**!'] });
    const boxJson = box.components[0]!.toJSON() as { components: { type: number; content?: string; items?: { media: { url: string } }[] }[] };
    check('box: main, subtext, media, credit, divider, extras (in that order)', boxJson.components.map((c) => c.type), [10, 10, 12, 10, 14, 10]);
    check('box: the mention is in the main text, the credit under the media', [boxJson.components[0]!.content?.startsWith('<@u1>-chan!'), boxJson.components[1]!.content?.startsWith('-# As #Revenge'), boxJson.components[2]!.items?.[0]?.media.url, boxJson.components[3]!.content], [true, true, 'attachment://chu-chu-challenge.mp4', '-# Video: <https://youtu.be/hJ78i-6uwGM>']);
    check('box: sent as Components V2 with the file attached', [(box.flags & 32768) === 32768, box.files.length], [true, 1]);
    const readBox = pingBox({ heading: chu.name, text: chu.text, mediaPath: chuMedia!, credit: chu.credit }).components[0]!.toJSON() as { components: { type: number; content?: string }[] };
    check('box: the read view adds the name on top and no extras', [readBox.components[0]!.content, readBox.components.at(-1)!.content], ['### #ChuChuChallenge', '-# Video: <https://youtu.be/hJ78i-6uwGM>']);
    // Plain lines are boxes too: just the line, then the extras; nothing attached.
    const plainBox = pingBox({ text: openers.fillOpener(PING_OPENERS[0]!, 'u1'), mediaPath: openers.specialMediaPath(PING_OPENERS[0]!), extraLines: ['**Milestone!** That makes run #**25**!'] });
    const plainBoxJson = plainBox.components[0]!.toJSON() as { components: { type: number; content?: string }[] };
    check('box: a plain reminder is a box too: line, divider, extras, no file', [plainBoxJson.components.map((c) => c.type), plainBox.files.length, (plainBox.flags & 32768) === 32768], [[10, 14, 10], 0, true]);
    check('box: with no extras, no divider', (pingBox({ text: 'Hi <@u1>!' }).components[0]!.toJSON() as { components: unknown[] }).components.length, 1);
    const scheduler = await import('../src/lib/timer/scheduler');
    const sum = { milestone: 25, totalRuns: 25, currentStreakDays: 4, newLongestStreak: false, firstOfDay: true } as Parameters<typeof scheduler.pingExtraLines>[0];
    check('box: the extras are the text ping minus its opener', scheduler.buildPingContent('u1', sum, 0, null, Math.random, PING_OPENERS[0]!).split('\n').slice(1), scheduler.pingExtraLines(sum, 0, null));
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
    check('settings: defaults', await us.getUserSettings(SG, 'u1'), { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [], autoOffSets: [] });
    check('settings: default run and ping times', [us.runMinutes(await us.getUserSettings(SG, 'u1')), us.pingMinutes(await us.getUserSettings(SG, 'u1'))], [50, 5]);
    await us.toggleSetting(SG, 'u1', 'dm');
    await us.toggleSetting(SG, 'u1', 'early');
    const on = await us.toggleSetting(SG, 'u1', 'set:set1');
    check('settings: each toggle flips', on, { dmPing: true, earlyRiser: true, boosts: true, disabledSets: ['set1'], autoOffSets: [] });
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
        PING_OPENERS[0]!.replace('{user}', '<@u1>'),
        '*Apologies! This run ended about 10 minutes ago while I was offline. It still counts!*',
        '**Milestone!** That makes run #**25**!',
        '**Record!** A new personal best: **7 days** in a row!',
        '**Promotion!** **25 runs** reached, and <@&role-25> is yours!',
    ]);
    check('ping: a plain run is just the opener', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never, 0, null, () => 0.5), PING_OPENERS[Math.floor(((0.5 - P) / (1 - P)) * PING_OPENERS.length)]!.replace('{user}', '<@u1>'));
    check('ping: an ongoing streak, first run of the day', buildPingContent('u1', { milestone: null, newLongestStreak: false, currentStreakDays: 4, firstOfDay: true, totalRuns: 9 } as never, 0, null, () => 0.5).split('\n')[1], '**Persistence!** **4 days** straight! Keep it going!');

    // ─── Fuku-chan's Fortune Tent (owner, 2026-11-15) ───────────────────────
    {
        const fortune = await import('../src/lib/timer/fortune');
        const boostsMod = await import('../src/lib/timer/boosts');
        const usF = await import('../src/lib/timer/userSettings');
        const fs = await import('fs');
        const FG = `test-fortune-${Date.now()}`;
        const BEFORE = new Date('2026-11-22T14:59:00Z');
        const OPEN = new Date('2026-11-23T03:00:00Z'); // Monday noon JST, after the opening
        const fuku = openers.specialById('set1.fukukitaru')!;
        const machi = openers.specialById('set1.matikane')!;
        const cleanF = async () => {
            await prisma.rareOpenerHit.deleteMany({ where: { guildId: FG } });
            await prisma.timerUserSettings.deleteMany({ where: { guildId: FG } });
            await prisma.timerFortuneDraw.deleteMany({ where: { guildId: FG } });
        };
        await cleanF();

        // The gate.
        check('tent: opens Monday 00:00 JST, Nov 23 (2026-11-22T15:00Z)', [fortune.TENT_OPENS.toISOString(), fortune.tentIsOpen(BEFORE), fortune.tentIsOpen(fortune.TENT_OPENS)], ['2026-11-22T15:00:00.000Z', false, true]);
        check('fukukitaru: a Lobby Loungers special right after Machitan, named Matikanefukukitaru', [fuku.set, fuku.name, openers.SPECIAL_SETS[0]!.openers[1]!.id, fuku.extra ?? false], ['set1', 'Matikanefukukitaru', 'set1.fukukitaru', false]);
        check('fukukitaru: her line is the doc\'s, one {user}', [fuku.text.startsWith('Mumu...! {user}-san'), fuku.text.split('{user}').length - 1], [true, 1]);
        check('fukukitaru: in no pool before the opening, in the pool from it', [openers.rarePoolFor([], [], BEFORE).includes(fuku.text), openers.rarePoolFor([], [], fortune.TENT_OPENS).includes(fuku.text), openers.setLinesPool('set1', BEFORE).includes(fuku.text), openers.setLinesPool('set1', OPEN).includes(fuku.text)], [false, true, false, true]);
        // Hidden everywhere players can see until she opens (owner): pages, "N of M", the board's count.
        await rares.recordRareOpener(FG, 'h1', fuku.text); // as if found early (cannot happen; proves the hiding)
        const hv = async (now: Date, mine: boolean) => {
            const v = mine ? await rares.mySpecialsView(FG, 'h1', 1, now) : rares.specialsView(await rares.rareTally(FG), 1, undefined, now);
            const e = v.embeds[0]!.toJSON();
            return [e.title, e.description?.split(' found')[0], (e.fields?.[0]?.value ?? '').includes('Matikanefukukitaru'), (e.fields?.[0]?.value ?? '').split('\n').length];
        };
        const nAll = RARE_OPENERS.filter((o) => !o.extra).length;
        check('hidden: her row and counts, before and after the opening (personal)', [await hv(BEFORE, true), await hv(OPEN, true)], [
            [`Your specials: 0 of ${nAll - 1}`, '**Set 1: Lobby Loungers**: 0 of 13', false, 13],
            [`Your specials: 1 of ${nAll + 13}`, '**Set 1: Lobby Loungers**: 1 of 14', true, 14],
        ]);
        check('hidden: the same on the server list', [(await hv(BEFORE, false))[0], (await hv(BEFORE, false))[2], (await hv(OPEN, false))[0], (await hv(OPEN, false))[2]], [`Specials found: 0 of ${nAll - 1}`, false, `Specials found: 1 of ${nAll + 13}`, true]);
        const hb = async (now: Date) => { const b = await rares.specialsBoard(FG, 15, now); return [b.specialCount, b.rows.find((r) => r.discordUserId === 'h1')?.found ?? 0]; };
        check('hidden: the board\'s special count and finds', [await hb(BEFORE), await hb(OPEN)], [[nAll - 1, 0], [nAll + 13, 1]]);
        await prisma.rareOpenerHit.deleteMany({ where: { guildId: FG, discordUserId: 'h1' } });
        // Set 1 complete without her until she opens (no lost set points), with her from then on.
        const LBF = `${FG}-board`;
        for (const o of openers.SPECIAL_SETS[0]!.openers.filter((x) => x.id !== fuku.id)) await rares.recordRareOpener(LBF, 'c1', o.text);
        check('fukukitaru: Set 1 counts as complete without her before the opening, not after', [(await rares.specialsBoard(LBF, 15, BEFORE)).rows[0]?.setsComplete, (await rares.specialsBoard(LBF, 15, OPEN)).rows[0]?.setsComplete], [1, 0]);
        await prisma.rareOpenerHit.deleteMany({ where: { guildId: LBF } });

        // The unlock: both Matikanes, and the tent open.
        await rares.recordRareOpener(FG, 't1', machi.text);
        check('unlock: Machitan alone is not enough', [await fortune.hasTent(FG, 't1', OPEN), await fortune.tentUnlockNotice(FG, 't1', PING_OPENERS[0]!, OPEN)], [false, null]);
        check('unlock: no unlock before the opening, even on Fuku\'s ping', [await fortune.tentUnlockNotice(FG, 't1', fuku.text, BEFORE)], [null]);
        const completing = await fortune.tentUnlockNotice(FG, 't1', fuku.text, OPEN);
        check('unlock: the ping that completes the pair says so', completing?.line, "**Congrats!** Fuku-chan's Fortune Tent unlocked!");
        const { pingExtraLines: pel } = await import('../src/lib/timer/scheduler');
        check('unlock: a Congrats line like a set unlock', pel({ milestone: null, newLongestStreak: false, currentStreakDays: 1, firstOfDay: false, totalRuns: 3 } as never, 0, null, [], [completing!.line]), ["**Congrats!** Fuku-chan's Fortune Tent unlocked!"]);
        await rares.recordRareOpener(FG, 't1', fuku.text);
        await completing!.record();
        check('unlock: once only', [await fortune.tentUnlockNotice(FG, 't1', PING_OPENERS[0]!, OPEN), await fortune.hasTent(FG, 't1', OPEN), await fortune.hasTent(FG, 't1', BEFORE)], [null, true, false]);
        // A trainer with both before the opening: the line on their first ping after it.
        await rares.recordRareOpener(FG, 't2', machi.text);
        await rares.recordRareOpener(FG, 't2', fuku.text);
        check('unlock: had both already: the line on the first ping after the opening, on any line', [await fortune.tentUnlockNotice(FG, 't2', PING_OPENERS[3]!, BEFORE), (await fortune.tentUnlockNotice(FG, 't2', PING_OPENERS[3]!, OPEN))?.line], [null, fortune.TENT_UNLOCK_LINE]);

        // The introduction: the next run's ping, behind a due guarantee, once ever.
        check('intro: owed after the unlock ping, not before', [await fortune.tentIntroDue(FG, 't2', false, OPEN), await fortune.tentIntroDue(FG, 't1', false, OPEN), await fortune.tentIntroDue(FG, 't1', false, BEFORE)], [false, true, false]);
        check('intro: a due guarantee (Rehearsal, a Helios guest) wins; the intro waits', await fortune.tentIntroDue(FG, 't1', true, OPEN), false);
        await prisma.timerUserSettings.update({ where: { guildId_discordUserId: { guildId: FG, discordUserId: 't1' } }, data: { guaranteedSpecialId: 'mejiro.rehearsal', guaranteedInRuns: 1 } });
        const st = await rares.outcomeState(FG, 't1');
        check('intro: the guarantee check is guaranteedOpener (due at 1 run)', [rares.guaranteedOpener(st, [], []) !== undefined, rares.guaranteedOpener({ ...st, guaranteedInRuns: 3 }, [], [])], [true, undefined]);
        check('intro: still owed while it waits', await fortune.tentIntroDue(FG, 't1', false, OPEN), true);
        const intro = fortune.tentIntroText('t1').split('\n');
        check('intro: four speakers, then the -# line, the mention once', [intro.length, intro.map((l) => l.split(':')[0]), intro[4]!.startsWith("-# Fuku-chan's Fortune Tent is open"), fortune.TENT_INTRO.split('{user}').length - 1, intro.join('\n').includes('<@t1>')], [5, ['Machitan', 'Fuku', 'Machitan', 'Fuku', "-# Fuku-chan's Fortune Tent is open"], true, 1, true]);
        check('intro: not a special (no find, not in Specials)', rares.isRareOpener(fortune.TENT_INTRO), false);
        await fortune.tentIntroShown(FG, 't1');
        check('intro: once only', [await fortune.tentIntroDue(FG, 't1', false, OPEN), (await prisma.timerUserSettings.findUnique({ where: { guildId_discordUserId: { guildId: FG, discordUserId: 't1' } } }))?.tentUnlocked], [false, true]);
        await prisma.timerUserSettings.update({ where: { guildId_discordUserId: { guildId: FG, discordUserId: 't1' } }, data: { guaranteedSpecialId: null, guaranteedInRuns: null } });

        // The tiers: weights 1, 4, 15, 25, 25, 20, 10 (never shown).
        const T = fortune.FORTUNE_TIERS;
        check('tiers: chances and weights', T.map((t) => [t.id, t.delta, t.weight]), [['oracle', 0.05, 1], ['super', 0.03, 4], ['great', 0.02, 15], ['blessing', 0.01, 25], ['small', 0.005, 25], ['curse', -0.01, 20], ['great-curse', -0.02, 10]]);
        check('tiers: the rolls map in order', [0, 0.0099, 0.01, 0.0499, 0.05, 0.1999, 0.2, 0.4499, 0.45, 0.6999, 0.7, 0.8999, 0.9, 0.9999].map((r) => fortune.tierForRoll(r).id), ['oracle', 'oracle', 'super', 'super', 'great', 'great', 'blessing', 'blessing', 'small', 'small', 'curse', 'curse', 'great-curse', 'great-curse']);
        const tierCounts = new Map<string, number>();
        for (let k = 0; k < 10000; k += 1) tierCounts.set(fortune.tierForRoll(k / 10000).id, (tierCounts.get(fortune.tierForRoll(k / 10000).id) ?? 0) + 1);
        check('tiers: a sweep matches the weights exactly', T.map((t) => tierCounts.get(t.id)), [100, 400, 1500, 2500, 2500, 2000, 1000]);
        check('tiers: lines per tier (大凶 has Air Groove too)', T.map((t) => t.lines.length), [1, 1, 2, 3, 2, 2, 2]);
        check('tiers: headings and effects, Japanese intact', T.map((t) => t.heading), ["Shiraoki-sama's Oracle", '超吉 Super blessing', '大吉 Great blessing', '吉 Blessing', '小吉 Small blessing', '凶 Curse', '大凶 Great curse']);
        const all13 = T.flatMap((t) => t.lines);
        check('lines: 13, unique ids, each exactly one {user}', [all13.length, new Set(all13.map((l) => l.id)).size, all13.every((l) => l.text.split('{user}').length === 2)], [13, 13, true]);
        // Verbatim: every line (and heading, effect, intro) is in the design doc, except Air Groove's (the owner's final copy).
        const doc = fs.readFileSync('docs/special-sets/fortune-tent.md', 'utf8');
        const inDoc = (t: string) => t.split('\n').every((l) => doc.includes(l));
        check('lines: verbatim from the doc', [all13.filter((l) => l.id !== 'great-curse.groove').every((l) => inDoc(l.text)), T.every((t) => doc.includes(`### ${t.heading}`) && doc.includes(t.effect)), inDoc(fortune.TENT_INTRO), doc.includes(fortune.TENT_UNLOCK_LINE), doc.includes(fuku.text)], [true, true, true, true, true]);
        check('lines: Air Groove\'s, the owner\'s final copy', fortune.fortuneTier('great-curse')!.lines[1]!.text, [
            'Fuku: "D-daikyou... {user}-san, it\'s a GREAT curse, and the black cat is back, and—"',
            'Groove: "Mattaku. What is this racket outside the student council room? ...Fukukitaru. It is a cat. Not the end of the world."',
            'Groove: "...Still. Kisama, take this. A Shigaraki tanuki. Fukukitaru insisted it would bring luck, and I am in no mood to argue with a crystal ball. Just in case."',
            'Fuku: "Air Groove-san... you kept it all this time?!"',
            'Machitan: "Ei, ei, mun! ...It\'s still a great curse though, isn\'t it." / Groove: "Yes. But perhaps a smaller one."',
        ].join('\n'));
        const great = fortune.fortuneTier('great')!;
        const oracle = fortune.fortuneTier('oracle')!;
        check('lines: never the previous line; a one-line tier may repeat', [fortune.lineForRoll(great, 0, 'great.tea').id, fortune.lineForRoll(great, 0.99, 'great.tea').id, fortune.lineForRoll(great, 0, null).id, fortune.lineForRoll(great, 0.99, null).id, fortune.lineForRoll(oracle, 0.5, 'oracle.sky').id], ['great.taiki', 'great.taiki', 'great.tea', 'great.taiki', 'oracle.sky']);

        // The draw: once per JST day.
        const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };
        check('draw: none without the tent, or before it opens', [await fortune.drawFortune(FG, 'nobody', OPEN), await fortune.drawFortune(FG, 't1', BEFORE)], [null, null]);
        const d1 = await fortune.drawFortune(FG, 't1', OPEN, seq(0.1, 0)); // 大吉, first line
        check('draw: the first of the day', [d1?.fresh, d1?.draw.tier.id, d1?.draw.line.id], [true, 'great', 'great.tea']);
        const d1b = await fortune.drawFortune(FG, 't1', new Date('2026-11-23T14:59:00Z'), seq(0.95, 0));
        check('draw: once a day: the same draw back until the reset', [d1b?.fresh, d1b?.draw.line.id, await prisma.timerFortuneDraw.count({ where: { guildId: FG, discordUserId: 't1' } })], [false, 'great.tea', 1]);
        const view = (await boostsMod.boostsView(FG, 't1', OPEN)).components[0]!.toJSON() as { components: { custom_id: string; label: string; disabled?: boolean }[] };
        check('draw: the button reads "Drawn today", greyed out', view.components.map((c) => [c.custom_id, c.label, c.disabled ?? false]), [['timer:boosts:toggle', 'Boosts: On', false], [fortune.FORTUNE_BUTTON_ID, 'Drawn today', true]]);
        const fresh = (await boostsMod.boostsView(FG, 't2', OPEN)).components[0]!.toJSON() as { components: { label: string; disabled?: boolean }[] };
        const none = (await boostsMod.boostsView(FG, 'nobody', OPEN)).components[0]!.toJSON() as { components: unknown[] };
        const early = (await boostsMod.boostsView(FG, 't1', BEFORE)).components[0]!.toJSON() as { components: unknown[] };
        check('draw: "Fortune" before drawing; no button without the tent, or before it opens', [fresh.components[1]?.label, fresh.components[1]?.disabled ?? false, none.components.length, early.components.length], ['Fortune', false, 1, 1]);
        const NEXT_DAY = new Date('2026-11-23T15:00:00Z'); // Tuesday 00:00 JST
        const d2 = await fortune.drawFortune(FG, 't1', NEXT_DAY, seq(0.1, 0));
        check('draw: a new one after midnight JST, never the previous line', [d2?.fresh, d2?.draw.tier.id, d2?.draw.line.id], [true, 'great', 'great.taiki']);
        const box = JSON.stringify(fortune.fortuneBox(d1!.draw, 't1'));
        check('draw: a box only to the trainer: heading, the scene with the mention, the effect line', [box.includes('### 大吉 Great blessing'), box.includes('<@t1>-san, three tea stalks'), box.includes("-# Today's fortune: +2% chance of a special line until the daily reset."), (fortune.fortuneBox(d1!.draw, 't1').flags & 64) === 64, box.includes('{user}')], [true, true, true, true, false]);

        // Set 4: Fuku-chan's Fortune Tent, a Specials page from the opening (owner, 2026-11-15).
        type VJ = { embeds: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string } }[]; components: { components: { custom_id: string; label?: string; options?: { label: string; value: string }[] }[] }[] };
        const vj = (v: { embeds: { toJSON(): unknown }[]; components: { toJSON(): unknown }[] }) => ({ embeds: v.embeds.map((e) => e.toJSON()), components: v.components.map((c) => c.toJSON()) }) as VJ;
        const lastBefore = vj(await rares.mySpecialsView(FG, 't1', 99, BEFORE));
        check('set 4: no page before the opening (the last page is still Set 3.5)', [lastBefore.embeds[0]!.description?.startsWith('**Set 3.5'), lastBefore.embeds[0]!.footer?.text.endsWith('Page 5 of 5')], [true, true]);
        const s4 = vj(await rares.mySpecialsView(FG, 't1', 5, OPEN));
        const s4e = s4.embeds[0]!;
        const s4col = (n: number) => s4e.fields?.[n]?.value.split('\n') ?? [];
        check('set 4: the last page, after Set 3.5, titled and counted', [s4e.description, s4e.footer?.text.endsWith('Page 6 of 6'), s4e.fields?.map((f) => f.name), s4col(0).length], ["**Set 4: Fuku-chan's Fortune Tent**: 2 of 13 drawn", true, ['Fortune', 'Times', 'First drawn'], 13]);
        check('set 4: ??? until drawn; the drawn one by name, count and when', [s4col(0)[0], s4col(0)[2], s4col(1)[2], s4col(2)[2]?.startsWith('<t:'), s4col(0)[3], s4col(0)[4]], ['**1.** ???', '**3.** 大吉: Tea Stalks', '**×1**', true, '**4.** 大吉: Taiki Shuttle', '**5.** ???']);
        check('set 4: the row names, in order', fortune.FORTUNE_LINES.map((l) => l.name), ["Shiraoki-sama's Oracle", '超吉: Copano Rickey', '大吉: Tea Stalks', '大吉: Taiki Shuttle', '吉: Rice Shower', '吉: Blue Machitan', '吉: Silence Suzuka', '小吉: Matikanetannhauser', '小吉: Nice Nature', '凶: The Cloudy Crystal Ball', '凶: Meisho Doto', '大凶: The Black Cat', '大凶: Air Groove']);
        check('set 4: no On/Off, a read menu of drawn fortunes', [s4.components[0]!.components.map((b) => b.label), s4.components[1]?.components[0]?.options?.map((o) => [o.label, o.value])], [['Back', 'Next'], [['3. 大吉: Tea Stalks', 'fortune:great.tea'], ['4. 大吉: Taiki Shuttle', 'fortune:great.taiki']]]);
        const readF = await rares.readSpecial(FG, 't1', 'fortune:great.tea');
        check('set 4: reading a fortune shows its result box text; not one not drawn', [readF?.name, readF?.text.includes('<@t1>-san, three tea stalks'), readF?.text.endsWith("-# Today's fortune: +2% chance of a special line until the daily reset."), await rares.readSpecial(FG, 't1', 'fortune:oracle.sky'), await rares.readSpecial(FG, 't1', 'fortune:nope')], ['大吉 Great blessing', true, true, null, null]);
        check('set 4: fortunes count in the "N of M" totals (personal: 2 Matikanes + 2 fortunes)', s4e.title, `Your specials: 4 of ${nAll + 13}`);
        const s4srv = vj(await rares.serverSpecialsView(FG, 5, OPEN)).embeds[0]!;
        check('set 4: the server list, first drawn by', [s4srv.fields?.[2]?.name, s4srv.fields?.[2]?.value.split('\n')[2]?.startsWith('<@t1> <t:')], ['First drawn by', true]);
        // Scoring: 15 a new fortune, 3 a repeat, 100 for all 13.
        const SB = `${FG}-score`;
        let k = 0;
        for (const l of fortune.FORTUNE_LINES) await prisma.timerFortuneDraw.create({ data: { guildId: SB, discordUserId: 'all13', day: `d${k++}`, tier: fortune.fortuneLineById(l.id)!.tier.id, lineId: l.id, drawnAt: new Date(OPEN.getTime() + k * 60_000) } });
        await prisma.timerFortuneDraw.create({ data: { guildId: SB, discordUserId: 'all13', day: 'again', tier: 'great', lineId: 'great.tea', drawnAt: new Date(OPEN.getTime() + 99 * 60_000) } });
        await prisma.timerFortuneDraw.create({ data: { guildId: SB, discordUserId: 'two', day: 'x', tier: 'great', lineId: 'great.tea', drawnAt: OPEN } });
        await prisma.timerFortuneDraw.create({ data: { guildId: SB, discordUserId: 'two', day: 'y', tier: 'curse', lineId: 'curse.doto', drawnAt: OPEN } });
        const fb = await rares.specialsBoard(SB, 15, OPEN);
        check('set 4: scored like a set (15 new, 3 repeat, +100 for all 13), finds and sets counted', fb.rows.map((r) => [r.discordUserId, r.points, r.setsComplete, r.found]), [['all13', 13 * 15 + 3 + 100, 1, 13], ['two', 30, 0, 2]]);
        check('set 4: not on the board before the opening', (await rares.specialsBoard(SB, 15, BEFORE)).rows.length, 0);
        await prisma.timerFortuneDraw.deleteMany({ where: { guildId: SB } });

        // Effects: a blessing is an extra slice (paused with Boosts off); a curse lowers the base (never paused).
        const plainF = { dmPing: false, earlyRiser: false, boosts: true, disabledSets: [] as string[] };
        const poolF = openers.rarePoolFor([], [], OPEN);
        // The Estate locked, as for these trainers (no Mejiro finds), so only the fortune shows.
        const LK = ['online-sensations', 'mejiro-estate'];
        const ex = await boostsMod.extraChances(FG, 't1', plainF, LK, false, poolF, OPEN);
        check('blessing: an extra slice from the usual pool, labelled', ex.map((e) => [e.chance, e.pool.length, e.label]), [[0.02, poolF.length, 'Fortune: Great blessing, until the daily reset.']]);
        check('blessing: paused with Boosts off; gone after the reset', [(await boostsMod.extraChances(FG, 't1', { ...plainF, boosts: false }, LK, false, poolF, OPEN)).length, (await boostsMod.extraChances(FG, 't1', plainF, LK, false, poolF, new Date('2026-11-25T03:00:00Z'))).length], [0, 0]);
        const bvBless = (await boostsMod.boostsView(FG, 't1', OPEN)).embeds[0]!.toJSON().description ?? '';
        check('blessing: the Boosts view line and total', [bvBless.includes('**+2%** Fortune: Great blessing, until the daily reset.'), bvBless.includes('**Your next ping: 8% chance of a special.**')], [true, true]);
        const CURSE_DAY = new Date('2026-11-25T03:00:00Z');
        await fortune.drawFortune(FG, 't2', CURSE_DAY, seq(0.75, 0)); // 凶
        check('curse: lowers the base for the day, Boosts on or off (not a boost)', [await boostsMod.fortuneBaseAdjust(FG, 't2', CURSE_DAY), (await boostsMod.extraChances(FG, 't2', plainF, LK, false, poolF, CURSE_DAY)).length, await boostsMod.fortuneBaseAdjust(FG, 't2', new Date('2026-11-26T03:00:00Z'))], [-0.01, 0, 0]);
        await usF.toggleSetting(FG, 't2', 'boosts');
        const bvCurse = (await boostsMod.boostsView(FG, 't2', CURSE_DAY)).embeds[0]!.toJSON().description ?? '';
        check('curse: the Boosts view line and total, with Boosts off too', [bvCurse.includes('**-1%** Fortune: Curse, until the daily reset.'), bvCurse.includes('**Your next ping: 5% chance of a special.**'), bvCurse.includes('**Base:** 6%')], [true, true, true]);
        await prisma.timerFortuneDraw.create({ data: { guildId: FG, discordUserId: 't2', day: '2026-11-27', tier: 'great-curse', lineId: 'great-curse.cat' } });
        const GC = new Date('2026-11-27T03:00:00Z');
        check('curse: a great curse, -2%, total 4%', [await boostsMod.fortuneBaseAdjust(FG, 't2', GC), ((await boostsMod.boostsView(FG, 't2', GC)).embeds[0]!.toJSON().description ?? '').includes('**Your next ping: 4% chance of a special.**')], [-0.02, true]);
        // chooseOpener with the base adjust: 5% and 4% of the range are specials.
        const sweepBase = async (adjust: number, extras: { chance: number; pool: string[] }[] = []) => {
            let n = 0;
            for (let k = 0; k < 10000; k += 1) if (rares.isRareOpener(await rares.chooseOpener(FG, 'sweeper', k / 10000, poolF, extras, PING_OPENERS, undefined, adjust))) n += 1;
            return n;
        };
        check('curse: chooseOpener\'s base share is 6% less the curse', [await sweepBase(0), await sweepBase(-0.01), await sweepBase(-0.02)], [600, 500, 400]);
        check('curse: other boosts still add on top', await sweepBase(-0.01, [{ chance: 0.02, pool: poolF }]), 700);
        await cleanF();
    }

    // First Victor on Set 3.5 (owner, 2026-11-15): once the guild has a Ramonu's Second Love.
    {
        const VG = `test-victor-${Date.now()}`;
        const openersV = await import('../src/lib/timer/openers');
        await rares.recordRareOpener(VG, 'v1', openersV.specialById('set1.mejiro')!.text);
        const fieldsOf = async (mine: boolean, page: number) => (mine ? await rares.mySpecialsView(VG, 'v1', page, PRE) : await rares.serverSpecialsView(VG, page, PRE)).embeds[0]!.toJSON().fields ?? [];
        const victorLine = (f: { value: string }[]) => f.find((x) => x.value.startsWith('First Victor'))?.value ?? null;
        check('victor: nothing before anyone has won', [victorLine(await fieldsOf(true, 4)), victorLine(await fieldsOf(false, 4))], [null, null]);
        const at = new Date('2026-11-16T12:00:00Z');
        await prisma.timerSecondLove.create({ data: { guildId: VG, firstUserId: 'winner-1', firstAt: at } });
        const line = `First Victor (Ramonu's Second Love): <@winner-1> <t:${Math.floor(at.getTime() / 1000)}:R>`;
        check('victor: under the Set 3.5 table, personal and server', [victorLine(await fieldsOf(true, 4)), victorLine(await fieldsOf(false, 4)), (await fieldsOf(false, 4)).at(-1)?.value], [line, line, line]);
        check('victor: only on Set 3.5, not on Set 3 or the Boosts view', [victorLine(await fieldsOf(false, 3)), victorLine(await fieldsOf(false, 1)), JSON.stringify(await (await import('../src/lib/timer/boosts')).boostsView(VG, 'v1', PRE)).includes('First Victor')], [null, null, false]);
        await prisma.timerSecondLove.deleteMany({ where: { guildId: VG } });
        await prisma.rareOpenerHit.deleteMany({ where: { guildId: VG } });
    }

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
    await prisma.timerUserSettings.deleteMany({ where: { guildId: G } });
    await prisma.trainingRun.deleteMany({ where: { guildId: G } });
    await prisma.trainingTimer.deleteMany({ where: { guildId: G } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
