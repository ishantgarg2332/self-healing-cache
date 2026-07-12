import { test } from 'node:test';
import assert from 'node:assert';
import { HashRing } from '../src/core/HashRing.js';

function sampleKeys(n) {
    return Array.from({ length: n }, (_, i) => `key-${i}`);
}

test('empty ring returns null', () => {
    const ring = new HashRing();
    assert(ring.getNode('any-key') === null, 'Empty ring should return null for any key');
});

test('single node owns every key', () => {
    const ring = new HashRing();
    ring.addNode('node-A');

    for (const key of sampleKeys(1000)) {
        assert(ring.getNode(key) === 'node-A', `Single node should own all keys, but got ${ring.getNode(key)} for key ${key}`);
    }
});

test('lookups are deterministic', () => {
    const ring = new HashRing();
    ring.addNode('node-A');
    ring.addNode('node-B');
    ring.addNode('node-C');

    const key = 'user:42';
    const first = ring.getNode(key);
    assert(ring.getNode(key) === first, `Deterministic lookup failed: expected ${first} but got ${ring.getNode(key)}`);
});

test('adding same node twice is idempotent', () => {
    const ring = new HashRing({});
    ring.addNode('node-A');
    const sizeAfterFirst = ring.ring.length;
    ring.addNode('node-A');
    const sizeAfterSecond = ring.ring.length;
    assert(sizeAfterFirst === sizeAfterSecond, 'Adding the same node twice should not change the ring size');
});

test('removing a nonexistent node is a no-op', () => {
    const ring = new HashRing();
    ring.addNode('node-A');
    const before = ring.ring.length;
    ring.removeNode('node-Z');
    assert(ring.ring.length === before, 'Removing a nonexistent node should not change the ring size');
});

test('removing a node only moves keys it owned', () => {
    const ring = new HashRing();
    ring.addNode('node-A');
    ring.addNode('node-B');
    ring.addNode('node-C');

    const keys = sampleKeys(1000);

    const before = new Map();
    for (const key of keys) {
        before.set(key, ring.getNode(key));
    }

    ring.removeNode('node-B');

    for (const key of keys) {
        const owner = before.get(key);
        const nowOwner = ring.getNode(key);

        if (owner === 'node-B') {
            assert((nowOwner !== 'node-B' && nowOwner !== null), `Key ${key} should not be owned by node-B after its removal`);
        } else {
            assert(nowOwner === owner, `Key ${key} should still be owned by ${owner} after node-B's removal, but got ${nowOwner}`);
        }
    }
});

test('keys distribute roughly evenly across nodes', () => {
    const ring = new HashRing();
    ring.addNode('node-A');
    ring.addNode('node-B');
    ring.addNode('node-C');

    const counts = { 'node-A': 0, 'node-B': 0, 'node-C': 0 };
    const total = 10000;
    for (const key of sampleKeys(total)) {
        counts[ring.getNode(key)]++;
    }

    for (const node of Object.keys(counts)) {
        const share = counts[node] / total;
        assert(share > 0.2 && share <= 0.45, `Node ${node} should have a reasonable share of keys, but got ${share}`);
    }
});
