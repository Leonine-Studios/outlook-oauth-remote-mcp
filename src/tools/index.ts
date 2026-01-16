/**
 * Tool registry - combines all tools for the MCP server
 */

import { mailToolDefinitions } from './mail.js';
import { calendarToolDefinitions } from './calendar.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

/**
 * All available tools
 */
export const allTools: ToolDefinition[] = [
  ...mailToolDefinitions as ToolDefinition[],
  ...calendarToolDefinitions as ToolDefinition[],
];

/**
 * Get tool by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return allTools.find(t => t.name === name);
}

/**
 * Get all tool names
 */
export function getToolNames(): string[] {
  return allTools.map(t => t.name);
}

/**
 * Export individual tool modules for direct access
 */
export * from './mail.js';
export * from './calendar.js';
