import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { executeTool } from './tools.js';
import type { ToolCallRecord } from './output-manager.js';

export interface ToolExecutionResult {
  toolResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
  }>;
  wroteToBlackboard: boolean;
}

export async function processToolCalls(
  toolUseBlocks: ToolUseBlock[],
  blackboard: Blackboard,
  targetPath: string,
  callbacks: {
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
): Promise<ToolExecutionResult> {
  const toolResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
  }> = [];

  let wroteToBlackboard = false;

  for (const toolUse of toolUseBlocks) {
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

    if (toolUse.name === 'update_blackboard' && result.success) {
      wroteToBlackboard = true;
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

    const resultContent = result.success
      ? result.output
      : `Error: ${result.error}`;

    toolResults.push({
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: resultContent,
    });
  }

  return { toolResults, wroteToBlackboard };
}
