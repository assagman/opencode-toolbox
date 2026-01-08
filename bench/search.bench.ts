/**
 * Search Performance Benchmarks
 * Tests BM25 and regex search performance at various scales
 */

import { BM25Index, searchWithRegex } from "../src/search";
import { generateMockTools, runBenchmarks } from "./utils";

async function main() {
  console.log("\n🔍 Search Performance Benchmarks\n");

  // Test different index sizes
  const sizes = [10, 50, 100, 500, 1000];

  for (const size of sizes) {
    console.log(`\n📊 Index Size: ${size} tools\n`);

    const tools = generateMockTools(size);
    const bm25Index = new BM25Index();
    bm25Index.indexTools(tools);

    const queries = [
      "get user",
      "search data analytics",
      "create item configuration",
      "delete log event metric",
      "find compute result status",
    ];

    await runBenchmarks(
      [
        // BM25 searches with different query complexities
        {
          name: `BM25 simple query (${size} tools)`,
          fn: () => {
            bm25Index.search("get user", 5);
          },
        },
        {
          name: `BM25 complex query (${size} tools)`,
          fn: () => {
            bm25Index.search("search data analytics compute", 10);
          },
        },
        {
          name: `BM25 multi-query cycle (${size} tools)`,
          fn: () => {
            for (const q of queries) {
              bm25Index.search(q, 5);
            }
          },
        },

        // Regex searches
        {
          name: `Regex prefix match (${size} tools)`,
          fn: () => {
            searchWithRegex(tools, "^time_", 10);
          },
        },
        {
          name: `Regex wildcard (${size} tools)`,
          fn: () => {
            searchWithRegex(tools, ".*user.*", 10);
          },
        },
        {
          name: `Regex complex pattern (${size} tools)`,
          fn: () => {
            searchWithRegex(tools, "(get|set|create)_.*_[0-9]+", 10);
          },
        },
      ],
      { warmup: 20, iterations: 200 }
    );
  }

  // Benchmark incremental indexing
  console.log("\n📊 Incremental Indexing Performance\n");

  const bm25Index = new BM25Index();

  await runBenchmarks(
    [
      {
        name: "Index 100 tools (batch)",
        fn: () => {
          bm25Index.clear();
          bm25Index.indexTools(generateMockTools(100));
        },
      },
      {
        name: "Index 100 tools (incremental)",
        fn: () => {
          bm25Index.clear();
          const tools = generateMockTools(100);
          for (const tool of tools) {
            bm25Index.addTool(tool);
          }
        },
      },
      {
        name: "Index 100 tools (addToolsBatch)",
        fn: () => {
          bm25Index.clear();
          bm25Index.addToolsBatch(generateMockTools(100));
        },
      },
      {
        name: "Add 10 tools to 100-tool index",
        fn: () => {
          bm25Index.clear();
          bm25Index.indexTools(generateMockTools(100));
          bm25Index.addToolsBatch(generateMockTools(10));
        },
      },
    ],
    { warmup: 10, iterations: 50 }
  );

  // Async indexing benchmark
  console.log("\n📊 Async Indexing Performance\n");

  await runBenchmarks(
    [
      {
        name: "Async index 500 tools (chunk 50)",
        fn: async () => {
          const index = new BM25Index();
          await index.indexToolsAsync(generateMockTools(500), 50);
        },
      },
      {
        name: "Async index 500 tools (chunk 100)",
        fn: async () => {
          const index = new BM25Index();
          await index.indexToolsAsync(generateMockTools(500), 100);
        },
      },
      {
        name: "Sync index 500 tools (baseline)",
        fn: () => {
          const index = new BM25Index();
          index.indexTools(generateMockTools(500));
        },
      },
    ],
    { warmup: 5, iterations: 20 }
  );

  console.log("\n✅ Search benchmarks complete!\n");
}

main().catch(console.error);
