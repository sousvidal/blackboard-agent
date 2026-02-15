import type { Tool } from '@anthropic-ai/sdk/resources/messages.mjs';
import {
  listDirectory,
  readFileContent,
  grepSearch,
  type FileInfo,
  type GrepResult,
} from '../utils/fs-utils.js';
import { Blackboard } from './blackboard.js';
import { logger } from '../utils/logger.js';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/**
 * Tool definitions for Claude
 */
export const TOOLS: Tool[] = [
  {
    name: 'list_dir',
    description:
      'List files and directories at a given path. Useful for exploring the codebase structure. Automatically filters out common build artifacts and hidden files.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to list (relative to target directory or absolute)',
        },
        max_depth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 3, max: 5)',
          default: 3,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_read',
    description:
      'Read the contents of a file with line numbers. For large files, you can specify a line range.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-indexed, optional)',
        },
        end_line: {
          type: 'number',
          description: 'Ending line number (inclusive, optional)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_search',
    description:
      'Search for a pattern (regex) across files in the codebase. Returns file paths, line numbers, and matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Path to search in (file or directory)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
          default: 50,
        },
      },
      required: ['pattern', 'path'],
    },
  },
  {
    name: 'update_blackboard',
    description:
      'Update a section of the blackboard with important findings. Use this to save key insights, patterns, or information you want to remember. Be concise and strategic with the available token budget.',
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            'Section name for organizing your findings (e.g., overview, architecture, patterns). You can use any name that makes sense for your analysis.',
        },
        content: {
          type: 'string',
          description: 'Content to add to the section',
        },
        replace: {
          type: 'boolean',
          description:
            'If true, replace the section content. If false, append to existing content. Default: false',
          default: false,
        },
      },
      required: ['section', 'content'],
    },
  },
];

/**
 * Execute a tool and return the result
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  blackboard: Blackboard,
  basePath: string
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    logger.info({ toolName, toolInput }, 'Executing tool');

    let result: Omit<ToolResult, 'durationMs'>;

    switch (toolName) {
      case 'list_dir':
        result = await executeListDir(toolInput, basePath);
        break;

      case 'file_read':
        result = await executeFileRead(toolInput, basePath);
        break;

      case 'grep_search':
        result = await executeGrepSearch(toolInput, basePath);
        break;

      case 'update_blackboard':
        result = executeUpdateBlackboard(toolInput, blackboard);
        break;

      default:
        result = {
          success: false,
          output: '',
          error: `Unknown tool: ${toolName}`,
        };
    }

    const durationMs = Date.now() - startTime;
    return { ...result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({ error, toolName }, 'Tool execution failed');
    return {
      success: false,
      output: '',
      error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      durationMs,
    };
  }
}

/**
 * Execute list_dir tool
 */
async function executeListDir(
  input: Record<string, unknown>,
  basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const path = String(input.path || basePath);
  const maxDepth = Math.min(Number(input.max_depth || 3), 5);

  const files = await listDirectory(path, maxDepth);

  // Format output
  const output = formatFileList(files, path);

  return {
    success: true,
    output,
  };
}

/**
 * Format file list for display
 */
function formatFileList(files: FileInfo[], basePath: string): string {
  const lines: string[] = [];
  lines.push(`Found ${files.length} items:\n`);

  // Group by directory
  const byDirectory = new Map<string, FileInfo[]>();

  for (const file of files) {
    const dir =
      file.path.substring(0, file.path.lastIndexOf('/') || 0) || basePath;
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, []);
    }
    byDirectory.get(dir)!.push(file);
  }

  // Sort directories
  const sortedDirs = Array.from(byDirectory.keys()).sort();

  for (const dir of sortedDirs) {
    lines.push(`\n${dir}/`);
    const dirFiles = byDirectory.get(dir)!;

    for (const file of dirFiles) {
      const icon = file.type === 'directory' ? '📁' : '📄';
      const size = file.size ? ` (${formatSize(file.size)})` : '';
      lines.push(`  ${icon} ${file.name}${size}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Execute file_read tool
 */
async function executeFileRead(
  input: Record<string, unknown>,
  _basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const path = String(input.path);
  const startLine = input.start_line ? Number(input.start_line) : undefined;
  const endLine = input.end_line ? Number(input.end_line) : undefined;

  const content = await readFileContent(path, startLine, endLine);

  const lines = content.split('\n').length;
  const summary = startLine
    ? `Lines ${startLine}-${endLine || 'end'} of ${path}`
    : `${path} (${lines} lines)`;

  return {
    success: true,
    output: `${summary}\n\n${content}`,
  };
}

/**
 * Execute grep_search tool
 */
async function executeGrepSearch(
  input: Record<string, unknown>,
  _basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const pattern = String(input.pattern);
  const path = String(input.path);
  const maxResults = Number(input.max_results || 50);

  const results = await grepSearch(pattern, path, maxResults);

  if (results.length === 0) {
    return {
      success: true,
      output: `No matches found for pattern: ${pattern}`,
    };
  }

  const output = formatGrepResults(results, pattern);

  return {
    success: true,
    output,
  };
}

/**
 * Format grep results
 */
function formatGrepResults(results: GrepResult[], pattern: string): string {
  const lines: string[] = [];
  lines.push(`Found ${results.length} matches for pattern: ${pattern}\n`);

  // Group by file
  const byFile = new Map<string, GrepResult[]>();

  for (const result of results) {
    if (!byFile.has(result.file)) {
      byFile.set(result.file, []);
    }
    byFile.get(result.file)!.push(result);
  }

  for (const [file, fileResults] of byFile.entries()) {
    lines.push(`\n${file} (${fileResults.length} matches):`);

    for (const result of fileResults) {
      lines.push(`  Line ${result.line}: ${result.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Execute update_blackboard tool
 */
function executeUpdateBlackboard(
  input: Record<string, unknown>,
  blackboard: Blackboard
): Omit<ToolResult, 'durationMs'> {
  const section = String(input.section);
  const content = String(input.content);
  const replace = Boolean(input.replace);

  const result = blackboard.updateSection(section, content, replace);

  if (result.success) {
    const tokens = blackboard.getTotalTokens();
    const max = blackboard.getMaxTokens();
    const remaining = blackboard.getRemainingTokens();

    return {
      success: true,
      output: `${result.message}\nTotal: ${tokens}/${max} tokens (${remaining} remaining)`,
    };
  }

  return {
    success: false,
    output: '',
    error: result.message,
  };
}
