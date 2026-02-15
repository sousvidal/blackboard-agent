import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageParam,
  TextBlock,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { generateSystemPrompt } from './prompts.js';
import type { AnalysisProfile } from './analysis-profile.js';
import { interpolateMessage } from './analysis-profile.js';
import type { ToolCallRecord } from './output-manager.js';
import { logger } from '../utils/logger.js';
import type { AgentStats } from './agent-stats.js';
import { updateTokenStats } from './agent-stats.js';
import { processToolCalls } from './agent-tools.js';
import { buildToolHistory, formatCompactToolCall } from './agent-history.js';
import type { AgentEvent } from './agent-types.js';

export interface LoopState {
  anthropic: Anthropic;
  model: string;
  maxIterations: number;
  targetPath: string;
  blackboard: Blackboard;
  profile: AnalysisProfile;
  tools: Tool[];
  stats: AgentStats;
  messages: MessageParam[];
  toolCallHistory: ToolCallRecord[];
  compactToolHistory: string[];
  iterationsSinceBlackboardWrite: number;
  completionNudges: number;
  emitEvent: (event: AgentEvent) => void;
}

export async function runAgentLoop(state: LoopState): Promise<void> {
  const initialMessage = interpolateMessage(state.profile.initialMessage, {
    targetPath: state.targetPath,
  });

  state.messages = [{ role: 'user', content: initialMessage }];
  let workingMessages: MessageParam[] = [
    { role: 'user', content: initialMessage },
  ];
  let running = true;

  while (running && state.stats.iterations < state.maxIterations) {
    const nextMessages = await runSingleIteration(state, workingMessages);
    running = nextMessages !== null;
    workingMessages = nextMessages ?? workingMessages;
  }
}

async function callClaude(
  state: LoopState,
  workingMessages: MessageParam[]
): Promise<Anthropic.Message> {
  const toolHistorySummary = buildToolHistory(
    state.toolCallHistory,
    state.compactToolHistory
  );
  const systemPrompt = generateSystemPrompt({
    blackboard: state.blackboard,
    profile: state.profile,
    tools: state.tools,
    toolHistorySummary,
    iterationsSinceBlackboardWrite: state.iterationsSinceBlackboardWrite,
  });

  const response = await state.anthropic.messages.create({
    model: state.model,
    max_tokens: 4096,
    system: systemPrompt,
    tools: state.tools,
    messages: workingMessages,
  });

  updateTokenStats(state.stats, response);
  logger.info(
    { stopReason: response.stop_reason, usage: response.usage },
    'Claude response received'
  );
  return response;
}

function extractAndEmitThinking(
  response: Anthropic.Message,
  emitEvent: (event: AgentEvent) => void
): void {
  const thinkingBlocks = response.content.filter(
    (block): block is TextBlock => block.type === 'text'
  );

  if (thinkingBlocks.length === 0) return;

  const thinking = thinkingBlocks.map((block) => block.text).join('\n');
  emitEvent({ type: 'thinking', data: { thinking } });
}

function checkCompletionNudge(
  state: LoopState,
  response: Anthropic.Message,
  hasToolUse: boolean
): string | null {
  if (hasToolUse && response.stop_reason !== 'end_turn') return null;

  const utilization =
    state.blackboard.getTotalTokens() / state.blackboard.getMaxTokens();
  if (utilization >= 0.65 || state.completionNudges >= 3) return null;

  state.completionNudges++;
  logger.info(
    { utilization, nudge: state.completionNudges },
    'Completion gate: nudging agent to continue'
  );

  return `Your blackboard is only ${Math.round(utilization * 100)}% utilized with ${state.blackboard.getRemainingTokens()} tokens remaining. There is likely more to discover. Continue exploring and saving findings.`;
}

function recordMessages(
  state: LoopState,
  assistantContent: ContentBlock[],
  userContent: MessageParam['content']
): MessageParam[] {
  state.messages.push({ role: 'assistant', content: assistantContent });
  state.messages.push({ role: 'user', content: userContent });
  return [
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: userContent },
  ];
}

async function handleToolUse(
  state: LoopState,
  response: Anthropic.Message
): Promise<MessageParam[]> {
  const toolUseBlocks = response.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );

  const { toolResults, wroteToBlackboard } = await processToolCalls(
    toolUseBlocks,
    state.blackboard,
    state.targetPath,
    {
      onToolCall: (name, input) => {
        state.emitEvent({ type: 'tool_call', data: { name, input } });
      },
      onToolResult: (result) => {
        state.emitEvent({ type: 'tool_result', data: result });
      },
      onBlackboardUpdate: (section, tokens, maxTokens) => {
        state.emitEvent({
          type: 'blackboard_update',
          data: { section, tokens, maxTokens },
        });
      },
      recordToolCall: (record) => {
        state.toolCallHistory.push(record);
      },
      recordCompactCall: (desc) => {
        state.compactToolHistory.push(desc);
      },
      formatCompactCall: formatCompactToolCall,
      getCurrentIteration: () => state.stats.iterations,
      incrementToolCalls: () => {
        state.stats.toolCalls++;
      },
    }
  );

  state.iterationsSinceBlackboardWrite = wroteToBlackboard
    ? 0
    : state.iterationsSinceBlackboardWrite + 1;

  return recordMessages(state, response.content, toolResults);
}

async function runSingleIteration(
  state: LoopState,
  workingMessages: MessageParam[]
): Promise<MessageParam[] | null> {
  state.stats.iterations++;
  logger.info({ iteration: state.stats.iterations }, 'Agent iteration');

  state.emitEvent({
    type: 'iteration',
    data: {
      iteration: state.stats.iterations,
      maxIterations: state.maxIterations,
      tokens: state.stats.totalTokens,
    },
  });

  const response = await callClaude(state, workingMessages);
  extractAndEmitThinking(response, state.emitEvent);

  const hasToolUse = response.content.some(
    (block) => block.type === 'tool_use'
  );

  const nudgeMessage = checkCompletionNudge(state, response, hasToolUse);
  if (nudgeMessage) {
    return recordMessages(state, response.content, nudgeMessage);
  }

  if (!hasToolUse || response.stop_reason === 'end_turn') {
    logger.info('Agent completed analysis (no more tool calls)');
    return null;
  }

  return await handleToolUse(state, response);
}
