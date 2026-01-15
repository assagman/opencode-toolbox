import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RemoteMCPServerConfig } from "./types";
import type { MCPClient } from "./types";

/**
 * Transport-like interface for DI/testing
 */
export interface RemoteTransport {
  close(): Promise<void>;
}

/**
 * Client-like interface for DI/testing
 */
export interface RemoteClientLike {
  connect(transport: RemoteTransport): Promise<void>;
  listTools(): Promise<{ tools: any[] }>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<any>;
}

/**
 * Options for RemoteMCPClient including DI seams for testing
 */
export interface RemoteMCPClientOptions {
  /** Override Client creation for testing */
  clientFactory?: (name: string) => RemoteClientLike;
  /** Override StreamableHTTP transport creation for testing */
  streamableTransportFactory?: (url: URL, headers?: Record<string, string>) => RemoteTransport;
  /** Override SSE transport creation for testing */
  sseTransportFactory?: (url: URL, headers: Record<string, string>) => RemoteTransport;
}

/**
 * Remote MCP client with auto-detection
 * Tries Streamable HTTP first (newer), falls back to SSE (legacy)
 */
export class RemoteMCPClient implements MCPClient {
  private client: RemoteClientLike;
  private transport: RemoteTransport | null;
  private toolsCache: any[] | null;
  private name: string;
  private config: RemoteMCPServerConfig;
  private transportType: "streamable-http" | "sse" | null;
  private options: RemoteMCPClientOptions;

  constructor(
    config: { name: string } & RemoteMCPServerConfig,
    options?: RemoteMCPClientOptions
  ) {
    this.transport = null;
    this.toolsCache = null;
    this.name = config.name;
    this.config = config;
    this.transportType = null;
    this.options = options ?? {};

    this.client = this.createClient();
  }

  private createClient(): RemoteClientLike {
    if (this.options.clientFactory) {
      return this.options.clientFactory(this.name);
    }
    return new Client(
      {
        name: `opencode-toolbox-client-${this.name}`,
        version: "0.1.0",
      },
      {}
    );
  }

  private createStreamableTransport(url: URL): RemoteTransport {
    if (this.options.streamableTransportFactory) {
      return this.options.streamableTransportFactory(url, this.config.headers);
    }
    return new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: this.config.headers,
      },
    });
  }

  private createSSETransport(url: URL, headers: Record<string, string>): RemoteTransport {
    if (this.options.sseTransportFactory) {
      return this.options.sseTransportFactory(url, headers);
    }
    return new SSEClientTransport(url, {
      requestInit: {
        headers,
      },
    });
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`Remote MCP server ${this.name} has no URL`);
    }

    const url = new URL(this.config.url);
    this.transportType = null;

    // Try Streamable HTTP first (newer protocol)
    let streamableTransport: RemoteTransport | null = null;
    try {
      streamableTransport = this.createStreamableTransport(url);

      await this.client.connect(streamableTransport);
      this.transport = streamableTransport;
      this.transportType = "streamable-http";
      return;
    } catch (error) {
      // Clean up only the attempted transport; avoid closing an existing connection.
      if (streamableTransport) {
        await streamableTransport.close().catch(() => {});
      }

      // If Streamable HTTP fails, try SSE fallback
      // Reset client for new connection attempt
      this.client = this.createClient();
    }

    // Fallback to SSE transport (legacy)
    let sseTransport: RemoteTransport | null = null;
    try {
      const sseHeaders = {
        Accept: "text/event-stream",
        ...this.config.headers,
      };

      sseTransport = this.createSSETransport(url, sseHeaders);

      await this.client.connect(sseTransport);
      this.transport = sseTransport;
      this.transportType = "sse";
    } catch (error) {
      // Clean up only the attempted transport; avoid closing an existing connection.
      if (sseTransport) {
        await sseTransport.close().catch(() => {});
      }
      this.transport = null;
      this.transportType = null;
      throw error;
    }
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
