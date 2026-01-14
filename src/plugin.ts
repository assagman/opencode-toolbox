import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { appendFile, mkdir, writeFile, access } from "fs/promises";
import { loadConfig, createDefaultConfigIfMissing } from "./config";
import type { ConnectionConfig } from "./config";
import { MCPManager } from "./mcp-client";
import { BM25Index, searchWithRegex, MAX_REGEX_LENGTH } from "./search";
import type { CatalogTool, SearchResult } from "./catalog";
import { globalProfiler } from "./profiler";

/** Package version for schema URL - read at build time */
const PACKAGE_VERSION = "0.8.0";

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
      "Use toolbox_execute({ toolId: '<toolId>', arguments: '<json>' }) to run a discovered tool",
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

Pass arguments as JSON string matching the tool's schema.
toolId format: {serverName}_{toolName}`;

const STATUS_DESC = `Get toolbox status including plugin initialization, MCP server connections, and tool counts.

Shows success/total metrics to highlight failures. Use to check if toolbox is working correctly.`;

const PERF_DESC = `Get detailed performance metrics for the toolbox plugin.

Shows initialization times, search latencies, execution stats, and per-server metrics.`;

const TEST_DESC = `Test all toolbox tools with minimal predefined prompts.

Executes every registered tool with super simple inputs to verify they work. Returns pass/fail for each tool.`;

/**
 * Predefined minimal test prompts for known tools
 * Format: toolIdString -> minimal arguments object
 * These should produce minimal output while verifying the tool works
 */
const TEST_PROMPTS: Record<string, Record<string, unknown>> = {
  // Time tools
  time_get_current_time: {},
  time_convert_time: {
    source_timezone: "UTC",
    time: "12:00",
    target_timezone: "America/New_York",
  },

  // Brave search tools - minimal queries
  brave_brave_web_search: { query: "test", count: 1 },
  brave_brave_local_search: { query: "coffee", count: 1 },
  brave_brave_video_search: { query: "test", count: 1 },
  brave_brave_image_search: { query: "test", count: 1 },
  brave_brave_news_search: { query: "test", count: 1 },
  brave_brave_summarizer: { key: "test" },

  // Brightdata tools
  brightdata_search_engine: { query: "hello", engine: "google", count: 1 },
  brightdata_search_engine_batch: {
    queries: [{ query: "test", engine: "google", count: 1 }],
  },
  brightdata_scrape_as_markdown: { url: "https://example.com" },
  brightdata_scrape_as_html: { url: "https://example.com" },
  brightdata_scrape_batch: { urls: ["https://example.com"] },
  brightdata_extract: { url: "https://example.com" },
  brightdata_session_stats: {},
  brightdata_web_data_reuter_news: {
    url: "https://www.reuters.com/technology/",
  },
  brightdata_web_data_github_repository_file: {
    url: "https://github.com/octocat/Hello-World/blob/master/README",
  },

  // Tavily tools - minimal queries
  "tavily_tavily-search": { query: "test", maxResults: 1 },
  "tavily_tavily-extract": { urls: ["https://example.com"] },
  "tavily_tavily-map": { url: "https://example.com" },

  // Context7 tools
  "context7_resolve-library-id": { libraryName: "react" },

  // Octocode GitHub tools - minimal queries
  octocode_githubSearchRepositories: { query: "test", maxResults: 1 },
  octocode_githubSearchCode: { query: "function test", maxResults: 1 },
  octocode_githubViewRepoStructure: { owner: "octocat", repo: "Hello-World" },

  // Perplexity tools - minimal queries
  perplexity_perplexity_ask: { query: "What is 1+1?" },
  perplexity_perplexity_search: { query: "test", maxResults: 1 },
};

/**
 * Generate minimal arguments from a JSON schema
 * Used as fallback when no predefined test prompt exists
 */
function generateMinimalArgs(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  if (schema.type !== "object" || !schema.properties) {
    return args;
  }

  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const required = (schema.required as string[]) || [];

  // Only fill in required properties with minimal values
  for (const propName of required) {
    const prop = properties[propName];
    if (!prop) continue;

    const enumValues = prop.enum as unknown[] | undefined;

    switch (prop.type) {
      case "string":
        args[propName] = prop.default ?? enumValues?.[0] ?? "test";
        break;
      case "number":
      case "integer":
        args[propName] = prop.default ?? prop.minimum ?? 1;
        break;
      case "boolean":
        args[propName] = prop.default ?? false;
        break;
      case "array":
        args[propName] = prop.default ?? [];
        break;
      case "object":
        args[propName] = prop.default ?? {};
        break;
      default:
        args[propName] = prop.default ?? null;
    }
  }

  return args;
}

/**
 * Check if running in test environment
 */
const isTestEnv = process.env.NODE_ENV === "test" || !!process.env.BUN_TEST;

/**
 * Safe logging helper - writes to ~/.local/share/opencode/toolbox.log
 * Never blocks or throws. Skips logging in test environment.
 */
function log(level: string, message: string, extra?: any) {
  // Skip logging in test environment
  if (isTestEnv) return;

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
 * Non-blocking, fire and forget. Skips in test environment.
 */
function ensureCommandFile() {
  // Skip in test environment
  if (isTestEnv) return;

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
 * Generate system prompt with configured MCP server names
 * Server names come from config (instant) - no need to wait for connections
 * Uses XML format for token-efficient AI parsing
 */
function generateSystemPrompt(configuredServers: string[]): string {
  const registry =
    configuredServers.length > 0
      ? configuredServers.map((s) => `${s}_*`).join("\n")
      : "(no servers configured)";

  return `
<MCPTools>
  <Rules>
    ALWAYS toolbox_search_* before saying "I cannot do that" or "I don't have access to"
    ALWAYS toolbox_search_* if user wants to use tools or refers to unknown tool names
  </Rules>
  <MCPServers>
    <Registry>
      ${registry}
    </Registry>
    <NamingConvention>
      serverName: MCP server name
      toolName: tool name provided by MCP server
      toolId: {serverName}_{toolName}
    </NamingConvention>
    <Patterns>
      ALL: ".*"
      SERVER: "{serverName}_.*"
      TOOL: "{serverName}_{toolName}"
    </Patterns>
    <Discovery>
      <ListAllTools>
        toolbox_search_regex({ pattern: ".*" })
      </ListAllTools>
      <ServerTools>
        toolbox_search_regex({ pattern: "serverName_.*" })
      </ServerTools>
      <FreeSearch>
        toolbox_search_bm25({ text: "description keywords" })
      </FreeSearch>
    </Discovery>
    <Execute>
      toolbox_execute({ toolId: "toolId", arguments: '{}' })
    </Execute>
    <When>
      regex: know server name or partial tool name
      bm25: know what you want to do, not tool name
    </When>
    <Fallback>
      toolbox_search_regex → toolbox_search_bm25 → toolbox_status → ask user
    </Fallback>
    <Troubleshoot>
      If tool not found: check server prefix, try bm25 with descriptive text
      Check server health: toolbox_status()
    </Troubleshoot>
  </MCPServers>
</MCPTools>`;
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
  const pluginLoadStart = performance.now();
  const { client } = ctx;

  // Load configuration
  const configPath = process.env.OPENCODE_TOOLBOX_CONFIG || DEFAULT_CONFIG_PATH;

  // Auto-create config if missing (non-blocking, fire and forget in test env)
  if (!isTestEnv) {
    const created = await createDefaultConfigIfMissing(configPath, PACKAGE_VERSION);
    if (created) {
      log("info", `Created default config file at ${configPath}`);
    }
  }

  const configResult = await loadConfig(configPath);

  if (!configResult.success) {
    // Format Zod errors with path information for better debugging
    const formattedErrors = configResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `at "${issue.path.join(".")}"` : "";
      return `${issue.message} ${path}`.trim();
    }).join("; ");
    const errorMsg = `Failed to load config from ${configPath}: ${formattedErrors}`;
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
  const pluginLoadDuration = performance.now() - pluginLoadStart;
  log("info", `Toolbox plugin loaded successfully`, {
    configPath,
    logPath: LOG_FILE_PATH,
    serverCount: serverNames.length,
    servers: serverNames,
    initMode,
    loadDurationMs: Math.round(pluginLoadDuration * 100) / 100,
  });

  /**
   * Set up progressive tool loading - index tools as servers connect
   */
  mcpManager.on(
    "server:connected",
    (serverName: string, tools: CatalogTool[], connectTime: number) => {
      const startTime = performance.now();
      bm25Index.addToolsBatch(tools);
      const indexTime = performance.now() - startTime;

      globalProfiler.recordIncrementalUpdate(tools.length);

      log(
        "info",
        `${serverName} - connection time: ${connectTime.toFixed(2)}ms, indexed ${tools.length} tools in ${indexTime.toFixed(2)}ms`,
      );
    },
  );

  mcpManager.on("server:error", (serverName: string, error: string) => {
    log("warn", `Server ${serverName} failed: ${error}`);
  });

  mcpManager.on("init:complete", (state) => {
    const duration = globalProfiler.getInitDuration();
    const servers = mcpManager.getAllServers();
    const connectedServers = servers.filter((s) => s.status === "connected");

    log(
      "info",
      `Initialization complete in ${duration?.toFixed(2)}ms: ${connectedServers.length}/${servers.length} servers, ${bm25Index.size} tools indexed`,
      {
        state,
        totalServers: servers.length,
        connectedServers: connectedServers.length,
        totalTools: bm25Index.size,
      },
    );
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
          toolId: tool.schema
            .string()
            .describe(
              "Tool ID from search results. Format: {serverName}_{toolName} (e.g., 'time_get_current_time', 'brave_web_search')",
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

          // Parse toolId to get server and original tool name
          const parsed = parseToolName(args.toolId);
          if (!parsed) {
            timer();
            log("warn", `Invalid toolId format: ${args.toolId}`, {
              toolId: args.toolId,
            });
            return JSON.stringify({
              success: false,
              error: `Invalid toolId format: ${args.toolId}. Expected format: {serverName}_{toolName} (e.g., 'time_get_current_time')`,
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
                `Failed to parse arguments as JSON for ${args.toolId}`,
                {
                  toolId: args.toolId,
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

            log(
              "info",
              `Tool executed successfully: ${args.toolId} in ${duration.toFixed(2)}ms`,
              {
                server: parsed.serverName,
                tool: parsed.toolName,
                durationMs: duration,
              },
            );

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

            const server = mcpManager.getServer(parsed.serverName);
            const configuredServer = config.mcp[parsed.serverName];

            const serverInfo = server
              ? {
                  name: server.name,
                  status: server.status,
                  type: server.config.type,
                  error: server.error || null,
                  command:
                    server.config.type === "local" ? server.config.command || null : undefined,
                  commandString:
                    server.config.type === "local" && server.config.command
                      ? server.config.command.join(" ")
                      : undefined,
                  url: server.config.type === "remote" ? server.config.url || null : undefined,
                }
              : configuredServer
                ? {
                    name: parsed.serverName,
                    status: "unknown",
                    type: configuredServer.type,
                    error: null,
                    command:
                      configuredServer.type === "local" ? configuredServer.command || null : undefined,
                    commandString:
                      configuredServer.type === "local" && configuredServer.command
                        ? configuredServer.command.join(" ")
                        : undefined,
                    url: configuredServer.type === "remote" ? configuredServer.url || null : undefined,
                  }
                : {
                    name: parsed.serverName,
                    status: "unknown",
                    type: "unknown",
                    error: null,
                  };

            return JSON.stringify({
              success: false,
              error: errorMsg,
              server: serverInfo,
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
                command:
                  server.config.type === "local" ? server.config.command || null : undefined,
                commandString:
                  server.config.type === "local" && server.config.command
                    ? server.config.command.join(" ")
                    : undefined,
                url: server.config.type === "remote" ? server.config.url || null : undefined,
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

          return JSON.stringify(
            {
              ...report,
              indexStats: bm25Index.getStats(),
              config: {
                initMode,
                connectionTimeout: connectionConfig.connectTimeout,
                requestTimeout: connectionConfig.requestTimeout,
                retryAttempts: connectionConfig.retryAttempts,
              },
            },
            null,
            2,
          );
        },
      }),

      /**
       * Test Tool
       * Execute all tools with minimal predefined prompts to verify they work
       * Shows full step-by-step progress with complete inputs and outputs
       */
      toolbox_test: tool({
        description: TEST_DESC,

        args: {
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout per tool in ms (default: 10000)"),
        },

        async execute(args) {
          const startTime = performance.now();
          const output: string[] = [];

          output.push("=".repeat(80));
          output.push("TOOLBOX TEST - Full Execution Log");
          output.push("=".repeat(80));
          output.push("");

          try {
            await ensureInitialized();
          } catch (error) {
            output.push(
              `[FATAL] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
            );
            return output.join("\n");
          }

          const allTools = mcpManager.getAllCatalogTools();
          const timeout = args.timeout || 10000;

          output.push(`[INFO] Found ${allTools.length} tools to test`);
          output.push(`[INFO] Timeout per tool: ${timeout}ms`);
          output.push(`[INFO] Started at: ${new Date().toISOString()}`);
          output.push("");

          // Track results for summary
          let passed = 0;
          let failed = 0;
          let timedOut = 0;
          let skipped = 0;

          // Execute tools sequentially to show clear step-by-step progress
          for (let i = 0; i < allTools.length; i++) {
            const catalogTool = allTools[i]!;
            const toolId = catalogTool.idString;
            const testNum = i + 1;

            output.push("-".repeat(80));
            output.push(`[TEST ${testNum}/${allTools.length}] ${toolId}`);
            output.push("-".repeat(80));

            const parsed = parseToolName(toolId);

            if (!parsed) {
              output.push(`[SKIP] Invalid tool name format`);
              output.push("");
              skipped++;
              continue;
            }

            output.push(`[INFO] Server: ${parsed.serverName}`);
            output.push(`[INFO] Tool: ${parsed.toolName}`);
            output.push(
              `[INFO] Description: ${catalogTool.description || "(no description)"}`,
            );
            output.push("");

            // Determine test arguments
            let testArgs: Record<string, unknown>;
            let argsSource: string;

            const predefinedArgs = TEST_PROMPTS[toolId];
            if (predefinedArgs !== undefined) {
              testArgs = predefinedArgs;
              argsSource = "PREDEFINED";
            } else {
              testArgs = generateMinimalArgs(catalogTool.inputSchema);
              argsSource =
                Object.keys(testArgs).length > 0 ? "GENERATED" : "EMPTY";
            }

            output.push(`[INPUT] Arguments source: ${argsSource}`);
            output.push(`[INPUT] Request payload:`);
            output.push(
              JSON.stringify(testArgs, null, 2)
                .split("\n")
                .map((line) => "        " + line)
                .join("\n"),
            );
            output.push("");

            // Execute with timeout
            const toolStart = performance.now();

            try {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("TIMEOUT")), timeout);
              });

              const execPromise = mcpManager.callTool(
                parsed.serverName,
                parsed.toolName,
                testArgs,
              );

              const result = await Promise.race([execPromise, timeoutPromise]);
              const duration = Math.round(performance.now() - toolStart);

              output.push(`[OUTPUT] Response received in ${duration}ms:`);
              const resultStr =
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2);
              output.push(
                resultStr
                  .split("\n")
                  .map((line) => "        " + line)
                  .join("\n"),
              );
              output.push("");
              output.push(`[PASS] ✓ Test passed in ${duration}ms`);
              passed++;
            } catch (error) {
              const duration = Math.round(performance.now() - toolStart);
              const errorMsg =
                error instanceof Error ? error.message : String(error);

              if (errorMsg === "TIMEOUT") {
                output.push(
                  `[OUTPUT] No response - timed out after ${timeout}ms`,
                );
                output.push("");
                output.push(`[TIMEOUT] ✗ Test timed out after ${duration}ms`);
                timedOut++;
              } else {
                output.push(`[OUTPUT] Error response:`);
                output.push(`        ${errorMsg}`);
                output.push("");
                output.push(`[FAIL] ✗ Test failed in ${duration}ms`);
                output.push(`[FAIL] Error: ${errorMsg}`);
                failed++;
              }
            }

            output.push("");
          }

          // Final summary
          const totalDuration = Math.round(performance.now() - startTime);
          const total = allTools.length;
          const successRate =
            total > 0 ? Math.round((passed / total) * 100) : 0;

          output.push("=".repeat(80));
          output.push("TEST SUMMARY");
          output.push("=".repeat(80));
          output.push("");
          output.push(`Total tests:    ${total}`);
          output.push(`Passed:         ${passed} ✓`);
          output.push(`Failed:         ${failed} ✗`);
          output.push(`Timed out:      ${timedOut} ⏱`);
          output.push(`Skipped:        ${skipped} ⊘`);
          output.push("");
          output.push(`Success rate:   ${successRate}%`);
          output.push(`Total duration: ${totalDuration}ms`);
          output.push(`Finished at:    ${new Date().toISOString()}`);
          output.push("");
          output.push("=".repeat(80));

          log(
            "info",
            `Toolbox test completed: ${passed}/${total} passed in ${totalDuration}ms`,
            {
              passed,
              failed,
              timedOut,
              skipped,
              total,
            },
          );

          return output.join("\n");
        },
      }),
    },

    // Inject system prompt with tool search instructions
    // NOTE: We use serverNames from config (instant) - no waiting for connections.
    // Tools are discoverable via toolbox_search_* once servers connect.
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(generateSystemPrompt(serverNames));
    },
  };
};

// Default export for OpenCode plugin system
export default ToolboxPlugin;
