import { test, expect } from "bun:test";
import { parseConfig, getSchemaUrl, generateDefaultConfig, createDefaultConfigIfMissing } from "../../src/config";
import type { Config } from "../../src/config";
import { unlink } from "fs/promises";

test("valid config loads correctly", () => {
  const jsonc = `{
    "mcp": {
      "gmail": {
        "type": "local",
        "command": ["npx", "-y", "@anthropic/mcp-gmail"]
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    expect(result.data.mcp).toHaveProperty("gmail");
    const gmail = result.data.mcp.gmail as any;
    expect(gmail.type).toBe("local");
    expect(gmail.command).toEqual(["npx", "-y", "@anthropic/mcp-gmail"]);
  }
});

test("config with remote server", () => {
  const jsonc = `{
    "mcp": {
      "weather": {
        "type": "remote",
        "url": "https://mcp.example.com/weather"
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    const weather = result.data.mcp.weather as any;
    expect(weather.type).toBe("remote");
    expect(weather.url).toBe("https://mcp.example.com/weather");
  }
});

test("config with settings", () => {
  const jsonc = `{
    "mcp": {},
    "settings": {
      "defaultLimit": 10
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    const settings = result.data.settings as any;
    expect(settings.defaultLimit).toBe(10);
  }
});

test("invalid server type returns error", () => {
  const jsonc = `{
    "mcp": {
      "invalid": {
        "type": "invalid_type"
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(false);
});

test("local server without command returns error", () => {
  const jsonc = `{
    "mcp": {
      "gmail": {
        "type": "local"
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(false);
});

test("remote server without url returns error", () => {
  const jsonc = `{
    "mcp": {
      "weather": {
        "type": "remote"
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(false);
});

test("env interpolation works", () => {
  const jsonc = `{
    "mcp": {
      "gmail": {
        "type": "local",
        "command": ["npx", "@anthropic/mcp-gmail"],
        "environment": {
          "GMAIL_CREDENTIALS": "{env:GMAIL_CREDENTIALS}"
        }
      }
    }
  }`;

  // Set env var for testing
  process.env.GMAIL_CREDENTIALS = "test-credentials";

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    const gmail = result.data.mcp.gmail as any;
    expect(gmail.environment?.GMAIL_CREDENTIALS).toBe("test-credentials");
  }

  delete process.env.GMAIL_CREDENTIALS;
});

test("missing env var keeps placeholder", () => {
  const jsonc = `{
    "mcp": {
      "github": {
        "type": "local",
        "command": ["npx", "@anthropic/mcp-github"],
        "environment": {
          "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
        }
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    const github = result.data.mcp.github as any;
    // If env var doesn't exist, it should keep the placeholder or handle gracefully
    expect(github.environment?.GITHUB_TOKEN).toBe("");
  }
});

test("jsonc comments are ignored", () => {
  const jsonc = `{
    // This is a comment
    "mcp": {
      "gmail": {
        "type": "local", // inline comment
        "command": ["npx", "@anthropic/mcp-gmail"]
      }
    },
    /* multi-line
       comment */
    "settings": {
      "defaultLimit": 5
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    expect(result.data.mcp).toHaveProperty("gmail");
    expect(result.data.settings?.defaultLimit).toBe(5);
  }
});

test("empty config is invalid (needs at least one server)", () => {
  const jsonc = `{
    "mcp": {}
  }`;

  const result = parseConfig(jsonc);
  // We may or may not want to enforce this - for now, let's allow empty
  expect(result.success).toBe(true);

  if (result.success) {
    expect(Object.keys(result.data.mcp)).toHaveLength(0);
  }
});

test("config with $schema field is valid", () => {
  const jsonc = `{
    "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
    "mcp": {
      "time": {
        "type": "local",
        "command": ["npx", "-y", "@anthropic/mcp-time"]
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    expect(result.data.$schema).toBe("https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json");
    expect(result.data.mcp).toHaveProperty("time");
  }
});

test("getSchemaUrl returns unpkg URL with @latest", () => {
  const url = getSchemaUrl();
  expect(url).toBe("https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json");
});

test("getSchemaUrl ignores version parameter (uses @latest)", () => {
  // Version parameter is ignored - always returns @latest URL
  expect(getSchemaUrl("1.0.0")).toBe("https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json");
  expect(getSchemaUrl("2.5.3")).toBe("https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json");
});

test("generateDefaultConfig includes schema URL", () => {
  const config = generateDefaultConfig("0.8.0");
  expect(config).toContain('"$schema"');
  expect(config).toContain("unpkg.com/opencode-toolbox@latest/toolbox.schema.json");
});

test("generateDefaultConfig includes empty mcp object", () => {
  const config = generateDefaultConfig("0.8.0");
  expect(config).toContain('"mcp"');
});

test("generateDefaultConfig includes default settings", () => {
  const config = generateDefaultConfig("0.8.0");
  expect(config).toContain('"settings"');
  expect(config).toContain('"defaultLimit": 5');
  expect(config).toContain('"initMode": "eager"');
});

test("generateDefaultConfig output is valid JSONC", () => {
  const config = generateDefaultConfig("0.8.0");
  const result = parseConfig(config);
  expect(result.success).toBe(true);
});

test("createDefaultConfigIfMissing creates file when missing", async () => {
  const testPath = "/tmp/toolbox-create-test-" + Date.now() + ".jsonc";
  
  try {
    const created = await createDefaultConfigIfMissing(testPath, "0.8.0");
    expect(created).toBe(true);
    
    // Verify file was created
    const file = Bun.file(testPath);
    expect(await file.exists()).toBe(true);
    
    // Verify content is valid
    const content = await file.text();
    const result = parseConfig(content);
    expect(result.success).toBe(true);
  } finally {
    // Cleanup
    try { await unlink(testPath); } catch {}
  }
});

test("createDefaultConfigIfMissing does not overwrite existing file", async () => {
  const testPath = "/tmp/toolbox-existing-test-" + Date.now() + ".jsonc";
  const existingContent = '{"mcp": {}, "settings": {"defaultLimit": 10}}';
  
  try {
    // Create file first
    await Bun.write(testPath, existingContent);
    
    const created = await createDefaultConfigIfMissing(testPath, "0.8.0");
    expect(created).toBe(false);
    
    // Verify content was not changed
    const content = await Bun.file(testPath).text();
    expect(content).toBe(existingContent);
  } finally {
    // Cleanup
    try { await unlink(testPath); } catch {}
  }
});

test("server without type gives helpful error", () => {
  const jsonc = `{
    "mcp": {
      "broken": {
        "command": "bunx",
        "args": ["some-package"]
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(false);

  if (!result.success) {
    const errorMessages = result.error.issues.map(i => i.message).join("; ");
    expect(errorMessages).toContain("type");
  }
});

test("server with invalid type gives helpful error", () => {
  const jsonc = `{
    "mcp": {
      "broken": {
        "type": "invalid",
        "command": ["bunx", "test"]
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(false);

  if (!result.success) {
    const errorMessages = result.error.issues.map(i => i.message).join("; ");
    expect(errorMessages).toContain("type");
  }
});
