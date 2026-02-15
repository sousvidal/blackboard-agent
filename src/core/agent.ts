import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { TOOLS } from './tool-definitions.js';
import {
  type AnalysisProfile,
  CODEBASE_ANALYSIS_PROFILE,
} from './analysis-profile.js';
import { OutputManager, type ToolCallRecord } from './output-manager.js';
import { logger } from '../utils/logger.js';
import {
  type AgentStats,
  createEmptyStats,
  finalizeStats,
} from './agent-stats.js';
import { generateSummarySafe } from './agent-summary.js';
import { runAgentLoop } from './agent-loop.js';

export type {
  AgentConfig,
  AgentEvent,
  AgentEventCallback,
} from './agent-types.js';
export type { AgentStats } from './agent-stats.js';

import type {
  AgentConfig,
  AgentEvent,
  AgentEventCallback,
} from './agent-types.js';

export class BlackboardAgent {
  private anthropic: Anthropic;
  private blackboard: Blackboard;
  private outputManager: OutputManager | undefined;
  private config: Required<
    Pick<AgentConfig, 'apiKey' | 'model' | 'maxIterations' | 'targetPath'>
  > &
    AgentConfig;
  private profile: AnalysisProfile;
  private tools: Tool[];
  private onEvent?: AgentEventCallback;
  private stats: AgentStats;
  private messages: MessageParam[];
  private toolCallHistory: ToolCallRecord[];
  private compactToolHistory: string[];
  private iterationsSinceBlackboardWrite: number;
  private completionNudges: number;

  constructor(config: AgentConfig, onEvent?: AgentEventCallback) {
    this.anthropic = new Anthropic({ apiKey: config.apiKey });
    this.config = {
      ...config,
      model: config.model || 'claude-sonnet-4-5',
      maxIterations: config.maxIterations || 100,
      saveOutput: config.saveOutput !== false,
    };
    this.profile = config.profile || CODEBASE_ANALYSIS_PROFILE;
    this.tools = config.tools || TOOLS;
    this.onEvent = onEvent;

    if (this.config.saveOutput !== false && config.workspaceRoot) {
      this.outputManager = new OutputManager(config.workspaceRoot);
    }

    this.stats = createEmptyStats();
    this.messages = [];
    this.toolCallHistory = [];
    this.compactToolHistory = [];
    this.iterationsSinceBlackboardWrite = 0;
    this.completionNudges = 0;
    this.blackboard = config.blackboard || new Blackboard(config.targetPath);
  }

  /**
   * Full orchestrated analysis flow (CLI entry point).
   */
  async analyze(): Promise<Blackboard> {
    if (this.config.saveOutput !== false && this.outputManager) {
      await this.outputManager.createOutputFolder();
    }

    try {
      await this.run();
    } catch (error) {
      return await this.handleAnalysisError(error);
    }

    if (this.config.saveOutput !== false) {
      await this.saveArtifacts();
    }

    return this.blackboard;
  }

  /**
   * Pure agent loop -- no disk I/O.
   */
  async run(): Promise<Blackboard> {
    this.emitEvent({
      type: 'start',
      data: {
        targetPath: this.config.targetPath,
        tokens: this.blackboard.getTotalTokens(),
        maxTokens: this.blackboard.getMaxTokens(),
        analysisId: this.outputManager?.getAnalysisId() ?? 'no-output',
      },
    });

    await runAgentLoop({
      anthropic: this.anthropic,
      model: this.config.model,
      maxIterations: this.config.maxIterations,
      targetPath: this.config.targetPath,
      blackboard: this.blackboard,
      profile: this.profile,
      tools: this.tools,
      stats: this.stats,
      messages: this.messages,
      toolCallHistory: this.toolCallHistory,
      compactToolHistory: this.compactToolHistory,
      iterationsSinceBlackboardWrite: this.iterationsSinceBlackboardWrite,
      completionNudges: this.completionNudges,
      emitEvent: (event) => this.emitEvent(event),
    });

    finalizeStats(this.stats);

    this.emitEvent({
      type: 'complete',
      data: {
        blackboard: this.blackboard,
        tokens: this.blackboard.getTotalTokens(),
        stats: this.stats,
        outputPath: this.outputManager?.getAnalysisPath() ?? '',
      },
    });

    return this.blackboard;
  }

  async saveArtifacts(error?: string): Promise<void> {
    if (!this.outputManager) return;

    const summary = error
      ? null
      : await generateSummarySafe(
          this.anthropic,
          this.config.model,
          this.profile,
          this.blackboard
        );

    await this.outputManager.saveConversation(
      this.messages,
      this.config.targetPath
    );
    await this.outputManager.saveBlackboard(this.blackboard);
    await this.outputManager.saveMetadata({
      stats: this.stats,
      blackboard: this.blackboard,
      targetPath: this.config.targetPath,
      model: this.config.model,
      success: !error,
      error,
    });
    await this.outputManager.saveToolCalls(this.toolCallHistory);

    if (summary) {
      await this.outputManager.saveSummary(summary);
    }

    logger.info(
      { outputPath: this.outputManager.getAnalysisPath() },
      'Saved all artifacts'
    );
  }

  private async handleAnalysisError(error: unknown): Promise<never> {
    this.stats.endTime = this.stats.endTime || new Date();
    this.stats.durationMs =
      this.stats.durationMs ||
      this.stats.endTime.getTime() - this.stats.startTime.getTime();

    if (this.config.saveOutput !== false) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.saveArtifacts(errorMsg).catch((e: unknown) => {
        logger.error({ error: e }, 'Failed to save error artifacts');
      });
    }

    logger.error({ error }, 'Agent analysis failed');
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.emitEvent({ type: 'error', data: { error: errorMsg } });
    throw error;
  }

  private emitEvent(event: AgentEvent): void {
    this.onEvent?.(event);
  }

  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  getStats(): AgentStats {
    return this.stats;
  }
}
