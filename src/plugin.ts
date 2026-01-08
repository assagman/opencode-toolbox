import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { appendFile, mkdir, writeFile, access } from "fs/promises";
import { loadConfig } from "./config";
import type { ConnectionConfig } from "./config";
import { MCPManager } from "./mcp-client";
import { BM25Index, searchWithRegex, MAX_REGEX_LENGTH } from "./search";
import type { CatalogTool, SearchResult } from "./catalog";
import { globalProfiler } from "./profiler";

const DEFAULT_CONFIG_PATH = `${process.env.HOME}/.config/opencode/toolbox.jsonc`;
const LOG_FILE_PATH = `${process.env.HOME}/.local/share/opencode/toolbox.log`;
const LOG_DIR = `${process.env.HOME}/.local/share/opencode`;

// Slash command paths
const COMMAND_DIR = `${process.env.HOME}/.config/opencode/command`;
const COMMAND_FILE_PATH = `${COMMAND_DIR}/toolbox-status.md`;
const COMMAND_CONTENT = `---
description: Check toolbox plugin status and server health
---
Run toolbox_status({}) tool and show me the results in a readable format.
Highlight any failed servers or issues.
`;

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

const STATUS_DESC = `Get toolbox status including plugin initialization, MCP server connections, and tool counts.

Shows success/total metrics to highlight failures. Use to check if toolbox is working correctly.`;

const PERF_DESC = `Get detailed performance metrics for the toolbox plugin.

Shows initialization times, search latencies, execution stats, and per-server metrics.`;

/**
 * Safe logging helper - writes to ~/.local/share/opencode/toolbox.log
 * Never blocks or throws
 */
function log(level: string, message: string, extra?: any) {
  const timestamp = new Date().toISOString();
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : "";
  const line = `${timestamp} [${level.toUpperCase()}] ${message}${extraStr}\n`;

  // Fire and forget - never block
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE_PATH, line))
    .catch(() => {
      // Ignore errors - never block
    });
}

/**
 * Create /toolbox-status slash command if it doesn't exist
 * Non-blocking, fire and forget
 */
function ensureCommandFile() {
  access(COMMAND_FILE_PATH).catch(() => {
    // File doesn't exist, create it
    mkdir(COMMAND_DIR, { recursive: true })
      .then(() => writeFile(COMMAND_FILE_PATH, COMMAND_CONTENT))
      .then(() => log("info", "Created /toolbox-status command file"))
      .catch(() => {
        // Ignore errors - non-critical
      });
  });
}

/**
 * System prompt injection - concise instructions for tool search
 */
const SYSTEM_PROMPT_BASE = `# Extended Toolbox

You have access to an extended toolbox with additional capabilities (web search, time utilities, code search, etc.).

## Rules
1. ALWAYS toolbox_search_* before saying "I cannot do that" or "I don't have access to."
2. ALWAYS toolbox_search_* if you think that user wants you to use some tools
3. ALWAYS toolbox_search_* if you think that user may refer specific tool name which is not exist in the context

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
      toolboxSchema[server.name] = server.tools.map((t) => t.idString);
    }
  }

  if (Object.keys(toolboxSchema).length === 0) {
    return SYSTEM_PROMPT_BASE;
  }

  return `${SYSTEM_PROMPT_BASE}

## Registered MCP Servers
${Object.entries(toolboxSchema).map(([server, tools]) => `- ${server}: ${tools.map(t => t.split('_').slice(1).join('_')).join(', ')}`).join('\n')}`;
}

/**
 * Toolbox Plugin - Tool Search Tool for OpenCode
 *
 * Provides on-demand access to MCP server tools through four tools:
 * - toolbox_search_bm25: Natural language search
 * - toolbox_search_regex: Pattern-based search
 * - toolbox_execute: Execute discovered tools
 * - toolbox_status: Get plugin and server status
 * - toolbox_perf: Get performance metrics
 */
export const ToolboxPlugin: Plugin = async (ctx: PluginInput) => {
  const { client } = ctx;

  // Load configuration
  const configPath = process.env.OPENCODE_TOOLBOX_CONFIG || DEFAULT_CONFIG_PATH;
  const configResult = await loadConfig(configPath);

  if (!configResult.success) {
    const errorMsg = `Failed to load config from ${configPath}: ${configResult.error.issues.map((i) => i.message).join(", ")}`;
    // Log to file only - don't block
    log("error", errorMsg);
    // Return empty hooks if config fails - plugin disabled
    return {};
  }

  const config = configResult.data;
  const initMode = config.settings?.initMode || "eager";
  const connectionConfig: ConnectionConfig = {
    connectTimeout: config.settings?.connection?.connectTimeout || 5000,
    requestTimeout: config.settings?.connection?.requestTimeout || 30000,
    retryAttempts: config.settings?.connection?.retryAttempts || 2,
    retryDelay: config.settings?.connection?.retryDelay || 1000,
  };

  // Initialize MCP manager and search index
  const mcpManager = new MCPManager({ connectionConfig });
  const bm25Index = new BM25Index();

  // Track metrics
  let searchCount = 0;
  let executionCount = 0;
  let executionSuccessCount = 0;

  // Create /toolbox-status command file if it doesn't exist
  ensureCommandFile();

  // Log successful config load - non-blocking, file only
  const serverNames = Object.keys(config.mcp);
  log("info", `Toolbox plugin loaded successfully`, {
    configPath,
    serverCount: serverNames.length,
    servers: serverNames,
    initMode,
  });

  /**
   * Set up progressive tool loading - index tools as servers connect
   */
  mcpManager.on("server:connected", (serverName: string, tools: CatalogTool[]) => {
    const startTime = performance.now();
    bm25Index.addToolsBatch(tools);
    const indexTime = performance.now() - startTime;
    
    globalProfiler.recordIncrementalUpdate(tools.length);
    
    log("info", `Server ${serverName} connected, indexed ${tools.length} tools in ${indexTime.toFixed(2)}ms`);
  });

  mcpManager.on("server:error", (serverName: string, error: string) => {
    log("warn", `Server ${serverName} failed: ${error}`);
  });

  mcpManager.on("init:complete", (state) => {
    const duration = globalProfiler.getInitDuration();
    const servers = mcpManager.getAllServers();
    const connectedServers = servers.filter((s) => s.status === "connected");
    
    log("info", `Initialization complete in ${duration?.toFixed(2)}ms: ${connectedServers.length}/${servers.length} servers, ${bm25Index.size} tools indexed`, {
      state,
      totalServers: servers.length,
      connectedServers: connectedServers.length,
      totalTools: bm25Index.size,
    });
  });

  /**
   * Start initialization based on mode
   * - eager: Start immediately, don't block plugin load
   * - lazy: Wait until first tool use
   */
  if (initMode === "eager") {
    // Non-blocking background initialization
    mcpManager.initializeBackground(config.mcp);
    log("info", "Started eager background initialization");
  }

  /**
   * Ensure initialized - for lazy mode or if eager init hasn't completed
   */
  async function ensureInitialized(): Promise<void> {
    if (mcpManager.isReady()) {
      return; // Already ready (at least partially)
    }

    if (initMode === "lazy" && mcpManager.getInitState() === "idle") {
      // Lazy mode - start initialization now
      log("info", "Starting lazy initialization on first use");
      await mcpManager.initialize(config.mcp);
      return;
    }

    // Eager mode but not ready yet - wait for at least partial readiness
    await mcpManager.waitForPartial();
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
          const timer = globalProfiler.startTimer("search.bm25");
          
          try {
            await ensureInitialized();
          } catch (error) {
            timer();
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          searchCount++;
          const searchLimit = args.limit || config.settings?.defaultLimit || 5;
          const allTools = mcpManager.getAllCatalogTools();
          const results = bm25Index.search(args.text, searchLimit);
          const duration = timer();

          log(
            "info",
            `BM25 search completed: "${args.text}" -> ${results.length} results in ${duration.toFixed(2)}ms`,
            {
              searchType: "bm25",
              query: args.text,
              resultsCount: results.length,
              limit: searchLimit,
              durationMs: duration,
            },
          );

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
          const timer = globalProfiler.startTimer("search.regex");
          
          try {
            await ensureInitialized();
          } catch (error) {
            timer();
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          searchCount++;
          const searchLimit = args.limit || config.settings?.defaultLimit || 5;
          const allTools = mcpManager.getAllCatalogTools();
          const result = searchWithRegex(allTools, args.pattern, searchLimit);
          const duration = timer();

          if ("error" in result) {
            log(
              "warn",
              `Regex search failed: "${args.pattern}" -> ${result.error}`,
            );
            return JSON.stringify({
              success: false,
              error: result.error,
            });
          }

          log(
            "info",
            `Regex search completed: "${args.pattern}" -> ${result.length} results in ${duration.toFixed(2)}ms`,
            {
              searchType: "regex",
              pattern: args.pattern,
              resultsCount: result.length,
              limit: searchLimit,
              durationMs: duration,
            },
          );

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
          const timer = globalProfiler.startTimer("tool.execute");
          
          try {
            await ensureInitialized();
          } catch (error) {
            timer();
            return JSON.stringify({
              success: false,
              error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // Parse tool name to get server and original tool name
          const parsed = parseToolName(args.name);
          if (!parsed) {
            timer();
            log("warn", `Invalid tool name format: ${args.name}`, {
              toolName: args.name,
            });
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
              timer();
              log(
                "warn",
                `Failed to parse arguments as JSON for ${args.name}`,
                {
                  toolName: args.name,
                  arguments: args.arguments,
                },
              );
              return JSON.stringify({
                success: false,
                error: `Failed to parse arguments as JSON: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }

          executionCount++;

          // Call the underlying MCP server
          try {
            const result = await mcpManager.callTool(
              parsed.serverName,
              parsed.toolName,
              toolArgs,
            );
            const duration = timer();
            executionSuccessCount++;

            log("info", `Tool executed successfully: ${args.name} in ${duration.toFixed(2)}ms`, {
              server: parsed.serverName,
              tool: parsed.toolName,
              durationMs: duration,
            });

            return JSON.stringify({
              success: true,
              result,
            });
          } catch (error) {
            const duration = timer();
            const errorMsg = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
            log("error", errorMsg, {
              server: parsed.serverName,
              tool: parsed.toolName,
              error: errorMsg,
              durationMs: duration,
            });
            return JSON.stringify({
              success: false,
              error: errorMsg,
            });
          }
        },
      }),

      /**
       * Status Tool
       * Get toolbox status and health information
       */
      toolbox_status: tool({
        description: STATUS_DESC,

        args: {},

        async execute() {
          // Initialize if not already done
          if (!mcpManager.isReady()) {
            try {
              await ensureInitialized();
            } catch (error) {
              return JSON.stringify({
                status: "error",
                message: "Failed to initialize toolbox",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          const servers = mcpManager.getAllServers();
          const connectedServers = servers.filter(
            (s) => s.status === "connected",
          );
          const failedServers = servers.filter((s) => s.status === "error");
          const connectingServers = servers.filter(
            (s) => s.status === "connecting",
          );
          const totalTools = mcpManager.getAllCatalogTools().length;
          const initDuration = globalProfiler.getInitDuration();

          const status = {
            plugin: {
              initialized: mcpManager.isComplete(),
              initState: mcpManager.getInitState(),
              initMode,
              initDurationMs: initDuration ? Math.round(initDuration) : null,
              configPath,
              uptime: process.uptime(),
              searches: searchCount,
              executions: executionCount,
              successRate:
                executionCount > 0
                  ? `${Math.round((executionSuccessCount / executionCount) * 100)}%`
                  : "N/A",
            },
            servers: {
              total: servers.length,
              connected: connectedServers.length,
              failed: failedServers.length,
              connecting: connectingServers.length,
              connectionRatio: `${connectedServers.length}/${servers.length}`,
              details: servers.map((server) => ({
                name: server.name,
                status: server.status,
                type: server.config.type,
                toolCount: server.tools.length,
                error: server.error || null,
                healthy: server.status === "connected",
              })),
            },
            tools: {
              total: totalTools,
              indexed: bm25Index.size,
              serversWithTools: servers.filter((s) => s.tools.length > 0)
                .length,
            },
            health: {
              status:
                failedServers.length === 0 && servers.length > 0
                  ? "healthy"
                  : failedServers.length > 0
                    ? "degraded"
                    : "unknown",
              message:
                servers.length === 0
                  ? "No servers configured"
                  : failedServers.length === 0
                    ? "All servers connected"
                    : `${failedServers.length} server(s) failed to connect`,
            },
          };

          // Log status request - non-blocking
          log(
            "info",
            `Status requested: ${connectedServers.length}/${servers.length} servers connected`,
            {
              connectedServers: connectedServers.length,
              totalServers: servers.length,
              totalTools: totalTools,
            },
          );

          return JSON.stringify(status, null, 2);
        },
      }),

      /**
       * Performance Metrics Tool
       * Get detailed performance information
       */
      toolbox_perf: tool({
        description: PERF_DESC,

        args: {},

        async execute() {
          const report = globalProfiler.export();
          
          return JSON.stringify({
            ...report,
            indexStats: bm25Index.getStats(),
            config: {
              initMode,
              connectionTimeout: connectionConfig.connectTimeout,
              requestTimeout: connectionConfig.requestTimeout,
              retryAttempts: connectionConfig.retryAttempts,
            },
          }, null, 2);
        },
      }),
    },

    // Inject system prompt with tool search instructions
    "experimental.chat.system.transform": async (_input, output) => {
      // Wait for partial readiness before generating system prompt
      // This is non-blocking if already ready
      if (!mcpManager.isReady() && initMode === "eager") {
        try {
          await mcpManager.waitForPartial();
        } catch {
          // Continue with base prompt if waiting fails
        }
      }
      
      output.system.push(generateSystemPrompt(mcpManager));
    },
  };
};

// Default export for OpenCode plugin system
export default ToolboxPlugin;
