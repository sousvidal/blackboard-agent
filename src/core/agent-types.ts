import type { Tool } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { Blackboard } from './blackboard.js';
import type { AnalysisProfile } from './analysis-profile.js';

export interface AgentConfig {
  apiKey: string;
  model?: string;
  maxIterations?: number;
  targetPath: string;
  workspaceRoot?: string;
  profile?: AnalysisProfile;
  tools?: Tool[];
  blackboard?: Blackboard;
  saveOutput?: boolean;
}

export interface AgentEvent {
  type:
    | 'start'
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'blackboard_update'
    | 'iteration'
    | 'complete'
    | 'error';
  data: unknown;
}

export type AgentEventCallback = (event: AgentEvent) => void;
