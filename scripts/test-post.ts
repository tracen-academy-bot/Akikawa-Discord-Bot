/**
 * `/post`: the form it opens and what submitting it does, with a fake Discord
 * interaction and channel.
 *
 * Building the form runs discord.js's own validators, so a field Discord
 * would reject fails here first.
 *
 *   DATABASE_URL=postgresql://... npm run test:post
 */
import { Collection } from 'discord.js';

const OFFICER_ROLE = 'officer-role';
process.env.OFFICER_ROLE_IDS = OFFICER_ROLE;

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

interface Sent {
    content?: string;
    files?: { attachment: string; name: string }[];
    allowedMentions?: { parse?: string[] };
}

/** A channel that records what is sent and whether the message was pinned. */
function fakeChannel(opts: { sendFails?: boolean; pinFails?: boolean } = {}) {
    const record = { sent: [] as Sent[], pinned: false };
    const channel = {
        isTextBased: () => true,
        send: async (message: Sent) => {
            if (opts.sendFails) throw new Error('Missing Permissions');
            record.sent.push(message);
            return {
                url: 'https://discord.com/channels/g/c/m1',
                pin: async () => {
                    if (opts.pinFails) throw new Error('Missing Permissions');
                    record.pinned = true;
                },
            };
        },
    };
    return { channel, record };
}

/** The slice of ModalSubmitInteraction `handlePostModal` uses. */
function fakeSubmit(
    form: { channel?: string | null; content?: string; files?: { url: string; name: string }[]; pin?: boolean; officer?: boolean },
    channel: ReturnType<typeof fakeChannel>['channel'],
) {
    const replies: { kind: string; description?: string | undefined; ephemeral?: boolean }[] = [];
    const embedText = (p: { embeds?: { toJSON(): { description?: string } }[] }) => p.embeds?.[0]?.toJSON().description;
    const interaction = {
        replied: false,
        deferred: false,
        inGuild: () => true,
        member: { roles: { cache: new Map(form.officer === false ? [] : [[OFFICER_ROLE, {}]]) } },
        client: { channels: { fetch: async () => channel } },
        fields: {
            getSelectedChannels: () => new Collection(form.channel === null ? [] : [[form.channel ?? 'c1', { id: form.channel ?? 'c1' }]]),
            getTextInputValue: () => form.content ?? '',
            getUploadedFiles: () => (form.files ? new Collection(form.files.map((f, i) => [String(i), f])) : null),
            getCheckbox: () => form.pin ?? false,
        },
        async reply(p: { embeds?: { toJSON(): { description?: string } }[]; flags?: unknown }) {
            interaction.replied = true;
            replies.push({ kind: 'reply', description: embedText(p), ephemeral: p.flags !== undefined });
        },
        async deferReply(p: { flags?: unknown } = {}) {
            interaction.deferred = true;
            replies.push({ kind: 'defer', ephemeral: p.flags !== undefined });
        },
        async editReply(p: { embeds?: { toJSON(): { description?: string } }[] }) {
            replies.push({ kind: 'edit', description: embedText(p) });
        },
    };
    return { interaction, replies };
}

async function main() {
    const post = await import('../src/commands/post');

    // ── The form ──────────────────────────────────────────────────────────────
    const modal = post.buildPostModal('c-here').toJSON() as unknown as {
        custom_id: string;
        title: string;
        components: { label: string; component: { type: number; custom_id: string; default_values?: { id: string }[] } }[];
    };
    check('form is routed by the post: prefix', post.isPostModal(modal.custom_id), true);
    check('form title', modal.title, 'Post a message');
    check('form fields, in order', modal.components.map((c) => c.label), ['Channel', 'Message', 'Attachment', 'Pin it']);
    check('channel field defaults to where /post ran', modal.components[0]?.component.default_values?.map((v) => v.id), ['c-here']);
    check('form ids match what the submit reads', modal.components.map((c) => c.component.custom_id), ['post:channel', 'post:content', 'post:files', 'post:pin']);

    // ── Opening it ────────────────────────────────────────────────────────────
    const shown: unknown[] = [];
    const opened: string[] = [];
    const open = (officer: boolean) => ({
        inGuild: () => true,
        channelId: 'c-here',
        member: { roles: { cache: new Map(officer ? [[OFFICER_ROLE, {}]] : []) } },
        showModal: async (m: unknown) => void shown.push(m),
        reply: async (p: { embeds?: { toJSON(): { description?: string } }[] }) => void opened.push(p.embeds?.[0]?.toJSON().description ?? ''),
    });
    await post.execute(open(true) as never);
    check('/post opens the form for a Club Manager', shown.length, 1);
    await post.execute(open(false) as never);
    check('/post refuses anyone else', opened, ['Only Club Managers can post as Akikawa.']);

    // ── Submitting it ─────────────────────────────────────────────────────────
    const ok = fakeChannel();
    const done = fakeSubmit({ content: '**Rules**\nBe nice.', files: [{ url: 'https://cdn/x.png', name: 'x.png' }], pin: true }, ok.channel);
    await post.handlePostModal(done.interaction as never);
    check('posts the message as written', ok.record.sent[0]?.content, '**Rules**\nBe nice.');
    check('re-attaches the uploaded file', ok.record.sent[0]?.files, [{ attachment: 'https://cdn/x.png', name: 'x.png' }]);
    check('never pings @everyone or @here', ok.record.sent[0]?.allowedMentions?.parse, ['users', 'roles']);
    check('pins it when asked', ok.record.pinned, true);
    check('confirms privately with a link', [done.replies[0]?.ephemeral, done.replies.at(-1)?.description],
        [true, 'Posted in <#c1> and pinned it: https://discord.com/channels/g/c/m1']);

    const fileOnly = fakeChannel();
    await post.handlePostModal(fakeSubmit({ files: [{ url: 'https://cdn/y.pdf', name: 'y.pdf' }] }, fileOnly.channel).interaction as never);
    check('a file alone is enough', [fileOnly.record.sent[0]?.content, fileOnly.record.sent[0]?.files?.length], [undefined, 1]);
    check('not pinned unless asked', fileOnly.record.pinned, false);

    const empty = fakeChannel();
    const nothing = fakeSubmit({ content: '   ' }, empty.channel);
    await post.handlePostModal(nothing.interaction as never);
    check('nothing to post is refused', [empty.record.sent.length, nothing.replies[0]?.description], [0, 'Write a message or attach a file; there is nothing to post.']);

    const noPin = fakeChannel({ pinFails: true });
    const pinFailed = fakeSubmit({ content: 'hi', pin: true }, noPin.channel);
    await post.handlePostModal(pinFailed.interaction as never);
    check('a failed pin still posts and says why', [noPin.record.sent.length, pinFailed.replies.at(-1)?.description?.includes('could not pin it')], [1, true]);

    const blocked = fakeSubmit({ content: 'hi' }, fakeChannel({ sendFails: true }).channel);
    await post.handlePostModal(blocked.interaction as never);
    check('a failed send explains what to check', blocked.replies.at(-1)?.description?.startsWith('Could not post in <#c1>: Missing Permissions'), true);

    const outsider = fakeChannel();
    const notOfficer = fakeSubmit({ content: 'hi', officer: false }, outsider.channel);
    await post.handlePostModal(notOfficer.interaction as never);
    check('the submit re-checks permission', [outsider.record.sent.length, notOfficer.replies[0]?.description], [0, 'Only Club Managers can post as Akikawa.']);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
