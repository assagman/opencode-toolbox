import type { MCPServerConfig, MCPServer, MCPClient } from "./types";
import { normalizeTools } from "../catalog";
import { LocalMCPClient } from "./local";
import { RemoteMCPClient } from "./remote";

/**
 * Factory function type for creating MCP clients
 * Used for dependency injection in tests
 */
export type MCPClientFactory = (name: string, config: MCPServerConfig) => MCPClient;

/**
 * Options for MCPManager
 */
export type MCPManagerOptions = {
  /** Custom client factory for testing */
  clientFactory?: MCPClientFactory;
};

export class MCPManager {
  private servers: Map<string, MCPServer>;
  private clients: Map<string, MCPClient>;
  private clientFactory: MCPClientFactory;

  constructor(options?: MCPManagerOptions) {
    this.servers = new Map();
    this.clients = new Map();
    this.clientFactory = options?.clientFactory || this.defaultClientFactory.bind(this);
  }

  /**
   * Default client factory - creates real MCP clients
   */
  private defaultClientFactory(name: string, config: MCPServerConfig): MCPClient {
    if (config.type === "local") {
      return new LocalMCPClient({ name, ...config });
    } else if (config.type === "remote") {
      return new RemoteMCPClient({ name, ...config });
    } else {
      throw new Error(`Unknown server type: ${(config as any).type}`);
    }
  }

  /**
   * Initialize all servers from config
   */
  async initialize(servers: Record<string, MCPServerConfig>): Promise<void> {
    const promises = Object.entries(servers).map(
      async ([name, config]) => {
        return this.connectServer(name, config);
      }
    );

    await Promise.all(promises);
  }

  /**
   * Connect to a single MCP server
   */
  private async connectServer(
    name: string,
    config: MCPServerConfig
  ): Promise<void> {
    this.servers.set(name, {
      name,
      config,
      tools: [],
      status: "connecting",
    });

    try {
      // Create client using factory (allows injection for testing)
      const client = this.clientFactory(name, config);

      // Connect and fetch tools
      await client.connect();
      const tools = await client.listTools();
      const catalogTools = normalizeTools(name, tools);

      // Update server and client maps
      this.servers.set(name, {
        name,
        config,
        tools: catalogTools,
        status: "connected",
      });
      this.clients.set(name, client);
    } catch (error) {
      this.servers.set(name, {
        name,
        config,
        tools: [],
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools() {
    const allTools: Array<{ server: string; tools: MCPServer["tools"] }> = [];

    for (const [name, server] of this.servers) {
      if (server.status === "connected") {
        allTools.push({ server: name, tools: server.tools });
      }
    }

    return allTools;
  }

  /**
   * Get all catalog tools flattened
   */
  getAllCatalogTools() {
    const tools: MCPServer["tools"][number][] = [];

    for (const server of this.servers.values()) {
      if (server.status === "connected") {
        tools.push(...server.tools);
      }
    }

    return tools;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP client not found for server: ${serverName}`);
    }

    return client.callTool(toolName, args);
  }

  /**
   * Get server status
   */
  getServer(name: string) {
    return this.servers.get(name);
  }

  /**
   * Get all servers
   */
  getAllServers() {
    return Array.from(this.servers.values());
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => client.close());
    await Promise.all(promises);
    this.servers.clear();
    this.clients.clear();
  }
}
