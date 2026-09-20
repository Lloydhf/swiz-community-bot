const { randomUUID } = require('node:crypto');
class KeyedLock {
  constructor() { this.pending = new Map(); }
  async run(key, task) {
    const previous = this.pending.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.pending.set(key, current);
    try { return await current; }
    finally { if (this.pending.get(key) === current) this.pending.delete(key); }
  }
}
const makeId = () => randomUUID().replaceAll('-', '');
const clip = (text, max = 1024) => String(text || '—').slice(0, max);
module.exports = { KeyedLock, makeId, clip };
