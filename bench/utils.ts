/**
 * Benchmark utilities for opencode-toolbox
 * Provides test data generators and measurement helpers
 */

import type { CatalogTool, ToolIdString, ToolId } from "../src/catalog/types";

/**
 * Generate mock catalog tools for benchmarking
 */
export function generateMockTools(count: number): CatalogTool[] {
  const tools: CatalogTool[] = [];
  
  const servers = ["time", "search", "calculator", "storage", "api", "data", "analytics"];
  const verbs = ["get", "set", "create", "delete", "update", "list", "find", "search", "compute", "analyze"];
  const nouns = ["user", "item", "data", "config", "result", "status", "report", "metric", "event", "log"];
  
  for (let i = 0; i < count; i++) {
    const server = servers[i % servers.length]!;
    const verb = verbs[Math.floor(i / servers.length) % verbs.length]!;
    const noun = nouns[Math.floor(i / (servers.length * verbs.length)) % nouns.length]!;
    const name = `${verb}_${noun}_${i}`;
    
    const id: ToolId = { server, name };
    const idString = `${server}_${name}` as ToolIdString;
    
    tools.push({
      id,
      idString,
      description: `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${noun} with ID ${i}. This tool provides functionality for ${verb}ing ${noun}s in the ${server} system.`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unique identifier" },
          options: { type: "object", description: "Optional configuration" },
        },
        required: ["id"],
      },
      searchableText: `${idString} ${name} ${verb} ${noun} ${server}`,
      args: [
        { name: "id", description: "The unique identifier" },
        { name: "options", description: "Optional configuration (optional)" },
      ],
    });
  }
  
  return tools;
}

/**
 * Benchmark result with statistics
 */
export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
}

/**
 * Run a benchmark function multiple times and collect statistics
 */
export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  options: { warmup?: number; iterations?: number } = {}
): Promise<BenchmarkResult> {
  const warmup = options.warmup ?? 10;
  const iterations = options.iterations ?? 100;
  
  // Warmup runs
  for (let i = 0; i < warmup; i++) {
    await fn();
  }
  
  // Timed runs
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  // Calculate statistics
  times.sort((a, b) => a - b);
  const total = times.reduce((sum, t) => sum + t, 0);
  
  return {
    name,
    iterations,
    totalMs: total,
    avgMs: total / iterations,
    minMs: times[0]!,
    maxMs: times[times.length - 1]!,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    opsPerSec: (iterations / total) * 1000,
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

/**
 * Format benchmark result as a table row
 */
export function formatResult(result: BenchmarkResult): string {
  return [
    result.name.padEnd(40),
    `${result.avgMs.toFixed(3)}ms`.padStart(12),
    `${result.p50Ms.toFixed(3)}ms`.padStart(12),
    `${result.p95Ms.toFixed(3)}ms`.padStart(12),
    `${result.p99Ms.toFixed(3)}ms`.padStart(12),
    `${result.opsPerSec.toFixed(0)} ops/s`.padStart(14),
  ].join(" | ");
}

/**
 * Print benchmark header
 */
export function printHeader(): void {
  const header = [
    "Benchmark".padEnd(40),
    "Avg".padStart(12),
    "P50".padStart(12),
    "P95".padStart(12),
    "P99".padStart(12),
    "Throughput".padStart(14),
  ].join(" | ");
  
  console.log("\n" + "=".repeat(header.length));
  console.log(header);
  console.log("=".repeat(header.length));
}

/**
 * Run multiple benchmarks and print results
 */
export async function runBenchmarks(
  benchmarks: Array<{ name: string; fn: () => void | Promise<void> }>,
  options?: { warmup?: number; iterations?: number }
): Promise<BenchmarkResult[]> {
  printHeader();
  
  const results: BenchmarkResult[] = [];
  
  for (const { name, fn } of benchmarks) {
    const result = await benchmark(name, fn, options);
    results.push(result);
    console.log(formatResult(result));
  }
  
  console.log("=".repeat(106) + "\n");
  
  return results;
}
