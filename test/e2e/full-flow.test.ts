import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { MCPManager, FakeMCPClient, FakeTools, FakeToolHandlers } from "../../src/mcp-client";
import { BM25Index, searchWithRegex } from "../../src/search";
import { normalizeTools } from "../../src/catalog";
import type { CatalogTool } from "../../src/catalog";

/**
 * E2E tests for the full Toolbox flow:
 * 1. Initialize with fake MCP servers
 * 2. Search for tools (BM25 or regex)
 * 3. Get tool schemas
 * 4. Execute tools
 * 5. Get results
 */

describe("E2E: Full Plugin Flow", () => {
  let mcpManager: MCPManager;
  let bm25Index: BM25Index;
  let allTools: CatalogTool[];

  beforeEach(async () => {
    // Create MCPManager with fake client factory
    mcpManager = new MCPManager({
      clientFactory: (name, config) => {
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
        if (name === "calculator") {
          return new FakeMCPClient({
            tools: FakeTools.calculator,
            onCallTool: FakeToolHandlers.calculator,
          });
        }
        throw new Error(`Unknown server: ${name}`);
      },
    });

    // Initialize servers
    await mcpManager.initialize({
      time: { type: "local" },
      search: { type: "local" },
      calculator: { type: "local" },
    });

    // Build search index
    allTools = mcpManager.getAllCatalogTools();
    bm25Index = new BM25Index();
    bm25Index.indexTools(allTools);
  });

  afterEach(async () => {
    await mcpManager.closeAll();
  });

  describe("Search -> Execute Flow", () => {
    test("search for time tool and execute it", async () => {
      // Step 1: Search for time-related tools
      const searchResults = bm25Index.search("get current time timezone", 5);
      
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0]!.idString).toBe("time_get_current_time");

      // Step 2: Get the tool schema
      const toolId = searchResults[0]!.idString;
      const catalogTool = allTools.find(t => t.idString === toolId);
      
      expect(catalogTool).toBeDefined();
      expect(catalogTool!.inputSchema).toBeDefined();
      expect((catalogTool!.inputSchema as any).properties.timezone).toBeDefined();

      // Step 3: Execute the tool
      const result = await mcpManager.callTool("time", "get_current_time", {
        timezone: "Asia/Tokyo",
      });

      expect(result).toBeDefined();
      expect(result.timezone).toBe("Asia/Tokyo");
      expect(result.datetime).toBeDefined();
    });

    test("search for calculator tool and execute it", async () => {
      // Step 1: Search
      const searchResults = bm25Index.search("add numbers", 5);
      
      expect(searchResults.length).toBeGreaterThan(0);
      const addTool = searchResults.find(r => r.idString === "calculator_add");
      expect(addTool).toBeDefined();

      // Step 2: Execute
      const result = await mcpManager.callTool("calculator", "add", {
        a: 5,
        b: 3,
      });

      expect(result).toEqual({ result: 8 });
    });

    test("search with regex and execute", async () => {
      // Step 1: Search with regex for all search-related tools
      const results = searchWithRegex(allTools, "^search_", 10);
      
      expect("error" in results).toBe(false);
      if (!("error" in results)) {
        expect(results.length).toBe(2);
        expect(results.some(r => r.idString === "search_web_search")).toBe(true);
      }

      // Step 2: Execute web_search
      const result = await mcpManager.callTool("search", "web_search", {
        query: "TypeScript tutorials",
      });

      expect(result.query).toBe("TypeScript tutorials");
      expect(result.results.length).toBe(2);
    });
  });

  describe("Error Handling", () => {
    test("execute non-existent tool returns error", async () => {
      await expect(
        mcpManager.callTool("time", "non_existent_tool", {})
      ).rejects.toThrow("Tool not found");
    });

    test("execute on non-existent server returns error", async () => {
      await expect(
        mcpManager.callTool("non_existent_server", "some_tool", {})
      ).rejects.toThrow("MCP client not found");
    });

    test("search with invalid regex returns error", () => {
      const result = searchWithRegex(allTools, "[invalid", 10);
      
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error.code).toBe("invalid_pattern");
      }
    });
  });

  describe("Multiple Servers", () => {
    test("search finds tools across all servers", () => {
      const results = bm25Index.search("search", 10);
      
      // Should find tools from both "search" server and potentially others
      expect(results.length).toBeGreaterThan(0);
    });

    test("tools are properly namespaced by server", () => {
      const timeTools = allTools.filter(t => t.id.server === "time");
      const searchTools = allTools.filter(t => t.id.server === "search");
      const calcTools = allTools.filter(t => t.id.server === "calculator");

      expect(timeTools.length).toBe(2);
      expect(searchTools.length).toBe(2);
      expect(calcTools.length).toBe(2);

      // All tool IDs should be properly prefixed
      expect(timeTools.every(t => t.idString.startsWith("time_"))).toBe(true);
      expect(searchTools.every(t => t.idString.startsWith("search_"))).toBe(true);
      expect(calcTools.every(t => t.idString.startsWith("calculator_"))).toBe(true);
    });
  });

  describe("Tool Schema Accuracy", () => {
    test("schema includes required fields", () => {
      const timeTool = allTools.find(t => t.idString === "time_get_current_time");
      
      expect(timeTool).toBeDefined();
      const schema = timeTool!.inputSchema as any;
      
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect(schema.properties.timezone).toBeDefined();
      expect(schema.properties.timezone.type).toBe("string");
      expect(schema.required).toContain("timezone");
    });

    test("schema descriptions are preserved", () => {
      const addTool = allTools.find(t => t.idString === "calculator_add");
      
      expect(addTool).toBeDefined();
      expect(addTool!.description).toBe("Add two numbers");
      
      const schema = addTool!.inputSchema as any;
      expect(schema.properties.a.description).toBe("First number");
      expect(schema.properties.b.description).toBe("Second number");
    });
  });
});

describe("E2E: Server Connection Failures", () => {
  test("handles server connection failure gracefully", async () => {
    const mcpManager = new MCPManager({
      clientFactory: (name, config) => {
        return new FakeMCPClient({
          tools: [],
          failConnect: true,
          errorMessage: "Connection refused",
        });
      },
      connectionConfig: {
        connectTimeout: 1000,
        requestTimeout: 5000,
        retryAttempts: 0,
        retryDelay: 0,
      },
    });

    await mcpManager.initialize({
      failing_server: { type: "local" },
    });

    const server = mcpManager.getServer("failing_server");
    expect(server).toBeDefined();
    expect(server!.status).toBe("error");
    expect(server!.error).toBe("Connection refused");

    // Tools list should be empty
    const tools = mcpManager.getAllCatalogTools();
    expect(tools.length).toBe(0);
    
    await mcpManager.closeAll();
  });

  test("handles listTools failure gracefully", async () => {
    const mcpManager = new MCPManager({
      clientFactory: (name, config) => {
        return new FakeMCPClient({
          tools: [],
          failListTools: true,
          errorMessage: "Server returned 500",
        });
      },
      connectionConfig: {
        connectTimeout: 1000,
        requestTimeout: 5000,
        retryAttempts: 0,
        retryDelay: 0,
      },
    });

    await mcpManager.initialize({
      broken_server: { type: "local" },
    });

    const server = mcpManager.getServer("broken_server");
    expect(server).toBeDefined();
    expect(server!.status).toBe("error");
    expect(server!.error).toBe("Server returned 500");
    
    await mcpManager.closeAll();
  });

  test("partial failure - some servers work, some don't", async () => {
    let serverCount = 0;
    const mcpManager = new MCPManager({
      clientFactory: (name, config) => {
        serverCount++;
        if (name === "working") {
          return new FakeMCPClient({ tools: FakeTools.time });
        }
        return new FakeMCPClient({
          tools: [],
          failConnect: true,
          errorMessage: "Connection failed",
        });
      },
      connectionConfig: {
        connectTimeout: 1000,
        requestTimeout: 5000,
        retryAttempts: 0,
        retryDelay: 0,
      },
    });

    await mcpManager.initialize({
      working: { type: "local" },
      broken: { type: "local" },
    });

    const workingServer = mcpManager.getServer("working");
    const brokenServer = mcpManager.getServer("broken");

    expect(workingServer!.status).toBe("connected");
    expect(brokenServer!.status).toBe("error");

    // Should still have tools from working server
    const tools = mcpManager.getAllCatalogTools();
    expect(tools.length).toBe(2); // time tools
    
    await mcpManager.closeAll();
  });
});

describe("E2E: Search Result Format", () => {
  let allTools: CatalogTool[];
  let bm25Index: BM25Index;

  beforeEach(async () => {
    const mcpManager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });

    await mcpManager.initialize({ time: { type: "local" } });
    allTools = mcpManager.getAllCatalogTools();
    bm25Index = new BM25Index();
    bm25Index.indexTools(allTools);
    
    // Note: not closing here as tests need the data
  });

  test("BM25 results include all required fields", () => {
    const results = bm25Index.search("time", 5);
    
    expect(results.length).toBeGreaterThan(0);
    
    const result = results[0]!;
    expect(result.tool).toBeDefined();
    expect(result.tool.server).toBe("time");
    expect(result.tool.name).toBeDefined();
    expect(result.idString).toBeDefined();
    expect(typeof result.score).toBe("number");
    expect(result.preview).toBeDefined();
    expect(result.signature).toBeDefined();
  });

  test("regex results include all required fields", () => {
    const results = searchWithRegex(allTools, "time_", 5);
    
    expect("error" in results).toBe(false);
    if (!("error" in results)) {
      const result = results[0]!;
      expect(result.tool).toBeDefined();
      expect(result.idString).toBeDefined();
      expect(typeof result.score).toBe("number");
      expect(result.preview).toBeDefined();
      expect(result.signature).toBeDefined();
    }
  });

  test("signature format is correct", () => {
    const results = bm25Index.search("get_current_time", 1);
    
    expect(results.length).toBe(1);
    // Signature should be like "get_current_time(timezone)"
    expect(results[0]!.signature).toContain("get_current_time");
    expect(results[0]!.signature).toContain("timezone");
  });
});

describe("E2E: Progressive Loading", () => {
  test("can index tools progressively as servers connect", async () => {
    const bm25Index = new BM25Index();
    const mcpManager = new MCPManager({
      clientFactory: (name) => {
        if (name === "time") {
          return new FakeMCPClient({ tools: FakeTools.time });
        }
        return new FakeMCPClient({ tools: FakeTools.calculator });
      },
    });

    // Set up progressive loading
    mcpManager.on("server:connected", (_, tools) => {
      bm25Index.addToolsBatch(tools);
    });

    // Initialize in background
    mcpManager.initializeBackground({
      time: { type: "local" },
      calculator: { type: "local" },
    });

    // Wait for at least partial readiness
    await mcpManager.waitForPartial();

    // Should have some tools indexed already
    expect(bm25Index.size).toBeGreaterThan(0);

    // Wait for full init
    await mcpManager.waitForReady();

    // Should have all tools now
    expect(bm25Index.size).toBe(4); // 2 time + 2 calculator

    await mcpManager.closeAll();
  });

  test("search works during progressive loading", async () => {
    const bm25Index = new BM25Index();
    const mcpManager = new MCPManager({
      clientFactory: (name) => {
        // Time server is fast, calculator is slower
        const delay = name === "time" ? 0 : 50;
        if (name === "time") {
          return new FakeMCPClient({ tools: FakeTools.time, delay });
        }
        return new FakeMCPClient({ tools: FakeTools.calculator, delay });
      },
    });

    mcpManager.on("server:connected", (_, tools) => {
      bm25Index.addToolsBatch(tools);
    });

    mcpManager.initializeBackground({
      time: { type: "local" },
      calculator: { type: "local" },
    });

    await mcpManager.waitForPartial();

    // Search should work with partial index
    const results = bm25Index.search("time", 5);
    expect(results.length).toBeGreaterThan(0);

    await mcpManager.waitForReady();
    await mcpManager.closeAll();
  });
});

describe("E2E: Async Indexing", () => {
  test("async indexing produces same results as sync", async () => {
    const tools = FakeTools.time.map((t, i) => ({
      id: { server: "test", name: t.name },
      idString: `test_${t.name}` as const,
      description: t.description || "",
      inputSchema: t.inputSchema as Record<string, unknown>,
      searchableText: `test_${t.name} ${t.name} ${t.description || ""}`,
      args: [],
    }));

    const syncIndex = new BM25Index();
    syncIndex.indexTools(tools);

    const asyncIndex = new BM25Index();
    await asyncIndex.indexToolsAsync(tools, 1);

    // Both should have same size
    expect(asyncIndex.size).toBe(syncIndex.size);

    // Both should return same search results
    const syncResults = syncIndex.search("time", 5);
    const asyncResults = asyncIndex.search("time", 5);

    expect(asyncResults.length).toBe(syncResults.length);
    expect(asyncResults[0]?.idString).toBe(syncResults[0]?.idString);
  });

  test("incremental add maintains search quality", () => {
    const bm25Index = new BM25Index();
    
    // Add first batch
    const timeTools = FakeTools.time.map((t) => ({
      id: { server: "time", name: t.name },
      idString: `time_${t.name}` as const,
      description: t.description || "",
      inputSchema: t.inputSchema as Record<string, unknown>,
      searchableText: `time_${t.name} ${t.name} ${t.description || ""}`,
      args: [],
    }));
    bm25Index.addToolsBatch(timeTools);
    
    // Verify time tools are searchable
    let results = bm25Index.search("time", 5);
    expect(results.length).toBe(2);
    
    // Add second batch
    const calcTools = FakeTools.calculator.map((t) => ({
      id: { server: "calc", name: t.name },
      idString: `calc_${t.name}` as const,
      description: t.description || "",
      inputSchema: t.inputSchema as Record<string, unknown>,
      searchableText: `calc_${t.name} ${t.name} ${t.description || ""}`,
      args: [],
    }));
    bm25Index.addToolsBatch(calcTools);
    
    // Verify both sets are searchable
    results = bm25Index.search("add", 5);
    expect(results.some(r => r.idString === "calc_add")).toBe(true);
    
    results = bm25Index.search("time", 5);
    expect(results.length).toBeGreaterThan(0);
  });
});
