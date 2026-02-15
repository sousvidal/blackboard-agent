import type { Tool } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import type { AnalysisProfile } from './analysis-profile.js';

/**
 * Build a human-readable tool description from Tool definitions.
 */
function formatToolDescriptions(tools: Tool[]): string {
  return tools
    .map((tool, i) => {
      const params =
        tool.input_schema.type === 'object' && tool.input_schema.properties
          ? Object.keys(
              tool.input_schema.properties as Record<string, unknown>
            ).join(', ')
          : '';
      return `${i + 1}. **${tool.name}(${params})**: ${tool.description}`;
    })
    .join('\n\n');
}

function buildStallWarning(iterationsSinceWrite: number): string {
  if (iterationsSinceWrite < 2) {
    return '';
  }

  return `
⚠️ WARNING: You have NOT written to the blackboard in ${iterationsSinceWrite} iterations.
Your findings from previous iterations are LOST because only the blackboard persists.
You MUST call update_blackboard NOW before doing any more exploration.
Summarize what you've learned so far and save it.`;
}

function buildSectionsList(profile: AnalysisProfile): string {
  return profile.suggestedSections
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join('\n');
}

function buildExplorationHints(profile: AnalysisProfile): string {
  return profile.explorationHints.map((h, i) => `${i + 1}. ${h}`).join('\n');
}

function getExplorationToolNames(tools: Tool[]): string {
  const explorationTools = tools
    .filter((t) => t.name !== 'update_blackboard')
    .map((t) => t.name);
  return explorationTools.join(', ');
}

function buildBlackboardSection(
  blackboard: Blackboard,
  hasContent: boolean
): string {
  const status = hasContent
    ? '**Continuing analysis.** Review existing blackboard content below.'
    : '**Fresh analysis.** The blackboard is empty — start filling it.';

  return `## THE BLACKBOARD SYSTEM

You have access to a "blackboard" - a structured knowledge store where you save important findings.
- **Token budget**: ${blackboard.getMaxTokens()} tokens
- **Current usage**: ${blackboard.getTotalTokens()} tokens
- **Remaining**: ${blackboard.getRemainingTokens()} tokens

${status}`;
}

/**
 * Generate the system prompt from an AnalysisProfile, tools, and blackboard state
 */
export function generateSystemPrompt(options: {
  blackboard: Blackboard;
  profile: AnalysisProfile;
  tools: Tool[];
  toolHistorySummary?: string;
  iterationsSinceBlackboardWrite?: number;
}): string {
  const {
    blackboard,
    profile,
    tools,
    toolHistorySummary = '',
    iterationsSinceBlackboardWrite = 0,
  } = options;

  const hasContent = blackboard.getTotalTokens() > 0;
  const stallWarning = buildStallWarning(iterationsSinceBlackboardWrite);
  const sectionsList = buildSectionsList(profile);
  const hints = buildExplorationHints(profile);
  const toolNamesList = getExplorationToolNames(tools);
  const blackboardSection = buildBlackboardSection(blackboard, hasContent);

  const prompt = `You are an expert analysis agent. Your goal is to systematically explore a target and record your findings.

## YOUR MISSION

${profile.mission}

Target: ${blackboard.getTargetPath()}

## CRITICAL RULE: ALWAYS SAVE YOUR FINDINGS

Your working memory is extremely limited — only your LAST action is visible to you. Everything older is discarded. The ONLY way to preserve knowledge across iterations is the blackboard.

**Every time you learn something new from a tool call, you MUST call update_blackboard in the SAME response to save your key findings.** If you explore without saving, you WILL forget what you found and repeat the same work.

Pattern for EVERY iteration:
1. Call exploration tools (${toolNamesList})
2. Call update_blackboard to save what you learned ← MANDATORY

NEVER make a response with only exploration tools and no update_blackboard call.
${stallWarning}

${blackboardSection}

### Suggested Sections

These are suggestions. After initial exploration, add, remove, or rename sections as you see fit:
${sectionsList}

### Blackboard Strategy

- Be concise and strategic - space is limited
- Focus on insights, not just facts
- Update sections as you learn more (use replace=true for better summaries)
- Create new sections when you discover areas worth tracking
- Prioritize what's most important for your analysis

## YOUR TOOLS

${formatToolDescriptions(tools)}

## EXPLORATION STRATEGY

${hints}

## IMPORTANT GUIDELINES

- **Be efficient**: Don't read every file - be strategic
- **NEVER explore without saving**: Always call update_blackboard in the same response as exploration tools
- **Don't repeat yourself**: Check your progress history and blackboard before exploring
- **Be concise**: Blackboard space is limited
- **Short-term memory**: You can see your last action, but older history is discarded
- **Long-term memory**: Important findings MUST go on the blackboard or they're lost
- **Signal completion**: When you've built a comprehensive understanding, explain what you learned

## STOPPING CONDITIONS

You should stop your analysis when:
- You have a solid understanding of the target
- The blackboard captures the key insights from your analysis
- You've explored the major components
- Further exploration would provide diminishing returns

When you're done, provide a brief summary of your findings.
${toolHistorySummary}
${hasContent ? '\n## EXISTING BLACKBOARD CONTENT\n\n' + blackboard.getAllSectionsForContext() : ''}

## BEGIN

Start exploring. Remember: be strategic, save findings to the blackboard, and build a comprehensive understanding.`;

  return prompt;
}
