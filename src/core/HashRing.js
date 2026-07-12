import { hashKey } from '../utils/hash.js';

class HashRing {
    constructor(virtualNodes = 150) {
        this.virtualNodes = virtualNodes;
        this.ring = [];
        this.map = new Map();
        this.nodes = new Set();
    }

    addNode(node) {
        if(this.nodes.has(node)) return;

        for(let i = 0; i < this.virtualNodes; ++i) {
            const point = hashKey(`${node}#${i}`);
            this.ring.push(point);
            this.map.set(point, node);
        }

        this.nodes.add(node);
        this.ring.sort((a, b) => a - b);
    }

    removeNode(node) {
        if(!this.nodes.has(node)) return;

        for(let i = 0; i < this.virtualNodes; ++i) {
            const point = hashKey(`${node}#${i}`);
            const index = this.ring.indexOf(point);
            if(index !== -1) {
                this.ring.splice(index, 1);
                this.map.delete(point);
            }
        }

        this.nodes.delete(node);
    }

    getNode(key) {
        if(this.ring.length === 0) return null;

        const hash = hashKey(key);
        let low = 0, high = this.ring.length;

        while(low < high) {
            const mid = (low + high) >>> 1;
            if(this.ring[mid] < hash) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        const index = low === this.ring.length ? 0 : low;
        return this.map.get(this.ring[index]);
    }

    getNodes(key, count) {
        if (this.ring.length === 0) return [];
        const hash = hashKey(key);

        let low = 0, high = this.ring.length;

        while(low < high) {
            const mid = (low + high) >>> 1;
            if(this.ring[mid] < hash) {
                low = mid + 1;
            }else{
                high = mid;
            }
        }

        const start = low === this.ring.length ? 0 : low;

        const seen = new Set();

        for(let i = 0; i < this.ring.length; ++i) {
            const idx = (start + i) % this.ring.length;
            const point = this.ring[idx];
            const owner = this.map.get(point);
            seen.add(owner);
            if(seen.size === count) break;
        }

        return [...seen];
    }
}

export { HashRing };
