import { parse } from "jsonc-parser";
import { z } from "zod";
import type { Config } from "./schema";
import { ConfigSchema } from "./schema";

/**
 * Interpolate environment variables in config values
 * Handles {env:VAR_NAME} pattern
 */
function interpolateEnvVars(obj: any): any {
  if (typeof obj === "string") {
    // Replace {env:VAR_NAME} with actual env var or empty string
    return obj.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, varName) => {
      return process.env[varName] || "";
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }

  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }

  return obj;
}

/**
 * Parse and validate opencode-toolbox.jsonc config
 * @param jsonc - JSONC string (may contain comments)
 * @returns Zod validation result
 */
export function parseConfig(jsonc: string): ReturnType<typeof ConfigSchema.safeParse> {
  try {
    // Parse JSONC (handles comments and trailing commas)
    const parsed = parse(jsonc);

    // Interpolate environment variables
    const interpolated = interpolateEnvVars(parsed);

    // Validate against schema
    return ConfigSchema.safeParse(interpolated);
  } catch (error) {
    // Return Zod error for JSON parsing errors
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: `Failed to parse JSONC: ${error instanceof Error ? error.message : String(error)}`,
          path: [],
        },
      ]),
    } as any;
  }
}

/**
 * Load config from file path
 * @param filePath - Path to config file
 * @returns Zod validation result
 */
export async function loadConfig(filePath: string): Promise<ReturnType<typeof ConfigSchema.safeParse>> {
  try {
    const file = Bun.file(filePath);
    const content = await file.text();
    return parseConfig(content);
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: `Failed to read config file: ${error instanceof Error ? error.message : String(error)}`,
          path: [],
        },
      ]),
    } as any;
  }
}
