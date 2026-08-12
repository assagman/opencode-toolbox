import type { CatalogTool } from "./catalog/types";

/**
 * Permission pattern format matching OpenCode agent frontmatter
 */
export interface PermissionPatterns {
  allow?: string[];
  deny?: string[];
}

/**
 * Matches a tool identifier against a permission pattern.
 *
 * Patterns use glob-style matching:
 * - `context7*` matches any tool id starting with `context7` (e.g. `context7_resolve`)
 * - `*search` matches any tool id ending with `search`
 * - `*` matches everything
 * - Exact match: `context7_resolve`
 *
 * @param toolId - The tool identifier (e.g. `context7_resolve`)
 * @param pattern - The permission pattern (e.g. `context7*`)
 * @returns true if the tool matches the pattern
 */
function matchesPermission(toolId: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolId) return true;

  // Convert glob pattern to regex
  // Escape regex special characters except *
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(toolId);
}

/**
 * Check if a specific tool is allowed based on permission patterns.
 *
 * @param toolId - The tool identifier (e.g. `context7_resolve`)
 * @param permissions - Permission patterns from agent config
 * @returns true if the tool is allowed
 */
export function isToolAllowed(toolId: string, permissions: PermissionPatterns): boolean {
  const { allow, deny } = permissions;

  // Check deny first - if denied, tool is not allowed
  if (deny && deny.length > 0) {
    for (const pattern of deny) {
      if (matchesPermission(toolId, pattern)) {
        return false;
      }
    }
  }

  // If allow list is empty or undefined, allow all (default behavior)
  if (!allow || allow.length === 0) {
    return true;
  }

  // Check allow list - must match at least one allowed pattern
  for (const pattern of allow) {
    if (matchesPermission(toolId, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter a list of tools based on permission patterns.
 *
 * @param tools - The tools to filter
 * @param permissions - Permission patterns from agent config
 * @returns Only tools that are allowed by the permissions
 */
export function filterToolsByPermissions(
  tools: CatalogTool[],
  permissions: PermissionPatterns
): CatalogTool[] {
  return tools.filter((tool) => isToolAllowed(tool.idString, permissions));
}
