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
  "plugin": ["opencode-toolbox"]
}
```

### 2. Configure Toolbox

Create `~/.config/opencode/toolbox.jsonc`:

```jsonc
{
  "servers": {
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

The plugin exposes three tools:

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
  "usage": "Use toolbox_execute({ name: '<tool_name>', arguments: '<json>' }) to run a discovered tool"
}
```

### toolbox_execute

Execute a discovered tool with JSON-encoded arguments:

```
toolbox_execute({ name: "time_get_current_time", arguments: '{"timezone": "Asia/Tokyo"}' })
```

## Example Flow

```
User: "What time is it in Tokyo?"

LLM: I need to find a time-related tool.
     toolbox_search_bm25({ text: "current time timezone" })

Toolbox: Returns time_get_current_time with its schema

LLM: Now I know the parameters. Let me call it.
     toolbox_execute({ name: "time_get_current_time", arguments: '{"timezone":"Asia/Tokyo"}' })

Toolbox: { "datetime": "2026-01-07T02:15:00+09:00", "timezone": "Asia/Tokyo" }

LLM: "The current time in Tokyo is 2:15 AM on January 7, 2026."
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

## Troubleshooting

### Plugin not loading

1. Check OpenCode logs for plugin errors
2. Verify `opencode-toolbox` is in the `plugin` array in `opencode.jsonc`
3. Ensure `toolbox.jsonc` exists and is valid JSON

### Search finds no tools

1. Verify underlying MCP servers are configured in `toolbox.jsonc`
2. Check tool descriptions for relevant keywords
3. Try broader search terms or regex patterns

### Execute fails

1. Verify the tool name format: `serverName_toolName`
2. Check `arguments` is valid JSON
3. Ensure underlying MCP server is running

## License

MIT
