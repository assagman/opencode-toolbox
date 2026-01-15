import { test, expect } from "bun:test";
import { BM25Index } from "../../src/search/bm25";
import type { CatalogTool } from "../../src/catalog";

function createMockTool(
  server: string,
  name: string,
  description: string
): CatalogTool {
  return {
    id: { server, name },
    idString: `${server}_${name}`,
    description,
    inputSchema: {
      type: "object",
      properties: {},
    },
    searchableText: `${name} ${description}`,
    args: [],
  };
}

test("BM25 index builds correctly", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message via Gmail"),
    createMockTool("github", "create_pr", "Create a pull request"),
    createMockTool("weather", "get_weather", "Get current weather for a location"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  expect(index.size).toBe(3);
});

test("BM25 search finds matching tools", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message via Gmail"),
    createMockTool("github", "create_pr", "Create a pull request"),
    createMockTool("weather", "get_weather", "Get current weather for a location"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  const results = index.search("email send");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]?.idString).toBe("gmail_send_email");
});

test("BM25 search handles no results", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message via Gmail"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  const results = index.search("xyzzy nonmatching terms");
  expect(results.length).toBe(0);
});

test("BM25 search with limit", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message"),
    createMockTool("outlook", "send_mail", "Send a mail message"),
    createMockTool("github", "create_pr", "Create a pull request"),
    createMockTool("gitlab", "create_mr", "Create a merge request"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  const results = index.search("send create", 2);
  expect(results.length).toBe(2);
});

test("BM25 search returns stable alphabetical ordering for ties", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
    createMockTool("outlook", "send_mail", "Send a mail"),
    createMockTool("github", "create_pr", "Create PR"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  // Search for term that matches all (should have same scores)
  const results = index.search("send", 10);

  // For same scores, should be alphabetical by idString
  const idStrings = results.map(r => r.idString);
  expect(idStrings).toEqual(idStrings.slice().sort());
});

test("BM25 search returns proper result structure", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email via Gmail"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  const results = index.search("email");

  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toMatchObject({
    tool: { server: "gmail", name: "send_email" },
    idString: "gmail_send_email",
    preview: "Send an email via Gmail",
    score: expect.any(Number),
    signature: expect.any(String),
  });
});

test("BM25 index clears correctly", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);
  expect(index.size).toBe(1);

  index.clear();
  expect(index.size).toBe(0);
});

test("BM25 handles empty index", () => {
  const index = new BM25Index();
  expect(index.size).toBe(0);

  const results = index.search("test");
  expect(results).toEqual([]);
});

test("BM25 handles empty query", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
  ];

  const index = new BM25Index();
  index.indexTools(tools);

  const results = index.search("");
  expect(results).toEqual([]);
});

test("BM25 search signature includes arguments", () => {
  const toolWithArgs: CatalogTool = {
    id: { server: "gmail", name: "send_email" },
    idString: "gmail_send_email",
    description: "Send an email",
    inputSchema: {
      type: "object",
      properties: {},
    },
    searchableText: "send_email Send an email",
    args: [
      { name: "to", description: "Recipient email address" },
      { name: "subject", description: "Email subject" },
      { name: "body", description: "Email body" },
    ],
  };

  const index = new BM25Index();
  index.indexTools([toolWithArgs]);

  const results = index.search("email");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]?.signature).toBe("send_email(to, subject, body)");
});

// --- Incremental operations ---

test("addTool() adds single tool incrementally", () => {
  const index = new BM25Index();
  
  const tool = createMockTool("gmail", "send_email", "Send an email");
  index.addTool(tool);
  
  expect(index.size).toBe(1);
  expect(index.has("gmail_send_email")).toBe(true);
  
  // Search should find it
  const results = index.search("email");
  expect(results.length).toBe(1);
  expect(results[0]?.idString).toBe("gmail_send_email");
});

test("addTool() skips duplicates", () => {
  const index = new BM25Index();
  
  const tool = createMockTool("gmail", "send_email", "Send an email");
  index.addTool(tool);
  index.addTool(tool); // Add again
  
  expect(index.size).toBe(1);
});

test("addToolsBatch() adds multiple tools", () => {
  const index = new BM25Index();
  
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
    createMockTool("github", "create_pr", "Create PR"),
  ];
  
  index.addToolsBatch(tools);
  
  expect(index.size).toBe(2);
});

test("removeTool() removes existing tool", () => {
  const index = new BM25Index();
  
  const tool1 = createMockTool("gmail", "send_email", "Send an email");
  const tool2 = createMockTool("github", "create_pr", "Create PR");
  
  index.addToolsBatch([tool1, tool2]);
  expect(index.size).toBe(2);
  
  const removed = index.removeTool("gmail_send_email");
  expect(removed).toBe(true);
  expect(index.size).toBe(1);
  expect(index.has("gmail_send_email")).toBe(false);
  expect(index.has("github_create_pr")).toBe(true);
});

test("removeTool() returns false for non-existent tool", () => {
  const index = new BM25Index();
  
  const removed = index.removeTool("nonexistent_tool");
  expect(removed).toBe(false);
});

test("removeTool() updates document frequencies correctly", () => {
  const index = new BM25Index();
  
  // Add two tools with overlapping terms
  const tool1 = createMockTool("a", "email_tool", "Send email messages");
  const tool2 = createMockTool("b", "email_util", "Email utility");
  
  index.addToolsBatch([tool1, tool2]);
  
  // Remove one - the shared term "email" should still be searchable
  index.removeTool("a_email_tool");
  
  const results = index.search("email");
  expect(results.length).toBe(1);
  expect(results[0]?.idString).toBe("b_email_util");
});

test("removeTool() handles term frequency going to zero", () => {
  const index = new BM25Index();
  
  const tool = createMockTool("unique", "special_tool", "Unique description");
  index.addTool(tool);
  
  index.removeTool("unique_special_tool");
  
  // Search for unique term should return nothing
  const results = index.search("unique special");
  expect(results.length).toBe(0);
});

test("has() returns true for indexed tool", () => {
  const index = new BM25Index();
  
  index.addTool(createMockTool("gmail", "send", "Send"));
  
  expect(index.has("gmail_send")).toBe(true);
});

test("has() returns false for non-indexed tool", () => {
  const index = new BM25Index();
  
  expect(index.has("nonexistent_tool")).toBe(false);
});

test("getStats() returns correct statistics", () => {
  const index = new BM25Index();
  
  const tools = [
    createMockTool("a", "tool1", "Description one"),
    createMockTool("b", "tool2", "Description two words"),
    createMockTool("c", "tool3", "Description three total words"),
  ];
  
  index.indexTools(tools);
  
  const stats = index.getStats();
  expect(stats.docCount).toBe(3);
  expect(stats.termCount).toBeGreaterThan(0);
  expect(stats.avgDocLength).toBeGreaterThan(0);
});

// --- Async operations ---

test("indexToolsAsync() indexes tools asynchronously", async () => {
  const index = new BM25Index();
  
  const tools = [
    createMockTool("a", "tool1", "First tool"),
    createMockTool("b", "tool2", "Second tool"),
    createMockTool("c", "tool3", "Third tool"),
  ];
  
  await index.indexToolsAsync(tools, 1); // Small chunk size to force multiple yields
  
  expect(index.size).toBe(3);
  
  const results = index.search("tool");
  expect(results.length).toBe(3);
});

test("indexToolsAsync() clears existing index", async () => {
  const index = new BM25Index();
  
  // Add initial tools
  index.addTool(createMockTool("old", "old_tool", "Old tool"));
  expect(index.size).toBe(1);
  
  // Async index should clear and replace
  const newTools = [
    createMockTool("new", "new_tool", "New tool"),
  ];
  
  await index.indexToolsAsync(newTools);
  
  expect(index.size).toBe(1);
  expect(index.has("new_new_tool")).toBe(true);
  expect(index.has("old_old_tool")).toBe(false);
});

test("addToolsAsync() adds tools incrementally", async () => {
  const index = new BM25Index();
  
  // Add first batch
  index.addTool(createMockTool("a", "tool1", "First"));
  
  // Add more async
  const moreTools = [
    createMockTool("b", "tool2", "Second"),
    createMockTool("c", "tool3", "Third"),
  ];
  
  await index.addToolsAsync(moreTools, 1);
  
  expect(index.size).toBe(3);
});

test("addToolsAsync() yields between chunks", async () => {
  const index = new BM25Index();
  
  // Create many tools to force multiple chunks
  const tools: CatalogTool[] = [];
  for (let i = 0; i < 10; i++) {
    tools.push(createMockTool(`server${i}`, `tool${i}`, `Description ${i}`));
  }
  
  // Use small chunk size
  await index.addToolsAsync(tools, 3);
  
  expect(index.size).toBe(10);
});

test("async and sync indexing produce same results", async () => {
  const tools = [
    createMockTool("a", "send_email", "Send email"),
    createMockTool("b", "search_web", "Search the web"),
  ];
  
  const syncIndex = new BM25Index();
  syncIndex.indexTools(tools);
  
  const asyncIndex = new BM25Index();
  await asyncIndex.indexToolsAsync(tools);
  
  expect(asyncIndex.size).toBe(syncIndex.size);
  
  const syncResults = syncIndex.search("email", 5);
  const asyncResults = asyncIndex.search("email", 5);
  
  expect(asyncResults.length).toBe(syncResults.length);
  expect(asyncResults[0]?.idString).toBe(syncResults[0]?.idString);
});

test("incremental avg doc length calculation", () => {
  const index = new BM25Index();
  
  // Add tools one at a time
  index.addTool(createMockTool("a", "short", "A"));
  index.addTool(createMockTool("b", "medium", "A B C"));
  index.addTool(createMockTool("c", "long", "A B C D E F G H"));
  
  const stats = index.getStats();
  expect(stats.avgDocLength).toBeGreaterThan(0);
  expect(stats.docCount).toBe(3);
});

test("avg doc length is zero after clearing", () => {
  const index = new BM25Index();
  
  index.addTool(createMockTool("a", "tool", "Description"));
  index.clear();
  
  const stats = index.getStats();
  expect(stats.avgDocLength).toBe(0);
  expect(stats.docCount).toBe(0);
});
