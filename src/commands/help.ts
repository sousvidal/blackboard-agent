import chalk from 'chalk';
import { logger } from '../utils/logger.js';

export function helpCommand() {
  console.log(chalk.cyan.bold('\nBlackboard Agent CLI\n'));
  console.log(
    chalk.white('An AI-powered codebase analysis tool using Claude\n')
  );

  console.log(chalk.yellow.bold('Usage:'));
  console.log(chalk.white('  agent [command] [options]\n'));

  console.log(chalk.yellow.bold('Available Commands:'));
  console.log(
    chalk.green('  analyze') +
      chalk.gray('  ') +
      chalk.white('Analyze a codebase using AI agent')
  );
  console.log(
    chalk.green('  help') +
      chalk.gray('     ') +
      chalk.white('Display this help message')
  );
  console.log(
    chalk.green('  version') +
      chalk.gray('  ') +
      chalk.white('Display version information')
  );

  console.log(chalk.yellow.bold('\nAnalyze Options:'));
  console.log(
    chalk.green('  -p, --path <path>') +
      chalk.gray('  ') +
      chalk.white('Target directory to analyze (default: current)')
  );
  console.log(
    chalk.green('  --show') +
      chalk.gray('            ') +
      chalk.white('Show most recent analysis from .output folder')
  );

  console.log(chalk.yellow.bold('\nGlobal Options:'));
  console.log(
    chalk.green('  -h, --help') +
      chalk.gray('        ') +
      chalk.white('Display help for a command')
  );
  console.log(
    chalk.green('  -V, --version') +
      chalk.gray('     ') +
      chalk.white('Display version information')
  );

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
