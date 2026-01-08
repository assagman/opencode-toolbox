/**
 * Initialization Performance Benchmarks
 * Tests cold start, server connection, and progressive loading
 */

import { MCPManager, FakeMCPClient, FakeTools } from "../src/mcp-client";
import { BM25Index } from "../src/search";
import { Profiler } from "../src/profiler";
import { generateMockTools, runBenchmarks, benchmark } from "./utils";

async function main() {
  console.log("\n🚀 Initialization Performance Benchmarks\n");

  // Cold start simulation with fake clients
  console.log("\n📊 Cold Start (Fake MCP Servers)\n");

  await runBenchmarks(
    [
      {
        name: "Initialize 1 server (2 tools)",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
          });
          await manager.initialize({ time: { type: "local" } });
          await manager.closeAll();
        },
      },
      {
        name: "Initialize 3 servers (6 tools)",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: (name) => {
              if (name === "time") return new FakeMCPClient({ tools: FakeTools.time });
              if (name === "search") return new FakeMCPClient({ tools: FakeTools.search });
              return new FakeMCPClient({ tools: FakeTools.calculator });
            },
          });
          await manager.initialize({
            time: { type: "local" },
            search: { type: "local" },
            calculator: { type: "local" },
          });
          await manager.closeAll();
        },
      },
      {
        name: "Initialize 10 servers (20 tools)",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
          });
          const servers: Record<string, { type: "local" }> = {};
          for (let i = 0; i < 10; i++) {
            servers[`server${i}`] = { type: "local" };
          }
          await manager.initialize(servers);
          await manager.closeAll();
        },
      },
    ],
    { warmup: 5, iterations: 50 }
  );

  // Progressive loading benchmark
  console.log("\n📊 Progressive Loading (Background Init)\n");

  await runBenchmarks(
    [
      {
        name: "Background init + immediate query",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
          });
          const bm25 = new BM25Index();
          
          // Set up progressive loading
          manager.on("server:connected", (_, tools) => {
            bm25.addToolsBatch(tools);
          });
          
          // Start background init
          manager.initializeBackground({
            time: { type: "local" },
            search: { type: "local" },
          });
          
          // Wait for partial readiness
          await manager.waitForPartial();
          
          // Query immediately
          bm25.search("time", 5);
          
          await manager.closeAll();
        },
      },
      {
        name: "Full init then query (baseline)",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
          });
          
          await manager.initialize({
            time: { type: "local" },
            search: { type: "local" },
          });
          
          const bm25 = new BM25Index();
          bm25.indexTools(manager.getAllCatalogTools());
          bm25.search("time", 5);
          
          await manager.closeAll();
        },
      },
    ],
    { warmup: 5, iterations: 30 }
  );

  // Measure time to first search
  console.log("\n📊 Time to First Search\n");

  const ttfsResults = await Promise.all([
    measureTimeToFirstSearch(1),
    measureTimeToFirstSearch(3),
    measureTimeToFirstSearch(5),
    measureTimeToFirstSearch(10),
  ]);

  console.log("\nTime to First Search Results:");
  console.log("━".repeat(50));
  for (const result of ttfsResults) {
    console.log(
      `${result.servers} servers: ${result.ttfs.toFixed(2)}ms ` +
      `(init: ${result.initTime.toFixed(2)}ms, search: ${result.searchTime.toFixed(2)}ms)`
    );
  }
  console.log("━".repeat(50));

  // Connection retry simulation
  console.log("\n📊 Connection Retry Performance\n");

  await runBenchmarks(
    [
      {
        name: "1 retry on failure",
        fn: async () => {
          let attempts = 0;
          const manager = new MCPManager({
            clientFactory: () => {
              attempts++;
              if (attempts % 2 === 1) {
                return new FakeMCPClient({
                  tools: [],
                  failConnect: true,
                  errorMessage: "Simulated failure",
                });
              }
              return new FakeMCPClient({ tools: FakeTools.time });
            },
            connectionConfig: {
              connectTimeout: 1000,
              requestTimeout: 5000,
              retryAttempts: 1,
              retryDelay: 10, // Fast retry for benchmark
            },
          });
          
          await manager.initialize({ time: { type: "local" } });
          await manager.closeAll();
        },
      },
      {
        name: "No retry (fail fast)",
        fn: async () => {
          const manager = new MCPManager({
            clientFactory: () => new FakeMCPClient({
              tools: [],
              failConnect: true,
              errorMessage: "Simulated failure",
            }),
            connectionConfig: {
              connectTimeout: 1000,
              requestTimeout: 5000,
              retryAttempts: 0,
              retryDelay: 0,
            },
          });
          
          await manager.initialize({ time: { type: "local" } });
          await manager.closeAll();
        },
      },
    ],
    { warmup: 3, iterations: 20 }
  );

  console.log("\n✅ Initialization benchmarks complete!\n");
}

/**
 * Measure time from init start to first search result
 */
async function measureTimeToFirstSearch(serverCount: number): Promise<{
  servers: number;
  ttfs: number;
  initTime: number;
  searchTime: number;
}> {
  const iterations = 10;
  let totalTtfs = 0;
  let totalInit = 0;
  let totalSearch = 0;

  for (let i = 0; i < iterations; i++) {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });
    const bm25 = new BM25Index();

    manager.on("server:connected", (_, tools) => {
      bm25.addToolsBatch(tools);
    });

    const startTime = performance.now();

    // Start background init
    manager.initializeBackground(
      Object.fromEntries(
        Array.from({ length: serverCount }, (_, i) => [`server${i}`, { type: "local" as const }])
      )
    );

    // Wait for partial readiness
    await manager.waitForPartial();
    const initDone = performance.now();

    // First search
    bm25.search("time", 5);
    const searchDone = performance.now();

    totalTtfs += searchDone - startTime;
    totalInit += initDone - startTime;
    totalSearch += searchDone - initDone;

    await manager.closeAll();
  }

  return {
    servers: serverCount,
    ttfs: totalTtfs / iterations,
    initTime: totalInit / iterations,
    searchTime: totalSearch / iterations,
  };
}

main().catch(console.error);
