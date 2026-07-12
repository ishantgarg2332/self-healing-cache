# Self-Healing Distributed Cache

A distributed in-memory cache, written from scratch in Node.js, that keeps your data available even as nodes fail and recover. Set a key, kill the node holding it, and the value is still there — the cluster notices the failure on its own and repairs itself, no operator involved.

I built this to actually understand distributed systems rather than just read about them. Every piece — consistent hashing, replication, rebalancing, failure detection — is implemented by hand, and the design decisions behind each one are the point. If you're here to see how a cache like this hangs together internally, read on.

## What it does

- **Consistent hashing** with virtual nodes, so adding or removing a node only reshuffles a small fraction of keys instead of remapping everything.
- **Tunable replication** — every key lives on N distinct nodes (default 3), so the cluster survives up to N−1 simultaneous node failures with no data loss.
- **Automatic rebalancing** in both directions. When a node leaves, missing replicas are rebuilt. When a node joins, keys migrate onto it and now-redundant copies are shed.
- **TTL expiry**, handled both lazily (on read) and actively (a background sweeper), so stale data is never served and cold keys don't leak memory.
- **Failure detection** modeled on the SWIM protocol — heartbeats, a suspicion state, and automatic eviction of dead nodes, which triggers the rebalance that heals the cluster.

The invariant that ties it all together: *every live key lives on exactly the N nodes the ring assigns to it* — and that stays true through arbitrary joins, leaves, and failures.

## The honest caveat, up front

This runs as a **single process**. The "nodes" are objects in the same memory, not separate machines, and the heartbeats are method calls, not UDP packets over a network.

That's a deliberate choice, not a hidden limitation. The parts that carry the real intellectual weight — the placement math, the replica-set walk, the suspicion state machine, the rebalancing logic — are all genuine and would port directly to a networked system. What's faked is only the *transport*: in production, each replica write would be an RPC, each heartbeat a network message, and each data migration a transfer between hosts. The logic deciding *which* nodes, *which* keys, and *when* to act is the same either way.

So when you read `target.set(key, value, ttl)` in the rebalancer, picture a network call. The interesting decisions all live above that line.

## Architecture

Four pieces, each with one job:

```
Coordinator ── owns the ring, the nodes, and the failure detector.
   │           Routes reads/writes, orchestrates replication and rebalancing.
   │
   ├── HashRing ──────── pure placement math. Given a key, which N node IDs own it?
   │                     Consistent hashing over a 32-bit ring with virtual nodes.
   │
   ├── CacheNode ──────── a single node's local store. get/set/delete plus TTL,
   │                      with both lazy and active (swept) expiry.
   │
   └── FailureDetector ── tracks liveness via heartbeats. alive → suspected → dead,
                          and calls back to the coordinator when a node dies.
```

The separation is the design. `HashRing` knows nothing about storage — it just answers "which nodes." `CacheNode` knows nothing about the cluster — it's a TTL map. `FailureDetector` knows nothing about caching — it tracks heartbeats and fires an `onDead` callback. The `Coordinator` is the only piece that knows about all of them, and it's where the orchestration lives. Each lower layer is unit-tested in complete isolation.

### How a read heals around a dead node

1. `get(key)` asks the ring for the key's replica set — say `[A, B, C]`.
2. It tries each in order and returns the first hit.
3. If A is dead, B still has the data. The read succeeds anyway.
4. Meanwhile, the failure detector has stopped hearing A's heartbeats. After a suspicion window (to avoid evicting a merely-slow node), it declares A dead.
5. That fires `onDead(A)` → `removeNode(A)` → the ring drops A → the rebalancer rebuilds A's replicas on a surviving node.
6. The key is back to N copies. The cluster healed itself.

## Design decisions worth explaining

A few choices that aren't obvious, and why they're the way they are.

**Virtual nodes.** Each physical node is placed at ~150 points around the ring, not one. Without this, load is lumpy (some nodes own huge arcs) and a node's death dumps its entire load onto a single neighbor. With virtual nodes, load spreads evenly and a failure disperses across many nodes.

**A binary search with wraparound** powers every lookup. The ring is a sorted array of points; finding a key's owner is a lower-bound search for the first point ≥ the key's hash, wrapping to the start if the key hashes past the last point. It's O(log n) per read, and getting the wrap case right is where the subtle bugs hide.

**Two expiry mechanisms, not one.** Lazy expiry (checking TTL on every read) guarantees you never serve stale data, but it leaks memory — a key that expires and is never read again sits there forever. The background sweeper reclaims those cold keys. Neither alone is sufficient: lazy leaks memory, sweep-only serves stale data between sweeps. Together they cover both.

**A suspicion state before death.** The failure detector doesn't jump straight from "alive" to "dead." A node that's merely slow — a GC pause, a brief hiccup — shouldn't be evicted, because eviction is expensive (a full rebalance and data migration). The `suspected` state is a grace window: "I haven't heard from you and I'm worried, but I'll give you until the dead timeout to prove you're alive." A single heartbeat during suspicion snaps the node back to alive. This is the difference between a detector that's robust and one that's trigger-happy.

**Rebalancing preserves remaining TTL.** When a key migrates to a new node, it arrives with its *remaining* lifetime, not a fresh one. A key set for 60 seconds that's already lived 40 shows up on the new node with ~20 left. Without this, keys could become effectively immortal, resurrected to full life every time the cluster reshuffled.

## Known limitations

Being straight about where this stops:

- **The rebalance scan is O(total keys).** When a node joins or leaves, the coordinator walks every key on every node. A production system would scope the work to just the affected range of the ring rather than scanning everything. The placement logic is correct; the trigger is brute-force.
- **Failure detection is centralized.** The coordinator runs one detector for the whole cluster, which makes it a single point of failure. The genuinely decentralized version — each node gossiping its view of everyone's health, SWIM-style — is a natural next layer. This builds the detection state machine first; distributing it is future work.
- **No persistence.** It's a cache, so this is by design — everything is in memory and gone on restart.
- **Single process.** As covered above: real logic, simulated transport.

## Getting started

Requires Node.js 18+ (for the built-in test runner and native ESM).

```bash
git clone <repo-url>
cd self-healing-cache
npm test        # runs the full suite — 50 tests, no dependencies
```

There are no runtime dependencies. The whole thing is standard-library Node.

### Using it

```javascript
import { Coordinator } from './src/core/Coordinator.js';

const cache = new Coordinator({ replicationFactor: 3, defaultTtl: 60000 });

cache.addNode('node-A');
cache.addNode('node-B');
cache.addNode('node-C');

cache.set('user:42', { name: 'Ada' });
cache.get('user:42');        // → { name: 'Ada' }

// simulate losing a node — the data survives on its replicas
cache.removeNode('node-A');
cache.get('user:42');        // → { name: 'Ada' }  (still there, re-replicated)

cache.stop();                // clean shutdown of all timers
```

## Tests

Every layer has its own suite, and the coverage is the argument that this actually works:

| Suite | What it proves |
|---|---|
| `HashRing` | Keys distribute evenly; removing a node moves *only* that node's keys (the stability guarantee that defines consistent hashing). |
| `CacheNode` | Storage, overwrites, and both expiry paths — including a cold key that only the sweeper can reclaim. |
| `Coordinator` | Reads and writes route correctly; a key physically lands on exactly its replica set; removing a replica heals. |
| `rebalance` | The core invariant holds through joins, leaves, and repeated churn, with no data loss and TTL preserved. |
| `FailureDetector` | The full state machine: alive, suspected, recovery-via-heartbeat, death firing `onDead` exactly once, and simultaneous failures. |

Run them all with `npm test`. A few are timing-based (they exercise real TTL and heartbeat timeouts), so they use short, loosely-bounded intervals to stay fast and stable.

## How it was built

The system came together in stages, each usable before the next began:

1. **HashRing** — consistent hashing with virtual nodes.
2. **CacheNode** — per-node storage with TTL.
3. **Coordinator** — routing keys to nodes.
4. **Replication** — N copies per key; survives node loss.
5. **Rebalancing** — restore replicas on leave, migrate and shed on join.
6. **Failure detection** — heartbeats and suspicion, closing the loop so the cluster heals without a human.

Each stage kept the previous ones' tests green — and when a later stage deliberately changed behavior (replication making "removing a node loses data" obsolete), the test that encoded the old behavior was flipped to assert the new, better one. Those flips are a record of the system growing up.
