import { test } from 'node:test';
import assert from 'node:assert';
import { FailureDetector } from '../src/cluster/FailureDetector.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDetector(onDead) {
    return new FailureDetector({
        suspectTimeout: 60,
        deadTimeout: 120,
        checkInterval: 20,
        onDead,
    });
}
const stateOf = (fd, id) => fd.health.get(id)?.state ?? 'gone';

test('register adds a node as alive', () => {
    const fd = makeDetector();
    fd.register('A');
    assert.strictEqual(stateOf(fd, 'A'), 'alive');
    fd.stop();
});

test('unregister stops tracking a node', () => {
    const fd = makeDetector();
    fd.register('A');
    fd.unregister('A');
    assert.strictEqual(stateOf(fd, 'A'), 'gone');
    fd.stop();
});

test('heartbeat on an untracked node returns false (no resurrection)', () => {
    const fd = makeDetector();
    assert.strictEqual(fd.heartbeat('ghost'), false);
    fd.stop();
});

test('heartbeat on a tracked node returns true', () => {
    const fd = makeDetector();
    fd.register('A');
    assert.strictEqual(fd.heartbeat('A'), true);
    fd.stop();
});

test('a node that keeps heartbeating stays alive', async () => {
    const fd = makeDetector();
    fd.start();
    fd.register('A');
    const beat = setInterval(() => fd.heartbeat('A'), 20);
    await sleep(200);
    assert.strictEqual(stateOf(fd, 'A'), 'alive');
    clearInterval(beat);
    fd.stop();
});

test('a silent node becomes suspected after suspectTimeout', async () => {
    const fd = makeDetector();
    fd.start();
    fd.register('A');
    await sleep(90);
    assert.strictEqual(stateOf(fd, 'A'), 'suspected');
    fd.stop();
});

test('a heartbeat during suspicion revives the node to alive', async () => {
    const fd = makeDetector();
    fd.start();
    fd.register('A');
    await sleep(90);
    assert.strictEqual(stateOf(fd, 'A'), 'suspected');
    fd.heartbeat('A');
    assert.strictEqual(stateOf(fd, 'A'), 'alive');
    fd.stop();
});

test('sustained silence escalates to dead and fires onDead exactly once', async () => {
    const deadEvents = [];
    const fd = makeDetector((id) => deadEvents.push(id));
    fd.start();
    fd.register('A');
    await sleep(200);
    assert.deepStrictEqual(deadEvents, ['A'], 'onDead should fire once for A');
    assert.strictEqual(stateOf(fd, 'A'), 'gone', 'dead node is removed from tracking');
    fd.stop();
});

test('onDead does not fire again after a node is evicted', async () => {
    const deadEvents = [];
    const fd = makeDetector((id) => deadEvents.push(id));
    fd.start();
    fd.register('A');
    await sleep(200);
    await sleep(120);
    assert.strictEqual(deadEvents.length, 1, 'onDead must fire only once per death');
    fd.stop();
});

test('one node dying does not affect a healthy peer', async () => {
    const deadEvents = [];
    const fd = makeDetector((id) => deadEvents.push(id));
    fd.start();
    fd.register('A');
    fd.register('B');
    const beat = setInterval(() => fd.heartbeat('A'), 20);
    await sleep(200);
    assert.strictEqual(stateOf(fd, 'A'), 'alive');
    assert.deepStrictEqual(deadEvents, ['B']);
    clearInterval(beat);
    fd.stop();
});

test('two nodes dying in the same window both fire onDead', async () => {
    const deadEvents = [];
    const fd = makeDetector((id) => deadEvents.push(id));
    fd.start();
    fd.register('X');
    fd.register('Y');
    await sleep(200);
    assert.strictEqual(deadEvents.length, 2);
    assert.ok(deadEvents.includes('X') && deadEvents.includes('Y'));
    fd.stop();
});

test('check() does not run after stop()', async () => {
    const deadEvents = [];
    const fd = makeDetector((id) => deadEvents.push(id));
    fd.start();
    fd.register('A');
    fd.stop();
    await sleep(200);
    assert.strictEqual(deadEvents.length, 0, 'no detection after stop');
    fd.stop();
});
