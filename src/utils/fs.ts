import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, statSync } from 'fs';

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface GrepResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

interface ListContext {
  targetPath: string;
  maxDepth: number;
  currentDepth: number;
}

interface GrepContext {
  regex: RegExp;
  results: GrepResult[];
  maxResults: number;
}

const IGNORED_ENTRIES = new Set(['node_modules', 'dist', 'build', 'coverage']);

function shouldIgnoreEntry(entry: string): boolean {
  return entry.startsWith('.') || IGNORED_ENTRIES.has(entry);
}

async function processDirectoryEntry(
  entry: string,
  ctx: ListContext,
  results: FileInfo[]
): Promise<void> {
  if (shouldIgnoreEntry(entry)) return;

  const fullPath = join(ctx.targetPath, entry);
  const stats = await stat(fullPath);
  const isDir = stats.isDirectory();

  if (isDir) {
    results.push({ name: entry, path: fullPath, type: 'directory' });
  }

  if (isDir && ctx.currentDepth + 1 < ctx.maxDepth) {
    const subResults = await listDirectory(
      fullPath,
      ctx.maxDepth,
      ctx.currentDepth + 1
    );
    results.push(...subResults);
  }

  if (stats.isFile()) {
    results.push({
      name: entry,
      path: fullPath,
      type: 'file',
      size: stats.size,
    });
  }
}

/**
 * List files and directories at a given path
 */
export async function listDirectory(
  targetPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<FileInfo[]> {
  if (currentDepth >= maxDepth) return [];

  const entries = await readdir(targetPath).catch((error: unknown) => {
    throw new Error(
      `Failed to list directory ${targetPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  const results: FileInfo[] = [];

  const ctx: ListContext = { targetPath, maxDepth, currentDepth };
  for (const entry of entries) {
    await processDirectoryEntry(entry, ctx, results);
  }

  return results;
}

function formatLinesWithNumbers(lines: string[], startIndex: number): string {
  return lines
    .map((line, idx) => `${startIndex + idx + 1}| ${line}`)
    .join('\n');
}

/**
 * Read a file with optional line range
 */
export async function readFileContent(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  const content = await readFile(filePath, 'utf-8').catch((error: unknown) => {
    throw new Error(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  const lines = content.split('\n');

  if (startLine === undefined && endLine === undefined) {
    return formatLinesWithNumbers(lines, 0);
  }

  const start = Math.max(0, (startLine ?? 1) - 1);
  const end = endLine ? Math.min(lines.length, endLine) : lines.length;
  return formatLinesWithNumbers(lines.slice(start, end), start);
}

function isTextFile(filePath: string): boolean {
  return /\.(ts|js|json|md|txt|tsx|jsx|css|html|yml|yaml)$/.test(filePath);
}

function collectLineMatch(
  line: string,
  lineNum: number,
  filePath: string,
  ctx: GrepContext
): void {
  if (ctx.results.length >= ctx.maxResults) return;
  const m = line.match(ctx.regex);
  if (m) {
    ctx.results.push({
      file: filePath,
      line: lineNum,
      content: line.trim(),
      match: m[0],
    });
  }
}

async function searchFileForPattern(
  filePath: string,
  ctx: GrepContext
): Promise<void> {
  if (ctx.results.length >= ctx.maxResults) return;

  const content = await readFile(filePath, 'utf-8').catch(() => null);
  if (content === null) return;

  content.split('\n').forEach((line, i) => {
    collectLineMatch(line, i + 1, filePath, ctx);
  });
}

async function processGrepEntry(
  entry: string,
  dirPath: string,
  ctx: GrepContext
): Promise<void> {
  if (shouldIgnoreEntry(entry)) return;

  const fullPath = join(dirPath, entry);
  const stats = await stat(fullPath);

  if (stats.isDirectory()) {
    await walkDirectoryForGrep(fullPath, ctx);
    return;
  }

  if (stats.isFile() && isTextFile(fullPath)) {
    await searchFileForPattern(fullPath, ctx);
  }
}

async function walkDirectoryForGrep(
  dirPath: string,
  ctx: GrepContext
): Promise<void> {
  if (ctx.results.length >= ctx.maxResults) return;

  const entries = await readdir(dirPath).catch(() => [] as string[]);

  for (const entry of entries) {
    await processGrepEntry(entry, dirPath, ctx);
  }
}

/**
 * Search for a pattern in files (simple grep implementation)
 */
export async function grepSearch(
  pattern: string,
  targetPath: string,
  maxResults: number = 50
): Promise<GrepResult[]> {
  const ctx: GrepContext = {
    results: [],
    regex: new RegExp(pattern, 'gi'),
    maxResults,
  };

  const stats = await stat(targetPath);

  if (stats.isFile()) {
    await searchFileForPattern(targetPath, ctx);
    return ctx.results;
  }

  await walkDirectoryForGrep(targetPath, ctx);
  return ctx.results;
}

/**
 * Validate that a path exists and is accessible
 */
export function validatePath(targetPath: string): {
  valid: boolean;
  error?: string;
} {
  if (!existsSync(targetPath)) {
    return { valid: false, error: 'Path does not exist' };
  }

  const stats = existsSync(targetPath) ? statSync(targetPath) : null;
  if (!stats) {
    return { valid: false, error: 'Cannot access path' };
  }

  if (!stats.isDirectory() && !stats.isFile()) {
    return { valid: false, error: 'Path is not a file or directory' };
  }

  return { valid: true };
}
