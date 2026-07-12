import { test } from 'node:test';
import assert from 'node:assert';
import { CacheNode } from '../src/core/CacheNode.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('set then get returns the stored value', () => {
    const node = new CacheNode('n1');
    node.set('user:42', { name: 'Self Healing Cache' });
    assert.deepStrictEqual(node.get('user:42'), { name: 'Self Healing Cache' });
});

test('get on a missing key returns null', () => {
    const node = new CacheNode('n1');
    assert.strictEqual(node.get('nope'), null);
});

test('set overwrites an existing key', () => {
    const node = new CacheNode('n1');
    node.set('k', 'old');
    node.set('k', 'new');
    assert.strictEqual(node.get('k'), 'new');
});

test('has reflects presence', () => {
    const node = new CacheNode('n1');
    node.set('k', 'v');
    assert.strictEqual(node.has('k'), true);
    assert.strictEqual(node.has('absent'), false);
});

test('delete returns true when key existed, false otherwise', () => {
    const node = new CacheNode('n1');
    node.set('k', 'v');
    assert.strictEqual(node.delete('k'), true);
    assert.strictEqual(node.delete('k'), false);
    assert.strictEqual(node.get('k'), null);
});

test('lazy expiry: get after TTL returns null', async () => {
    const node = new CacheNode('n1');
    node.set('k', 'v', 20);
    assert.strictEqual(node.get('k'), 'v');
    await sleep(40);
    assert.strictEqual(node.get('k'), null);
});

test('lazy expiry evicts the entry from the store, not just hides it', async () => {
    const node = new CacheNode('n1');
    node.set('k', 'v', 20);
    await sleep(40);
    node.get('k');
    assert.strictEqual(node.store.has('k'), false);
});

test('has applies expiry too', async () => {
    const node = new CacheNode('n1');
    node.set('k', 'v', 20);
    await sleep(40);
    assert.strictEqual(node.has('k'), false);
});

test('sweep evicts a cold expired key that was never read', async () => {
    const node = new CacheNode('n1');
    node.set('cold', 'v', 20);
    await sleep(40);
    assert.strictEqual(node.store.has('cold'), true);
    node.sweep();
    assert.strictEqual(node.store.has('cold'), false);
});

test('sweep leaves live entries alone', () => {
    const node = new CacheNode('n1');
    node.set('live', 'v', 60000);
    node.sweep();
    assert.strictEqual(node.get('live'), 'v');
});

test('default TTL is applied when none is passed', () => {
    const node = new CacheNode('n1', { defaultTtl: 50000 });
    const before = Date.now();
    node.set('k', 'v');
    const entry = node.store.get('k');
    assert.ok(entry.expiresAt >= before + 50000);
    assert.ok(entry.expiresAt <= Date.now() + 50000);
});

test('start then stop lets the process exit (no hanging timer)', () => {
    const node = new CacheNode('n1', { sweepInterval: 10 });
    node.start();
    assert.ok(node.timer);
    node.stop();
    assert.strictEqual(node.timer, null);
});

test('stop is safe to call without start and twice', () => {
    const node = new CacheNode('n1');
    node.stop();
    node.start();
    node.stop();
    node.stop();
    assert.strictEqual(node.timer, null);
});
