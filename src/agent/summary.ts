import Anthropic from '@anthropic-ai/sdk';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { Blackboard } from '../blackboard/blackboard.js';
import type { AnalysisProfile } from '../config/profiles.js';
import { logger } from '../utils/logger.js';

export async function generateSummary(
  anthropic: Anthropic,
  model: string,
  profile: AnalysisProfile,
  blackboard: Blackboard
): Promise<string> {
  const summaryPrompt = `Based on the analysis findings below, provide a comprehensive summary in markdown format.

${profile.summaryInstructions}

Here are the findings (from the blackboard):

${blackboard.getAllSectionsForContext()}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: summaryPrompt }],
  });

  const textBlocks = response.content.filter(
    (block): block is TextBlock => block.type === 'text'
  );

  return textBlocks.map((block) => block.text).join('\n');
}

export async function generateSummarySafe(
  anthropic: Anthropic,
  model: string,
  profile: AnalysisProfile,
  blackboard: Blackboard
): Promise<string> {
  return generateSummary(anthropic, model, profile, blackboard).catch(
    (error: unknown) => {
      logger.error({ error }, 'Failed to generate summary');
      const msg = error instanceof Error ? error.message : String(error);
      return `# Analysis Summary\n\n_Summary generation failed: ${msg}_\n\n${blackboard.toMarkdown()}`;
    }
  );
}
