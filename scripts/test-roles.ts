/**
 * The Member role sync: what each member's Member role needs. No database
 * needed.
 *
 *   npm run test:roles
 */
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

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
