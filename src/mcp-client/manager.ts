import { EventEmitter } from "events";
import type { MCPServerConfig, MCPServer, MCPClient } from "./types";
import type { ConnectionConfig } from "../config";
import { normalizeTools } from "../catalog";
import { LocalMCPClient } from "./local";
import { RemoteMCPClient } from "./remote";
import { globalProfiler } from "../profiler";
import type { CatalogTool } from "../catalog";

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
  /** Connection configuration */
  connectionConfig?: ConnectionConfig;
};

/**
 * Initialization state for the manager
 */
export type InitState = "idle" | "initializing" | "partial" | "ready" | "degraded";

/**
 * Events emitted by MCPManager
 */
export interface MCPManagerEvents {
  /** Emitted when a server successfully connects with its tools */
  "server:connected": (serverName: string, tools: CatalogTool[]) => void;
  /** Emitted when a server fails to connect */
  "server:error": (serverName: string, error: string) => void;
  /** Emitted when initialization completes (all servers attempted) */
  "init:complete": (state: InitState) => void;
  /** Emitted when at least one server is ready (partial init) */
  "init:partial": () => void;
}

// Default connection settings
const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  connectTimeout: 5000,
  requestTimeout: 30000,
  retryAttempts: 2,
  retryDelay: 1000,
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Race a promise against a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ]);
}

export class MCPManager extends EventEmitter {
  private servers: Map<string, MCPServer>;
  private clients: Map<string, MCPClient>;
  private clientFactory: MCPClientFactory;
  private connectionConfig: ConnectionConfig;
  
  // Initialization state
  private initState: InitState = "idle";
  private initPromise: Promise<void> | null = null;
  private serversPending: number = 0;
  private serversCompleted: number = 0;

  constructor(options?: MCPManagerOptions) {
    super();
    this.servers = new Map();
    this.clients = new Map();
    this.clientFactory = options?.clientFactory || this.defaultClientFactory.bind(this);
    this.connectionConfig = { ...DEFAULT_CONNECTION_CONFIG, ...options?.connectionConfig };
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
   * Returns immediately, connections happen in background
   * Use waitForReady() or listen to events for completion
   */
  async initialize(servers: Record<string, MCPServerConfig>): Promise<void> {
    if (this.initState !== "idle") {
      // Already initializing or initialized
      return this.initPromise || Promise.resolve();
    }

    globalProfiler.initStart();
    this.initState = "initializing";
    this.serversPending = Object.keys(servers).length;
    this.serversCompleted = 0;

    // Start all connections concurrently
    const promises = Object.entries(servers).map(
      async ([name, config]) => {
        return this.connectServerWithRetry(name, config);
      }
    );

    // Create the init promise but don't await it here
    this.initPromise = Promise.all(promises).then(() => {
      this.finalizeInit();
    });

    return this.initPromise;
  }

  /**
   * Start initialization without waiting
   * Use for eager/background initialization
   */
  initializeBackground(servers: Record<string, MCPServerConfig>): void {
    // Fire and forget - initialization happens in background
    this.initialize(servers).catch(() => {
      // Errors are handled per-server, this catch is for safety
    });
  }

  /**
   * Finalize initialization state based on results
   */
  private finalizeInit(): void {
    const allServers = Array.from(this.servers.values());
    const connected = allServers.filter(s => s.status === "connected");
    const failed = allServers.filter(s => s.status === "error");

    if (connected.length === allServers.length) {
      this.initState = "ready";
    } else if (connected.length > 0) {
      this.initState = "degraded";
    } else {
      this.initState = "degraded"; // All failed but we're still "done"
    }

    globalProfiler.initComplete(this.initState);
    this.emit("init:complete", this.initState);
  }

  /**
   * Connect to a server with retry logic
   */
  private async connectServerWithRetry(
    name: string,
    config: MCPServerConfig
  ): Promise<void> {
    const maxAttempts = this.connectionConfig.retryAttempts + 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.connectServer(name, config);
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxAttempts) {
          // Exponential backoff based on retryDelay (base)
          const baseDelay = this.connectionConfig.retryDelay;
          const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
          // Cap to 30s to avoid excessively long waits
          const delayMs = Math.min(exponentialDelay, 30000);
          await sleep(delayMs);
        }
      }
    }

    // All retries failed
    this.servers.set(name, {
      name,
      config,
      tools: [],
      status: "error",
      error: lastError?.message || "Connection failed after retries",
    });

    globalProfiler.recordServerConnect(
      name,
      -1,
      0,
      "error",
      lastError?.message
    );

    this.emit("server:error", name, lastError?.message || "Unknown error");
    this.checkPartialReady();
  }

  /**
   * Connect to a single MCP server
   */
  private async connectServer(
    name: string,
    config: MCPServerConfig
  ): Promise<void> {
    const startTime = performance.now();
    
    this.servers.set(name, {
      name,
      config,
      tools: [],
      status: "connecting",
    });

    // Create client using factory (allows injection for testing)
    const client = this.clientFactory(name, config);

    // Connect with timeout
    await withTimeout(
      client.connect(),
      this.connectionConfig.connectTimeout,
      `Connection to ${name} timed out after ${this.connectionConfig.connectTimeout}ms`
    );

    // Fetch tools with timeout
    const tools = await withTimeout(
      client.listTools(),
      this.connectionConfig.requestTimeout,
      `Listing tools from ${name} timed out after ${this.connectionConfig.requestTimeout}ms`
    );
    
    const catalogTools = normalizeTools(name, tools);
    const connectTime = performance.now() - startTime;

    // Update server and client maps
    this.servers.set(name, {
      name,
      config,
      tools: catalogTools,
      status: "connected",
    });
    this.clients.set(name, client);

    // Record metrics
    globalProfiler.recordServerConnect(name, connectTime, catalogTools.length, "connected");

    // Emit event for progressive loading
    this.emit("server:connected", name, catalogTools);
    this.checkPartialReady();
  }

  /**
   * Check if we've reached partial readiness (at least one server ready)
   */
  private checkPartialReady(): void {
    this.serversCompleted++;
    
    if (this.initState === "initializing") {
      const connected = Array.from(this.servers.values()).filter(s => s.status === "connected");
      if (connected.length === 1 && this.serversCompleted < this.serversPending) {
        // First server ready, emit partial ready event
        this.initState = "partial";
        this.emit("init:partial");
      }
    }
  }

  /**
   * Check if at least one server is ready for queries
   */
  isReady(): boolean {
    return this.initState === "ready" || 
           this.initState === "partial" || 
           this.initState === "degraded";
  }

  /**
   * Check if all servers have completed initialization (success or failure)
   */
  isComplete(): boolean {
    return this.initState === "ready" || this.initState === "degraded";
  }

  /**
   * Get current initialization state
   */
  getInitState(): InitState {
    return this.initState;
  }

  /**
   * Wait for initialization to complete
   * Resolves when all servers have been attempted
   */
  async waitForReady(): Promise<InitState> {
    if (this.isComplete()) {
      return this.initState;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.initState;
    }

    return this.initState;
  }

  /**
   * Wait for at least one server to be ready
   * Faster than waitForReady() when you just need partial functionality
   */
  waitForPartial(): Promise<void> {
    if (this.isReady()) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      const onPartial = () => {
        this.off("init:partial", onPartial);
        this.off("init:complete", onComplete);
        resolve();
      };
      const onComplete = () => {
        this.off("init:partial", onPartial);
        this.off("init:complete", onComplete);
        resolve();
      };
      this.on("init:partial", onPartial);
      this.on("init:complete", onComplete);
    });
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
  getAllCatalogTools(): CatalogTool[] {
    const tools: CatalogTool[] = [];

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

    return withTimeout(
      client.callTool(toolName, args),
      this.connectionConfig.requestTimeout,
      `Tool execution timed out after ${this.connectionConfig.requestTimeout}ms`
    );
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
    this.initState = "idle";
    this.initPromise = null;
  }
}
