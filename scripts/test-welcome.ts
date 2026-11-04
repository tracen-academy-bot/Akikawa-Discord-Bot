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
    check('default text uses every channel placeholder', ['{user}', '{apply}', '{clubs}'].every((p) => w.DEFAULT_WELCOME.includes(p)), true);
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
        check('member welcomed with the default text', first?.embeds[0]?.toJSON().description?.startsWith('Welcome to **Tracen Academy**, <@42>! You are member #99.'), true);
        await prisma.welcomeSettings.update({ where: { guildId }, data: { message: 'Yo {user}' } });
        await w.welcomeMember(member() as unknown as Member);
        check('custom text used', (sent[1] as typeof first).embeds[0]?.toJSON().description, 'Yo <@42>');
        await prisma.welcomeSettings.update({ where: { guildId }, data: { channelId: 'gone' } });
        await w.welcomeMember(member() as unknown as Member);
        check('a missing channel posts nothing and does not throw', sent.length, 2);
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
