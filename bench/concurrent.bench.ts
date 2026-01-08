/**
 * Concurrent Load Benchmarks
 * Tests performance under concurrent search and execution load
 */

import { MCPManager, FakeMCPClient, FakeTools, FakeToolHandlers } from "../src/mcp-client";
import { BM25Index, searchWithRegex } from "../src/search";
import { generateMockTools, runBenchmarks } from "./utils";

async function main() {
  console.log("\n⚡ Concurrent Load Benchmarks\n");

  // Set up test infrastructure
  const tools = generateMockTools(500);
  const bm25Index = new BM25Index();
  bm25Index.indexTools(tools);

  const manager = new MCPManager({
    clientFactory: (name) => {
      if (name === "time") {
        return new FakeMCPClient({
          tools: FakeTools.time,
          onCallTool: FakeToolHandlers.time,
        });
      }
      if (name === "search") {
        return new FakeMCPClient({
          tools: FakeTools.search,
          onCallTool: FakeToolHandlers.search,
        });
      }
      return new FakeMCPClient({
        tools: FakeTools.calculator,
        onCallTool: FakeToolHandlers.calculator,
      });
    },
  });

  await manager.initialize({
    time: { type: "local" },
    search: { type: "local" },
    calculator: { type: "local" },
  });

  // Concurrent search benchmarks
  console.log("\n📊 Concurrent Searches\n");

  const queries = [
    "get user data",
    "search analytics",
    "create item",
    "delete log",
    "find status",
    "compute result",
    "list events",
    "update config",
  ];

  await runBenchmarks(
    [
      {
        name: "10 concurrent BM25 searches",
        fn: async () => {
          await Promise.all(
            queries.slice(0, 10).map((q) => 
              Promise.resolve(bm25Index.search(q, 5))
            )
          );
        },
      },
      {
        name: "50 concurrent BM25 searches",
        fn: async () => {
          const allQueries = Array(50).fill(null).map((_, i) => queries[i % queries.length]!);
          await Promise.all(
            allQueries.map((q) => 
              Promise.resolve(bm25Index.search(q, 5))
            )
          );
        },
      },
      {
        name: "100 concurrent BM25 searches",
        fn: async () => {
          const allQueries = Array(100).fill(null).map((_, i) => queries[i % queries.length]!);
          await Promise.all(
            allQueries.map((q) => 
              Promise.resolve(bm25Index.search(q, 5))
            )
          );
        },
      },
      {
        name: "10 concurrent regex searches",
        fn: async () => {
          await Promise.all([
            Promise.resolve(searchWithRegex(tools, "^time_", 5)),
            Promise.resolve(searchWithRegex(tools, "^search_", 5)),
            Promise.resolve(searchWithRegex(tools, "^calc_", 5)),
            Promise.resolve(searchWithRegex(tools, ".*user.*", 5)),
            Promise.resolve(searchWithRegex(tools, ".*data.*", 5)),
            Promise.resolve(searchWithRegex(tools, "get_.*", 5)),
            Promise.resolve(searchWithRegex(tools, ".*_0$", 5)),
            Promise.resolve(searchWithRegex(tools, ".*_1$", 5)),
            Promise.resolve(searchWithRegex(tools, ".*_2$", 5)),
            Promise.resolve(searchWithRegex(tools, ".*config.*", 5)),
          ]);
        },
      },
    ],
    { warmup: 10, iterations: 100 }
  );

  // Concurrent tool execution
  console.log("\n📊 Concurrent Tool Execution\n");

  await runBenchmarks(
    [
      {
        name: "5 concurrent tool executions",
        fn: async () => {
          await Promise.all([
            manager.callTool("time", "get_current_time", { timezone: "UTC" }),
            manager.callTool("time", "convert_time", { time: "12:00", from: "UTC", to: "EST" }),
            manager.callTool("calculator", "add", { a: 1, b: 2 }),
            manager.callTool("calculator", "multiply", { a: 3, b: 4 }),
            manager.callTool("search", "web_search", { query: "test" }),
          ]);
        },
      },
      {
        name: "10 concurrent tool executions",
        fn: async () => {
          await Promise.all(
            Array(10).fill(null).map((_, i) =>
              manager.callTool("calculator", "add", { a: i, b: i + 1 })
            )
          );
        },
      },
      {
        name: "20 concurrent tool executions",
        fn: async () => {
          await Promise.all(
            Array(20).fill(null).map((_, i) =>
              manager.callTool("calculator", "add", { a: i, b: i + 1 })
            )
          );
        },
      },
    ],
    { warmup: 5, iterations: 50 }
  );

  // Mixed workload (search + execute)
  console.log("\n📊 Mixed Workload (Search + Execute)\n");

  await runBenchmarks(
    [
      {
        name: "Search then execute (sequential)",
        fn: async () => {
          const results = bm25Index.search("time", 1);
          if (results.length > 0) {
            await manager.callTool("time", "get_current_time", { timezone: "UTC" });
          }
        },
      },
      {
        name: "10 search-execute pairs (concurrent)",
        fn: async () => {
          await Promise.all(
            Array(10).fill(null).map(async () => {
              bm25Index.search("calculate", 1);
              await manager.callTool("calculator", "add", { a: 1, b: 2 });
            })
          );
        },
      },
      {
        name: "Mixed: 50 searches + 10 executes",
        fn: async () => {
          await Promise.all([
            ...Array(50).fill(null).map((_, i) =>
              Promise.resolve(bm25Index.search(queries[i % queries.length]!, 5))
            ),
            ...Array(10).fill(null).map((_, i) =>
              manager.callTool("calculator", "add", { a: i, b: i })
            ),
          ]);
        },
      },
    ],
    { warmup: 5, iterations: 50 }
  );

  // Memory pressure test
  console.log("\n📊 Memory Under Load\n");

  const memBefore = process.memoryUsage();

  // Create many indexes
  const indexes: BM25Index[] = [];
  for (let i = 0; i < 10; i++) {
    const idx = new BM25Index();
    idx.indexTools(generateMockTools(100));
    indexes.push(idx);
  }

  // Run many concurrent searches
  await Promise.all(
    indexes.flatMap((idx) =>
      queries.map((q) => Promise.resolve(idx.search(q, 5)))
    )
  );

  const memAfter = process.memoryUsage();

  console.log("\nMemory Usage:");
  console.log("━".repeat(50));
  console.log(`Heap Used (before):  ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Used (after):   ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Total (before): ${(memBefore.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Total (after):  ${(memAfter.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS (before):        ${(memBefore.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS (after):         ${(memAfter.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log("━".repeat(50));

  await manager.closeAll();

  console.log("\n✅ Concurrent load benchmarks complete!\n");
}

main().catch(console.error);
