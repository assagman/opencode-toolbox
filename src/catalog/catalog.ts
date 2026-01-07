import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CatalogTool, ToolId, ToolIdString } from "./types";

/**
 * Normalize a tool from an MCP server into a CatalogTool
 */
export function normalizeTool(
  serverName: string,
  tool: Tool
): CatalogTool {
  const id: ToolId = {
    server: serverName,
    name: tool.name,
  };

  const idString: ToolIdString = `${serverName}_${tool.name}`;

  // Extract argument information for indexing
  const args = extractArgs(tool.inputSchema);

  // Build searchable text (name + description + arg names/descriptions)
  const searchableText = buildSearchableText(serverName, tool, args);

  return {
    id,
    idString,
    description: tool.description || "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
    searchableText,
    args,
  };
}

/**
 * Extract argument information from JSON schema
 */
function extractArgs(
  schema: Tool["inputSchema"]
): Array<{ name: string; description?: string }> {
  const args: Array<{ name: string; description?: string }> = [];

  if (
    typeof schema === "object" &&
    schema !== null &&
    "type" in schema &&
    schema.type === "object" &&
    "properties" in schema &&
    typeof schema.properties === "object" &&
    schema.properties !== null
  ) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      const propSchema = prop as Record<string, unknown> | null;
      const description =
        propSchema && typeof propSchema === "object" && "description" in propSchema
          ? String(propSchema.description)
          : undefined;
      args.push({ name, description });
    }
  }

  return args;
}

/**
 * Build searchable text for a tool
 * Includes: qualified name, original name, description, argument names, argument descriptions
 */
function buildSearchableText(
  serverName: string,
  tool: Tool,
  args: Array<{ name: string; description?: string }>
): string {
  const parts: string[] = [];

  // Add qualified name (server_toolname) for regex matching
  parts.push(`${serverName}_${tool.name}`);
  
  // Add original tool name
  parts.push(tool.name);

  // Add description
  if (tool.description) {
    parts.push(tool.description);
  }

  // Add argument names and descriptions
  for (const arg of args) {
    parts.push(arg.name);
    if (arg.description) {
      parts.push(arg.description);
    }
  }

  return parts.join(" ");
}

/**
 * Normalize multiple tools from a server
 */
export function normalizeTools(
  serverName: string,
  tools: Tool[]
): CatalogTool[] {
  return tools.map(tool => normalizeTool(serverName, tool));
}
