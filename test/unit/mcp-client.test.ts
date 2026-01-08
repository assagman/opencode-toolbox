import { test, expect, describe } from "bun:test";
import { FakeMCPClient, FakeTools, FakeToolHandlers } from "../../src/mcp-client/fake";
import { MCPManager } from "../../src/mcp-client/manager";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

describe("FakeMCPClient", () => {
  test("can be instantiated and connected", async () => {
    const tools: Tool[] = [
      {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];

    const client = new FakeMCPClient({ tools });
    await client.connect();

    expect(client.isConnected()).toBe(true);
    
    const listedTools = await client.listTools();
    expect(listedTools).toHaveLength(1);
    expect(listedTools[0]?.name).toBe("test_tool");
  });

  test("calls tools correctly with default handler", async () => {
    const tools: Tool[] = [
      {
        name: "echo",
        description: "Echo back the input",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Message to echo" },
          },
        },
      },
    ];

    const client = new FakeMCPClient({ tools });
    await client.connect();

    const result = await client.callTool("echo", { message: "hello" });

    expect(result.success).toBe(true);
    expect(result.tool).toBe("echo");
    expect(result.args).toEqual({ message: "hello" });
  });

  test("throws error for unknown tool", async () => {
    const client = new FakeMCPClient({ tools: [] });
    await client.connect();

    await expect(
      client.callTool("nonexistent", {})
    ).rejects.toThrow("Tool not found: nonexistent");
  });

  test("close() is safe to call multiple times", async () => {
    const client = new FakeMCPClient({ tools: [] });
    await client.connect();
    await client.close();

    expect(client.isConnected()).toBe(false);

    // Should not throw when called again
    await client.close();
  });

  test("supports custom tool call handler", async () => {
    const client = new FakeMCPClient({
      tools: FakeTools.calculator,
      onCallTool: FakeToolHandlers.calculator,
    });
    await client.connect();

    const result = await client.callTool("add", { a: 10, b: 5 });
    expect(result).toEqual({ result: 15 });

    const multiplyResult = await client.callTool("multiply", { a: 3, b: 4 });
    expect(multiplyResult).toEqual({ result: 12 });
  });

  test("simulates connection failure", async () => {
    const client = new FakeMCPClient({
      tools: [],
      failConnect: true,
      errorMessage: "Network unreachable",
    });

    await expect(client.connect()).rejects.toThrow("Network unreachable");
    expect(client.isConnected()).toBe(false);
  });

  test("simulates listTools failure", async () => {
    const client = new FakeMCPClient({
      tools: [],
      failListTools: true,
      errorMessage: "Server error",
    });

    await client.connect();
    await expect(client.listTools()).rejects.toThrow("Server error");
  });

  test("respects delay configuration", async () => {
    const client = new FakeMCPClient({
      tools: FakeTools.time,
      delay: 50,
    });

    const start = Date.now();
    await client.connect();
    const duration = Date.now() - start;

    // Should take at least 50ms (with some tolerance)
    expect(duration).toBeGreaterThanOrEqual(45);
  });

  test("zero delay for fast tests", async () => {
    const client = new FakeMCPClient({
      tools: FakeTools.time,
      delay: 0,
    });

    const start = Date.now();
    await client.connect();
    await client.listTools();
    await client.callTool("get_current_time", { timezone: "UTC" });
    const duration = Date.now() - start;

    // Should be very fast with no delay
    expect(duration).toBeLessThan(50);
  });
});

describe("FakeTools presets", () => {
  test("time tools are properly defined", () => {
    expect(FakeTools.time).toHaveLength(2);
    expect(FakeTools.time.map(t => t.name)).toContain("get_current_time");
    expect(FakeTools.time.map(t => t.name)).toContain("convert_time");
  });

  test("search tools are properly defined", () => {
    expect(FakeTools.search).toHaveLength(2);
    expect(FakeTools.search.map(t => t.name)).toContain("web_search");
    expect(FakeTools.search.map(t => t.name)).toContain("news_search");
  });

  test("calculator tools are properly defined", () => {
    expect(FakeTools.calculator).toHaveLength(2);
    expect(FakeTools.calculator.map(t => t.name)).toContain("add");
    expect(FakeTools.calculator.map(t => t.name)).toContain("multiply");
  });
});

describe("FakeToolHandlers", () => {
  test("time handler returns realistic data", async () => {
    const result = await FakeToolHandlers.time("get_current_time", {
      timezone: "America/New_York",
    });

    expect(result.timezone).toBe("America/New_York");
    expect(result.datetime).toBeDefined();
    expect(result.formatted).toBeDefined();
  });

  test("calculator handler performs calculations", async () => {
    expect(await FakeToolHandlers.calculator("add", { a: 1, b: 2 }))
      .toEqual({ result: 3 });
    
    expect(await FakeToolHandlers.calculator("multiply", { a: 7, b: 8 }))
      .toEqual({ result: 56 });
  });

  test("search handler returns mock results", async () => {
    const result = await FakeToolHandlers.search("web_search", {
      query: "test query",
    });

    expect(result.query).toBe("test query");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.title).toContain("test query");
  });
});

describe("MCPManager - Init States", () => {
  test("starts in idle state", () => {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });
    
    expect(manager.getInitState()).toBe("idle");
    expect(manager.isReady()).toBe(false);
    expect(manager.isComplete()).toBe(false);
  });

  test("transitions to ready state on successful init", async () => {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });

    await manager.initialize({ time: { type: "local" } });
    
    expect(manager.getInitState()).toBe("ready");
    expect(manager.isReady()).toBe(true);
    expect(manager.isComplete()).toBe(true);
    
    await manager.closeAll();
  });

  test("transitions to degraded state on partial failure", async () => {
    let callCount = 0;
    const manager = new MCPManager({
      clientFactory: () => {
        callCount++;
        if (callCount === 1) {
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

    await manager.initialize({
      working: { type: "local" },
      failing: { type: "local" },
    });

    expect(manager.getInitState()).toBe("degraded");
    expect(manager.isReady()).toBe(true); // Still ready with partial servers
    expect(manager.isComplete()).toBe(true);

    await manager.closeAll();
  });

  test("emits server:connected events", async () => {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });

    const connectedServers: string[] = [];
    manager.on("server:connected", (name) => {
      connectedServers.push(name);
    });

    await manager.initialize({
      time: { type: "local" },
      search: { type: "local" },
    });

    expect(connectedServers).toContain("time");
    expect(connectedServers).toContain("search");

    await manager.closeAll();
  });

  test("emits init:complete event", async () => {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time }),
    });

    let initState = "";
    manager.on("init:complete", (state) => {
      initState = state;
    });

    await manager.initialize({ time: { type: "local" } });

    expect(initState).toBe("ready");

    await manager.closeAll();
  });

  test("waitForPartial resolves when first server connects", async () => {
    const manager = new MCPManager({
      clientFactory: (name) => {
        // Second server takes longer
        const delay = name === "slow" ? 100 : 0;
        return new FakeMCPClient({ tools: FakeTools.time, delay });
      },
    });

    manager.initializeBackground({
      fast: { type: "local" },
      slow: { type: "local" },
    });

    const start = Date.now();
    await manager.waitForPartial();
    const duration = Date.now() - start;

    // Should resolve quickly when first server connects
    expect(duration).toBeLessThan(50);
    expect(manager.isReady()).toBe(true);

    // Wait for full init before cleanup
    await manager.waitForReady();
    await manager.closeAll();
  });

  test("background init does not block", async () => {
    const manager = new MCPManager({
      clientFactory: () => new FakeMCPClient({ tools: FakeTools.time, delay: 100 }),
    });

    const start = Date.now();
    manager.initializeBackground({ time: { type: "local" } });
    const duration = Date.now() - start;

    // Should return immediately
    expect(duration).toBeLessThan(10);

    // Wait for completion before cleanup
    await manager.waitForReady();
    await manager.closeAll();
  });
});

describe("MCPManager - Connection Retry", () => {
  test("retries on connection failure", async () => {
    let attempts = 0;
    const manager = new MCPManager({
      clientFactory: () => {
        attempts++;
        if (attempts < 2) {
          return new FakeMCPClient({
            tools: [],
            failConnect: true,
            errorMessage: "Temporary failure",
          });
        }
        return new FakeMCPClient({ tools: FakeTools.time });
      },
      connectionConfig: {
        connectTimeout: 1000,
        requestTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 10,
      },
    });

    await manager.initialize({ time: { type: "local" } });

    expect(attempts).toBe(2);
    expect(manager.getInitState()).toBe("ready");

    await manager.closeAll();
  });

  test("gives up after max retries", async () => {
    let attempts = 0;
    const manager = new MCPManager({
      clientFactory: () => {
        attempts++;
        return new FakeMCPClient({
          tools: [],
          failConnect: true,
          errorMessage: "Permanent failure",
        });
      },
      connectionConfig: {
        connectTimeout: 1000,
        requestTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 10,
      },
    });

    await manager.initialize({ time: { type: "local" } });

    // 1 initial + 2 retries = 3 attempts
    expect(attempts).toBe(3);
    expect(manager.getInitState()).toBe("degraded");

    const server = manager.getServer("time");
    expect(server?.status).toBe("error");
    expect(server?.error).toBe("Permanent failure");

    await manager.closeAll();
  });
});
