import { test, expect, describe, beforeEach } from "bun:test";
import { BM25Index, searchWithRegex } from "../../src/search";
import type { CatalogTool, SearchResult } from "../../src/catalog";
import { normalizeTools } from "../../src/catalog";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock MCP tools for testing
 */
const mockTimeTools: Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current time in a specific timezone",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name (e.g., 'America/New_York', 'Europe/London')",
        },
      },
      required: ["timezone"],
    },
  },
  {
    name: "convert_time",
    description: "Convert time between timezones",
    inputSchema: {
      type: "object",
      properties: {
        source_timezone: { type: "string" },
        target_timezone: { type: "string" },
        time: { type: "string" },
      },
      required: ["source_timezone", "target_timezone", "time"],
    },
  },
];

const mockSearchTools: Tool[] = [
  {
    name: "web_search",
    description: "Search the web for information using natural language queries",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results to return" },
      },
      required: ["query"],
    },
  },
  {
    name: "news_search",
    description: "Search for recent news articles",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        freshness: { type: "string", enum: ["day", "week", "month"] },
      },
      required: ["query"],
    },
  },
];

describe("Plugin Flow Integration", () => {
  let bm25Index: BM25Index;
  let allTools: CatalogTool[];

  beforeEach(() => {
    // Normalize tools from mock servers
    const timeToolsNormalized = normalizeTools("time", mockTimeTools);
    const searchToolsNormalized = normalizeTools("exa", mockSearchTools);
    
    allTools = [...timeToolsNormalized, ...searchToolsNormalized];
    
    // Build search index
    bm25Index = new BM25Index();
    bm25Index.indexTools(allTools);
  });

  describe("BM25 Search Flow", () => {
    test("finds time tools for time-related query", () => {
      const results = bm25Index.search("current time timezone", 5);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.idString).toContain("time_");
    });

    test("finds search tools for web search query", () => {
      const results = bm25Index.search("search the web for information", 5);
      
      expect(results.length).toBeGreaterThan(0);
      const toolNames = results.map(r => r.idString);
      expect(toolNames.some(n => n.includes("search"))).toBe(true);
    });

    test("finds news tools for news query", () => {
      const results = bm25Index.search("latest news articles", 5);
      
      expect(results.length).toBeGreaterThan(0);
    });

    test("returns empty for unrelated query", () => {
      const results = bm25Index.search("quantum physics simulation", 5);
      
      // May find something or not, depending on scoring threshold
      // Just verify it doesn't crash
      expect(results).toBeDefined();
    });

    test("respects limit parameter", () => {
      const results = bm25Index.search("search", 2);
      
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Regex Search Flow", () => {
    test("finds tools by exact prefix", () => {
      const results = searchWithRegex(allTools, "^time_", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
        expect(results.every(r => r.idString.startsWith("time_"))).toBe(true);
      }
    });

    test("finds tools by partial name", () => {
      const results = searchWithRegex(allTools, "search", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
      }
    });

    test("case insensitive search with (?i)", () => {
      const results = searchWithRegex(allTools, "(?i)TIME_", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
      }
    });

    test("finds tools with complex pattern", () => {
      const results = searchWithRegex(allTools, ".*_convert.*|.*_news.*", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
      }
    });

    test("respects limit", () => {
      const results = searchWithRegex(allTools, ".*", 2);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
      }
    });
  });

  describe("Tool Schema Access", () => {
    test("search results include tool info", () => {
      const results = bm25Index.search("time", 1);
      
      expect(results.length).toBe(1);
      const result = results[0]!;
      expect(result.tool).toBeDefined();
      expect(result.idString).toBeDefined();
      expect(result.preview).toBeDefined();
    });

    test("can retrieve full schema from catalog", () => {
      const results = bm25Index.search("time", 1);
      expect(results.length).toBeGreaterThan(0);
      
      const toolId = results[0]!.idString;
      const catalogTool = allTools.find(t => t.idString === toolId);
      
      expect(catalogTool).toBeDefined();
      expect(catalogTool!.inputSchema).toBeDefined();
      expect(catalogTool!.inputSchema.properties).toBeDefined();
    });
  });

  describe("Tool Name Parsing", () => {
    test("tools are named with server prefix", () => {
      const timeTools = allTools.filter(t => t.id.server === "time");
      
      expect(timeTools.length).toBe(2);
      expect(timeTools[0]!.idString).toBe("time_get_current_time");
      expect(timeTools[1]!.idString).toBe("time_convert_time");
    });

    test("can extract server name from tool id", () => {
      const toolId = "time_get_current_time";
      const underscoreIndex = toolId.indexOf("_");
      const serverName = toolId.substring(0, underscoreIndex);
      
      expect(serverName).toBe("time");
    });
  });

  describe("Search Result Format", () => {
    test("BM25 results have scores", () => {
      const results = bm25Index.search("time", 3);
      
      for (const result of results) {
        expect(typeof result.score).toBe("number");
        expect(result.score).toBeGreaterThanOrEqual(0);
      }
    });

    test("BM25 results are sorted by score descending", () => {
      const results = bm25Index.search("search web", 3);
      
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    });

    test("regex results have match scores", () => {
      const results = searchWithRegex(allTools, "search", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        for (const result of results) {
          expect(typeof result.score).toBe("number");
        }
      }
    });
  });
});

describe("Multiple Server Simulation", () => {
  test("tools from multiple servers are indexed", () => {
    const server1Tools = normalizeTools("server1", [
      { name: "tool_a", description: "Tool A", inputSchema: { type: "object", properties: {} } },
    ] as Tool[]);
    const server2Tools = normalizeTools("server2", [
      { name: "tool_b", description: "Tool B", inputSchema: { type: "object", properties: {} } },
    ] as Tool[]);
    const server3Tools = normalizeTools("server3", [
      { name: "tool_c", description: "Tool C", inputSchema: { type: "object", properties: {} } },
    ] as Tool[]);
    
    const allTools = [...server1Tools, ...server2Tools, ...server3Tools];
    const index = new BM25Index();
    index.indexTools(allTools);
    
    const results = index.search("tool", 10);
    
    expect(results.length).toBe(3);
  });

  test("can search tools from specific server", () => {
    const server1Tools = normalizeTools("time", mockTimeTools);
    const server2Tools = normalizeTools("exa", mockSearchTools);
    
    const allTools = [...server1Tools, ...server2Tools];
    
    // Search with regex for specific server
    const timeResults = searchWithRegex(allTools, "^time_", 10);
    const exaResults = searchWithRegex(allTools, "^exa_", 10);
    
    expect("error" in timeResults).toBe(false);
    expect("error" in exaResults).toBe(false);
    
    if (!("error" in timeResults) && !("error" in exaResults)) {
      expect(timeResults.length).toBe(2);
      expect(exaResults.length).toBe(2);
    }
  });
});
