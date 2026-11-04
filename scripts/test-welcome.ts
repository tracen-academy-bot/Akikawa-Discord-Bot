/**
 * The welcome for new members: placeholders, the payload, and who gets
 * welcomed, with a fake member and channel against a real database.
 *
 *   DATABASE_URL=postgresql://... npm run test:welcome
 */
process.env.FORUM_CHANNEL_ID = 'forum-1';

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

async function main() {
    const w = await import('../src/lib/welcome');
    const { prisma } = await import('../src/db/prisma');

    const ctx = { userId: '42', serverName: 'Tracen Academy', memberCount: 1234, applyChannelId: 'forum-1', clubsChannelId: 'bio-1' };
    check('placeholders filled', w.renderWelcome('Hi {user}, welcome to {server} (#{count}). {apply} {clubs}', ctx), 'Hi <@42>, welcome to Tracen Academy (#1,234). <#forum-1> <#bio-1>');
    check('placeholders are not case-sensitive', w.renderWelcome('{USER} {Server}', ctx), '<@42> Tracen Academy');
    check('unknown placeholder left as written', w.renderWelcome('{user} {nope}', ctx), '<@42> {nope}');
    check('missing channels read as words', w.renderWelcome('{apply} / {clubs}', { ...ctx, applyChannelId: null, clubsChannelId: null }), 'the club application forum / the club list');
    check('every built-in welcome uses the member and both channels', w.DEFAULT_WELCOMES.every((t) => ['{user}', '{apply}', '{clubs}'].every((p) => t.includes(p))), true);
    check('variants split at --- lines', w.welcomeVariants('one\n---\ntwo\n  ---  \n\n---\nthree'), ['one', 'two', 'three']);
    check('the built-in text splits back into its variants', w.welcomeVariants(w.DEFAULT_WELCOME).length, w.DEFAULT_WELCOMES.length);
    check('pick is spread over all items', [w.pick(['a', 'b', 'c'], () => 0), w.pick(['a', 'b', 'c'], () => 0.5), w.pick(['a', 'b', 'c'], () => 0.999)], ['a', 'b', 'c']);
    check('one variant picked per welcome', w.welcomePayload('A {user}\n---\nB {user}', ctx, null, false, () => 0.9).embeds[0]!.toJSON().description, 'B <@42>');
    check('empty text falls back to the built-in welcomes', w.welcomePayload('   ', ctx, null, false, () => 0).embeds[0]!.toJSON().description?.startsWith('**Welcome!** <@42>'), true);
    const withWave = w.welcomePayload('x', ctx, null, true);
    const waveButton = (withWave.components[0]!.toJSON() as { components: { custom_id?: string; label?: string }[] }).components[0];
    check('"Say hi!" button carries the newcomer', [waveButton?.label, waveButton?.custom_id, w.isWaveButton(waveButton?.custom_id ?? ''), w.waveTarget(waveButton?.custom_id ?? '')], ['Say hi!', 'welcome:wave:42', true, '42']);
    check('no button when wave is off', w.welcomePayload('x', ctx, null, false).components.length, 0);
    check('wave line names both and pings nobody', [w.wavePayload('7', '42', () => 0).content, w.wavePayload('7', '42').allowedMentions], ['**Friendship!** <@7> waves hello to <@42>!', { parse: [] }]);
    check('each member waves once per welcome', [w.recordWave('m1', '7'), w.recordWave('m1', '7'), w.recordWave('m1', '8'), w.recordWave('m2', '7')], [true, false, true, true]);
    check('boost thank-you pings the booster', [w.boostPayload('9', 'Tracen Academy', () => 0).content, w.boostPayload('9', 'x').allowedMentions], ['**Gratitude!** <@9> has boosted **Tracen Academy**! The academy thanks you for your generous support!', { users: ['9'] }]);
    check('starting to boost is seen; already boosting is not', [
        w.startedBoosting({ premiumSinceTimestamp: null }, { premiumSinceTimestamp: 1 }),
        w.startedBoosting({ premiumSinceTimestamp: 1 }, { premiumSinceTimestamp: 1 }),
        w.startedBoosting({ premiumSinceTimestamp: 1 }, { premiumSinceTimestamp: null }),
    ], [true, false, false]);
    const payload = w.welcomePayload('{user} @everyone', ctx, 'https://cdn.example/a.png');
    check('payload pings only the newcomer', [payload.content, payload.allowedMentions], ['<@42>', { users: ['42'] }]);
    check('payload has the avatar', payload.embeds[0]!.toJSON().thumbnail?.url, 'https://cdn.example/a.png');

    const guildId = `test-welcome-${Date.now()}`;
    const sent: unknown[] = [];
    const channel = { isSendable: () => true, send: async (p: unknown) => void sent.push(p) };
    const member = (bot = false) => ({
        id: '42',
        user: { bot },
        displayAvatarURL: () => 'https://cdn.example/a.png',
        guild: { id: guildId, name: 'Tracen Academy', memberCount: 99, channels: { fetch: async (id: string) => (id === 'welcome-1' ? channel : null) } },
    });
    type Member = Parameters<typeof w.welcomeMember>[0];
    try {
        await w.welcomeMember(member() as unknown as Member);
        check('nothing posted before a channel is set', sent.length, 0);
        await prisma.welcomeSettings.create({ data: { guildId, channelId: 'welcome-1' } });
        await w.welcomeMember(member(true) as unknown as Member);
        check('bots are not welcomed', sent.length, 0);
        await w.welcomeMember(member() as unknown as Member);
        const first = sent[0] as { embeds: { toJSON(): { description?: string } }[] };
        const rendered = w.DEFAULT_WELCOMES.map((t) => w.renderWelcome(t, { userId: '42', serverName: 'Tracen Academy', memberCount: 99, applyChannelId: 'forum-1', clubsChannelId: null }));
        check('member welcomed with one of the built-in welcomes', rendered.includes(first?.embeds[0]?.toJSON().description ?? ''), true);
        check('welcome has the "Say hi!" button by default', (sent[0] as { components: unknown[] }).components.length, 1);
        await prisma.welcomeSettings.update({ where: { guildId }, data: { message: 'Yo {user}' } });
        await w.welcomeMember(member() as unknown as Member);
        check('custom text used', (sent[1] as typeof first).embeds[0]?.toJSON().description, 'Yo <@42>');
        await prisma.welcomeSettings.update({ where: { guildId }, data: { channelId: 'gone' } });
        await w.welcomeMember(member() as unknown as Member);
        check('a missing channel posts nothing and does not throw', sent.length, 2);
        await prisma.welcomeSettings.update({ where: { guildId }, data: { channelId: 'welcome-1' } });
        await w.thankBooster(member() as unknown as Member);
        check('a new booster is thanked in the welcome channel', (sent[2] as { content: string })?.content.includes('<@42>'), true);
        await prisma.welcomeSettings.update({ where: { guildId }, data: { boosts: false } });
        await w.thankBooster(member() as unknown as Member);
        check('no thank-you with boosts off', sent.length, 3);
    } finally {
        await prisma.welcomeSettings.deleteMany({ where: { guildId } });
        await prisma.$disconnect();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
