import { test, expect, describe, beforeEach, mock } from "bun:test";
import { ToolboxPlugin } from "../../src/plugin";
import type { PluginInput } from "@opencode-ai/plugin";

// Mock plugin input
const createMockPluginInput = (): PluginInput => ({
  client: {} as any,
  project: {} as any,
  directory: "/test/dir",
  worktree: "/test/dir",
  serverUrl: new URL("http://localhost:3000"),
  $: {} as any,
});

describe("ToolboxPlugin", () => {
  test("exports a plugin function", () => {
    expect(typeof ToolboxPlugin).toBe("function");
  });

  test("returns hooks object when config is missing", async () => {
    // Set config path to non-existent file
    process.env.OPENCODE_TOOLBOX_CONFIG = "/non/existent/config.jsonc";
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    
    // Should return empty hooks when config fails
    expect(hooks).toBeDefined();
    
    delete process.env.OPENCODE_TOOLBOX_CONFIG;
  });

  test("returns all three tools when config is valid", async () => {
    // Create a temp config file
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool?.toolbox_search_bm25).toBeDefined();
    expect(hooks.tool?.toolbox_search_regex).toBeDefined();
    expect(hooks.tool?.toolbox_execute).toBeDefined();
    
    delete process.env.OPENCODE_TOOLBOX_CONFIG;
  });
});

describe("toolbox_search_bm25 schema", () => {
  let bm25Tool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    bm25Tool = hooks.tool?.toolbox_search_bm25;
  });

  test("has description with directive", () => {
    expect(bm25Tool.description).toContain("extended toolbox");
    expect(bm25Tool.description).toContain("ALWAYS search");
  });

  test("has text parameter", () => {
    expect(bm25Tool.args.text).toBeDefined();
  });

  test("has limit parameter", () => {
    expect(bm25Tool.args.limit).toBeDefined();
  });
});

describe("toolbox_search_regex schema", () => {
  let regexTool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    regexTool = hooks.tool?.toolbox_search_regex;
  });

  test("has description with directive", () => {
    expect(regexTool.description).toContain("regex pattern");
    expect(regexTool.description).toContain("ALWAYS search");
  });

  test("has pattern parameter", () => {
    expect(regexTool.args.pattern).toBeDefined();
  });

  test("has limit parameter", () => {
    expect(regexTool.args.limit).toBeDefined();
  });
});

describe("toolbox_execute schema", () => {
  let executeTool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    executeTool = hooks.tool?.toolbox_execute;
  });

  test("has description with usage info", () => {
    expect(executeTool.description).toContain("toolbox_search_bm25");
    expect(executeTool.description).toContain("JSON string");
  });

  test("has name parameter", () => {
    expect(executeTool.args.name).toBeDefined();
  });

  test("has arguments parameter", () => {
    expect(executeTool.args.arguments).toBeDefined();
  });
});

describe("toolbox_search_bm25 execute", () => {
  let bm25Tool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    bm25Tool = hooks.tool?.toolbox_search_bm25;
  });

  test("search with text returns results (empty catalog)", async () => {
    const result = await bm25Tool.execute({ text: "time" }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.count).toBe(0);
    expect(parsed.tools).toEqual([]);
  });

  test("search returns usage hint for toolbox_execute", async () => {
    const result = await bm25Tool.execute({ text: "time" }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.usage).toContain("toolbox_execute");
  });
});

describe("toolbox_search_regex execute", () => {
  let regexTool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    regexTool = hooks.tool?.toolbox_search_regex;
  });

  test("search with pattern returns results (empty catalog)", async () => {
    const result = await regexTool.execute({ pattern: "time.*" }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.count).toBe(0);
    expect(parsed.tools).toEqual([]);
  });

  test("search with invalid regex returns error", async () => {
    const result = await regexTool.execute({ pattern: "[invalid" }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe("invalid_pattern");
  });
});

describe("toolbox_execute execute", () => {
  let executeTool: any;
  
  beforeEach(async () => {
    const configPath = "/tmp/toolbox-test-config.jsonc";
    await Bun.write(configPath, JSON.stringify({
      servers: {},
      settings: { defaultLimit: 5 }
    }));
    
    process.env.OPENCODE_TOOLBOX_CONFIG = configPath;
    
    const hooks = await ToolboxPlugin(createMockPluginInput());
    executeTool = hooks.tool?.toolbox_execute;
  });

  test("execute with invalid name format returns error", async () => {
    const result = await executeTool.execute({ 
      name: "invalidname"  // No underscore
    }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid tool name format");
  });

  test("execute with invalid JSON arguments returns error", async () => {
    const result = await executeTool.execute({ 
      name: "server_tool",
      arguments: "not valid json"
    }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("JSON");
  });

  test("execute with non-existent server returns error", async () => {
    const result = await executeTool.execute({ 
      name: "nonexistent_tool",
      arguments: "{}"
    }, {} as any);
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not found");
  });
});
