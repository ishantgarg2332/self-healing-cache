export class FailureDetector {
    constructor({ suspectTimeout = 3000, deadTimeout = 6000, checkInterval = 1000, onDead } = {}) {
        this.suspectTimeout = suspectTimeout;
        this.deadTimeout = deadTimeout;
        this.checkInterval = checkInterval;
        this.onDead = onDead;
        this.health = new Map();
    }

    register(nodeId) {
        return this.health.set(nodeId, { state: 'alive', lastHeartbeat: Date.now() });
    }

    unregister(nodeId) {
        return this.health.delete(nodeId);
    }

    heartbeat(nodeId) {
        const node = this.health.get(nodeId);
        if(node) {
            node.lastHeartbeat = Date.now();
            if(node.state === 'suspected') {
                node.state = 'alive';
            }
            return true;
        }
        return false;
    }

    check() {
        const now = Date.now();
        const dead = [];
        for (const [nodeId, record] of this.health) {
            const silence = now - record.lastHeartbeat;
            if (silence >= this.deadTimeout) {
                dead.push(nodeId);
            } else if (silence >= this.suspectTimeout) {
                record.state = 'suspected';
            } else {
                record.state = 'alive';
            }
        }

        for (const nodeId of dead) {
            this.health.delete(nodeId);
            this.onDead?.(nodeId);
        }
    }

    start() {
        this.timer = setInterval(() => this.check(), this.checkInterval);
        this.timer.unref();
        return this;
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
