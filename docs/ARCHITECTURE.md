# Toolbox Architecture

## Overview

Toolbox (Tool Search Tool) is an OpenCode plugin that implements the "tool search tool" pattern. It reduces LLM context bloat by exposing a single `toolbox` tool that provides on-demand access to a catalog of MCP server tools.

## Tool Registration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OPENCODE                                       │
│                                                                          │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐     │
│  │  Built-in Tools  │   │  MCP Server Tools │   │   Plugin Tools   │     │
│  │                  │   │                   │   │                  │     │
│  │  • read          │   │  • time_*         │   │  • supermemory   │     │
│  │  • bash          │   │  • exa_*          │   │  • toolbox (ours)│     │
│  │  • edit          │   │  • brave_*        │   │                  │     │
│  │  • write         │   │  • context7_*     │   │                  │     │
│  │  • glob          │   │                   │   │                  │     │
│  │  • grep          │   │                   │   │                  │     │
│  │  • task          │   │                   │   │                  │     │
│  └────────┬─────────┘   └─────────┬─────────┘   └────────┬─────────┘     │
│           │                       │                      │               │
│           └───────────────────────┼──────────────────────┘               │
│                                   ▼                                      │
│                    ┌──────────────────────────┐                          │
│                    │     Tool Registry        │                          │
│                    │  (unified tool list)     │                          │
│                    └──────────────────────────┘                          │
│                                   │                                      │
│                                   ▼                                      │
│                    ┌──────────────────────────┐                          │
│                    │   Send to LLM as JSON    │                          │
│                    │   Schema in API call     │                          │
│                    └──────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Problem: Context Bloat

Without Toolbox, LLM sees all MCP tools:

```json
{
  "tools": [
    { "name": "read", "description": "Read a file...", "parameters": {...} },
    { "name": "bash", "description": "Execute command...", "parameters": {...} },
    { "name": "time_get_current_time", "description": "Get time...", "parameters": {...} },
    { "name": "time_convert_time", "description": "Convert time...", "parameters": {...} },
    { "name": "exa_web_search_exa", "description": "Search web...", "parameters": {...} },
    ... (50+ more tools)
  ]
}
```

## Solution: Toolbox as Gateway

With Toolbox plugin, LLM sees only essential tools:

```json
{
  "tools": [
    { "name": "read", "description": "Read a file...", "parameters": {...} },
    { "name": "bash", "description": "Execute command...", "parameters": {...} },
    { "name": "toolbox", "description": "Search and execute tools...", "parameters": {
        "action": { "enum": ["search", "execute"] },
        "query": { "type": "string" },
        "toolName": { "type": "string" },
        "toolArgs": { "type": "string" }
      }
    }
  ]
}
```

## Toolbox Plugin Initialization

```
┌─────────────────────────────────────────────────────────────────┐
│                      OPENCODE STARTUP                            │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ Load Built-in │     │  Load Plugins │     │  Load MCP     │
│    Tools      │     │               │     │  Servers      │
└───────────────┘     └───────┬───────┘     └───────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ opencode-toolbox  │
                    │ plugin loads      │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────────────────────────┐
                    │ Toolbox Plugin Initialization:        │
                    │                                       │
                    │ 1. Read ~/.config/opencode/toolbox.jsonc │
                    │ 2. Connect to configured MCP servers  │
                    │ 3. Fetch all tools from each server   │
                    │ 4. Build internal catalog             │
                    │ 5. Return { tool: { toolbox: ... } }  │
                    └───────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────────────────────────┐
                    │         TOOL REGISTRY                 │
                    │                                       │
                    │  • read                               │
                    │  • bash                               │
                    │  • edit                               │
                    │  • write                              │
                    │  • glob                               │
                    │  • grep                               │
                    │  • task                               │
                    │  • toolbox  ◄── OUR PLUGIN TOOL       │
                    │                                       │
                    │  (NO time_*, exa_*, brave_* etc.)     │
                    └───────────────────────────────────────┘
```

## Request Flow: "What time is it in Tokyo?"

```
┌────────┐                    ┌────────┐                    ┌─────────┐
│  User  │                    │  LLM   │                    │ Toolbox │
└───┬────┘                    └───┬────┘                    └────┬────┘
    │                             │                              │
    │ "What time is it in Tokyo?" │                              │
    │────────────────────────────►│                              │
    │                             │                              │
    │                             │ Hmm, I need time info.       │
    │                             │ I have 'toolbox' tool.       │
    │                             │ Let me search for time tools │
    │                             │                              │
    │                             │ toolbox({                    │
    │                             │   action: "search",          │
    │                             │   query: "time timezone"     │
    │                             │ })                           │
    │                             │─────────────────────────────►│
    │                             │                              │
    │                             │                              │ Search catalog
    │                             │                              │ using BM25
    │                             │                              │
    │                             │◄─────────────────────────────│
    │                             │ {                            │
    │                             │   "tools": [{                │
    │                             │     "name": "time_get_current_time",
    │                             │     "description": "Get current time in timezone",
    │                             │     "schema": {              │
    │                             │       "timezone": {          │
    │                             │         "type": "string",    │
    │                             │         "description": "IANA timezone name"
    │                             │       }                      │
    │                             │     }                        │
    │                             │   }]                         │
    │                             │ }                            │
    │                             │                              │
    │                             │ Now I know the schema!       │
    │                             │ timezone is a string,        │
    │                             │ Tokyo = "Asia/Tokyo"         │
    │                             │                              │
    │                             │ toolbox({                    │
    │                             │   action: "execute",         │
    │                             │   toolName: "time_get_current_time",
    │                             │   toolArgs: '{"timezone":"Asia/Tokyo"}'
    │                             │ })                           │
    │                             │─────────────────────────────►│
    │                             │                              │
    │                             │                              │ Parse toolName
    │                             │                              │ → server: "time"
    │                             │                              │ → tool: "get_current_time"
    │                             │                              │
    │                             │                              │ Call MCP server
    │                             │                              │     │
    │                             │                              │     ▼
    │                             │                              │ ┌────────────┐
    │                             │                              │ │ Time MCP   │
    │                             │                              │ │ Server     │
    │                             │                              │ └────────────┘
    │                             │                              │
    │                             │◄─────────────────────────────│
    │                             │ {                            │
    │                             │   "time": "2026-01-07T02:15:00+09:00",
    │                             │   "timezone": "Asia/Tokyo"   │
    │                             │ }                            │
    │                             │                              │
    │◄────────────────────────────│                              │
    │ "The current time in Tokyo  │                              │
    │  is 2:15 AM on Jan 7, 2026" │                              │
    │                             │                              │
```

## Tool Call Details

### Step 1: Search

```typescript
// LLM generates:
{ "name": "toolbox", "arguments": { "action": "search", "query": "time timezone" } }

// Toolbox returns:
{
  "tools": [
    {
      "name": "time_get_current_time",
      "description": "Get current time in a specific timezone",
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
  ]
}
```

### Step 2: Execute

```typescript
// LLM generates (using schema from search):
{
  "name": "toolbox",
  "arguments": {
    "action": "execute",
    "toolName": "time_get_current_time",
    "toolArgs": "{\"timezone\":\"Asia/Tokyo\"}"
  }
}

// Toolbox parses toolName: "time_get_current_time" → server="time", tool="get_current_time"
// Toolbox calls MCP server and returns result
```

## Tool Visibility Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCODE TOOL LIST                            │
├─────────────────────────────────────────────────────────────────┤
│  BUILT-IN          PLUGIN              (MCP - hidden behind Toolbox) │
│  ─────────         ──────              ─────────────────────────│
│  • read            • toolbox ◄────────► time_get_current_time    │
│  • bash            • supermemory       time_convert_time        │
│  • edit                                exa_web_search_exa       │
│  • write                               exa_crawling_exa         │
│  • glob                                brave_brave_web_search   │
│  • grep                                brave_brave_news_search  │
│  • task                                context7_resolve...      │
│  • lsp                                 ... (50+ more)           │
│  • todowrite                                                    │
│  • todoread                                                     │
└─────────────────────────────────────────────────────────────────┘

LLM only sees left two columns (~12 tools)
Toolbox provides access to right column on-demand
```

## Search Engines

Toolbox supports two search modes:

### BM25 (Natural Language)
- Best for semantic queries like "search the web", "get current time"
- Uses TF-IDF based ranking with k1=1.2, b=0.75
- Searches tool name, description, and parameter info

### Regex (Pattern Matching)
- Best for precise matches like "exa_.*", "brave_"
- Supports Python-style `(?i)` for case-insensitive
- Limited to 200 characters for safety
