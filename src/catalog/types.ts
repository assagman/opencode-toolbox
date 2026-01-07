// Canonical identifier for a tool in the catalog
export type ToolId = {
  server: string;  // underlying MCP server name
  name: string;    // original tool name
};

// Combined tool ID for easy comparison (e.g., "gmail_send_email")
export type ToolIdString = `${string}_${string}`;

export type CatalogTool = {
  id: ToolId;
  idString: ToolIdString;
  description: string;
  inputSchema: Record<string, unknown>;  // Full MCP/JSON schema
  searchableText: string;  // Flattened text for indexing (name + desc + args)
  args: Array<{ name: string; description?: string }>;
};

// Search result
export type SearchResult = {
  tool: ToolId;
  idString: ToolIdString;
  score: number;
  preview: string;  // Description
  signature: string;  // Condensed function signature
};
