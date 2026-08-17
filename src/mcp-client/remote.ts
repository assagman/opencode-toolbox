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
  /** Override fetch used for raw tools/list recovery, for testing */
  fetchImpl?: typeof fetch;
}

/**
 * True if an error looks like a JSON Schema $ref/$defs resolution failure
 * from the MCP SDK's tool-list validation, rather than an auth/network/
 * transport failure. Used to scope the raw-fetch recovery path narrowly to
 * the one failure mode it's designed for.
 */
export function isSchemaResolutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /resolve reference|\$defs|\$ref\b/i.test(message);
}

/**
 * Recursively collect every "$ref" value found anywhere inside a JSON
 * Schema object/array.
 */
function collectRefs(schema: unknown, out: Set<string>): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) collectRefs(item, out);
    return;
  }
  const obj = schema as Record<string, unknown>;
  if (typeof obj["$ref"] === "string") out.add(obj["$ref"]);
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$ref") continue;
    collectRefs(value, out);
  }
}

/**
 * Returns the names of any "#/$defs/X" references in `schema` whose target
 * X is not declared in that same schema's own top-level "$defs". Each tool's
 * inputSchema/outputSchema is expected to be self-contained (MCP has no
 * shared cross-tool schema namespace), so a non-empty result here means the
 * server emitted a genuinely broken schema for that tool.
 */
export function unresolvedLocalRefs(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const obj = schema as Record<string, unknown>;
  const localDefs = new Set(Object.keys((obj["$defs"] as Record<string, unknown>) ?? {}));
  const refs = new Set<string>();
  collectRefs(obj, refs);
  const missing: string[] = [];
  const prefix = "#/$defs/";
  for (const ref of refs) {
    if (!ref.startsWith(prefix)) continue;
    const defName = ref.slice(prefix.length);
    if (!localDefs.has(defName)) missing.push(defName);
  }
  return missing;
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
    try {
      const result = await this.client.listTools();
      this.toolsCache = result.tools;
      return result.tools;
    } catch (error) {
      // Only recover from the specific failure mode this handles: the SDK
      // validates the whole tools/list batch atomically and throws on a
      // dangling $ref, taking down every tool on the server even when only
      // one tool's schema is malformed. Any other failure (auth, network,
      // timeout) is rethrown unchanged.
      if (!isSchemaResolutionError(error)) throw error;

      const recovered = await this.recoverToolsViaRawFetch(error);
      this.toolsCache = recovered;
      return recovered;
    }
  }

  /**
   * Fallback for when the SDK's atomic tools/list validation fails due to a
   * server-emitted schema with a dangling $ref (a $ref to a $defs entry the
   * tool's own schema never declares). Fetches the raw JSON-RPC response
   * directly, bypassing SDK-side validation, and registers only the tools
   * whose schemas are actually self-contained. Broken tools are dropped and
   * reported via console.warn, not silently hidden. If recovery can't
   * produce at least one good tool, the original error is thrown.
   */
  private async recoverToolsViaRawFetch(originalError: unknown): Promise<any[]> {
    if (!this.config.url) throw originalError;

    const doFetch = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.config.headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `toolbox-recover-${Date.now()}`,
          method: "tools/list",
          params: {},
        }),
      });
    } catch {
      throw originalError;
    }

    if (!response.ok) throw originalError;

    const contentType = response.headers.get("content-type") ?? "";
    let payload: any;
    try {
      if (contentType.includes("text/event-stream")) {
        const text = await response.text();
        const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) throw originalError;
        payload = JSON.parse(dataLine.slice("data:".length).trim());
      } else {
        payload = await response.json();
      }
    } catch {
      throw originalError;
    }

    const rawTools: any[] = payload?.result?.tools ?? [];
    if (rawTools.length === 0) throw originalError;

    const goodTools: any[] = [];
    for (const tool of rawTools) {
      const missing = [
        ...unresolvedLocalRefs(tool.inputSchema),
        ...unresolvedLocalRefs(tool.outputSchema),
      ];
      if (missing.length > 0) {
        console.warn(
          `[toolbox] ${this.name}: skipping tool "${tool.name}" — unresolvable schema ` +
            `$ref(s) to ${missing.join(", ")}. This tool's own schema doesn't declare ` +
            `the $defs it references (upstream server bug, not a toolbox config issue).`
        );
        continue;
      }
      goodTools.push(tool);
    }

    if (goodTools.length === 0) throw originalError;

    console.warn(
      `[toolbox] ${this.name}: recovered ${goodTools.length}/${rawTools.length} tools via ` +
        `raw tools/list fetch after SDK schema validation failed.`
    );

    return goodTools;
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
