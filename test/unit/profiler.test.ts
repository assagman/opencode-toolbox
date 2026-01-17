import { test, expect, describe, beforeEach } from "bun:test";
import { Profiler, globalProfiler } from "../../src/profiler";

describe("Profiler", () => {
  let profiler: Profiler;

  beforeEach(() => {
    profiler = new Profiler();
  });

  describe("mark and measure", () => {
    test("mark() stores timestamp", () => {
      profiler.mark("test-mark");
      // Measure should work after mark
      const duration = profiler.measure("test-measure", "test-mark");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    test("measure() returns -1 for missing mark", () => {
      const duration = profiler.measure("test-measure", "nonexistent");
      expect(duration).toBe(-1);
    });

    test("measure() calculates duration correctly", async () => {
      profiler.mark("start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = profiler.measure("elapsed", "start");
      expect(duration).toBeGreaterThanOrEqual(9);
      expect(duration).toBeLessThan(100);
    });

    test("measure() stores measurement for later retrieval", () => {
      profiler.mark("m1");
      profiler.measure("duration", "m1");
      const stats = profiler.getStats("duration");
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
    });
  });

  describe("record", () => {
    test("record() adds direct measurement", () => {
      profiler.record("direct", 100);
      profiler.record("direct", 200);
      const stats = profiler.getStats("direct");
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(2);
      expect(stats!.min).toBe(100);
      expect(stats!.max).toBe(200);
    });
  });

  describe("getStats", () => {
    test("getStats() returns null for unknown metric", () => {
      const stats = profiler.getStats("unknown");
      expect(stats).toBeNull();
    });

    test("getStats() calculates min/max/avg correctly", () => {
      profiler.record("test", 10);
      profiler.record("test", 20);
      profiler.record("test", 30);
      const stats = profiler.getStats("test");
      expect(stats).not.toBeNull();
      expect(stats!.min).toBe(10);
      expect(stats!.max).toBe(30);
      expect(stats!.avg).toBe(20);
      expect(stats!.total).toBe(60);
    });

    test("getStats() calculates percentiles", () => {
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        profiler.record("perc", i);
      }
      const stats = profiler.getStats("perc");
      expect(stats).not.toBeNull();
      expect(stats!.p50).toBe(50);
      expect(stats!.p95).toBe(95);
      expect(stats!.p99).toBe(99);
    });

    test("percentile handles empty array", () => {
      // This is covered by the calculateStats null return for empty
      const stats = profiler.getStats("empty");
      expect(stats).toBeNull();
    });

    test("percentile handles single element", () => {
      profiler.record("single", 42);
      const stats = profiler.getStats("single");
      expect(stats).not.toBeNull();
      expect(stats!.p50).toBe(42);
      expect(stats!.p95).toBe(42);
      expect(stats!.p99).toBe(42);
    });
  });

  describe("initialization tracking", () => {
    test("initStart() sets state to initializing", () => {
      expect(profiler.getInitState()).toBe("idle");
      profiler.initStart();
      expect(profiler.getInitState()).toBe("initializing");
    });

    test("initComplete() sets final state", () => {
      profiler.initStart();
      profiler.initComplete("ready");
      expect(profiler.getInitState()).toBe("ready");
    });

    test("initComplete() with degraded state", () => {
      profiler.initStart();
      profiler.initComplete("degraded");
      expect(profiler.getInitState()).toBe("degraded");
    });

    test("initComplete() with partial state", () => {
      profiler.initStart();
      profiler.initComplete("partial");
      expect(profiler.getInitState()).toBe("partial");
    });

    test("getInitDuration() returns null before init", () => {
      expect(profiler.getInitDuration()).toBeNull();
    });

    test("getInitDuration() returns ongoing duration during init", async () => {
      profiler.initStart();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = profiler.getInitDuration();
      expect(duration).not.toBeNull();
      expect(duration!).toBeGreaterThanOrEqual(9);
    });

    test("getInitDuration() returns final duration after init", async () => {
      profiler.initStart();
      await new Promise((resolve) => setTimeout(resolve, 10));
      profiler.initComplete("ready");
      const duration = profiler.getInitDuration();
      expect(duration).not.toBeNull();
      expect(duration!).toBeGreaterThanOrEqual(9);
    });
  });

  describe("server metrics", () => {
    test("recordServerConnect stores connected metrics", () => {
      profiler.recordServerConnect("server1", 100, 5, "connected");
      const report = profiler.export();
      expect(report.initialization.servers).toHaveLength(1);
      expect(report.initialization.servers[0]).toEqual({
        name: "server1",
        connectTime: 100,
        toolCount: 5,
        status: "connected",
        error: undefined,
      });
    });

    test("recordServerConnect stores error metrics", () => {
      profiler.recordServerConnect("server2", -1, 0, "error", "Connection failed");
      const report = profiler.export();
      const server = report.initialization.servers.find((s) => s.name === "server2");
      expect(server).toBeDefined();
      expect(server!.status).toBe("error");
      expect(server!.error).toBe("Connection failed");
    });
  });

  describe("indexing metrics", () => {
    test("recordIndexBuild stores build time and count", () => {
      profiler.recordIndexBuild(50, 100);
      const report = profiler.export();
      expect(report.indexing.buildTime).toBe(50);
      expect(report.indexing.toolCount).toBe(100);
    });

    test("recordIncrementalUpdate increments counter and tool count", () => {
      profiler.recordIncrementalUpdate(10);
      profiler.recordIncrementalUpdate(5);
      const report = profiler.export();
      expect(report.indexing.incrementalUpdates).toBe(2);
      expect(report.indexing.toolCount).toBe(15);
    });
  });

  describe("export", () => {
    test("export() returns full report structure", () => {
      profiler.initStart();
      profiler.recordServerConnect("test", 100, 3, "connected");
      profiler.recordIndexBuild(20, 10);
      profiler.record("search.bm25", 5);
      profiler.record("search.regex", 3);
      profiler.record("tool.execute", 50);
      profiler.initComplete("ready");

      const report = profiler.export();

      expect(report.timestamp).toBeDefined();
      expect(typeof report.uptime).toBe("number");
      expect(report.initialization.state).toBe("ready");
      expect(report.initialization.duration).not.toBeNull();
      expect(report.indexing.buildTime).toBe(20);
      expect(report.searches.bm25).not.toBeNull();
      expect(report.searches.regex).not.toBeNull();
      expect(report.executions).not.toBeNull();
    });

    test("export() handles no searches/executions", () => {
      const report = profiler.export();
      expect(report.searches.bm25).toBeNull();
      expect(report.searches.regex).toBeNull();
      expect(report.executions).toBeNull();
    });
  });

  describe("reset", () => {
    test("reset() clears all state", () => {
      profiler.mark("test");
      profiler.record("metric", 100);
      profiler.recordServerConnect("srv", 50, 2, "connected");
      profiler.initStart();
      profiler.initComplete("ready");
      profiler.recordIndexBuild(10, 5);
      profiler.recordIncrementalUpdate(3);

      profiler.reset();

      expect(profiler.getInitState()).toBe("idle");
      expect(profiler.getInitDuration()).toBeNull();
      expect(profiler.getStats("metric")).toBeNull();

      const report = profiler.export();
      expect(report.initialization.servers).toHaveLength(0);
      expect(report.indexing.buildTime).toBeNull();
      expect(report.indexing.toolCount).toBe(0);
      expect(report.indexing.incrementalUpdates).toBe(0);
    });
  });

  describe("startTimer", () => {
    test("startTimer() returns function that records duration", async () => {
      const done = profiler.startTimer("timed-op");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = done();

      expect(duration).toBeGreaterThanOrEqual(9);

      const stats = profiler.getStats("timed-op");
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
      expect(stats!.min).toBeGreaterThanOrEqual(9);
    });

    test("startTimer() can be called multiple times", () => {
      const done1 = profiler.startTimer("multi");
      const done2 = profiler.startTimer("multi");
      done1();
      done2();

      const stats = profiler.getStats("multi");
      expect(stats!.count).toBe(2);
    });
  });
});

describe("globalProfiler", () => {
  test("globalProfiler is a Profiler instance", () => {
    expect(globalProfiler).toBeInstanceOf(Profiler);
  });

  test("globalProfiler can record metrics", () => {
    // Just verify it works - don't pollute global state too much
    const timer = globalProfiler.startTimer("global-test");
    timer();
    // If we get here without error, it works
    expect(true).toBe(true);
  });
});
