import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LocalMCPServerConfig } from "./types";
import type { MCPClient } from "./types";

/**
 * Local MCP client using stdio transport
 */
export class LocalMCPClient implements MCPClient {
  private client: Client;
  private transport: StdioClientTransport | null;
  private toolsCache: any[] | null;
  private name: string;
  private config: LocalMCPServerConfig;

  constructor(config: { name: string } & LocalMCPServerConfig) {
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
    if (!this.config.command || this.config.command.length === 0) {
      throw new Error(`Local MCP server ${this.name} has no command`);
    }

    this.transport = new StdioClientTransport({
      command: this.config.command[0]!,
      args: this.config.command.slice(1),
      env: {
        ...(process.env as Record<string, string>),
        ...this.config.environment,
      },
      stderr: "pipe",
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
