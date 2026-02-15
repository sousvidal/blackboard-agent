import type { Tool } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from '../blackboard/blackboard.js';
import type { AnalysisProfile } from '../config/profiles.js';

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

function buildStallWarning(
  iterationsSinceWrite: number,
  threshold: number
): string {
  if (iterationsSinceWrite < threshold) {
    return '';
  }

  const severity =
    iterationsSinceWrite >= threshold + 2 ? '🚨 CRITICAL' : '⚠️ WARNING';

  return `
${severity}: You have NOT written to the blackboard in ${iterationsSinceWrite} iterations.
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

interface PromptComponents {
  profile: AnalysisProfile;
  blackboard: Blackboard;
  stallThreshold: number;
  stallWarning: string;
  toolNamesList: string;
  blackboardSection: string;
  sectionsList: string;
  hints: string;
  toolDescriptions: string;
  toolHistorySummary: string;
  hasContent: boolean;
}

function buildPromptTemplate(components: PromptComponents): string {
  const {
    profile,
    blackboard,
    stallThreshold,
    stallWarning,
    toolNamesList,
    blackboardSection,
    sectionsList,
    hints,
    toolDescriptions,
    toolHistorySummary,
    hasContent,
  } = components;

  const completionCriteria = profile.completionCriteria
    ? profile.completionCriteria.map((c) => `- ${c}`).join('\n')
    : '- You have a comprehensive understanding of the target\n- The blackboard captures key insights\n- Further exploration would provide diminishing returns';

  const progress = `${blackboard.getTotalTokens()} / ${blackboard.getMaxTokens()} tokens (${Math.round((blackboard.getTotalTokens() / blackboard.getMaxTokens()) * 100)}%)`;

  return `You are an expert analysis agent. Your goal is to systematically explore a target and record your findings.

## YOUR MISSION

${profile.mission}

Target: ${blackboard.getTargetPath()}

## CRITICAL RULE: PRESERVE YOUR DISCOVERIES

Your working memory is extremely limited — only your LAST action is visible to you. Everything older is discarded. The ONLY way to preserve knowledge across iterations is the blackboard.

**Exploration Strategy:**
- You can explore multiple files in one iteration to gather context
- Once you've made meaningful discoveries, call update_blackboard to save insights
- Never go more than ${stallThreshold} iterations without saving findings
- Save strategic insights and patterns, not just raw facts

Pattern for efficient exploration:
1. Explore strategically using tools (${toolNamesList})
2. When you discover something important, call update_blackboard
3. Continue exploring and saving iteratively
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

${toolDescriptions}

## EXPLORATION STRATEGY

${hints}

## IMPORTANT GUIDELINES

- **Be strategic**: Don't read every file - focus on high-value targets
- **Save discoveries regularly**: Don't let more than ${stallThreshold} iterations pass without saving to the blackboard
- **Avoid repetition**: Check your blackboard and recent history before exploring
- **Be concise**: Blackboard space is limited - prioritize insights over raw data
- **Memory model**: 
  - Short-term: You can see your last action and blackboard content
  - Long-term: Only the blackboard persists - everything else is lost
- **Quality over quantity**: Save strategic insights, architectural patterns, and key discoveries
- **Signal completion**: When you've met the completion criteria, summarize what you learned

## STOPPING CONDITIONS

Stop your analysis when you've achieved these goals:
${completionCriteria}

Current progress: ${progress}

When you're done, provide a brief summary of your findings and explain what you learned.
${toolHistorySummary}
${hasContent ? '\n## EXISTING BLACKBOARD CONTENT\n\n' + blackboard.getAllSectionsForContext() : ''}

## BEGIN

Start exploring. Remember: be strategic, save findings to the blackboard, and build a comprehensive understanding.`;
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
  const stallThreshold = profile.stallWarningThreshold ?? 3;

  return buildPromptTemplate({
    profile,
    blackboard,
    stallThreshold,
    stallWarning: buildStallWarning(
      iterationsSinceBlackboardWrite,
      stallThreshold
    ),
    toolNamesList: getExplorationToolNames(tools),
    blackboardSection: buildBlackboardSection(blackboard, hasContent),
    sectionsList: buildSectionsList(profile),
    hints: buildExplorationHints(profile),
    toolDescriptions: formatToolDescriptions(tools),
    toolHistorySummary,
    hasContent,
  });
}
