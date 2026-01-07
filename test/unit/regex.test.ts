import { test, expect } from "bun:test";
import { searchWithRegex, MAX_REGEX_LENGTH } from "../../src/search/regex";
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

test("regex search finds matching tools", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message via Gmail"),
    createMockTool("github", "create_pr", "Create a pull request"),
    createMockTool("weather", "get_weather", "Get current weather for a location"),
  ];

  const results = searchWithRegex(tools, "email") as any;

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].idString).toBe("gmail_send_email");
});

test("regex search handles case-insensitive with (?i)", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email message"),
    createMockTool("outlook", "SEND_MAIL", "Send a mail message"),  // All caps
  ];

  const results = searchWithRegex(tools, "(?i)send") as any;

  expect(results.length).toBe(2);
  const ids = results.map((r: any) => r.idString);
  expect(ids).toContain("gmail_send_email");
  expect(ids).toContain("outlook_SEND_MAIL");
});

test("regex search with no matches", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
  ];

  const results = searchWithRegex(tools, "xyzzy") as any;

  expect(results).toEqual([]);
});

test("regex search with limit", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
    createMockTool("outlook", "send_mail", "Send a mail"),
    createMockTool("github", "create_pr", "Create PR"),
  ];

  const results = searchWithRegex(tools, "send", 1) as any;

  expect(results.length).toBe(1);
});

test("regex search enforces max length", () => {
  const tools = [createMockTool("gmail", "send_email", "Send an email")];

  const result = searchWithRegex(tools, "a".repeat(MAX_REGEX_LENGTH + 1));

  expect(result).toEqual({
    error: {
      code: "pattern_too_long",
      message: `Pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
    },
  });
});

test("regex search with invalid pattern", () => {
  const tools = [createMockTool("gmail", "send_email", "Send an email")];

  const result = searchWithRegex(tools, "[unclosed(");

  expect(result).toEqual({
    error: {
      code: "invalid_pattern",
      message: expect.any(String),
    },
  });
});

test("regex search with empty pattern", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
    createMockTool("github", "create_pr", "Create PR"),
  ];

  const results = searchWithRegex(tools, "") as any;

  // Empty regex matches everything, so should return all tools
  expect(results.length).toBe(2);
});

test("regex search with pattern matching args", () => {
  const toolWithArgs: CatalogTool = {
    id: { server: "gmail", name: "send_email" },
    idString: "gmail_send_email",
    description: "Send an email",
    inputSchema: { type: "object", properties: {} },
    searchableText: "send_email Send an email to recipient subject body",
    args: [
      { name: "to", description: "Recipient email address" },
      { name: "subject", description: "Email subject" },
      { name: "body", description: "Email body" },
    ],
  };

  const results = searchWithRegex([toolWithArgs], "recipient") as any;

  expect(results.length).toBe(1);
  expect(results[0].idString).toBe("gmail_send_email");
});

test("regex search returns proper result structure", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email via Gmail"),
  ];

  const results = searchWithRegex(tools, "email") as any;

  expect(results[0]).toMatchObject({
    tool: { server: "gmail", name: "send_email" },
    idString: "gmail_send_email",
    preview: "Send an email via Gmail",
    score: 1,
    signature: expect.any(String),
  });
});

test("regex search returns stable alphabetical ordering", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email"),
    createMockTool("outlook", "send_mail", "Send a mail"),
  ];

  const results = searchWithRegex(tools, "send") as any;

  // All have same score, should be alphabetical
  expect(results[0].idString).toBe("gmail_send_email");
  expect(results[1].idString).toBe("outlook_send_mail");
});

test("regex search signature includes arguments", () => {
  const toolWithArgs: CatalogTool = {
    id: { server: "gmail", name: "send_email" },
    idString: "gmail_send_email",
    description: "Send an email",
    inputSchema: { type: "object", properties: {} },
    searchableText: "send_email Send an email",
    args: [
      { name: "to", description: "Recipient email address" },
      { name: "subject", description: "Email subject" },
      { name: "body", description: "Email body" },
    ],
  };

  const results = searchWithRegex([toolWithArgs], "email") as any;

  expect(results[0].signature).toBe("send_email(to, subject, body)");
});

test("regex search with pattern matching multiple terms", () => {
  const tools = [
    createMockTool("gmail", "send_email", "Send an email via Gmail"),
    createMockTool("github", "get_email", "Get email from GitHub"),
    createMockTool("outlook", "read_mail", "Read mail messages"),
  ];

  const results = searchWithRegex(tools, "email|mail") as any;

  expect(results.length).toBe(3);
  const ids = results.map((r: any) => r.idString);
  expect(ids).toContain("gmail_send_email");
  expect(ids).toContain("github_get_email");
  expect(ids).toContain("outlook_read_mail");
});
