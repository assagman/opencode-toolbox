import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RemoteMCPServerConfig } from "./types";
import type { MCPClient } from "./types";

/**
 * Remote MCP client using SSE transport
 */
export class RemoteMCPClient implements MCPClient {
  private client: Client;
  private transport: SSEClientTransport | null;
  private toolsCache: any[] | null;
  private name: string;
  private config: RemoteMCPServerConfig;

  constructor(config: { name: string } & RemoteMCPServerConfig) {
    this.transport = null;
    this.toolsCache = null;
    this.name = config.name;
    this.config = config;

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

    this.transport = new SSEClientTransport(url, {
      requestInit: {
        headers: this.config.headers,
      },
    });

    await this.client.connect(this.transport);
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
  }

  /**
   * Get cached tools without re-fetching
   */
  getCachedTools(): any[] | null {
    return this.toolsCache;
  }
}
