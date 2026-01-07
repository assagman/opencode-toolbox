import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MCPClient } from "./types";

/**
 * Configuration for FakeMCPClient behavior
 */
export type FakeMCPClientConfig = {
  /** Tools this server provides */
  tools: Tool[];
  /** Simulated network delay in ms (default: 10) */
  delay?: number;
  /** Custom tool call handler */
  onCallTool?: (name: string, args: Record<string, unknown>) => Promise<any>;
  /** Simulate connection failure */
  failConnect?: boolean;
  /** Simulate listTools failure */
  failListTools?: boolean;
  /** Error message for failures */
  errorMessage?: string;
};

/**
 * Fake MCP client for testing purposes
 * Simulates an MCP server with configurable behavior
 */
export class FakeMCPClient implements MCPClient {
  private config: FakeMCPClientConfig;
  private connected = false;

  constructor(config: FakeMCPClientConfig) {
    this.config = {
      delay: 10,
      ...config,
    };
  }

  private async simulateDelay(): Promise<void> {
    if (this.config.delay && this.config.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.delay));
    }
  }

  async connect(): Promise<void> {
    await this.simulateDelay();
    
    if (this.config.failConnect) {
      throw new Error(this.config.errorMessage || "Connection failed");
    }
    
    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    await this.simulateDelay();
    
    if (this.config.failListTools) {
      throw new Error(this.config.errorMessage || "Failed to list tools");
    }
    
    return [...this.config.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.simulateDelay();

    // Check if tool exists
    const tool = this.config.tools.find(t => t.name === name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Use custom handler if provided
    if (this.config.onCallTool) {
      return this.config.onCallTool(name, args);
    }

    // Default mock result
    return {
      success: true,
      tool: name,
      args,
      result: `Mock result for ${name}`,
    };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  /** Check if client is connected (for testing) */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Pre-configured fake tools for common test scenarios
 */
export const FakeTools = {
  time: [
    {
      name: "get_current_time",
      description: "Get the current time in a specific timezone",
      inputSchema: {
        type: "object" as const,
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone name (e.g., 'America/New_York', 'Asia/Tokyo')",
          },
        },
        required: ["timezone"],
      },
    },
    {
      name: "convert_time",
      description: "Convert time between timezones",
      inputSchema: {
        type: "object" as const,
        properties: {
          time: { type: "string", description: "Time in HH:MM format" },
          source_timezone: { type: "string", description: "Source timezone" },
          target_timezone: { type: "string", description: "Target timezone" },
        },
        required: ["time", "source_timezone", "target_timezone"],
      },
    },
  ] as Tool[],

  search: [
    {
      name: "web_search",
      description: "Search the web for information",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          num_results: { type: "number", description: "Number of results (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "news_search",
      description: "Search for recent news articles",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "News search query" },
          days: { type: "number", description: "Number of days to search back" },
        },
        required: ["query"],
      },
    },
  ] as Tool[],

  calculator: [
    {
      name: "add",
      description: "Add two numbers",
      inputSchema: {
        type: "object" as const,
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
    },
    {
      name: "multiply",
      description: "Multiply two numbers",
      inputSchema: {
        type: "object" as const,
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
    },
  ] as Tool[],
};

/**
 * Pre-configured tool call handlers for realistic responses
 */
export const FakeToolHandlers = {
  time: async (name: string, args: Record<string, unknown>) => {
    if (name === "get_current_time") {
      const tz = args.timezone as string || "UTC";
      const now = new Date();
      return {
        datetime: now.toISOString(),
        timezone: tz,
        formatted: now.toLocaleString("en-US", { timeZone: tz }),
      };
    }
    if (name === "convert_time") {
      return {
        original: { time: args.time, timezone: args.source_timezone },
        converted: { time: args.time, timezone: args.target_timezone },
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  },

  calculator: async (name: string, args: Record<string, unknown>) => {
    const a = args.a as number;
    const b = args.b as number;
    if (name === "add") return { result: a + b };
    if (name === "multiply") return { result: a * b };
    throw new Error(`Unknown tool: ${name}`);
  },

  search: async (name: string, args: Record<string, unknown>) => {
    const query = args.query as string;
    return {
      query,
      results: [
        { title: `Result 1 for "${query}"`, url: "https://example.com/1" },
        { title: `Result 2 for "${query}"`, url: "https://example.com/2" },
      ],
    };
  },
};
