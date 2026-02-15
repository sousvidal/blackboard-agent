import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlock,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { TOOLS } from './tools.js';
import { generateSystemPrompt } from './prompts.js';
import {
  type AnalysisProfile,
  CODEBASE_ANALYSIS_PROFILE,
  interpolateMessage,
} from './analysis-profile.js';
import { OutputManager, type ToolCallRecord } from './output-manager.js';
import { logger } from '../utils/logger.js';
import {
  type AgentStats,
  createEmptyStats,
  updateTokenStats,
  finalizeStats,
} from './agent-stats.js';
import { processToolCalls } from './agent-tools.js';
import { buildToolHistory, formatCompactToolCall } from './agent-history.js';

export type { AgentStats } from './agent-stats.js';

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

    // Output manager is only created when saving output
    if (this.config.saveOutput !== false && config.workspaceRoot) {
      this.outputManager = new OutputManager(config.workspaceRoot);
    }

    // Initialize tracking
    this.stats = createEmptyStats();
    this.messages = [];
    this.toolCallHistory = [];
    this.compactToolHistory = [];
    this.iterationsSinceBlackboardWrite = 0;
    this.completionNudges = 0;

    // Use provided blackboard or create a fresh one
    this.blackboard = config.blackboard || new Blackboard(config.targetPath);
  }

  private formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private finalizeStatsOnError(): void {
    this.stats.endTime = this.stats.endTime || new Date();
    this.stats.durationMs =
      this.stats.durationMs ||
      this.stats.endTime.getTime() - this.stats.startTime.getTime();
  }

  private async saveErrorArtifacts(errorMessage: string): Promise<void> {
    if (this.config.saveOutput === false) {
      return;
    }

    try {
      await this.saveArtifacts(errorMessage);
    } catch (saveError) {
      logger.error({ saveError }, 'Failed to save error artifacts');
    }
  }

  private async handleAnalysisError(error: unknown): Promise<never> {
    this.finalizeStatsOnError();

    const errorMessage = this.formatErrorMessage(error);
    await this.saveErrorArtifacts(errorMessage);

    logger.error({ error }, 'Agent analysis failed');
    this.emitEvent({
      type: 'error',
      data: { error: errorMessage },
    });
    throw error;
  }

  /**
   * Full orchestrated analysis flow (CLI entry point).
   * Calls run(), saves artifacts, returns the blackboard.
   */
  async analyze(): Promise<Blackboard> {
    try {
      if (this.config.saveOutput !== false && this.outputManager) {
        await this.outputManager.createOutputFolder();
      }

      await this.run();

      if (this.config.saveOutput !== false) {
        await this.saveArtifacts();
      }

      return this.blackboard;
    } catch (error) {
      return await this.handleAnalysisError(error);
    }
  }

  /**
   * Pure agent loop — no disk I/O.
   * This is what a parent agent calls on a sub-agent.
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

    await this.runAgentLoop();

    // Finalize stats
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

  /**
   * Save all analysis artifacts to disk.
   */
  async saveArtifacts(error?: string): Promise<void> {
    if (!this.outputManager) return;

    try {
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

      // Generate and save summary if analysis was successful
      if (!error) {
        const summary = await this.generateSummary();
        await this.outputManager.saveSummary(summary);
      }

      logger.info(
        { outputPath: this.outputManager.getAnalysisPath() },
        'Saved all artifacts'
      );
    } catch (saveError) {
      logger.error({ saveError }, 'Failed to save artifacts');
      throw saveError;
    }
  }

  /**
   * Generate a summary from the blackboard content using the profile's instructions.
   */
  async generateSummary(): Promise<string> {
    try {
      const summaryPrompt = `Based on the analysis findings below, provide a comprehensive summary in markdown format.

${this.profile.summaryInstructions}

Here are the findings (from the blackboard):

${this.blackboard.getAllSectionsForContext()}`;

      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: summaryPrompt,
          },
        ],
      });

      const textBlocks = response.content.filter(
        (block): block is TextBlock => block.type === 'text'
      );

      return textBlocks.map((block) => block.text).join('\n');
    } catch (error) {
      logger.error({ error }, 'Failed to generate summary');
      return `# Analysis Summary\n\n_Summary generation failed: ${error instanceof Error ? error.message : String(error)}_\n\n${this.blackboard.toMarkdown()}`;
    }
  }

  private extractAndEmitThinking(response: Anthropic.Message): void {
    const thinkingBlocks = response.content.filter(
      (block): block is TextBlock => block.type === 'text'
    );

    if (thinkingBlocks.length > 0) {
      const thinking = thinkingBlocks.map((block) => block.text).join('\n');
      this.emitEvent({ type: 'thinking', data: { thinking } });
    }
  }

  private checkCompletionNudge(
    response: Anthropic.Message,
    hasToolUse: boolean
  ): string | null {
    if (hasToolUse && response.stop_reason !== 'end_turn') {
      return null;
    }

    const utilization =
      this.blackboard.getTotalTokens() / this.blackboard.getMaxTokens();

    if (utilization >= 0.65 || this.completionNudges >= 3) {
      return null;
    }

    this.completionNudges++;
    const nudgeMessage = `Your blackboard is only ${Math.round(utilization * 100)}% utilized with ${this.blackboard.getRemainingTokens()} tokens remaining. There is likely more to discover. Continue exploring and saving findings.`;

    logger.info(
      { utilization, nudge: this.completionNudges },
      'Completion gate: nudging agent to continue'
    );

    return nudgeMessage;
  }

  /**
   * Main agentic loop - BLACKBOARD PATTERN WITH ROLLING WINDOW
   */
  private async runAgentLoop(): Promise<void> {
    const initialMessage = interpolateMessage(this.profile.initialMessage, {
      targetPath: this.config.targetPath,
    });

    this.messages = [{ role: 'user', content: initialMessage }];
    let workingMessages: MessageParam[] = [
      { role: 'user', content: initialMessage },
    ];

    while (this.stats.iterations < this.config.maxIterations) {
      this.stats.iterations++;

      logger.info({ iteration: this.stats.iterations }, 'Agent iteration');

      this.emitEvent({
        type: 'iteration',
        data: {
          iteration: this.stats.iterations,
          maxIterations: this.config.maxIterations,
          tokens: this.stats.totalTokens,
        },
      });

      const toolHistorySummary = buildToolHistory(
        this.toolCallHistory,
        this.compactToolHistory
      );
      const systemPrompt = generateSystemPrompt({
        blackboard: this.blackboard,
        profile: this.profile,
        tools: this.tools,
        toolHistorySummary,
        iterationsSinceBlackboardWrite: this.iterationsSinceBlackboardWrite,
      });

      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: this.tools,
        messages: workingMessages,
      });

      updateTokenStats(this.stats, response);

      logger.info(
        { stopReason: response.stop_reason, usage: response.usage },
        'Claude response received'
      );

      this.extractAndEmitThinking(response);

      const hasToolUse = response.content.some(
        (block) => block.type === 'tool_use'
      );

      const nudgeMessage = this.checkCompletionNudge(response, hasToolUse);
      if (nudgeMessage) {
        this.messages.push({ role: 'assistant', content: response.content });
        this.messages.push({ role: 'user', content: nudgeMessage });

        workingMessages = [
          { role: 'assistant', content: response.content },
          { role: 'user', content: nudgeMessage },
        ];
        continue;
      }

      if (!hasToolUse || response.stop_reason === 'end_turn') {
        logger.info('Agent completed analysis (no more tool calls)');
        break;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      const { toolResults, wroteToBlackboard } = await processToolCalls(
        toolUseBlocks,
        this.blackboard,
        this.config.targetPath,
        {
          onToolCall: (name, input) => {
            this.emitEvent({ type: 'tool_call', data: { name, input } });
          },
          onToolResult: (result) => {
            this.emitEvent({ type: 'tool_result', data: result });
          },
          onBlackboardUpdate: (section, tokens, maxTokens) => {
            this.emitEvent({
              type: 'blackboard_update',
              data: { section, tokens, maxTokens },
            });
          },
          recordToolCall: (record) => {
            this.toolCallHistory.push(record);
          },
          recordCompactCall: (desc) => {
            this.compactToolHistory.push(desc);
          },
          formatCompactCall: formatCompactToolCall,
          getCurrentIteration: () => this.stats.iterations,
          incrementToolCalls: () => {
            this.stats.toolCalls++;
          },
        }
      );

      this.iterationsSinceBlackboardWrite = wroteToBlackboard
        ? 0
        : this.iterationsSinceBlackboardWrite + 1;

      this.messages.push({ role: 'assistant', content: response.content });
      this.messages.push({ role: 'user', content: toolResults });

      workingMessages = [
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];

      if (this.stats.iterations >= this.config.maxIterations) {
        logger.info('Max iterations reached');
        break;
      }
    }
  }

  /**
   * Build a grouped summary of tool history for the system prompt.
   * Groups by directory explored and files read, with recent calls listed.
   */
  private emitEvent(event: AgentEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  getStats(): AgentStats {
    return this.stats;
  }
}
