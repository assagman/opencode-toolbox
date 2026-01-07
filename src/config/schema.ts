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
 * Plugin settings
 */
export const SettingsConfigSchema = z.object({
  /** Default number of search results to return */
  defaultLimit: z.number().min(1).max(20).default(5),
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
