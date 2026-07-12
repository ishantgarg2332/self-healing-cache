export class CacheNode {
    constructor(id, { defaultTtl = 60000, sweepInterval = 30000 } = {}) {
        this.id = id;
        this.store = new Map();
        this.defaultTtl = defaultTtl;
        this.sweepInterval = sweepInterval;
    }

    set(key, value, ttl = this.defaultTtl) {
        const now = Date.now();
        const expiresAt = now + ttl;

        this.store.set(key, { value, expiresAt });
    }

    #liveEntry(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.delete(key);
            return null;
        }
        return entry;
    }

    get(key) {
        const entry = this.#liveEntry(key);
        return entry ? entry.value : null;
    }

    has(key) {
        return this.#liveEntry(key) !== null;
    }

    delete(key) {
        return this.store.delete(key);
    }

    sweep() {
        const now = Date.now();

        for(let [key, value] of this.store) {
            if(value.expiresAt <= now) {
                this.store.delete(key);
            }
        }

        return true;
    }

    start() {
        this.timer = setInterval(() => this.sweep(), this.sweepInterval);
        this.timer.unref();
        return this;
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    entries() {
        const now = Date.now();
        const result = [];
        for (const [key, entry] of this.store) {
            if (entry.expiresAt <= now) continue;
            result.push({
                key,
                value: entry.value,
                ttl: entry.expiresAt - now,
            });
        }
        return result;
    }
}
