import chalk from 'chalk';
import { Blackboard } from '../core/blackboard.js';

function formatSectionName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Display the full blackboard summary
 */
export function displayBlackboardSummary(blackboard: Blackboard): void {
  console.log(chalk.cyan.bold('\n═'.repeat(60)));
  console.log(chalk.cyan.bold('           BLACKBOARD SUMMARY'));
  console.log(chalk.cyan.bold('═'.repeat(60)) + '\n');

  const sections = blackboard.getSections();

  if (sections.length === 0) {
    console.log(chalk.yellow('No content on blackboard yet.'));
    return;
  }

  for (const section of sections) {
    console.log(chalk.yellow.bold(`## ${formatSectionName(section.name)}`));
    console.log(
      chalk.gray(
        `(${section.tokens} tokens, updated ${section.updatedAt.toLocaleString()})\n`
      )
    );
    console.log(chalk.white(section.content));
    console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  }

  const totalTokens = blackboard.getTotalTokens();
  const maxTokens = blackboard.getMaxTokens();
  const percentage = Math.round((totalTokens / maxTokens) * 100);

  console.log(
    chalk.cyan.bold('Total Usage: ') +
      chalk.white(`${totalTokens} / ${maxTokens} tokens (${percentage}%)`)
  );
  console.log(chalk.cyan.bold('═'.repeat(60)) + '\n');
}

/**
 * Display initial status when showing existing blackboard
 */
export function displayBlackboardStatus(blackboard: Blackboard): void {
  console.log(chalk.cyan.bold('\n📋 Blackboard Status\n'));
  console.log(
    chalk.white(`Target: ${chalk.yellow(blackboard.getTargetPath())}`)
  );
  console.log(chalk.white(`Session: ${chalk.gray(blackboard.getId())}`));
  console.log(
    chalk.white(
      `Created: ${chalk.gray(blackboard.getCreatedAt().toLocaleString())}`
    )
  );
  console.log(
    chalk.white(
      `Updated: ${chalk.gray(blackboard.getUpdatedAt().toLocaleString())}`
    )
  );

  const totalTokens = blackboard.getTotalTokens();
  const maxTokens = blackboard.getMaxTokens();
  const percentage = Math.round((totalTokens / maxTokens) * 100);

  console.log(
    chalk.white(
      `Tokens: ${chalk.green(`${totalTokens} / ${maxTokens}`)} ${chalk.gray(`(${percentage}%)`)}`
    )
  );

  const sections = blackboard.getSections();
  console.log(
    chalk.white(`Sections: ${chalk.green(sections.length)} with content\n`)
  );
}

/**
 * Display API key error message
 */
export function displayApiKeyError(): void {
  console.log(chalk.red.bold('\n❌ Error: ANTHROPIC_API_KEY not found\n'));
  console.log(chalk.white('Please set your Anthropic API key:\n'));
  console.log(chalk.yellow('  export ANTHROPIC_API_KEY="your-key-here"\n'));
  console.log(
    chalk.gray('Get your API key at: https://console.anthropic.com/\n')
  );
}

/**
 * Display path validation error
 */
export function displayPathError(path: string, error: string): void {
  console.log(chalk.red.bold('\n❌ Error: Invalid path\n'));
  console.log(chalk.white(`Path: ${chalk.yellow(path)}`));
  console.log(chalk.white(`Error: ${error}\n`));
}
