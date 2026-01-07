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
