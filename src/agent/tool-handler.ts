import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from '../blackboard/blackboard.js';
import { executeTool } from '../tools/executor.js';
import type { ToolCallRecord } from './output.js';

export interface ToolExecutionResult {
  toolResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
  }>;
  wroteToBlackboard: boolean;
}

interface ToolCallbacks {
  onToolCall: (name: string, input: unknown) => void;
  onToolResult: (result: {
    name: string;
    success: boolean;
    output: string;
    error?: string;
    durationMs?: number;
  }) => void;
  onBlackboardUpdate: (
    section: string,
    tokens: number,
    maxTokens: number
  ) => void;
  recordToolCall: (record: ToolCallRecord) => void;
  recordCompactCall: (description: string) => void;
  formatCompactCall: (
    name: string,
    input: Record<string, unknown>,
    result: Record<string, unknown>
  ) => string;
  getCurrentIteration: () => number;
  incrementToolCalls: () => void;
}

async function processSingleToolCall(
  toolUse: ToolUseBlock,
  blackboard: Blackboard,
  targetPath: string,
  callbacks: ToolCallbacks
): Promise<{
  toolResult: { type: 'tool_result'; tool_use_id: string; content: string };
  wroteToBlackboard: boolean;
}> {
  callbacks.incrementToolCalls();
  callbacks.onToolCall(toolUse.name, toolUse.input);

  const result = await executeTool(
    toolUse.name,
    toolUse.input as Record<string, unknown>,
    blackboard,
    targetPath
  );

  callbacks.recordToolCall({
    timestamp: new Date().toISOString(),
    iteration: callbacks.getCurrentIteration(),
    name: toolUse.name,
    input: toolUse.input as Record<string, unknown>,
    success: result.success,
    output: result.output,
    error: result.error,
    durationMs: result.durationMs,
  });

  const compactDesc = callbacks.formatCompactCall(
    toolUse.name,
    toolUse.input as Record<string, unknown>,
    result as unknown as Record<string, unknown>
  );
  callbacks.recordCompactCall(compactDesc);

  const wroteToBlackboard =
    toolUse.name === 'update_blackboard' && result.success;
  if (wroteToBlackboard) {
    callbacks.onBlackboardUpdate(
      (toolUse.input as { section: string }).section,
      blackboard.getTotalTokens(),
      blackboard.getMaxTokens()
    );
  }

  callbacks.onToolResult({
    name: toolUse.name,
    success: result.success,
    output: result.output,
    error: result.error,
    durationMs: result.durationMs,
  });

  const content = result.success ? result.output : `Error: ${result.error}`;

  return {
    toolResult: { type: 'tool_result', tool_use_id: toolUse.id, content },
    wroteToBlackboard,
  };
}

export async function processToolCalls(
  toolUseBlocks: ToolUseBlock[],
  blackboard: Blackboard,
  targetPath: string,
  callbacks: ToolCallbacks
): Promise<ToolExecutionResult> {
  let wroteToBlackboard = false;
  const toolResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
  }> = [];

  for (const toolUse of toolUseBlocks) {
    const single = await processSingleToolCall(
      toolUse,
      blackboard,
      targetPath,
      callbacks
    );
    toolResults.push(single.toolResult);
    wroteToBlackboard = wroteToBlackboard || single.wroteToBlackboard;
  }

  return { toolResults, wroteToBlackboard };
}
