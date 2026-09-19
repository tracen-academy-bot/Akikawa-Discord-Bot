/**
 * Tests gateway-outcome detection without a network.
 *
 * discord.js reports an unrecoverable connection failure by emitting
 * shardDisconnect and returning; login() does not reject. These tests drive a
 * bare Client's event emitter the same way and assert the outcome, because
 * getting this wrong is a silent restart loop in production.
 *
 *   npm run test:startup
 */
import { Client, Events, GatewayCloseCodes, GatewayIntentBits } from 'discord.js';
import { waitForConnectOutcome } from '../src/lib/startup';

let pass = 0;
let fail = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = actual === expected;
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${actual} want=${expected}`}`);
};
const fresh = () => new Client({ intents: [GatewayIntentBits.Guilds] });
const close = (code: number) => ({ code, reason: '', wasClean: true }) as never;

(async () => {
    let c = fresh();
    let p = waitForConnectOutcome(c);
    c.emit(Events.ShardDisconnect, close(GatewayCloseCodes.DisallowedIntents), 0);
    check('4014 -> disallowed-intents', await p, 'disallowed-intents');

    c = fresh(); p = waitForConnectOutcome(c);
    c.emit(Events.ShardDisconnect, close(GatewayCloseCodes.AuthenticationFailed), 0);
    check('4004 -> fatal', await p, 'fatal');

    c = fresh(); p = waitForConnectOutcome(c);
    c.emit(Events.ShardDisconnect, close(GatewayCloseCodes.InvalidIntents), 0);
    check('4013 -> fatal', await p, 'fatal');

    // A recoverable blip must not settle the outcome; ready afterwards must.
    c = fresh(); p = waitForConnectOutcome(c);
    c.emit(Events.ShardDisconnect, close(1006), 0);
    const settled = await Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 50))]);
    check('1006 does not settle the outcome', settled, false);
    c.emit(Events.ClientReady, c as never);
    check('ready after a blip -> ready', await p, 'ready');

    // discord.js may attach listeners of its own at construction, so compare
    // against the baseline rather than assuming a bare emitter.
    c = fresh();
    const baseline = c.listenerCount(Events.ShardDisconnect);
    p = waitForConnectOutcome(c);
    check('helper attaches its listener', c.listenerCount(Events.ShardDisconnect), baseline + 1);
    c.emit(Events.ClientReady, c as never);
    check('plain ready -> ready', await p, 'ready');
    check('helper removes its listener on settle', c.listenerCount(Events.ShardDisconnect), baseline);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
