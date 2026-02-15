import { resolve } from 'path';
import { BlackboardAgent } from '../core/agent.js';
import { Blackboard, type BlackboardData } from '../core/blackboard.js';
import { getProfile, getAvailableProfiles } from '../core/analysis-profile.js';
import { validatePath } from '../utils/fs-utils.js';
import { logger } from '../utils/logger.js';
import {
  displayAgentEvent,
  displayBlackboardSummary,
  displayBlackboardStatus,
  displayApiKeyError,
  displayPathError,
} from '../utils/ui.js';

export interface AnalyzeOptions {
  path?: string;
  show?: boolean;
  profile?: string;
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  try {
    const targetPath = resolve(options.path || process.cwd());

    const pathValidation = validatePath(targetPath);
    if (!pathValidation.valid) {
      displayPathError(targetPath, pathValidation.error || 'Unknown error');
      process.exit(1);
    }

    if (options.show) {
      await showMostRecentAnalysis();
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      displayApiKeyError();
      process.exit(1);
    }

    // Resolve profile
    const profileName = options.profile || 'codebase-analysis';
    const profile = getProfile(profileName);
    if (!profile) {
      const available = getAvailableProfiles();
      console.error(
        `\nError: Unknown profile "${profileName}". Available profiles: ${available.join(', ')}\n`
      );
      process.exit(1);
    }

    const agent = new BlackboardAgent(
      {
        apiKey,
        targetPath,
        workspaceRoot: process.cwd(),
        profile,
      },
      displayAgentEvent
    );

    logger.info(
      { targetPath, workspaceRoot: process.cwd(), profile: profileName },
      'Starting analysis'
    );

    const blackboard = await agent.analyze();

    displayBlackboardSummary(blackboard);

    logger.info('Analysis completed successfully');
  } catch (error) {
    logger.error({ error }, 'Analysis command failed');

    if (error instanceof Error) {
      console.error(`\nError: ${error.message}`);
    }

    process.exit(1);
  }
}

/**
 * Show most recent analysis from .output folder
 */
async function showMostRecentAnalysis(): Promise<void> {
  const fsPromises = await import('fs/promises');
  const path = await import('path');
  const fs = await import('fs');

  const outputDir = path.join(process.cwd(), '.output');

  if (!fs.existsSync(outputDir)) {
    console.log(`\nNo analysis history found in: ${outputDir}\n`);
    console.log('Run without --show to create a new analysis.\n');
    return;
  }

  try {
    const entries = await fsPromises.readdir(outputDir);
    const analysisDirs = entries.filter((e) => e.startsWith('analysis-'));

    if (analysisDirs.length === 0) {
      console.log(`\nNo analysis history found in: ${outputDir}\n`);
      console.log('Run without --show to create a new analysis.\n');
      return;
    }

    analysisDirs.sort().reverse();
    const mostRecent = analysisDirs[0];
    const blackboardPath = path.join(outputDir, mostRecent, 'blackboard.json');

    if (!fs.existsSync(blackboardPath)) {
      console.log(
        `\nMost recent analysis (${mostRecent}) has no blackboard data.\n`
      );
      return;
    }

    const content = await fsPromises.readFile(blackboardPath, 'utf-8');
    const data = JSON.parse(content) as BlackboardData;
    const blackboard = Blackboard.fromJSON(data);

    console.log(`\nShowing most recent analysis: ${mostRecent}\n`);
    displayBlackboardStatus(blackboard);
    displayBlackboardSummary(blackboard);
  } catch (error) {
    logger.error({ error }, 'Failed to load recent analysis');
    console.error(
      `\nError loading analysis: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}
