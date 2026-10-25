export class MemoryStore {
  constructor() { this.entries = new Map(); this.sequence = 0; }
  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { data: structuredClone(entry.value), etag: entry.etag, metadata: {} } : null;
  }
  async setJSON(key, value, options = {}) {
    const existing = this.entries.get(key);
    if (options.onlyIfNew && existing) return { modified: false };
    if (options.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = `"memory-${++this.sequence}"`;
    this.entries.set(key, { value: structuredClone(value), etag });
    return { modified: true, etag };
  }
  async delete(key) { this.entries.delete(key); }
  async list() { return { blobs: [...this.entries].map(([key, value]) => ({ key, etag: value.etag })) }; }
}
