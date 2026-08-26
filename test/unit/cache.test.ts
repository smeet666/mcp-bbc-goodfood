import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../../src/bbcgoodfood/cache.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Cache", () => {
  it("returns undefined for a key it never held", () => {
    const cache = new Cache<string>(1000, 10);
    expect(cache.get("absent")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("reads back a value that was written", () => {
    const cache = new Cache<string>(1000, 10);
    cache.set("a", "one");
    expect(cache.get("a")).toBe("one");
    expect(cache.size).toBe(1);
  });

  it("keeps an entry while its lifetime runs", async () => {
    const cache = new Cache<number>(1000, 10);
    cache.set("a", 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(cache.get("a")).toBe(1);
  });

  it("drops an expired entry and shrinks with it", async () => {
    const cache = new Cache<number>(1000, 10);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
    await vi.advanceTimersByTimeAsync(1001);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("a zero lifetime turns the store off", () => {
    const cache = new Cache<number>(0, 10);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("a negative lifetime turns the store off", () => {
    const cache = new Cache<number>(-1, 10);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry past maxEntries", () => {
    const cache = new Cache<number>(10_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("a read shelters the oldest entry from the next eviction", () => {
    const cache = new Cache<number>(10_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("rewriting a key keeps a single entry", () => {
    const cache = new Cache<string>(10_000, 2);
    cache.set("a", "one");
    cache.set("a", "two");
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe("two");
  });

  it("rewriting a key does not evict another one", () => {
    const cache = new Cache<string>(10_000, 2);
    cache.set("a", "one");
    cache.set("b", "two");
    cache.set("a", "three");
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe("three");
    expect(cache.get("b")).toBe("two");
  });

  it("holds a single entry when maxEntries is one", () => {
    const cache = new Cache<number>(10_000, 1);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });
});

describe("Cache under both pressures", () => {
  it("an entry that expired frees its place before the next eviction", async () => {
    const cache = new Cache<number>(1000, 2);
    cache.set("a", 1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(cache.get("a")).toBeUndefined();
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("writing the same key over and over holds a single place", () => {
    const cache = new Cache<number>(10_000, 2);
    for (let i = 0; i < 5; i += 1) {
      cache.set("a", i);
    }
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(4);
  });

  it("a read of an expired entry leaves the store usable", async () => {
    const cache = new Cache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    await vi.advanceTimersByTimeAsync(1001);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    cache.set("c", 3);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(1);
  });
});
