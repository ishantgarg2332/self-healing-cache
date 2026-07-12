import { test } from 'node:test';
import assert from 'node:assert';
import { Coordinator } from '../src/core/Coordinator.js';

function makeLoadedCluster(nodeIds, keyCount, rf = 3) {
    const c = new Coordinator({ replicationFactor: rf, defaultTtl: 60000 });
    for (const id of nodeIds) c.addNode(id);
    for (let i = 0; i < keyCount; i++) c.set(`key-${i}`, `v${i}`);
    return c;
}
function stopAll(c) { for (const n of c.nodes.values()) n.stop(); }

function holdersOf(c, key) {
    return [...c.nodes.entries()]
        .filter(([, n]) => n.store.has(key))
        .map(([id]) => id)
        .sort();
}
function assignedFor(c, key) {
    return [...c.ring.getNodes(key, c.replicationFactor)].sort();
}

function findInvariantViolation(c, keyCount) {
    for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`;
        const held = holdersOf(c, key);
        const want = assignedFor(c, key);
        if (JSON.stringify(held) !== JSON.stringify(want)) {
            return `key-${i}: held=${JSON.stringify(held)} want=${JSON.stringify(want)}`;
        }
    }
    return null;
}

test('freshly loaded cluster: every key on exactly its assigned nodes', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    assert.strictEqual(findInvariantViolation(c, 200), null);
    stopAll(c);
});

test('after a node leaves, invariant holds (re-replication restores N)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C', 'D'], 200);
    c.removeNode('C');
    assert.strictEqual(findInvariantViolation(c, 200), null);
    stopAll(c);
});

test('after a node leaves, every key still readable (no data loss)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C', 'D'], 200);
    c.removeNode('B');
    for (let i = 0; i < 200; i++) {
        assert.strictEqual(c.get(`key-${i}`), `v${i}`, `key-${i} lost after leave`);
    }
    stopAll(c);
});

test('after a leave, every key still has exactly replicationFactor copies', () => {
    const c = makeLoadedCluster(['A', 'B', 'C', 'D'], 200);
    c.removeNode('A');
    for (let i = 0; i < 200; i++) {
        assert.strictEqual(holdersOf(c, `key-${i}`).length, 3, `key-${i} wrong copy count`);
    }
    stopAll(c);
});

test('after a node joins, invariant holds (migrate onto newcomer + shed stale)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    c.addNode('D');
    assert.strictEqual(findInvariantViolation(c, 200), null);
    stopAll(c);
});

test('after a join, no key is over-replicated (shedding works)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    c.addNode('D');
    for (let i = 0; i < 200; i++) {
        const n = holdersOf(c, `key-${i}`).length;
        assert.strictEqual(n, 3, `key-${i} has ${n} copies, expected exactly 3`);
    }
    stopAll(c);
});

test('after a join, the new node actually receives keys (migration happened)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    c.addNode('D');
    let onD = 0;
    for (let i = 0; i < 200; i++) if (holdersOf(c, `key-${i}`).includes('D')) onD++;
    assert.ok(onD > 0, 'new node D received no keys — migration did not run');
    stopAll(c);
});

test('after a join, no data loss', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    c.addNode('D');
    for (let i = 0; i < 200; i++) {
        assert.strictEqual(c.get(`key-${i}`), `v${i}`, `key-${i} lost after join`);
    }
    stopAll(c);
});

test('invariant survives repeated churn (multiple joins and leaves)', () => {
    const c = makeLoadedCluster(['A', 'B', 'C'], 200);
    c.addNode('D');
    c.addNode('E');
    c.removeNode('A');
    c.addNode('F');
    c.removeNode('C');
    assert.strictEqual(findInvariantViolation(c, 200), null);
    for (let i = 0; i < 200; i++) {
        assert.strictEqual(c.get(`key-${i}`), `v${i}`, `key-${i} lost during churn`);
    }
    stopAll(c);
});

test('migrated copies preserve remaining TTL (not reset to fresh)', () => {
    const c = new Coordinator({ replicationFactor: 3, defaultTtl: 60000 });
    ['A', 'B', 'C'].forEach(id => c.addNode(id));
    c.set('k', 'v', 60000);
    c.addNode('D');
    const holder = c.nodes.get(holdersOf(c, 'k')[0]);
    const remaining = holder.store.get('k').expiresAt - Date.now();
    assert.ok(remaining > 58000 && remaining <= 60000, `ttl not preserved: ${remaining}ms`);
    stopAll(c);
});

test('replication factor larger than cluster degrades gracefully', () => {
    const c = new Coordinator({ replicationFactor: 3, defaultTtl: 60000 });
    c.addNode('A');
    c.addNode('B');
    c.set('k', 'v');
    assert.strictEqual(holdersOf(c, 'k').length, 2, 'should replicate to all available nodes');
    assert.strictEqual(c.get('k'), 'v');
    stopAll(c);
});
