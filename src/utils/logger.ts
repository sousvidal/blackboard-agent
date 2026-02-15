import pino from 'pino';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

// Create a logger that writes to a file for persistent logging
// Note: Use chalk for user-facing output in the CLI
const logDir = join(homedir(), '.blackboard-agent');
const logFile = join(logDir, 'agent.log');

// Ensure log directory exists
try {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  // Silently fail if we can't create the directory
  // Logger will be disabled but CLI will still work
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: {
          destination: logFile,
        },
      },
    ],
  },
});

logger.info({ logFile }, 'Logger initialized');
