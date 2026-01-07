import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config";
import { MCPManager } from "./mcp-client";
import { BM25Index, searchWithRegex, MAX_REGEX_LENGTH } from "./search";
import type { CatalogTool, SearchResult } from "./catalog";

const DEFAULT_CONFIG_PATH = `${process.env.HOME}/.config/opencode/toolbox.jsonc`;

/**
 * Parse tool name into server and original tool name
 * Format: "serverName_toolName" where serverName may contain underscores
 */
function parseToolName(
  fullName: string,
): { serverName: string; toolName: string } | null {
  const underscoreIndex = fullName.indexOf("_");
  if (underscoreIndex === -1) {
    return null;
  }

  return {
    serverName: fullName.substring(0, underscoreIndex),
    toolName: fullName.substring(underscoreIndex + 1),
  };
}

/**
 * Format search results for LLM consumption
 */
function formatSearchResults(
  results: SearchResult[],
  allTools: CatalogTool[],
): string {
  const toolMap = new Map(allTools.map((t) => [t.idString, t]));

  const output = {
    count: results.length,
    tools: results.map((r) => {
      const catalogTool = toolMap.get(r.idString);
      return {
        name: r.idString,
        description: catalogTool?.description || r.preview,
        score: r.score,
        schema: catalogTool?.inputSchema || null,
      };
    }),
    usage:
      "Use toolbox_execute({ name: '<tool_name>', arguments: '<json>' }) to run a discovered tool",
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Tool descriptions - short, directive style
 */
const BM25_DESC = `Search extended toolbox by natural language. ALWAYS search before saying "I cannot do that."

Returns tools with schemas. Use toolbox_execute() to run them.`;

const REGEX_DESC = `Search extended toolbox by regex pattern on tool names. ALWAYS search before saying "I cannot do that."

Use when you know part of a tool name or server prefix (e.g., "time_.*", "exa_.*search.*").

Returns tools with schemas. Use toolbox_execute() to run them.`;

const EXECUTE_DESC = `Execute a tool discovered via toolbox_search_bm25 or toolbox_search_regex.

Pass arguments as JSON string matching the tool's schema.`;

/**
 * System prompt injection - concise instructions for tool search
 */
const SYSTEM_PROMPT_BASE = `# Extended Toolbox

You have access to an extended toolbox with additional capabilities (web search, time utilities, code search, etc.).

## Rule
ALWAYS search before saying "I cannot do that" or "I don't have access to."

## Workflow
1. Search: toolbox_search_bm25({ text: "what you need" }) or toolbox_search_regex({ pattern: "prefix_.*" })
2. Execute: toolbox_execute({ name: "tool_name", arguments: '{"key": "value"}' })`;

/**
 * Generate system prompt with registered MCP servers and their tools
 * Uses JSON schema format with full tool names (serverName_toolName)
 */
function generateSystemPrompt(mcpManager: MCPManager): string {
  const servers = mcpManager.getAllServers();
  
  if (servers.length === 0) {
    return SYSTEM_PROMPT_BASE;
  }

  const toolboxSchema: Record<string, string[]> = {};
  
  for (const server of servers) {
    if (server.status === "connected" && server.tools.length > 0) {
      toolboxSchema[server.name] = server.tools.map(t => t.idString);
    }
  }

  if (Object.keys(toolboxSchema).length === 0) {
    return SYSTEM_PROMPT_BASE;
  }

  return `${SYSTEM_PROMPT_BASE}

## Toolbox Schema
Tool names use \`<server>_<tool>\` format. Pass exact names to toolbox_execute().
\`\`\`json
${JSON.stringify(toolboxSchema, null, 2)}
\`\`\``;
}

/**
 * Toolbox Plugin - Tool Search Tool for OpenCode
 *
 * Provides on-demand access to MCP server tools through three tools:
 * - toolbox_search_bm25: Natural language search
 * - toolbox_search_regex: Pattern-based search
 * - toolbox_execute: Execute discovered tools
 */
export const ToolboxPlugin: Plugin = async (ctx: PluginInput) => {
  // Load configuration
  const configPath = process.env.OPENCODE_TOOLBOX_CONFIG || DEFAULT_CONFIG_PATH;
  const configResult = await loadConfig(configPath);

  if (!configResult.success) {
    console.error(
      "[Toolbox] Failed to load config:",
      configResult.error.issues,
    );
    // Return empty hooks if config fails - plugin disabled
    return {};
  }

  const config = configResult.data;

  // Initialize MCP manager and search index
  const mcpManager = new MCPManager();
  const bm25Index = new BM25Index();
  let initialized = false;

  /**
   * Lazy initialization - connect to MCP servers on first use
   */
  async function ensureInitialized(): Promise<void> {
    if (initialized) return;

    try {
      await mcpManager.initialize(config.servers);
      const allTools = mcpManager.getAllCatalogTools();
      bm25Index.indexTools(allTools);
      initialized = true;
    } catch (error) {
      console.error("[Toolbox] Failed to initialize MCP servers:", error);
      throw error;
    }
  }

  return {
    tool: {
      /**
       * BM25 Natural Language Search
       * Use this when you need to find tools by describing what you want in plain English.
       */
      toolbox_search_bm25: tool({
        description: BM25_DESC,

        args: {
          text: tool.schema
            .string()
            .describe(
              "Natural language description of the tool you're looking for (e.g., 'get current time', 'search the web')",
            ),
          limit: tool.schema
            .number()
            .optional()
            .describe("Maximum number of results to return (default: 5)"),
        },

        async execute(args) {
          try {
            await ensureInitialized();
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          const searchLimit = args.limit || config.settings?.defaultLimit || 5;
          const allTools = mcpManager.getAllCatalogTools();
          const results = bm25Index.search(args.text, searchLimit);
          return formatSearchResults(results, allTools);
        },
      }),

      /**
       * Regex Pattern Search
       * Use this when you know part of a tool name or want to browse tools from a specific server.
       */
      toolbox_search_regex: tool({
        description: REGEX_DESC,

        args: {
          pattern: tool.schema
            .string()
            .describe(
              `Regex pattern to match tool names (max ${MAX_REGEX_LENGTH} chars). Examples: "time_.*", "exa_.*search.*"`,
            ),
          limit: tool.schema
            .number()
            .optional()
            .describe("Maximum number of results to return (default: 5)"),
        },

        async execute(args) {
          try {
            await ensureInitialized();
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          const searchLimit = args.limit || config.settings?.defaultLimit || 5;
          const allTools = mcpManager.getAllCatalogTools();
          const result = searchWithRegex(allTools, args.pattern, searchLimit);

          if ("error" in result) {
            return JSON.stringify({
              success: false,
              error: result.error,
            });
          }

          return formatSearchResults(result, allTools);
        },
      }),

      /**
       * Tool Executor
       * Use this to run a tool discovered via toolbox_search_bm25 or toolbox_search_regex.
       */
      toolbox_execute: tool({
        description: EXECUTE_DESC,

        args: {
          name: tool.schema
            .string()
            .describe(
              "Full tool name from search results (e.g., 'time_get_current_time', 'exa_web_search')",
            ),
          arguments: tool.schema
            .string()
            .optional()
            .describe(
              "JSON-encoded arguments for the tool, matching its schema. Use '{}' or omit for tools with no required arguments.",
            ),
        },

        async execute(args) {
          try {
            await ensureInitialized();
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // Parse tool name to get server and original tool name
          const parsed = parseToolName(args.name);
          if (!parsed) {
            return JSON.stringify({
              success: false,
              error: `Invalid tool name format: ${args.name}. Expected format: serverName_toolName (e.g., 'time_get_current_time')`,
            });
          }

          // Parse tool arguments
          let toolArgs: Record<string, unknown> = {};
          if (args.arguments) {
            try {
              toolArgs = JSON.parse(args.arguments);
            } catch (error) {
              return JSON.stringify({
                success: false,
                error: `Failed to parse arguments as JSON: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }

          // Call the underlying MCP server
          try {
            const result = await mcpManager.callTool(
              parsed.serverName,
              parsed.toolName,
              toolArgs,
            );

            return JSON.stringify({
              success: true,
              result,
            });
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        },
      }),
    },

    // Inject system prompt with tool search instructions
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        await ensureInitialized();
        output.system.push(generateSystemPrompt(mcpManager));
      } catch {
        // If initialization fails, use base prompt without server listing
        output.system.push(SYSTEM_PROMPT_BASE);
      }
    },
  };
};

// Default export for OpenCode plugin system
export default ToolboxPlugin;
