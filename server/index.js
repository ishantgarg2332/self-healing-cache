import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Coordinator } from '../src/core/Coordinator.js';
import { hashKey } from '../src/utils/hash.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RF = 3;
const cache = new Coordinator({
  replicationFactor: RF,
  defaultTtl: 600000,
  suspectTimeout: 2500,
  deadTimeout: 5000,
  checkInterval: 700,
});

const knownKeys = new Map();

const heartbeaters = new Map();
function startHeartbeat(id) {
  stopHeartbeat(id);
  heartbeaters.set(id, setInterval(() => cache.heartbeat(id), 400));
}
function stopHeartbeat(id) {
  const h = heartbeaters.get(id);
  if (h) { clearInterval(h); heartbeaters.delete(id); }
}

cache.onNodeDied = (id) => stopHeartbeat(id);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/state', (req, res) => {
  const nodes = [...cache.nodes.keys()].map((id) => {
    const node = cache.nodes.get(id);
    const health = cache.detector.health.get(id);
    let heldKeys = 0;
    for (const key of knownKeys.keys()) if (node.store.has(key)) heldKeys++;
    return {
      id,
      state: health?.state ?? 'alive',
      heldKeys,
      ringPoint: firstPoint(id),
    };
  });

  const keys = [...knownKeys.keys()].map((key) => {
    const owners = cache.ring.getNodes(key, RF);
    let replicaCount = 0;
    for (const [, node] of cache.nodes) if (node.store.has(key)) replicaCount++;
    return { key, ringPoint: pointOf(key), primary: owners[0] ?? null, replicaCount };
  });

  res.json({
    replicationFactor: RF,
    ringMax: 4294967296,
    nodes,
    keys,
  });
});

app.post('/api/nodes', (req, res) => {
  const id = (req.body?.id || nextNodeName()).toString();
  if (cache.nodes.has(id)) return res.status(409).json({ error: `node ${id} already exists` });
  cache.addNode(id);
  startHeartbeat(id);
  res.status(201).json({ id });
});

app.delete('/api/nodes/:id', (req, res) => {
  const { id } = req.params;
  if (!cache.nodes.has(id)) return res.status(404).json({ error: `no node ${id}` });
  stopHeartbeat(id);
  cache.removeNode(id);
  res.json({ removed: id });
});

app.post('/api/nodes/:id/kill', (req, res) => {
  const { id } = req.params;
  if (!cache.nodes.has(id)) return res.status(404).json({ error: `no node ${id}` });
  stopHeartbeat(id);
  res.json({ killed: id, note: 'heartbeats stopped; detector will heal' });
});

app.post('/api/keys', (req, res) => {
  const { key, value } = req.body ?? {};
  if (!key) return res.status(400).json({ error: 'key is required' });
  const ok = cache.set(key, value ?? '');
  if (!ok) return res.status(503).json({ error: 'no nodes available' });
  knownKeys.set(key, value ?? '');
  res.status(201).json({ key, value: value ?? '' });
});

app.get('/api/keys/:key', (req, res) => {
  const value = cache.get(req.params.key);
  if (value === null) return res.status(404).json({ error: 'not found' });
  res.json({ key: req.params.key, value });
});

app.delete('/api/keys/:key', (req, res) => {
  const removed = cache.delete(req.params.key);
  knownKeys.delete(req.params.key);
  res.json({ key: req.params.key, removed });
});

app.post('/api/seed', (req, res) => {
  const words = ['user', 'order', 'cart', 'session', 'token', 'post', 'like', 'view', 'flag', 'cache'];
  const n = Math.min(Number(req.body?.count) || 20, 200);
  for (let i = 0; i < n; i++) {
    const key = words[(Math.random() * words.length) | 0] + ':' + ((Math.random() * 1000) | 0);
    cache.set(key, (Math.random() * 10000) | 0);
    knownKeys.set(key, '');
  }
  res.json({ seeded: n });
});

function pointOf(str) { return hashKey(str); }
function firstPoint(id) { return hashKey(`${id}#0`); }

let nodeSeq = 0;
const NODE_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
function nextNodeName() {
  const base = NODE_NAMES[nodeSeq % NODE_NAMES.length];
  const suffix = nodeSeq >= NODE_NAMES.length ? '-' + Math.floor(nodeSeq / NODE_NAMES.length) : '';
  nodeSeq++;
  return base + suffix;
}

for (let i = 0; i < 3; i++) {
  const id = nextNodeName();
  cache.addNode(id);
  startHeartbeat(id);
}
{
  const words = ['user', 'order', 'cart', 'session', 'token', 'post'];
  for (let i = 0; i < 15; i++) {
    const key = words[(Math.random() * words.length) | 0] + ':' + ((Math.random() * 1000) | 0);
    cache.set(key, (Math.random() * 10000) | 0);
    knownKeys.set(key, '');
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`self-healing cache server on http://localhost:${PORT}`);
});
