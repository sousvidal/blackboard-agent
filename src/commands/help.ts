import chalk from 'chalk';
import { logger } from '../utils/logger.js';

interface HelpEntry {
  left: string;
  right: string;
}

function renderEntries(entries: HelpEntry[]): void {
  const maxLeft = Math.max(...entries.map((e) => e.left.length));
  for (const entry of entries) {
    const padding = ' '.repeat(maxLeft - entry.left.length + 2);
    console.log(
      chalk.green(`  ${entry.left}`) + padding + chalk.white(entry.right)
    );
  }
}

export function helpCommand() {
  console.log(chalk.cyan.bold('\nBlackboard Agent CLI\n'));
  console.log(
    chalk.white('An AI-powered codebase analysis tool using Claude\n')
  );

  console.log(chalk.yellow.bold('Usage:'));
  console.log(chalk.white('  agent [command] [options]\n'));

  console.log(chalk.yellow.bold('Available Commands:'));
  renderEntries([
    { left: 'analyze', right: 'Analyze a codebase using AI agent' },
    { left: 'help', right: 'Display this help message' },
    { left: 'version', right: 'Display version information' },
  ]);

  console.log(chalk.yellow.bold('\nAnalyze Options:'));
  renderEntries([
    {
      left: '-p, --path <path>',
      right: 'Target directory to analyze (default: current)',
    },
    { left: '--show', right: 'Show most recent analysis from .output folder' },
  ]);

  console.log(chalk.yellow.bold('\nGlobal Options:'));
  renderEntries([
    { left: '-h, --help', right: 'Display help for a command' },
    { left: '-V, --version', right: 'Display version information' },
  ]);

  console.log(chalk.yellow.bold('\nExamples:'));
  console.log(
    chalk.gray('  $ ') +
      chalk.white('agent analyze') +
      chalk.gray('              # Analyze current directory')
  );
  console.log(
    chalk.gray('  $ ') +
      chalk.white('agent analyze --path ./src') +
      chalk.gray(' # Analyze specific path')
  );
  console.log(
    chalk.gray('  $ ') +
      chalk.white('agent analyze --show') +
      chalk.gray('        # Show most recent analysis')
  );
  console.log(chalk.gray('  $ ') + chalk.white('agent --help\n'));

  console.log(chalk.yellow.bold('Environment:'));
  console.log(
    chalk.white(
      '  Set ANTHROPIC_API_KEY environment variable with your API key\n'
    )
  );

  logger.info('Help command executed');
}
