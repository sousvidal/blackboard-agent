#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { versionCommand } from './commands/version.js';
import { helpCommand } from './commands/help.js';
import { analyzeCommand, type AnalyzeOptions } from './commands/analyze.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for metadata
const packageJsonPath = join(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  name: string;
  version: string;
  description: string;
};

const program = new Command();

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version);

// Help command
program
  .command('help')
  .description('Display help information')
  .action(() => {
    helpCommand();
  });

// Version command
program
  .command('version')
  .description('Display version information')
  .action(() => {
    versionCommand(packageJson.name, packageJson.version);
  });

// Analyze command
program
  .command('analyze')
  .description('Analyze a codebase using AI agent with blackboard')
  .option('-p, --path <path>', 'Target directory to analyze', process.cwd())
  .option('--show', 'Show most recent analysis from .output folder')
  .option(
    '--profile <name>',
    'Analysis profile to use (default: codebase-analysis)',
    'codebase-analysis'
  )
  .action(async (options: AnalyzeOptions) => {
    await analyzeCommand(options);
  });

// Error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error) {
    // Handle commander errors gracefully
    if ('code' in error && error.code === 'commander.help') {
      // Help was displayed, exit normally
      process.exit(0);
    } else if ('code' in error && error.code === 'commander.version') {
      // Version was displayed, exit normally
      process.exit(0);
    } else {
      console.error(chalk.red('Error:'), error.message);
      logger.error({ error }, 'CLI error occurred');
      process.exit(1);
    }
  }
}
