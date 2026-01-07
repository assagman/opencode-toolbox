import { test, expect } from "bun:test";
import { normalizeTool, normalizeTools } from "../../src/catalog/catalog";

test("normalizeTool creates correct structure", () => {
  const tool = {
    name: "send_email",
    description: "Send an email message via Gmail",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string" as const,
          description: "Recipient email address",
        },
        subject: {
          type: "string" as const,
          description: "Email subject",
        },
      },
    },
  };

  const catalogTool = normalizeTool("gmail", tool);

  expect(catalogTool.id).toEqual({ server: "gmail", name: "send_email" });
  expect(catalogTool.idString).toBe("gmail_send_email");
  expect(catalogTool.description).toBe("Send an email message via Gmail");
  expect(catalogTool.inputSchema).toEqual(tool.inputSchema);
});

test("normalizeTool extracts arguments", () => {
  const tool = {
    name: "send_email",
    description: "Send an email",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string" as const,
          description: "Recipient email address",
        },
        subject: {
          type: "string" as const,
          description: "Email subject",
        },
        body: {
          type: "string" as const,
        },
      },
    },
  };

  const catalogTool = normalizeTool("gmail", tool);

  expect(catalogTool.args).toHaveLength(3);
  expect(catalogTool.args[0]).toEqual({
    name: "to",
    description: "Recipient email address",
  });
  expect(catalogTool.args[1]).toEqual({
    name: "subject",
    description: "Email subject",
  });
  expect(catalogTool.args[2]).toEqual({
    name: "body",
    description: undefined,
  });
});

test("normalizeTool builds searchable text", () => {
  const tool = {
    name: "send_email",
    description: "Send an email message via Gmail",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string" as const,
          description: "Recipient email address",
        },
      },
    },
  };

  const catalogTool = normalizeTool("gmail", tool);

  // Searchable text includes qualified name, original name, description, and args
  expect(catalogTool.searchableText).toBe(
    "gmail_send_email send_email Send an email message via Gmail to Recipient email address"
  );
});

test("normalizeTool handles missing description", () => {
  const tool = {
    name: "send_email",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  };

  const catalogTool = normalizeTool("gmail", tool);

  expect(catalogTool.description).toBe("");
  // Searchable text includes qualified name and original name even without description
  expect(catalogTool.searchableText).toBe("gmail_send_email send_email");
});

test("normalizeTool handles empty properties", () => {
  const tool = {
    name: "simple_tool",
    description: "A simple tool",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  };

  const catalogTool = normalizeTool("test", tool);

  expect(catalogTool.args).toEqual([]);
  expect(catalogTool.searchableText).toBe("test_simple_tool simple_tool A simple tool");
});

test("normalizeTools processes multiple tools", () => {
  const tools = [
    {
      name: "send_email",
      description: "Send an email",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_weather",
      description: "Get current weather",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  const catalogTools = normalizeTools("test", tools);

  expect(catalogTools).toHaveLength(2);
  expect(catalogTools[0]?.idString).toBe("test_send_email");
  expect(catalogTools[1]?.idString).toBe("test_get_weather");
});

test("normalizeTool handles server name sanitization in idString", () => {
  const tool = {
    name: "send_email",
    description: "Send an email",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  };

  const catalogTool = normalizeTool("my-mcp-server", tool);

  expect(catalogTool.idString).toBe("my-mcp-server_send_email");
});

test("normalizeTool handles boolean properties", () => {
  const tool = {
    name: "toggle_feature",
    description: "Toggle a feature flag",
    inputSchema: {
      type: "object" as const,
      properties: {
        enabled: {} as any,  // Empty object for required property
      },
    },
  };

  const catalogTool = normalizeTool("test", tool);

  expect(catalogTool.args).toHaveLength(1);
  expect(catalogTool.args[0]?.name).toBe("enabled");
  expect(catalogTool.args[0]?.description).toBeUndefined();
});

test("normalizeTool handles boolean properties", () => {
  const tool = {
    name: "toggle_feature",
    description: "Toggle a feature flag",
    inputSchema: {
      type: "object" as const,
      properties: {
        enabled: {} as any,  // Empty object for required property
      },
    },
  };

  const catalogTool = normalizeTool("test", tool);

  expect(catalogTool.args).toHaveLength(1);
  expect(catalogTool.args[0]?.name).toBe("enabled");
  expect(catalogTool.args[0]?.description).toBeUndefined();
});
