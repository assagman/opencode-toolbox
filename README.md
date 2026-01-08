# opencode-toolbox (Tool Search Tool)

An OpenCode plugin that implements a **tool search tool** pattern, allowing users to keep only a tiny set of tools in LLM context while accessing a larger MCP catalog on-demand.

## Motivation

OpenCode's MCP servers add tool schemas to LLM context at session start. With many MCPs, this can front-load tens of thousands of tokens, reducing "smart zone" capacity and degrading speed/accuracy.

opencode-toolbox solves this by:
- Exposing **a few toolbox tools** instead of 50+ MCP tools
- Search for tools using natural language (BM25) or regex patterns
- Execute discovered tools through the same interface
- Tool schemas are returned in search results for accurate LLM usage

## Configuration

### 1. Add Plugin to OpenCode

Add `opencode-toolbox` to your `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-toolbox@x.y.z"]
}
```

> **⚡ Performance Tip:** Always pin to a specific version for instant startup.
>
> | Configuration | Startup Time | Why |
> |---------------|--------------|-----|
> | ✅ `opencode-toolbox@x.y.z` | ~0ms | Cached version matches, skips npm check |
> | ❌ `opencode-toolbox` | ~1000ms | Resolves "latest" via npm on every startup |
>
> OpenCode caches plugins by exact version. When you omit the version, it defaults to `"latest"` which doesn't match the cached resolved version, triggering a fresh `bun add` on every startup. Check [npm](https://www.npmjs.com/package/opencode-toolbox) for the latest version.

### 2. Configure Toolbox

Create `~/.config/opencode/toolbox.jsonc`:

```jsonc
{
  "mcp": {
    "time": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-time"]
    },
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-github"],
      "environment": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    },
    "weather": {
      "type": "remote",
      "url": "https://mcp.example.com/weather",
      "headers": {
        "Authorization": "Bearer {env:WEATHER_API_KEY}"
      }
    }
  },
  "settings": {
    "defaultLimit": 5
  }
}
```

### Environment Variables

- `OPENCODE_TOOLBOX_CONFIG`: Path to config file (default: `~/.config/opencode/toolbox.jsonc`)
- Environment variable interpolation: Use `{env:VAR_NAME}` in config values

## Usage

The plugin exposes five tools:

### toolbox_search_bm25

Search for tools using natural language:

```
toolbox_search_bm25({ text: "get current time in timezone" })
```

### toolbox_search_regex

Search for tools using regex patterns on tool names:

```
toolbox_search_regex({ pattern: "time_.*", limit: 5 })
```

### Search Results

Both search tools return tool schemas so the LLM knows exact parameters:

```json
{
  "count": 1,
  "tools": [
    {
      "name": "time_get_current_time",
      "description": "Get current time in a specific timezone",
      "score": 0.87,
      "schema": {
        "type": "object",
        "properties": {
          "timezone": {
            "type": "string",
            "description": "IANA timezone name (e.g., 'America/New_York')"
          }
        },
        "required": ["timezone"]
      }
    }
  ],
  "usage": "Use toolbox_execute({ toolId: '<toolId>', arguments: '<json>' }) to run a discovered tool"
}
```

### toolbox_execute

Execute a discovered tool with JSON-encoded arguments. The `toolId` format is `{serverName}_{toolName}`:

```
toolbox_execute({ toolId: "time_get_current_time", arguments: '{"timezone": "Asia/Tokyo"}' })
```

## Example Flow

```
User: "What time is it in Tokyo?"

LLM: I need to find a time-related tool.
     toolbox_search_bm25({ text: "current time timezone" })

Toolbox: Returns time_get_current_time with its schema

LLM: Now I know the parameters. Let me call it.
     toolbox_execute({ toolId: "time_get_current_time", arguments: '{"timezone":"Asia/Tokyo"}' })

Toolbox: { "datetime": "2026-01-07T02:15:00+09:00", "timezone": "Asia/Tokyo" }

LLM: "The current time in Tokyo is 2:15 AM on January 7, 2026."
```

### toolbox_status

Get toolbox status including plugin health, MCP server connections, and tool counts:

```
toolbox_status({})
```

Returns a comprehensive status object:

```json
{
  "plugin": {
    "initialized": true,
    "configPath": "/Users/username/.config/opencode/toolbox.jsonc",
    "uptime": 123.45,
    "searches": 23,
    "executions": 15,
    "successRate": "93%"
  },
  "servers": {
    "total": 3,
    "connected": 2,
    "failed": 1,
    "connecting": 0,
    "connectionRatio": "2/3",
    "details": [
      {
        "name": "time",
        "status": "connected",
        "type": "local",
        "toolCount": 5,
        "error": null,
        "healthy": true
      },
      {
        "name": "github",
        "status": "connected",
        "type": "local",
        "toolCount": 12,
        "error": null,
        "healthy": true
      },
      {
        "name": "weather",
        "status": "error",
        "type": "remote",
        "toolCount": 0,
        "error": "Failed to connect: timeout",
        "healthy": false
      }
    ]
  },
  "tools": {
    "total": 17,
    "available": 17,
    "serversWithTools": 2
  },
  "health": {
    "status": "degraded",
    "message": "1 server(s) failed to connect"
  }
}
```

**Health Status:**
- `healthy`: All servers connected successfully
- `degraded`: Some servers failed to connect (check `servers.failed`)
- `unknown`: No servers configured or initialization failed

### /toolbox-status Slash Command

The plugin automatically creates a `/toolbox-status` slash command on first launch:

```
~/.config/opencode/command/toolbox-status.md
```

Use it in OpenCode by typing `/toolbox-status` to get a formatted status report.

### toolbox_perf

Get detailed performance metrics for the toolbox plugin:

```
toolbox_perf({})
```

Returns performance data including initialization times, search latencies, and execution stats:

```json
{
  "init": {
    "duration": 1234.56,
    "serverCount": 6,
    "toolCount": 42
  },
  "timers": {
    "search.bm25": { "count": 15, "total": 45.2, "avg": 3.01, "min": 1.2, "max": 8.5 },
    "search.regex": { "count": 5, "total": 12.1, "avg": 2.42, "min": 1.1, "max": 4.2 },
    "tool.execute": { "count": 10, "total": 892.3, "avg": 89.23, "min": 12.5, "max": 245.8 }
  },
  "indexStats": {
    "documentCount": 42,
    "avgDocLength": 15.3
  },
  "config": {
    "initMode": "eager",
    "connectionTimeout": 5000,
    "requestTimeout": 30000,
    "retryAttempts": 2
  }
}
```

## Search Modes

### BM25 (Natural Language)
- Best for semantic queries: "search the web", "get current time"
- Uses TF-IDF based ranking
- Searches tool name, description, and parameter info

### Regex (Pattern Matching)
- Best for precise matches: `^time_.*`, `github_`
- Supports `(?i)` prefix for case-insensitive matching
- Limited to 200 characters for safety

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed diagrams and flow explanations.

## Development

### Setup

```bash
bun install
```

### Tests

```bash
bun test              # Run all tests
bun test --coverage   # Run with coverage
```

### Build

```bash
bun run build
```

## Observability

The toolbox plugin provides built-in logging and status monitoring to help you understand what's happening.

### Logging

All plugin operations are logged **silently** to a dedicated log file (no screen output):

```
~/.local/share/opencode/toolbox.log
```

Log entries include:
- Plugin initialization status
- MCP server connection status (connected/error)
- Tool search operations (BM25/regex queries + result counts)
- Tool execution results (success/failure with duration)
- Errors with details

**View logs:**
```bash
# Watch logs in real-time
tail -f ~/.local/share/opencode/toolbox.log

# Check for errors only
grep "ERROR" ~/.local/share/opencode/toolbox.log

# Check for warnings
grep "WARN" ~/.local/share/opencode/toolbox.log
```

**Log format:**
```
2026-01-08T12:34:56.789Z [INFO] Toolbox plugin loaded successfully {"configPath":"...","serverCount":6}
2026-01-08T12:34:57.123Z [INFO] Initialization complete: 5/6 servers connected, 42 tools indexed
2026-01-08T12:34:57.124Z [WARN] 1 server(s) failed to connect: weather
2026-01-08T12:35:00.456Z [INFO] BM25 search completed: "web search" -> 3 results
```

### Status Tool

Use the `toolbox_status` command to check plugin health at any time:

```
toolbox_status({})
```

This shows:
- **Plugin Status**: Initialization, config path, uptime, search/execution counts
- **Server Status**: Connection ratio (e.g., "2/3"), details per server
- **Tools**: Total available tools, servers with tools
- **Health**: Overall health status (healthy/degraded/unknown)

**Connection Ratio**: Shows `success/total` for servers. If `success < total`, it indicates failed connections.

## Troubleshooting

### Plugin not loading

1. Run `toolbox_status({})` to check initialization status
2. Check OpenCode logs at `~/.local/share/opencode/log/` for plugin errors
3. Verify `opencode-toolbox` is in the `plugin` array in `opencode.jsonc`
4. Ensure `toolbox.jsonc` exists and is valid JSON

### Search finds no tools

1. Verify underlying MCP servers are configured in `toolbox.jsonc`
2. Check tool descriptions for relevant keywords
3. Try broader search terms or regex patterns

### MCP servers not connecting

1. Run `toolbox_status({})` to see which servers failed
2. Check logs for specific error messages from failed servers
3. Verify server command works standalone: `npx -y @anthropic/mcp-time`
4. For remote servers, verify URL is accessible
5. Check environment variables are set correctly

### Execute fails

1. Run `toolbox_status({})` to check server health
2. Verify `toolId` format: `{serverName}_{toolName}`
3. Check `arguments` is valid JSON
4. Ensure underlying MCP server is running and connected
5. Check logs for detailed error messages

## License

MIT
