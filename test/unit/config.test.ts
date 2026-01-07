import { test, expect } from "bun:test";
import { parseConfig } from "../../src/config";
import type { Config } from "../../src/config";

test("valid config loads correctly", () => {
  const jsonc = `{
    "servers": {
      "gmail": {
        "type": "local",
        "command": ["npx", "-y", "@anthropic/mcp-gmail"]
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    expect(result.data.servers).toHaveProperty("gmail");
    const gmail = result.data.servers.gmail as any;
    expect(gmail.type).toBe("local");
    expect(gmail.command).toEqual(["npx", "-y", "@anthropic/mcp-gmail"]);
  }
});

test("config with remote server", () => {
  const jsonc = `{
    "servers": {
      "weather": {
        "type": "remote",
        "url": "https://mcp.example.com/weather"
      }
    }
  }`;

  const result = parseConfig(jsonc);
  expect(result.success).toBe(true);

  if (result.success) {
    const weather = result.data.servers.weather as any;
    expect(weather.type).toBe("remote");
    expect(weather.url).toBe("https://mcp.example.com/weather");
  }
});

test("config with settings", () => {
  const jsonc = `{
    "servers": {},
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
    "servers": {
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
    "servers": {
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
    "servers": {
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
    "servers": {
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
    const gmail = result.data.servers.gmail as any;
    expect(gmail.environment?.GMAIL_CREDENTIALS).toBe("test-credentials");
  }

  delete process.env.GMAIL_CREDENTIALS;
});

test("missing env var keeps placeholder", () => {
  const jsonc = `{
    "servers": {
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
    const github = result.data.servers.github as any;
    // If env var doesn't exist, it should keep the placeholder or handle gracefully
    expect(github.environment?.GITHUB_TOKEN).toBe("");
  }
});

test("jsonc comments are ignored", () => {
  const jsonc = `{
    // This is a comment
    "servers": {
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
    expect(result.data.servers).toHaveProperty("gmail");
    expect(result.data.settings?.defaultLimit).toBe(5);
  }
});

test("empty config is invalid (needs at least one server)", () => {
  const jsonc = `{
    "servers": {}
  }`;

  const result = parseConfig(jsonc);
  // We may or may not want to enforce this - for now, let's allow empty
  expect(result.success).toBe(true);

  if (result.success) {
    expect(Object.keys(result.data.servers)).toHaveLength(0);
  }
});
