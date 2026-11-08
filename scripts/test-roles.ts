/**
 * The Member role sync: what each member's Member role needs. No database
 * needed.
 *
 *   npm run test:roles
 */
// Read when the module loads, so set first.
process.env.CLUB_ROLE_IDS = 'club-a,club-b';
process.env.MEMBER_ROLE_ID = 'member';

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

async function main() {
    const { memberRoleChange } = await import('../src/lib/roleAssignment');
    const clubs = ['club-a', 'club-b'];
    check('club role, no Member: add', memberRoleChange(['club-a'], 'member', clubs), 'add');
    check('club role and Member: nothing', memberRoleChange(['other', 'club-b', 'member'], 'member', clubs), null);
    check('Member, no club role: remove', memberRoleChange(['member', 'other'], 'member', clubs), 'remove');
    check('neither: nothing', memberRoleChange(['other'], 'member', clubs), null);
    check('no Member role set: nothing', memberRoleChange(['club-a'], '', clubs), null);
    check('no club roles set: nobody loses Member', memberRoleChange(['member'], 'member', []), null);


    // A club role deleted: every member is synced, so its ex-members lose Member.
    const { handleClubRoleDeleted, syncMemberRoles } = await import('../src/lib/roleAssignment');
    const calls: string[] = [];
    const fake = (id: string, roleIds: string[], bot = false) => ({
        id,
        user: { bot },
        roles: {
            cache: new Map(roleIds.map((r) => [r, {}])),
            add: async (r: string) => void calls.push(`+${id}:${r}`),
            remove: async (r: string) => void calls.push(`-${id}:${r}`),
        },
    });
    // After "club-c" (Rigil) is deleted, its members simply no longer hold it.
    const members = [
        fake('ex-rigil', ['member', 'other']),
        fake('in-a', ['club-a', 'member']),
        fake('in-b-missing-member', ['club-b']),
        fake('outsider', ['other']),
        fake('bot', ['member'], true),
    ];
    const guild = { name: 'Tracen', members: { fetch: async () => new Map(members.map((m) => [m.id, m])) } };
    await handleClubRoleDeleted({ id: 'club-a', name: 'Rigil', guild } as never);
    check('club role deleted: ex-members lose Member, missing Member is added, bots and outsiders untouched', calls.sort(), ['+in-b-missing-member:member', '-ex-rigil:member']);
    calls.length = 0;
    await handleClubRoleDeleted({ id: 'not-a-club', name: 'Random', guild } as never);
    check('a non-club role deleted: nothing', calls, []);
    const failing = { ...fake('broken', ['member']), roles: { cache: new Map([['member', {}]]), add: async () => {}, remove: async () => { throw new Error('403'); } } };
    check('a failed change is not counted', await syncMemberRoles([failing as never]), { added: 0, removed: 0 });

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
