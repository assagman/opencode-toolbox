# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
