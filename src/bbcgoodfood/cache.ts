/**
 * A small in-memory store, keyed by the address that produced the value.
 *
 * It exists to keep a conversation that asks the same thing twice from asking
 * the site twice. Entries expire, the store is bounded, and it holds only
 * what was successfully read: storing a response nobody could parse would serve
 * that failure back for the rest of its lifetime.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-inserting marks it as the most recently used, which is what the
    // eviction below reads.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // A lifetime of zero turns the store off rather than expiring at once:
    // nothing is written, so nothing has to be checked on the way out.
    if (this.ttlMs <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Walked in insertion order, which `get` refreshes, so the first keys are
    // the least recently used. The walk stops as soon as the store fits.
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
