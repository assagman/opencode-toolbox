# Configuration Guide

## Quick Start

1. Add plugin to OpenCode config (`~/.config/opencode/opencode.jsonc`):
```jsonc
{
  "plugin": ["opencode-toolbox"]
}
```

2. Create Toolbox config (`~/.config/opencode/toolbox.jsonc`):
```jsonc
{
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
  "mcp": {
    "time": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-time"]
    }
  }
}
```

> **Note:** The config file is auto-created with default settings if it doesn't exist when the plugin loads.

## Config File Location

- **Default:** `~/.config/opencode/toolbox.jsonc`
- **Custom:** Set `OPENCODE_TOOLBOX_CONFIG` environment variable

## Full Example

```jsonc
{
  // JSON Schema for editor support (optional, recommended)
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",

  // MCP servers to manage (required)
  "mcp": {
    // Local MCP server (stdio)
    "gmail": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-gmail"],
      "environment": {
        "GMAIL_CREDENTIALS": "{env:GMAIL_CREDENTIALS}"
      }
    },

    // Remote MCP server (SSE)
    "weather": {
      "type": "remote",
      "url": "https://mcp.example.com/weather",
      "headers": {
        "Authorization": "Bearer {env:WEATHER_API_KEY}"
      }
    }
  },

  // Optional settings
  "settings": {
    "defaultLimit": 5,  // Default number of search results (1-20)
    "initMode": "eager",  // "eager" (default) or "lazy"
    "connection": {
      "connectTimeout": 5000,  // Connection timeout in ms
      "requestTimeout": 30000,  // Request timeout in ms
      "retryAttempts": 2,  // Retry attempts on failure
      "retryDelay": 1000  // Delay between retries in ms
    }
  }
}
```

## Server Types

### Local Servers

Runs MCP server as a child process via stdio:

```jsonc
{
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-server"],
      "environment": {
        "API_KEY": "{env:MY_API_KEY}"
      }
    }
  }
}
```

### Remote Servers

Connects to MCP server via HTTP/SSE:

```jsonc
{
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
  "mcp": {
    "my-remote": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer {env:API_KEY}"
      }
    }
  }
}
```

## Environment Variables

Use `{env:VAR_NAME}` pattern to reference environment variables:

```jsonc
{
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
  "mcp": {
    "github": {
      "type": "local",
      "command": ["npx", "@anthropic/mcp-github"],
      "environment": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    }
  }
}
```

If the environment variable doesn't exist, it will be replaced with an empty string.

## JSON Schema

Add `$schema` to your config for editor autocompletion and validation:

```jsonc
{
  "$schema": "https://unpkg.com/opencode-toolbox@latest/toolbox.schema.json",
  "mcp": { ... }
}
```

The `@latest` tag auto-updates when new versions are published to npm. To pin a specific version:
```
https://unpkg.com/opencode-toolbox@0.8.0/toolbox.schema.json
```

> **JSONC Support:** The schema includes `allowTrailingCommas` and `allowComments` extensions for VS Code and Neovim (jsonls). Editors will not warn about trailing commas or comments in `.jsonc` files referencing this schema.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultLimit` | number | 5 | Default number of search results (1-20) |
| `initMode` | "eager" \| "lazy" | "eager" | When to connect to MCP servers (see below) |
| `connection.connectTimeout` | number | 5000 | Connection timeout in milliseconds |
| `connection.requestTimeout` | number | 30000 | Request timeout in milliseconds |
| `connection.retryAttempts` | number | 2 | Number of retry attempts on failure (0-10) |
| `connection.retryDelay` | number | 1000 | Delay between retries in milliseconds |

### Initialization Modes

- **`eager`** (default): Start connecting to MCP servers immediately when the plugin loads. Connections happen in the background and don't block plugin startup. First search/execute may wait briefly if servers haven't finished connecting.
- **`lazy`**: Only connect to servers when the first tool is used. Reduces startup overhead but adds latency to the first operation.

## Common Mistakes

### Wrong: Using "servers" key

```jsonc
// Wrong - will cause errors
{
  "servers": {
    "time": { ... }
  }
}
```

```jsonc
// Correct - use "mcp"
{
  "mcp": {
    "time": { ... }
  }
}
```

### Wrong: Invalid JSON syntax

```jsonc
// Wrong - trailing comma in arrays breaks some parsers
{
  "mcp": {
    "time": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-time",]  // <-- trailing comma
    }
  }
}
```

Note: JSONC allows trailing commas, but ensure your file has the `.jsonc` extension.

## Troubleshooting

### Config not loading

1. Check file exists: `ls ~/.config/opencode/toolbox.jsonc`
2. Verify JSON syntax: `cat ~/.config/opencode/toolbox.jsonc | bun -e "console.log(JSON.parse(await Bun.stdin.text()))"`
3. Check OpenCode logs for plugin errors

### Servers not connecting

1. Verify server command works standalone: `npx -y @anthropic/mcp-time`
2. Check environment variables are set
3. For remote servers, verify URL is accessible

### Search finds no tools

1. Verify at least one server is configured
2. Check server is connecting (no errors in logs)
3. Try broader search terms
