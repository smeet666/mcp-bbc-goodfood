import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, sleep } from "../../src/bbcgoodfood/rateLimiter.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Settles pending microtasks without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("sleep", () => {
  it("resolves once the delay has run", async () => {
    let done = false;
    const pending = sleep(500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await pending;
  });
});

describe("currentIntervalMs", () => {
  it("starts at the interval it was built with", () => {
    expect(new RateLimiter({ intervalMs: 1500 }).currentIntervalMs).toBe(1500);
    expect(new RateLimiter({ intervalMs: 1000, maxIntervalMs: 4000 }).currentIntervalMs).toBe(1000);
  });
});

describe("schedule", () => {
  it("runs tasks one after another, never overlapping", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;

    const first = limiter.schedule(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      return "first";
    });
    const second = limiter.schedule(async () => {
      events.push("second:start");
      return "second";
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("a failing task does not block the next one", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    const failing = limiter.schedule(async () => {
      throw new Error("boom");
    });
    const next = limiter.schedule(async () => "ok");

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("hands back the value of the task", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    const result = limiter.schedule(async () => 42);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBe(42);
  });
});

describe("beforeRequest", () => {
  it("returns at once when nothing came before", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    let done = false;
    const pending = limiter.beforeRequest().then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(true);
    await pending;
  });

  it("waits the whole interval from the start of the previous request", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    await limiter.beforeRequest();

    let done = false;
    const pending = limiter.beforeRequest().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await pending;
  });

  it("waits only the balance of the interval already elapsed", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    await limiter.beforeRequest();
    await vi.advanceTimersByTimeAsync(400);

    let done = false;
    const pending = limiter.beforeRequest().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await pending;
  });

  it("returns at once when the interval has already run out", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    await limiter.beforeRequest();
    await vi.advanceTimersByTimeAsync(5000);

    let done = false;
    const pending = limiter.beforeRequest().then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(true);
    await pending;
  });

  it("waits the widened interval after a pushBack", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    await limiter.beforeRequest();
    limiter.pushBack();

    let done = false;
    const pending = limiter.beforeRequest().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await pending;
  });
});

describe("pushBack", () => {
  it("doubles the interval", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(2000);
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(4000);
  });

  it("stops at sixteen times the interval by default", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    for (let i = 0; i < 10; i += 1) {
      limiter.pushBack();
    }
    expect(limiter.currentIntervalMs).toBe(16_000);
  });

  it("stops at the ceiling the caller gave", () => {
    const limiter = new RateLimiter({ intervalMs: 1000, maxIntervalMs: 2500 });
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(2000);
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(2500);
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(2500);
  });
});

describe("succeeded", () => {
  it("changes nothing while the interval is the starting one", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    limiter.succeeded();
    limiter.succeeded();
    limiter.succeeded();
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(1000);
  });

  it("halves the interval after three consecutive successes", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    limiter.pushBack();
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(4000);
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(4000);
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(4000);
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(2000);
  });

  it("never goes below the starting interval", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    limiter.pushBack();
    for (let i = 0; i < 12; i += 1) {
      limiter.succeeded();
    }
    expect(limiter.currentIntervalMs).toBe(1000);
  });

  it("a pushBack puts the count of successes back to zero", () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    limiter.pushBack();
    limiter.succeeded();
    limiter.succeeded();
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(4000);
    limiter.succeeded();
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(4000);
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(2000);
  });
});
