import { test } from 'node:test';
import assert from 'node:assert';
import { Coordinator } from '../src/core/Coordinator.js';

function makeCluster() {
    const c = new Coordinator({ defaultTtl: 60000 });
    c.addNode('node-A');
    c.addNode('node-B');
    c.addNode('node-C');
    return c;
}
function stopAll(c) { c.stop(); }

test('set on empty cluster returns false and stores nothing', () => {
    const c = new Coordinator();
    assert.strictEqual(c.set('k', 'v'), false);
    assert.strictEqual(c.get('k'), null);
});

test('set then get round-trips through the coordinator', () => {
    const c = makeCluster();
    c.set('user:42', { name: 'Ishu' });
    assert.deepStrictEqual(c.get('user:42'), { name: 'Ishu' });
    stopAll(c);
});

test('the value lands on exactly the replica set the ring assigns', () => {
    const c = makeCluster();
    const key = 'user:42';
    // independently ask the ring which nodes should hold this key
    const assigned = new Set(c.ring.getNodes(key, c.replicationFactor));
    c.set(key, 'payload');
    // the value must be on every assigned replica, and no other node
    for (const [id, node] of c.nodes) {
        if (assigned.has(id)) {
            assert.strictEqual(node.get(key), 'payload', `replica ${id} should hold the key`);
        } else {
            assert.strictEqual(node.store.has(key), false, `non-replica ${id} must not hold the key`);
        }
    }
    stopAll(c);
});

test('delete removes the value', () => {
    const c = makeCluster();
    c.set('k', 'v');
    assert.strictEqual(c.delete('k'), true);
    assert.strictEqual(c.get('k'), null);
    stopAll(c);
});

test('get for a missing key returns null', () => {
    const c = makeCluster();
    assert.strictEqual(c.get('never-set'), null);
    stopAll(c);
});

test('removing a replica heals: data survives and re-replicates to N', () => {
    const c = makeCluster();
    const key = 'user:42';
    c.set(key, 'payload');
    const victim = c.ring.getNodes(key, c.replicationFactor)[0];
    c.removeNode(victim);
    assert.strictEqual(c.get(key), 'payload');
    const holders = [...c.nodes.entries()].filter(([, n]) => n.store.has(key)).length;
    const expected = Math.min(c.replicationFactor, c.nodes.size);
    assert.strictEqual(holders, expected);
    stopAll(c);
});

test('many keys all resolve to some live node (no routing gaps)', () => {
    const c = makeCluster();
    for (let i = 0; i < 500; i++) {
        c.set(`key-${i}`, i);
    }
    let hits = 0;
    for (let i = 0; i < 500; i++) {
        if (c.get(`key-${i}`) === i) hits++;
    }
    assert.strictEqual(hits, 500, 'every set key should be retrievable');
    stopAll(c);
});
