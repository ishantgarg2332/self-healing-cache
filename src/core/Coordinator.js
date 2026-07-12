import { HashRing } from './HashRing.js';
import { CacheNode } from './CacheNode.js';
import { FailureDetector } from '../cluster/FailureDetector.js';

export class Coordinator {
  constructor({
    virtualNodes = 150,
    replicationFactor = 3,
    defaultTtl,
    sweepInterval,
    suspectTimeout,
    deadTimeout,
    checkInterval,
  } = {}) {
    this.ring = new HashRing(virtualNodes);
    this.nodes = new Map();
    this.replicationFactor = replicationFactor;
    this.nodeOptions = { defaultTtl, sweepInterval };

    this.detector = new FailureDetector({
      suspectTimeout,
      deadTimeout,
      checkInterval,
      onDead: (nodeId) => this.removeNode(nodeId),
    });
    this.detector.start();
  }

  #nodesFor(key) {
    const ids = this.ring.getNodes(key, this.replicationFactor);
    return ids.map((id) => this.nodes.get(id));
  }

  #rebalanceAfterLeave() {
    for (const [_, node] of this.nodes) {
      for (const { key, value, ttl } of node.entries()) {
        const targets = this.#nodesFor(key);
        for (const target of targets) {
          if (!target.store.has(key)) {
            target.set(key, value, ttl);
          }
        }
      }
    }
  }

  #rebalanceAfterJoin() {
    for (const [id, node] of this.nodes) {
      for (const { key, value, ttl } of node.entries()) {
        const targetIds = new Set(
          this.ring.getNodes(key, this.replicationFactor)
        );

        for (const targetId of targetIds) {
          const target = this.nodes.get(targetId);
          if (!target.store.has(key)) target.set(key, value, ttl);
        }

        if (!targetIds.has(id)) {
          node.delete(key);
        }
      }
    }
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    const node = new CacheNode(nodeId, this.nodeOptions).start();
    this.nodes.set(nodeId, node);
    this.ring.addNode(nodeId);
    this.#rebalanceAfterJoin();
    this.detector.register(nodeId);
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    const node = this.nodes.get(nodeId);
    node.stop();
    this.nodes.delete(nodeId);
    this.ring.removeNode(nodeId);
    this.#rebalanceAfterLeave();
    this.detector.unregister(nodeId);
  }

  set(key, value, ttl) {
    const nodes = this.#nodesFor(key);
    if (nodes.length === 0) return false;
    for (const node of nodes) node.set(key, value, ttl);
    return true;
  }

  get(key) {
    const nodes = this.#nodesFor(key);
    for (const node of nodes) {
      const value = node.get(key);
      if (value !== null) return value;
    }
    return null;
  }

  delete(key) {
    const nodes = this.#nodesFor(key);
    let deleted = false;
    for (let node of nodes) {
      if (node.delete(key)) deleted = true;
    }
    return deleted;
  }

  heartbeat(nodeId) {
    return this.detector.heartbeat(nodeId);
  }

  stop() {
    this.detector.stop();
    for (const node of this.nodes.values()) node.stop();
  }
}
