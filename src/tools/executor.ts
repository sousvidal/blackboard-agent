import {
  listDirectory,
  readFileContent,
  grepSearch,
  type FileInfo,
  type GrepResult,
} from '../utils/fs.js';
import { Blackboard } from '../blackboard/blackboard.js';
import { logger } from '../utils/logger.js';
import { resolve, isAbsolute } from 'path';

export { TOOLS } from './definitions.js';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

type ToolHandler = (
  input: Record<string, unknown>,
  basePath: string,
  blackboard: Blackboard
) => Promise<Omit<ToolResult, 'durationMs'>> | Omit<ToolResult, 'durationMs'>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_dir: (input, basePath) => executeListDir(input, basePath),
  file_read: (input, basePath) => executeFileRead(input, basePath),
  grep_search: (input, basePath) => executeGrepSearch(input, basePath),
  update_blackboard: (input, _basePath, blackboard) =>
    executeUpdateBlackboard(input, blackboard),
};

/**
 * Resolve a path relative to basePath if it's not absolute
 */
function resolvePath(path: string, basePath: string): string {
  return isAbsolute(path) ? path : resolve(basePath, path);
}

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
  logger.info({ toolName, toolInput }, 'Executing tool');

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      success: false,
      output: '',
      error: `Unknown tool: ${toolName}`,
      durationMs: Date.now() - startTime,
    };
  }

  const result = await Promise.resolve(
    handler(toolInput, basePath, blackboard)
  ).catch((error: unknown) => ({
    success: false as const,
    output: '',
    error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
  }));

  return { ...result, durationMs: Date.now() - startTime };
}

async function executeListDir(
  input: Record<string, unknown>,
  basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const path = input.path
    ? resolvePath(String(input.path), basePath)
    : basePath;
  const maxDepth = Math.min(Number(input.max_depth || 3), 5);
  const files = await listDirectory(path, maxDepth);
  return { success: true, output: formatFileList(files, path) };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  return items.reduce((map, item) => {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
    return map;
  }, new Map<string, T[]>());
}

function formatFileEntry(file: FileInfo): string {
  const icon = file.type === 'directory' ? '📁' : '📄';
  const size = file.size ? ` (${formatSize(file.size)})` : '';
  return `  ${icon} ${file.name}${size}`;
}

function formatFileList(files: FileInfo[], basePath: string): string {
  const byDirectory = groupBy(
    files,
    (file) =>
      file.path.substring(0, file.path.lastIndexOf('/') || 0) || basePath
  );

  const dirEntries = Array.from(byDirectory.keys())
    .sort()
    .flatMap((dir) => [
      `\n${dir}/`,
      ...byDirectory.get(dir)!.map(formatFileEntry),
    ]);

  return [`Found ${files.length} items:\n`, ...dirEntries].join('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function executeFileRead(
  input: Record<string, unknown>,
  basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const path = resolvePath(String(input.path), basePath);
  const startLine = input.start_line ? Number(input.start_line) : undefined;
  const endLine = input.end_line ? Number(input.end_line) : undefined;

  const content = await readFileContent(path, startLine, endLine);
  const lines = content.split('\n').length;
  const summary = startLine
    ? `Lines ${startLine}-${endLine || 'end'} of ${path}`
    : `${path} (${lines} lines)`;

  return { success: true, output: `${summary}\n\n${content}` };
}

async function executeGrepSearch(
  input: Record<string, unknown>,
  basePath: string
): Promise<Omit<ToolResult, 'durationMs'>> {
  const pattern = String(input.pattern);
  const path = resolvePath(String(input.path), basePath);
  const maxResults = Number(input.max_results || 50);

  const results = await grepSearch(pattern, path, maxResults);
  if (results.length === 0) {
    return {
      success: true,
      output: `No matches found for pattern: ${pattern}`,
    };
  }

  return { success: true, output: formatGrepResults(results, pattern) };
}

function formatGrepResults(results: GrepResult[], pattern: string): string {
  const byFile = groupBy(results, (r) => r.file);

  const fileEntries = Array.from(byFile.entries()).flatMap(
    ([file, fileResults]) => [
      `\n${file} (${fileResults.length} matches):`,
      ...fileResults.map((r) => `  Line ${r.line}: ${r.content}`),
    ]
  );

  return [
    `Found ${results.length} matches for pattern: ${pattern}\n`,
    ...fileEntries,
  ].join('\n');
}

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

  return { success: false, output: '', error: result.message };
}
