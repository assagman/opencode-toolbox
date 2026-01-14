# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-01-14

### Added
- **JSON Schema support**: Config files now support `$schema` for editor autocompletion and validation
- **Auto-create config**: Plugin automatically creates `~/.config/opencode/toolbox.jsonc` with schema reference on first run
- **Better error messages**: Config validation errors now show file path and server command/url details

### Fixed
- **Exponential backoff**: MCP server connection retries now use exponential backoff (100ms → 200ms → 400ms...) instead of fixed delay

### Documentation
- Added `$schema` to all config examples in README.md, CONFIG.md, and example-config.jsonc

## [0.8.0] - 2026-01-11

### Breaking Changes
- **`toolbox_execute` parameter renamed**: `name` → `toolId` for clarity
  - Old: `toolbox_execute({ name: "time_get_current_time", ... })`
  - New: `toolbox_execute({ toolId: "time_get_current_time", ... })`

### Added
- Streamable HTTP transport with SSE fallback for remote MCP connections

### Changed
- System prompt rewritten in structured XML format for better readability and debugging
- Added `{serverName}_{toolName}` format documentation to `toolbox_execute` description
- Renamed ExtendedToolbox to MCPTools in system prompt
- Improved code formatting throughout plugin

### Fixed
- Remote MCP client transport fallback cleanup to avoid closing existing connections

### CI
- Added CI/CD workflow and README badges
- Fixed Codecov reporting and generated lcov.info for uploads

### Documentation
- Added performance tip about version pinning for instant startup
- Updated all docs to use `toolId` instead of `name`

## [0.7.0] - 2026-01-08

### Added
- **Test tool**: New `toolbox_test` tool for testing all MCP tools with predefined minimal prompts
- Predefined test prompts for all known tools (time, brave, brightdata, tavily, context7, octocode, perplexity)
- Auto-generated minimal arguments from JSON schema for unknown tools

### Changed
- **Instant startup**: System prompt generation no longer waits for MCP server connections
- System prompt now shows configured server names immediately (from config, not connection state)
- Removed blocking `waitForPartial()` call from system prompt transform hook

### Performance
- Plugin startup reduced from ~1.5s to <10ms (no longer blocked by container initialization)
- MCP servers still connect in background, tools available via `toolbox_search_*` once ready

## [0.6.0] - 2026-01-08

### Added
- **Non-blocking eager initialization**: MCP servers connect in background on plugin load, not blocking startup
- **Progressive tool loading**: Tools are indexed incrementally as servers connect
- **Performance tool**: New `toolbox_perf` tool for detailed performance metrics
- **Profiling infrastructure**: Track init times, search latencies, and execution stats
- **Connection settings**: Configurable timeouts and retry behavior (`connection.connectTimeout`, `requestTimeout`, `retryAttempts`, `retryDelay`)
- **Init mode setting**: Choose between `eager` (default) or `lazy` initialization via `settings.initMode`
- **Benchmark suite**: Performance benchmarks for search, init, and concurrent operations

### Changed
- MCPManager rewritten with event-based architecture for non-blocking init
- BM25Index now supports async and incremental indexing
- Improved startup logging with load duration and log path
- Skip logging in test environment for cleaner test output

### Documentation
- Synced all docs with codebase (README, ARCHITECTURE, CONFIG)
- Added `toolbox_perf` documentation
- Documented `initMode` and `connection` settings
- Updated tool count in architecture diagrams (3→5)

## [0.5.1] - 2026-01-08

### Fixed
- **Reverted auto-update**: Removed command file version tracking that caused OpenCode launch delays

## [0.5.0] - 2026-01-08

### Added
- **Observability**: Dedicated log file at `~/.local/share/opencode/toolbox.log`
- **Status Tool**: New `toolbox_status` tool for checking plugin and server health
- **Slash Command**: Auto-creates `/toolbox-status` command on first launch
- **Health Metrics**: Track search count, execution count, and success rate
- **Server Connection Tracking**: Log MCP server initialization and connection status
- **Error Logging**: Detailed error messages for failed operations
- **Status Indicators**: Connection ratio (e.g., "2/3") to highlight failures
- **Tests**: Comprehensive test suite for `toolbox_status` tool (9 new tests)

### Changed
- Updated README with observability section and logging documentation
- Added troubleshooting guidance using `toolbox_status` and logs
- Silent logging (no screen output) to prevent UI flickering

## [0.4.0] - 2026-01-08

### Breaking Changes
- **Config format change**: Renamed `servers` key to `mcp` in toolbox.jsonc to align with OpenCode's configuration format
- Users must update their config file from `"servers": {}` to `"mcp": {}`

### Changed
- Updated config schema to use `mcp` field
- Updated plugin to read `config.mcp` instead of `config.servers`
- Updated all documentation (README.md, CONFIG.md) and examples to use `mcp` key
- Updated all test cases to use new config format

## [0.3.1] - 2026-01-08

### Changed
- Updated README and ARCHITECTURE docs to reflect three-tool structure (`toolbox_search_bm25`, `toolbox_search_regex`, `toolbox_execute`)
- Removed outdated installation instructions (no `bun add` required)
- Fixed parameter names in documentation (`arguments` instead of `toolArgs`)

## [0.3.0] - 2026-01-08

### Added
- Dynamic toolbox schema in system prompt listing all registered MCP servers and their tools
- Tool names now use clear `<server>_<tool>` format matching toolbox_execute() expectations
- Makefile with build, test, typecheck, and release helper targets
- RELEASE.md documenting the release process

### Changed
- System prompt now includes JSON schema of available tools for better LLM understanding
- Simplified system prompt rules for clarity

## [0.2.0] - 2026-01-08

### Added
- Config system with JSONC parsing and Zod validation
- Environment variable interpolation ({env:VAR})
- BM25 search engine with k1=1.2, b=0.75
- Regex search engine with Python (?i) compatibility
- Tool catalog and normalization from MCP servers
- Activation manager for tracking active tools
- MCP server exposing toolbox_search_regex and toolbox_search_bm25
- Local MCP client with StdioClientTransport
- Remote MCP client with SSEClientTransport
- Comprehensive test suite (51 tests, 72.80% coverage)
- Integration tests for full flow
- Testing documentation and debugging guide

### Changed
- Updated MCPManager to use real client transports
- Added connect() method to MCPClient interface
- Split MCPServerConfig into LocalMCPServerConfig and RemoteMCPServerConfig

### Technical Notes
- Tools stay active for session (matches Anthropic behavior)
- No automatic deactivation in v1
- Max regex pattern length: 200 characters
- Default search results: 5, max: 10
- Default max activated tools: 50 (configurable)
