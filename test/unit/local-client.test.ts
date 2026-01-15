import { test, expect, describe, beforeEach } from "bun:test";
import { LocalMCPClient, type Transport, type LocalMCPClientOptions } from "../../src/mcp-client/local";

/**
 * Create a mock client factory for testing
 */
function createMockClientFactory(options?: {
  failConnect?: boolean;
  failListTools?: boolean;
  tools?: any[];
  callToolResult?: any;
}) {
  return (name: string) => {
    let connected = false;
    return {
      async connect(transport: Transport): Promise<void> {
        if (options?.failConnect) {
          throw new Error("Connection failed");
        }
        connected = true;
      },
      async listTools(): Promise<{ tools: any[] }> {
        if (options?.failListTools) {
          throw new Error("List tools failed");
        }
        return { tools: options?.tools ?? [] };
      },
      async callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<any> {
        return options?.callToolResult ?? { content: [{ type: "text", text: "ok" }] };
      },
    };
  };
}

/**
 * Create a mock transport factory for testing
 */
function createMockTransportFactory(options?: {
  failClose?: boolean;
  onClose?: () => void;
}) {
  return (opts: {
    command: string;
    args: string[];
    env: Record<string, string>;
    stderr: "pipe" | "inherit" | "ignore";
  }): Transport => {
    return {
      async close(): Promise<void> {
        if (options?.failClose) {
          throw new Error("Close failed");
        }
        options?.onClose?.();
      },
    };
  };
}

describe("LocalMCPClient", () => {
  describe("constructor", () => {
    test("creates client with default factories", () => {
      // This should not throw
      const client = new LocalMCPClient({
        name: "test",
        type: "local",
        command: ["echo", "hello"],
      });
      expect(client).toBeDefined();
    });

    test("accepts custom client factory", () => {
      const mockFactory = createMockClientFactory();
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["echo"] },
        { clientFactory: mockFactory }
      );
      expect(client).toBeDefined();
    });

    test("accepts custom transport factory", () => {
      const mockTransport = createMockTransportFactory();
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["echo"] },
        { transportFactory: mockTransport }
      );
      expect(client).toBeDefined();
    });
  });

  describe("connect", () => {
    test("throws when command is empty", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: [] },
        { clientFactory: createMockClientFactory() }
      );

      await expect(client.connect()).rejects.toThrow("has no command");
    });

    test("throws when command is undefined", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local" },
        { clientFactory: createMockClientFactory() }
      );

      await expect(client.connect()).rejects.toThrow("has no command");
    });

    test("connects successfully with valid command", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node", "server.js"] },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      // Should not throw
    });

    test("creates transport with correct config", async () => {
      let capturedOpts: any = null;
      const client = new LocalMCPClient(
        {
          name: "test",
          type: "local",
          command: ["node", "server.js", "--port", "3000"],
          environment: { MY_VAR: "value" },
        },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: (opts) => {
            capturedOpts = opts;
            return { close: async () => {} };
          },
        }
      );

      await client.connect();

      expect(capturedOpts).not.toBeNull();
      expect(capturedOpts.command).toBe("node");
      expect(capturedOpts.args).toEqual(["server.js", "--port", "3000"]);
      expect(capturedOpts.env.MY_VAR).toBe("value");
      expect(capturedOpts.stderr).toBe("pipe");
    });

    test("merges environment with process.env", async () => {
      let capturedEnv: Record<string, string> = {};
      const client = new LocalMCPClient(
        {
          name: "test",
          type: "local",
          command: ["node"],
          environment: { CUSTOM: "value" },
        },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: (opts) => {
            capturedEnv = opts.env;
            return { close: async () => {} };
          },
        }
      );

      await client.connect();

      // Should include process.env PATH (or similar)
      expect(capturedEnv.CUSTOM).toBe("value");
      // Should include at least some process.env vars
      expect(Object.keys(capturedEnv).length).toBeGreaterThan(1);
    });

    test("propagates connection errors", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ failConnect: true }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await expect(client.connect()).rejects.toThrow("Connection failed");
    });
  });

  describe("listTools", () => {
    test("returns tools from client", async () => {
      const mockTools = [
        { name: "tool1", description: "Tool 1" },
        { name: "tool2", description: "Tool 2" },
      ];

      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      const tools = await client.listTools();

      expect(tools).toEqual(mockTools);
    });

    test("caches tools after first call", async () => {
      const mockTools = [{ name: "tool1" }];
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.listTools();

      const cached = client.getCachedTools();
      expect(cached).toEqual(mockTools);
    });

    test("propagates listTools errors", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ failListTools: true }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await expect(client.listTools()).rejects.toThrow("List tools failed");
    });
  });

  describe("callTool", () => {
    test("forwards call to underlying client", async () => {
      const expectedResult = { content: [{ type: "text", text: "result" }] };
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ callToolResult: expectedResult }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      const result = await client.callTool("test_tool", { arg1: "value" });

      expect(result).toEqual(expectedResult);
    });
  });

  describe("close", () => {
    test("closes transport and clears cache", async () => {
      let transportClosed = false;
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ tools: [{ name: "t1" }] }),
          transportFactory: createMockTransportFactory({
            onClose: () => {
              transportClosed = true;
            },
          }),
        }
      );

      await client.connect();
      await client.listTools();
      expect(client.getCachedTools()).not.toBeNull();

      await client.close();

      expect(transportClosed).toBe(true);
      expect(client.getCachedTools()).toBeNull();
    });

    test("is safe to call multiple times", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.close();
      await client.close(); // Should not throw
    });

    test("is safe to call without connect", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.close(); // Should not throw
    });
  });

  describe("getCachedTools", () => {
    test("returns null before listTools is called", async () => {
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory(),
          transportFactory: createMockTransportFactory(),
        }
      );

      expect(client.getCachedTools()).toBeNull();
    });

    test("returns tools after listTools is called", async () => {
      const mockTools = [{ name: "tool1" }];
      const client = new LocalMCPClient(
        { name: "test", type: "local", command: ["node"] },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          transportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.listTools();

      expect(client.getCachedTools()).toEqual(mockTools);
    });
  });
});
