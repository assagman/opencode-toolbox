// OpenCode Toolbox Plugin - Tool Search Tool
// Provides on-demand access to MCP server tools through search and execute

export { ToolboxPlugin, ToolboxPlugin as default } from "./plugin";

// Re-export types for consumers
export type { Config, ServerConfig, LocalServerConfig, RemoteServerConfig } from "./config";
export type { CatalogTool, SearchResult, ToolIdString } from "./catalog";
