/**
 * `/role give-club-members`: who gets the role. No database needed.
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
    const { membersToGrant } = await import('../src/lib/roleAssignment');
    const clubs = ['club-a', 'club-b'];
    const members = [
        { id: 'in-a', bot: false, roleIds: ['club-a'] },
        { id: 'in-b-plus-other', bot: false, roleIds: ['other', 'club-b'] },
        { id: 'no-club', bot: false, roleIds: ['other'] },
        { id: 'has-it', bot: false, roleIds: ['club-a', 'new'] },
        { id: 'bot-in-a', bot: true, roleIds: ['club-a'] },
        { id: 'nothing', bot: false, roleIds: [] },
    ];
    check('club members without the role get it', membersToGrant(members, 'new', clubs), ['in-a', 'in-b-plus-other']);
    check('no club roles set: nobody', membersToGrant(members, 'new', []), []);
    check('everyone has it already: nobody', membersToGrant(members, 'club-a', ['club-a']), []);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
