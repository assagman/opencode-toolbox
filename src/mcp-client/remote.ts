import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RemoteMCPServerConfig } from "./types";
import type { MCPClient } from "./types";

type RemoteTransport = SSEClientTransport | StreamableHTTPClientTransport;

/**
 * Remote MCP client with auto-detection
 * Tries Streamable HTTP first (newer), falls back to SSE (legacy)
 */
export class RemoteMCPClient implements MCPClient {
  private client: Client;
  private transport: RemoteTransport | null;
  private toolsCache: any[] | null;
  private name: string;
  private config: RemoteMCPServerConfig;
  private transportType: "streamable-http" | "sse" | null;

  constructor(config: { name: string } & RemoteMCPServerConfig) {
    this.transport = null;
    this.toolsCache = null;
    this.name = config.name;
    this.config = config;
    this.transportType = null;

    this.client = new Client(
      {
        name: `opencode-toolbox-client-${this.name}`,
        version: "0.1.0",
      },
      {}
    );
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`Remote MCP server ${this.name} has no URL`);
    }

    const url = new URL(this.config.url);

    // Try Streamable HTTP first (newer protocol)
    try {
      this.transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: this.config.headers,
        },
      });
      await this.client.connect(this.transport);
      this.transportType = "streamable-http";
      return;
    } catch (error) {
      // If Streamable HTTP fails, try SSE fallback
      // Reset client for new connection attempt
      this.client = new Client(
        {
          name: `opencode-toolbox-client-${this.name}`,
          version: "0.1.0",
        },
        {}
      );
    }

    // Fallback to SSE transport (legacy)
    const sseHeaders = {
      Accept: "text/event-stream",
      ...this.config.headers,
    };

    this.transport = new SSEClientTransport(url, {
      requestInit: {
        headers: sseHeaders,
      },
    });

    await this.client.connect(this.transport);
    this.transportType = "sse";
  }

  async listTools(): Promise<any[]> {
    const result = await this.client.listTools();
    this.toolsCache = result.tools;
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.client.callTool({
      name,
      arguments: args,
    });
  }

  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.toolsCache = null;
    this.transportType = null;
  }

  /**
   * Get cached tools without re-fetching
   */
  getCachedTools(): any[] | null {
    return this.toolsCache;
  }

  /**
   * Get the transport type that was used for connection
   */
  getTransportType(): "streamable-http" | "sse" | null {
    return this.transportType;
  }
}
