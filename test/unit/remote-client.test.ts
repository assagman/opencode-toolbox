import { test, expect, describe } from "bun:test";
import {
  RemoteMCPClient,
  type RemoteTransport,
  type RemoteClientLike,
  type RemoteMCPClientOptions,
} from "../../src/mcp-client/remote";

/**
 * Create a mock client factory for testing
 */
function createMockClientFactory(options?: {
  failConnect?: boolean;
  failListTools?: boolean;
  tools?: any[];
  callToolResult?: any;
}): (name: string) => RemoteClientLike {
  return (name: string) => ({
    async connect(transport: RemoteTransport): Promise<void> {
      if (options?.failConnect) {
        throw new Error("Connection failed");
      }
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
  });
}

/**
 * Create a mock transport factory
 */
function createMockTransportFactory(options?: {
  failConnect?: boolean;
  onClose?: () => void;
}): () => RemoteTransport {
  return () => ({
    async close(): Promise<void> {
      options?.onClose?.();
    },
  });
}

describe("RemoteMCPClient", () => {
  describe("constructor", () => {
    test("creates client with default factories", () => {
      const client = new RemoteMCPClient({
        name: "test",
        type: "remote",
        url: "https://example.com/mcp",
      });
      expect(client).toBeDefined();
    });

    test("accepts custom client factory", () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com" },
        { clientFactory: createMockClientFactory() }
      );
      expect(client).toBeDefined();
    });
  });

  describe("connect", () => {
    test("throws when URL is missing", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote" },
        { clientFactory: createMockClientFactory() }
      );

      await expect(client.connect()).rejects.toThrow("has no URL");
    });

    test("connects successfully with streamable HTTP", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      expect(client.getTransportType()).toBe("streamable-http");
    });

    test("falls back to SSE when streamable fails", async () => {
      let streamableAttempts = 0;
      let sseAttempts = 0;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: (name) => ({
            async connect(transport: RemoteTransport): Promise<void> {
              // Fail on first attempt (streamable), succeed on second (SSE)
              if (streamableAttempts === 0 && sseAttempts === 0) {
                streamableAttempts++;
                throw new Error("Streamable not supported");
              }
              sseAttempts++;
            },
            async listTools() {
              return { tools: [] };
            },
            async callTool() {
              return {};
            },
          }),
          streamableTransportFactory: () => ({
            async close() {},
          }),
          sseTransportFactory: () => ({
            async close() {},
          }),
        }
      );

      await client.connect();

      expect(streamableAttempts).toBe(1);
      expect(sseAttempts).toBe(1);
      expect(client.getTransportType()).toBe("sse");
    });

    test("throws when both transports fail", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ failConnect: true }),
          streamableTransportFactory: createMockTransportFactory(),
          sseTransportFactory: createMockTransportFactory(),
        }
      );

      await expect(client.connect()).rejects.toThrow("Connection failed");
      expect(client.getTransportType()).toBeNull();
    });

    test("passes headers to streamable transport", async () => {
      let capturedUrl: URL | null = null;
      let capturedHeaders: Record<string, string> | undefined;

      const client = new RemoteMCPClient(
        {
          name: "test",
          type: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token123" },
        },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: (url, headers) => {
            capturedUrl = url;
            capturedHeaders = headers;
            return { close: async () => {} };
          },
        }
      );

      await client.connect();

      expect(capturedUrl?.href).toBe("https://example.com/mcp");
      expect(capturedHeaders?.Authorization).toBe("Bearer token123");
    });

    test("passes headers to SSE transport with Accept header", async () => {
      let capturedHeaders: Record<string, string> | null = null;

      const client = new RemoteMCPClient(
        {
          name: "test",
          type: "remote",
          url: "https://example.com/mcp",
          headers: { "X-Custom": "value" },
        },
        {
          clientFactory: (name) => ({
            async connect(transport: RemoteTransport): Promise<void> {
              // Fail first (streamable), succeed second (SSE)
              if (capturedHeaders === null) {
                throw new Error("Streamable failed");
              }
            },
            async listTools() {
              return { tools: [] };
            },
            async callTool() {
              return {};
            },
          }),
          streamableTransportFactory: () => ({
            async close() {},
          }),
          sseTransportFactory: (url, headers) => {
            capturedHeaders = headers;
            return { close: async () => {} };
          },
        }
      );

      await client.connect();

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders!.Accept).toBe("text/event-stream");
      expect(capturedHeaders!["X-Custom"]).toBe("value");
    });

    test("cleans up streamable transport on failure", async () => {
      let streamableClosed = false;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ failConnect: true }),
          streamableTransportFactory: () => ({
            async close() {
              streamableClosed = true;
            },
          }),
          sseTransportFactory: createMockTransportFactory(),
        }
      );

      await expect(client.connect()).rejects.toThrow();
      expect(streamableClosed).toBe(true);
    });

    test("cleans up SSE transport on failure", async () => {
      let sseClosed = false;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ failConnect: true }),
          streamableTransportFactory: createMockTransportFactory(),
          sseTransportFactory: () => ({
            async close() {
              sseClosed = true;
            },
          }),
        }
      );

      await expect(client.connect()).rejects.toThrow();
      expect(sseClosed).toBe(true);
    });

    test("resets client between transport attempts", async () => {
      let clientCreations = 0;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: (name) => {
            clientCreations++;
            return {
              async connect(transport: RemoteTransport): Promise<void> {
                // Fail on first attempt
                if (clientCreations === 1) {
                  throw new Error("Streamable failed");
                }
              },
              async listTools() {
                return { tools: [] };
              },
              async callTool() {
                return {};
              },
            };
          },
          streamableTransportFactory: createMockTransportFactory(),
          sseTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();

      // Should have created client twice: initial + after streamable failure
      expect(clientCreations).toBe(2);
    });
  });

  describe("listTools", () => {
    test("returns tools from client", async () => {
      const mockTools = [{ name: "tool1" }, { name: "tool2" }];

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      const tools = await client.listTools();

      expect(tools).toEqual(mockTools);
    });

    test("caches tools", async () => {
      const mockTools = [{ name: "tool1" }];

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.listTools();

      expect(client.getCachedTools()).toEqual(mockTools);
    });
  });

  describe("callTool", () => {
    test("forwards call to client", async () => {
      const expectedResult = { result: "success" };

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ callToolResult: expectedResult }),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      const result = await client.callTool("my_tool", { arg: "value" });

      expect(result).toEqual(expectedResult);
    });
  });

  describe("close", () => {
    test("closes transport and clears state", async () => {
      let transportClosed = false;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ tools: [{ name: "t1" }] }),
          streamableTransportFactory: () => ({
            async close() {
              transportClosed = true;
            },
          }),
        }
      );

      await client.connect();
      await client.listTools();
      expect(client.getCachedTools()).not.toBeNull();
      expect(client.getTransportType()).toBe("streamable-http");

      await client.close();

      expect(transportClosed).toBe(true);
      expect(client.getCachedTools()).toBeNull();
      expect(client.getTransportType()).toBeNull();
    });

    test("is safe to call multiple times", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.close();
      await client.close(); // Should not throw
    });

    test("is safe to call without connect", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.close(); // Should not throw
    });
  });

  describe("getTransportType", () => {
    test("returns null before connect", () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        { clientFactory: createMockClientFactory() }
      );

      expect(client.getTransportType()).toBeNull();
    });

    test("returns 'streamable-http' on success", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      expect(client.getTransportType()).toBe("streamable-http");
    });

    test("returns 'sse' on fallback", async () => {
      let isFirstAttempt = true;

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: (name) => ({
            async connect(transport: RemoteTransport): Promise<void> {
              if (isFirstAttempt) {
                isFirstAttempt = false;
                throw new Error("Streamable failed");
              }
            },
            async listTools() {
              return { tools: [] };
            },
            async callTool() {
              return {};
            },
          }),
          streamableTransportFactory: createMockTransportFactory(),
          sseTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      expect(client.getTransportType()).toBe("sse");
    });
  });

  describe("getCachedTools", () => {
    test("returns null before listTools", async () => {
      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory(),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      expect(client.getCachedTools()).toBeNull();
    });

    test("returns tools after listTools", async () => {
      const mockTools = [{ name: "cached_tool" }];

      const client = new RemoteMCPClient(
        { name: "test", type: "remote", url: "https://example.com/mcp" },
        {
          clientFactory: createMockClientFactory({ tools: mockTools }),
          streamableTransportFactory: createMockTransportFactory(),
        }
      );

      await client.connect();
      await client.listTools();

      expect(client.getCachedTools()).toEqual(mockTools);
    });
  });
});
