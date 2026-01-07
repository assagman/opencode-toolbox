import type { CatalogTool, SearchResult } from "../catalog/types";

export const MAX_REGEX_LENGTH = 200;

/**
 * Error codes matching Anthropic's spec
 */
export type RegexSearchError = {
  code: "invalid_pattern" | "pattern_too_long" | "unavailable";
  message: string;
};

/**
 * Search tools using regex pattern
 * Emulates Python's re.search() behavior as much as possible
 */
export function searchWithRegex(
  tools: CatalogTool[],
  pattern: string,
  limit: number = 5
): SearchResult[] | { error: RegexSearchError } {
  // Validate pattern length
  if (pattern.length > MAX_REGEX_LENGTH) {
    return {
      error: {
        code: "pattern_too_long",
        message: `Pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
      },
    };
  }

  // Handle (?i) prefix for case-insensitive matching (Python-style)
  let flags = "";
  let searchPattern = pattern;

  if (pattern.startsWith("(?i)")) {
    flags = "i";
    searchPattern = pattern.slice(4);
  }

  // Try to compile the regex
  let regex: RegExp;
  try {
    regex = new RegExp(searchPattern, flags);
  } catch (error) {
    return {
      error: {
        code: "invalid_pattern",
        message: error instanceof Error ? error.message : "Invalid regex pattern",
      },
    };
  }

  // Search across all tools
  const results: { tool: CatalogTool; score: number }[] = [];

  for (const tool of tools) {
    const matches = regex.test(tool.searchableText);

    if (matches) {
      // For regex, we use a simple binary score (1 if matches)
      // In a more advanced implementation, we could calculate score based on match position/length
      results.push({ tool, score: 1 });
    }
  }

  // Sort: all matches have score 1, so use alphabetical for stable ordering
  const sorted = results
    .sort((a, b) => a.tool.idString.localeCompare(b.tool.idString))
    .slice(0, limit);

  return sorted.map(({ tool, score }) => ({
    tool: tool.id,
    idString: tool.idString,
    score,
    preview: tool.description,
    signature: generateSignature(tool),
  }));
}

/**
 * Generate a condensed function signature for a tool
 */
function generateSignature(tool: CatalogTool): string {
  const argList = tool.args
    .map(arg => {
      // Check if arg is optional by looking for keywords in description
      const desc = arg.description?.toLowerCase() || "";
      const optional = desc.includes("optional") || desc.includes("(optional)");
      return `${arg.name}${optional ? "?" : ""}`;
    })
    .join(", ");

  return `${tool.id.name}(${argList})`;
}
