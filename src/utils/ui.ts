import chalk from 'chalk';
import { Blackboard } from '../blackboard/blackboard.js';
import type { AgentEvent } from '../agent/types.js';

export {
  displayBlackboardSummary,
  displayBlackboardStatus,
  displayApiKeyError,
  displayPathError,
} from './ui-display.js';

/**
 * Display agent events in a user-friendly way
 */
export function displayAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'start':
      displayStart(
        event.data as {
          targetPath: string;
          tokens: number;
          maxTokens: number;
          analysisId: string;
        }
      );
      break;

    case 'iteration':
      displayIteration(
        event.data as {
          iteration: number;
          maxIterations: number;
          tokens: { input: number; output: number; total: number };
        }
      );
      break;

    case 'thinking':
      displayThinking(event.data as { thinking: string });
      break;

    case 'tool_call':
      displayToolCall(event.data as { name: string; input: unknown });
      break;

    case 'tool_result':
      displayToolResult(
        event.data as {
          name: string;
          success: boolean;
          output: string;
          error?: string;
          durationMs: number;
        }
      );
      break;

    case 'blackboard_update':
      displayBlackboardUpdate(
        event.data as { section: string; tokens: number; maxTokens: number }
      );
      break;

    case 'complete':
      displayComplete(
        event.data as {
          blackboard: Blackboard;
          tokens: number;
          stats: {
            iterations: number;
            toolCalls: number;
            totalTokens: { input: number; output: number; total: number };
            durationMs: number;
          };
          outputPath: string;
        }
      );
      break;

    case 'error':
      displayError(event.data as { error: string });
      break;
  }
}

function displayStart(data: {
  targetPath: string;
  tokens: number;
  maxTokens: number;
  analysisId: string;
}): void {
  console.log(chalk.cyan.bold('\n🔍 Starting Codebase Analysis\n'));
  console.log(chalk.white(`Target: ${chalk.yellow(data.targetPath)}`));
  console.log(
    chalk.white(
      `Blackboard: ${chalk.green(`${data.tokens} / ${data.maxTokens} tokens`)}`
    )
  );
  console.log(chalk.white(`Analysis ID: ${chalk.gray(data.analysisId)}`));
  console.log(chalk.gray('─'.repeat(60)));
}

function displayIteration(data: {
  iteration: number;
  maxIterations: number;
  tokens: { input: number; output: number; total: number };
}): void {
  const progressBar = createProgressBar(
    (data.iteration / data.maxIterations) * 100,
    30
  );
  console.log(
    chalk.cyan(`\nIteration ${data.iteration}/${data.maxIterations}`) +
      chalk.gray(
        ` | Tokens: ${data.tokens.input.toLocaleString()} in / ${data.tokens.output.toLocaleString()} out / ${data.tokens.total.toLocaleString()} total`
      )
  );
  console.log(chalk.gray(`${progressBar}`));
}

function displayThinking(data: { thinking: string }): void {
  const thinking =
    data.thinking.length > 500
      ? data.thinking.substring(0, 500) + '...'
      : data.thinking;
  console.log(chalk.blue('\n💭 Agent: ') + chalk.white(thinking));
}

function displayToolCall(data: { name: string; input: unknown }): void {
  const inputStr = formatToolInput(data.input);
  console.log(chalk.yellow(`  → ${data.name}`) + chalk.gray(`(${inputStr})`));
}

function displayToolResult(data: {
  name: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}): void {
  if (data.success) {
    const lines = data.output.split('\n');
    const summary =
      lines.length > 3 ? `${lines.slice(0, 2).join(' ')}...` : data.output;

    console.log(
      chalk.green('    ✓ ') +
        chalk.gray(summary.substring(0, 100)) +
        chalk.gray(` (${data.durationMs}ms)`)
    );
  } else {
    console.log(
      chalk.red('    ✗ Error: ') +
        chalk.gray(data.error) +
        chalk.gray(` (${data.durationMs}ms)`)
    );
  }
}

function displayBlackboardUpdate(data: {
  section: string;
  tokens: number;
  maxTokens: number;
}): void {
  const percentage = Math.round((data.tokens / data.maxTokens) * 100);
  const bar = createProgressBar(percentage);

  console.log(
    chalk.cyan(`\n📝 Blackboard updated: `) +
      chalk.white(data.section) +
      chalk.gray(` (${data.tokens}/${data.maxTokens} tokens)`)
  );
  console.log(chalk.gray(`   ${bar} ${percentage}%`));
}

function displayComplete(data: {
  blackboard: Blackboard;
  tokens: number;
  stats: {
    iterations: number;
    toolCalls: number;
    totalTokens: { input: number; output: number; total: number };
    durationMs: number;
  };
  outputPath: string;
}): void {
  console.log(chalk.gray('\n' + '═'.repeat(60)));
  console.log(chalk.green.bold('✨ Analysis Complete!'));
  console.log(chalk.gray('═'.repeat(60)));

  console.log(
    chalk.white('Iterations:    ') +
      chalk.cyan(data.stats.iterations.toString())
  );
  console.log(
    chalk.white('Tool Calls:    ') + chalk.cyan(data.stats.toolCalls.toString())
  );
  console.log(
    chalk.white('Tokens Used:   ') +
      chalk.cyan(
        `${data.stats.totalTokens.input.toLocaleString()} in / ${data.stats.totalTokens.output.toLocaleString()} out / ${data.stats.totalTokens.total.toLocaleString()} total`
      )
  );
  console.log(
    chalk.white('Duration:      ') +
      chalk.cyan(`${(data.stats.durationMs / 1000).toFixed(1)}s`)
  );
  console.log(
    chalk.white('Blackboard:    ') +
      chalk.cyan(`${data.tokens} / ${data.blackboard.getMaxTokens()} tokens`)
  );
  console.log(chalk.white('Output Saved:  ') + chalk.green(data.outputPath));
  console.log(chalk.gray('═'.repeat(60)));
}

function displayError(data: { error: string }): void {
  console.log(chalk.red.bold('\n❌ Error: ') + chalk.white(data.error));
}

function formatEntryValue(key: string, value: unknown): string {
  if (typeof value === 'string' && value.length > 50) {
    return `${key}="${value.substring(0, 47)}..."`;
  }
  return `${key}=${JSON.stringify(value)}`;
}

function formatToolInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return String(input);

  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => formatEntryValue(key, value))
    .join(', ');
}

function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}
