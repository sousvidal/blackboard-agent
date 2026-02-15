import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { BlackboardAgent } from '../agent/agent.js';
import { Blackboard, type BlackboardData } from '../blackboard/blackboard.js';
import { getProfile, getAvailableProfiles } from '../config/profiles.js';
import { validatePath } from '../utils/fs.js';
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

  const profileName = options.profile || 'codebase-analysis';
  const profile = getProfile(profileName);
  if (!profile) {
    const available = getAvailableProfiles();
    console.error(
      `\nError: Unknown profile "${profileName}". Available profiles: ${available.join(', ')}\n`
    );
    process.exit(1);
  }

  await runAnalysis(apiKey, targetPath, profileName, profile);
}

async function runAnalysis(
  apiKey: string,
  targetPath: string,
  profileName: string,
  profile: NonNullable<ReturnType<typeof getProfile>>
): Promise<void> {
  const agent = new BlackboardAgent(
    { apiKey, targetPath, workspaceRoot: process.cwd(), profile },
    displayAgentEvent
  );

  logger.info(
    { targetPath, workspaceRoot: process.cwd(), profile: profileName },
    'Starting analysis'
  );

  const blackboard = await agent.analyze().catch((error: unknown) => {
    logger.error({ error }, 'Analysis command failed');
    if (error instanceof Error) console.error(`\nError: ${error.message}`);
    process.exit(1);
  });

  displayBlackboardSummary(blackboard);
  logger.info('Analysis completed successfully');
}

async function findMostRecentDir(outputDir: string): Promise<string | null> {
  if (!existsSync(outputDir)) return null;

  const entries = await readdir(outputDir);
  const analysisDirs = entries.filter((e) => e.startsWith('analysis-'));
  if (analysisDirs.length === 0) return null;

  analysisDirs.sort().reverse();
  return analysisDirs[0];
}

async function loadBlackboardFromDir(
  outputDir: string,
  dirName: string
): Promise<Blackboard | null> {
  const blackboardPath = join(outputDir, dirName, 'blackboard.json');
  if (!existsSync(blackboardPath)) return null;

  const content = await readFile(blackboardPath, 'utf-8');
  const data = JSON.parse(content) as BlackboardData;
  return Blackboard.fromJSON(data);
}

async function showMostRecentAnalysis(): Promise<void> {
  const outputDir = join(process.cwd(), '.output');
  const mostRecent = await findMostRecentDir(outputDir);

  if (!mostRecent) {
    console.log(`\nNo analysis history found in: ${outputDir}\n`);
    console.log('Run without --show to create a new analysis.\n');
    return;
  }

  const blackboard = await loadBlackboardFromDir(outputDir, mostRecent).catch(
    (error: unknown) => {
      logger.error({ error }, 'Failed to load recent analysis');
      console.error(
        `\nError loading analysis: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return null;
    }
  );

  if (!blackboard) {
    console.log(
      `\nMost recent analysis (${mostRecent}) has no blackboard data.\n`
    );
    return;
  }

  console.log(`\nShowing most recent analysis: ${mostRecent}\n`);
  displayBlackboardStatus(blackboard);
  displayBlackboardSummary(blackboard);
}
