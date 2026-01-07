# Testing Guide for opencode-toolbox

## Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test test/unit/config.test.ts
```

## Test Coverage

Current coverage: **72.80% function, 74.33% line**

Note: Full coverage isn't possible without:
- Testing actual stdio process spawning (requires real MCP servers)
- Testing HTTP/SSE connections (requires network)
- Testing full MCP protocol flows (requires integration)

## Integration with OpenCode

### Manual Testing

To manually test with OpenCode:

1. **Create test config:**
   ```bash
   mkdir -p ~/.config/opencode
   cp example-config.jsonc ~/.config/opencode/opencode-toolbox.jsonc
   ```

2. **Configure OpenCode:**
   Add to `opencode.jsonc`:
   ```jsonc
   {
     "mcp": {
       "toolbox": {
         "type": "local",
         "command": ["bun", "run", "dist/index.js"]
       }
     }
   }
   ```

3. **Start OpenCode** with the config

4. **Test search tools:**
   - Ask the model to use `toolbox_search_bm25`
   - Query: "send email"
   - Verify that tools are discovered and activated

5. **Test activated tools:**
   - Ask the model to call the discovered tool
   - Verify the tool call works

### Automated Testing (Simulated)

Run the full integration test suite:

```bash
bun test test/integration/
```

This tests:
- Server initialization with various configs
- Activation limit enforcement
- Multiple server connections
- MCP client connections

## Testing Checklist

- [x] Unit tests for config parsing
- [x] Unit tests for BM25 search
- [x] Unit tests for regex search
- [x] Unit tests for tool catalog
- [x] Unit tests for activation manager
- [x] Unit tests for MCP client (FakeMCPClient)
- [x] Integration tests for ToolboxServer
- [ ] Manual testing with OpenCode
- [ ] End-to-end testing with real MCP servers

## Debugging

### Enable Debug Logging

To see what the server is doing:

```bash
DEBUG=* bun run dist/index.js
```

Or in the code, add console.error() statements to track execution flow.

### Common Issues

**Issue:** Tools not appearing in OpenCode

**Solution:**
1. Check that `opencode-toolbox.jsonc` path is correct
2. Verify OpenCode logs for connection errors
3. Check that underlying MCP servers are configured correctly

**Issue:** Search finds no tools

**Solution:**
1. Verify that underlying MCP servers connected successfully
2. Check tool descriptions for relevant keywords
3. Try broader search terms

**Issue:** Activated tools not working

**Solution:**
1. Check that underlying MCP server is running
2. Verify environment variables are set correctly
3. Check server logs for routing errors
