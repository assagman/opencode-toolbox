# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
