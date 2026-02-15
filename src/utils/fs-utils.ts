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

/**
 * List files and directories at a given path
 */
export async function listDirectory(
  targetPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<FileInfo[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  try {
    const entries = await readdir(targetPath);
    const results: FileInfo[] = [];

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === 'build' ||
        entry === 'coverage'
      ) {
        continue;
      }

      const fullPath = join(targetPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        results.push({
          name: entry,
          path: fullPath,
          type: 'directory',
        });

        // Recursively list subdirectories
        if (currentDepth + 1 < maxDepth) {
          const subResults = await listDirectory(
            fullPath,
            maxDepth,
            currentDepth + 1
          );
          results.push(...subResults);
        }
      } else if (stats.isFile()) {
        results.push({
          name: entry,
          path: fullPath,
          type: 'file',
          size: stats.size,
        });
      }
    }

    return results;
  } catch (error) {
    throw new Error(
      `Failed to list directory ${targetPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read a file with optional line range
 */
export async function readFileContent(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    if (startLine !== undefined || endLine !== undefined) {
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = endLine ? Math.min(lines.length, endLine) : lines.length;
      const selectedLines = lines.slice(start, end);

      return selectedLines
        .map((line, idx) => `${start + idx + 1}| ${line}`)
        .join('\n');
    }

    // Return with line numbers for all lines
    return lines.map((line, idx) => `${idx + 1}| ${line}`).join('\n');
  } catch (error) {
    throw new Error(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
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
  const results: GrepResult[] = [];
  const regex = new RegExp(pattern, 'gi');

  async function searchInFile(filePath: string): Promise<void> {
    if (results.length >= maxResults) {
      return;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) {
          break;
        }

        const line = lines[i];
        const matches = line.match(regex);

        if (matches) {
          results.push({
            file: filePath,
            line: i + 1,
            content: line.trim(),
            match: matches[0],
          });
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  async function walkDirectory(dirPath: string): Promise<void> {
    if (results.length >= maxResults) {
      return;
    }

    try {
      const entries = await readdir(dirPath);

      for (const entry of entries) {
        if (results.length >= maxResults) {
          break;
        }

        // Skip ignored patterns
        if (
          entry.startsWith('.') ||
          entry === 'node_modules' ||
          entry === 'dist' ||
          entry === 'build'
        ) {
          continue;
        }

        const fullPath = join(dirPath, entry);
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          await walkDirectory(fullPath);
        } else if (stats.isFile()) {
          // Only search text files
          if (
            fullPath.match(/\.(ts|js|json|md|txt|tsx|jsx|css|html|yml|yaml)$/)
          ) {
            await searchInFile(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't access
    }
  }

  const stats = await stat(targetPath);
  if (stats.isFile()) {
    await searchInFile(targetPath);
  } else {
    await walkDirectory(targetPath);
  }

  return results;
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

  try {
    const stats = statSync(targetPath);
    if (!stats.isDirectory() && !stats.isFile()) {
      return { valid: false, error: 'Path is not a file or directory' };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Cannot access path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
