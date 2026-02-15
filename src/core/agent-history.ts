import type { ToolCallRecord } from './output-manager.js';

function collectDirEntry(record: ToolCallRecord, dirs: Set<string>): void {
  const path = String(record.input.path || '');
  dirs.add(path.split('/').slice(-2).join('/') || '/');
}

function collectFileEntry(record: ToolCallRecord, files: Set<string>): void {
  const path = String(record.input.path || '');
  files.add(path.split('/').pop() || path);
}

function collectDirsAndFiles(toolCallHistory: ToolCallRecord[]): {
  dirs: Set<string>;
  files: Set<string>;
} {
  const dirs = new Set<string>();
  const files = new Set<string>();

  for (const record of toolCallHistory) {
    if (record.name === 'list_dir') collectDirEntry(record, dirs);
    if (record.name === 'file_read') collectFileEntry(record, files);
  }

  return { dirs, files };
}

function buildSummaryLines(
  dirs: Set<string>,
  files: Set<string>,
  totalCalls: number
): string[] {
  const lines = [`\n## YOUR PROGRESS SO FAR (${totalCalls} tool calls)`, ''];

  if (dirs.size > 0) {
    lines.push(`Directories explored: ${Array.from(dirs).join(', ')}`);
  }

  if (files.size > 0) {
    const fileList = Array.from(files);
    const shown = fileList.slice(0, 12);
    const moreCount = fileList.length - shown.length;
    lines.push(
      `Files read: ${shown.join(', ')}${moreCount > 0 ? `, +${moreCount} more` : ''}`
    );
  }

  return lines;
}

function buildRecentLines(recentHistory: string[], skipped: number): string[] {
  const lines = ['', 'Recent:'];

  if (skipped > 0) {
    lines.push(`  (${skipped} earlier calls omitted)`);
  }

  recentHistory.forEach((t, i) => {
    lines.push(`  ${skipped + i + 1}. ${t}`);
  });

  return lines;
}

export function buildToolHistory(
  toolCallHistory: ToolCallRecord[],
  compactToolHistory: string[]
): string {
  if (compactToolHistory.length === 0) return '';

  const { dirs, files } = collectDirsAndFiles(toolCallHistory);
  const recentHistory = compactToolHistory.slice(-15);
  const skipped = compactToolHistory.length - recentHistory.length;

  const lines = [
    ...buildSummaryLines(dirs, files, compactToolHistory.length),
    ...buildRecentLines(recentHistory, skipped),
    '',
    "DO NOT repeat tool calls you've already made. Use the blackboard to track what you've learned and move on to new areas.",
  ];

  return lines.join('\n');
}

type CompactFormatter = (
  input: Record<string, unknown>,
  result: Record<string, unknown>
) => string;

function formatListDir(
  input: Record<string, unknown>,
  result: Record<string, unknown>
): string {
  const path = String(input.path || '')
    .split('/')
    .slice(-2)
    .join('/');
  const count = result.success
    ? `${(result.output as string).split('\n').length} items`
    : 'failed';
  return `list_dir(${path}) → ${count}`;
}

function formatFileRead(input: Record<string, unknown>): string {
  const path = String(input.path || '')
    .split('/')
    .pop();
  const lines =
    typeof input.end_line === 'number'
      ? `lines ${String(input.start_line || 1)}-${String(input.end_line)}`
      : 'full file';
  return `file_read(${path}, ${lines})`;
}

function formatGrepSearch(
  input: Record<string, unknown>,
  result: Record<string, unknown>
): string {
  const pattern = String(input.pattern || '');
  const count = result.success
    ? `${(result.output as string).split('\n').length} matches`
    : 'failed';
  return `grep("${pattern}") → ${count}`;
}

function formatBlackboardUpdate(input: Record<string, unknown>): string {
  return `update_blackboard(${String(input.section || '')})`;
}

const COMPACT_FORMATTERS: Record<string, CompactFormatter> = {
  list_dir: formatListDir,
  file_read: (input) => formatFileRead(input),
  grep_search: formatGrepSearch,
  update_blackboard: (input) => formatBlackboardUpdate(input),
};

export function formatCompactToolCall(
  name: string,
  input: Record<string, unknown>,
  result: Record<string, unknown>
): string {
  const success = result.success ? '✓' : '✗';
  const formatter = COMPACT_FORMATTERS[name];
  const description = formatter ? formatter(input, result) : `${name}(...)`;
  return `${success} ${description}`;
}
