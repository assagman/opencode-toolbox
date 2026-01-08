import { z } from "zod";

/**
 * Local MCP server configuration
 * Spawns a process and communicates via stdio
 */
export const LocalServerConfigSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()).min(1).describe("Command and arguments to spawn the MCP server"),
  environment: z.record(z.string(), z.string()).optional().describe("Environment variables for the process"),
});

/**
 * Remote MCP server configuration
 * Connects via SSE (Server-Sent Events)
 */
export const RemoteServerConfigSchema = z.object({
  type: z.literal("remote"),
  url: z.string().url().describe("SSE endpoint URL"),
  headers: z.record(z.string(), z.string()).optional().describe("HTTP headers for authentication"),
});

export const ServerConfigSchema = z.discriminatedUnion("type", [
  LocalServerConfigSchema,
  RemoteServerConfigSchema,
]);

/**
 * Connection settings for MCP servers
 */
export const ConnectionConfigSchema = z.object({
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout: z.number().min(100).max(60000).default(5000),
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout: z.number().min(100).max(300000).default(30000),
  /** Number of retry attempts on connection failure (default: 2) */
  retryAttempts: z.number().min(0).max(10).default(2),
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelay: z.number().min(0).max(30000).default(1000),
});

/**
 * Plugin settings
 */
export const SettingsConfigSchema = z.object({
  /** Default number of search results to return */
  defaultLimit: z.number().min(1).max(20).default(5),
  /** 
   * Initialization mode:
   * - "eager": Start connecting to servers immediately on plugin load (non-blocking)
   * - "lazy": Connect only when first tool is used (default for backward compat)
   */
  initMode: z.enum(["eager", "lazy"]).default("eager"),
  /** Connection settings */
  connection: ConnectionConfigSchema.optional(),
});

/**
 * Toolbox Plugin configuration schema
 * Located at ~/.config/opencode/toolbox.jsonc
 */
export const ConfigSchema = z.object({
  /** MCP servers to connect to */
  mcp: z.record(z.string(), ServerConfigSchema),
  /** Plugin settings */
  settings: SettingsConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LocalServerConfig = z.infer<typeof LocalServerConfigSchema>;
export type RemoteServerConfig = z.infer<typeof RemoteServerConfigSchema>;
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
export type SettingsConfig = z.infer<typeof SettingsConfigSchema>;
