import chalk from 'chalk';
import { logger } from '../utils/logger.js';

export function versionCommand(name: string, version: string) {
  // Display version with chalk
  console.log(chalk.cyan.bold(`${name}`), chalk.green(`v${version}`));

  logger.info({ version, name }, 'Version command executed');
}
