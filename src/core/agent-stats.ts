import Anthropic from '@anthropic-ai/sdk';

export interface AgentStats {
  totalTokens: {
    input: number;
    output: number;
    total: number;
    cacheCreation: number;
    cacheRead: number;
  };
  iterations: number;
  toolCalls: number;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

export function createEmptyStats(): AgentStats {
  return {
    totalTokens: {
      input: 0,
      output: 0,
      total: 0,
      cacheCreation: 0,
      cacheRead: 0,
    },
    iterations: 0,
    toolCalls: 0,
    startTime: new Date(),
  };
}

export function updateTokenStats(
  stats: AgentStats,
  response: Anthropic.Message
): void {
  stats.totalTokens.input += response.usage.input_tokens;
  stats.totalTokens.output += response.usage.output_tokens;
  stats.totalTokens.total = stats.totalTokens.input + stats.totalTokens.output;

  const usage = response.usage as {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  if (usage.cache_creation_input_tokens) {
    stats.totalTokens.cacheCreation =
      (stats.totalTokens.cacheCreation || 0) +
      usage.cache_creation_input_tokens;
  }
  if (usage.cache_read_input_tokens) {
    stats.totalTokens.cacheRead =
      (stats.totalTokens.cacheRead || 0) + usage.cache_read_input_tokens;
  }
}

export function finalizeStats(stats: AgentStats): void {
  stats.endTime = new Date();
  stats.durationMs = stats.endTime.getTime() - stats.startTime.getTime();
}
