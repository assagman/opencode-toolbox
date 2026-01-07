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
  "servers": {
    "time": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-time"]
    }
  }
}
```

## Config File Location

- **Default:** `~/.config/opencode/toolbox.jsonc`
- **Custom:** Set `OPENCODE_TOOLBOX_CONFIG` environment variable

## Full Example

```jsonc
{
  // Servers to manage (required)
  "servers": {
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
    "defaultLimit": 5  // Default number of search results (1-20)
  }
}
```

## Server Types

### Local Servers

Runs MCP server as a child process via stdio:

```jsonc
{
  "servers": {
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
  "servers": {
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
  "servers": {
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

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultLimit` | number | 5 | Default number of search results (1-20) |

## Common Mistakes

### Wrong: Using "mcp" key

```jsonc
// Wrong - will cause errors
{
  "mcp": {
    "time": { ... }
  }
}
```

```jsonc
// Correct - use "servers"
{
  "servers": {
    "time": { ... }
  }
}
```

### Wrong: Invalid JSON syntax

```jsonc
// Wrong - trailing comma in arrays breaks some parsers
{
  "servers": {
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
