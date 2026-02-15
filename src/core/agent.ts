import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlock,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { TOOLS, executeTool } from './tools.js';
import { generateSystemPrompt } from './prompts.js';
import {
  type AnalysisProfile,
  CODEBASE_ANALYSIS_PROFILE,
  interpolateMessage,
} from './analysis-profile.js';
import {
  OutputManager,
  type AgentStats,
  type ToolCallRecord,
} from './output-manager.js';
import { logger } from '../utils/logger.js';

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
    this.stats = {
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
    this.messages = [];
    this.toolCallHistory = [];
    this.compactToolHistory = [];
    this.iterationsSinceBlackboardWrite = 0;
    this.completionNudges = 0;

    // Use provided blackboard or create a fresh one
    this.blackboard = config.blackboard || new Blackboard(config.targetPath);
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
      // Finalize stats on error
      this.stats.endTime = this.stats.endTime || new Date();
      this.stats.durationMs =
        this.stats.durationMs ||
        this.stats.endTime.getTime() - this.stats.startTime.getTime();

      if (this.config.saveOutput !== false) {
        try {
          await this.saveArtifacts(
            error instanceof Error ? error.message : String(error)
          );
        } catch (saveError) {
          logger.error({ saveError }, 'Failed to save error artifacts');
        }
      }

      logger.error({ error }, 'Agent analysis failed');
      this.emitEvent({
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
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
    this.stats.endTime = new Date();
    this.stats.durationMs =
      this.stats.endTime.getTime() - this.stats.startTime.getTime();

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

      await this.outputManager.saveMetadata(
        this.stats,
        this.blackboard,
        this.config.targetPath,
        this.config.model,
        !error,
        error
      );

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

      // Regenerate system prompt with current blackboard state + history
      const toolHistorySummary = this.buildGroupedToolHistory();
      const systemPrompt = generateSystemPrompt(
        this.blackboard,
        this.profile,
        this.tools,
        toolHistorySummary,
        this.iterationsSinceBlackboardWrite
      );

      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: this.tools,
        messages: workingMessages,
      });

      // Track token usage
      this.stats.totalTokens.input += response.usage.input_tokens;
      this.stats.totalTokens.output += response.usage.output_tokens;
      this.stats.totalTokens.total =
        this.stats.totalTokens.input + this.stats.totalTokens.output;

      const usage = response.usage as {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };

      if (usage.cache_creation_input_tokens) {
        this.stats.totalTokens.cacheCreation =
          (this.stats.totalTokens.cacheCreation || 0) +
          usage.cache_creation_input_tokens;
      }
      if (usage.cache_read_input_tokens) {
        this.stats.totalTokens.cacheRead =
          (this.stats.totalTokens.cacheRead || 0) +
          usage.cache_read_input_tokens;
      }

      logger.info(
        { stopReason: response.stop_reason, usage: response.usage },
        'Claude response received'
      );

      const hasToolUse = response.content.some(
        (block) => block.type === 'tool_use'
      );

      // Extract thinking
      const thinkingBlocks = response.content.filter(
        (block): block is TextBlock => block.type === 'text'
      );

      if (thinkingBlocks.length > 0) {
        const thinking = thinkingBlocks.map((block) => block.text).join('\n');
        this.emitEvent({ type: 'thinking', data: { thinking } });
      }

      // Agent wants to stop — check completion gate
      if (!hasToolUse || response.stop_reason === 'end_turn') {
        const utilization =
          this.blackboard.getTotalTokens() / this.blackboard.getMaxTokens();

        if (utilization < 0.65 && this.completionNudges < 3) {
          this.completionNudges++;
          const nudgeMessage = `Your blackboard is only ${Math.round(utilization * 100)}% utilized with ${this.blackboard.getRemainingTokens()} tokens remaining. There is likely more to discover. Continue exploring and saving findings.`;

          logger.info(
            { utilization, nudge: this.completionNudges },
            'Completion gate: nudging agent to continue'
          );

          // Archive in full conversation
          this.messages.push({ role: 'assistant', content: response.content });
          this.messages.push({ role: 'user', content: nudgeMessage });

          workingMessages = [
            { role: 'assistant', content: response.content },
            { role: 'user', content: nudgeMessage },
          ];
          continue;
        }

        logger.info('Agent completed analysis (no more tool calls)');
        break;
      }

      // Process tool calls
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
      }> = [];

      let wroteToBlackboardThisIteration = false;

      for (const toolUse of toolUseBlocks) {
        this.stats.toolCalls++;

        this.emitEvent({
          type: 'tool_call',
          data: { name: toolUse.name, input: toolUse.input },
        });

        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          this.blackboard,
          this.config.targetPath
        );

        this.toolCallHistory.push({
          timestamp: new Date().toISOString(),
          iteration: this.stats.iterations,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          success: result.success,
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
        });

        const compactDesc = this.formatCompactToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          result
        );
        this.compactToolHistory.push(compactDesc);

        if (toolUse.name === 'update_blackboard' && result.success) {
          wroteToBlackboardThisIteration = true;
          this.emitEvent({
            type: 'blackboard_update',
            data: {
              section: (toolUse.input as { section: string }).section,
              tokens: this.blackboard.getTotalTokens(),
              maxTokens: this.blackboard.getMaxTokens(),
            },
          });
        }

        this.emitEvent({
          type: 'tool_result',
          data: {
            name: toolUse.name,
            success: result.success,
            output: result.output,
            error: result.error,
            durationMs: result.durationMs,
          },
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

      if (wroteToBlackboardThisIteration) {
        this.iterationsSinceBlackboardWrite = 0;
      } else {
        this.iterationsSinceBlackboardWrite++;
      }

      // Archive full conversation
      this.messages.push({ role: 'assistant', content: response.content });
      this.messages.push({ role: 'user', content: toolResults });

      // Rolling window
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
  private buildGroupedToolHistory(): string {
    if (this.compactToolHistory.length === 0) return '';

    const dirs = new Set<string>();
    const files = new Set<string>();

    for (const record of this.toolCallHistory) {
      if (record.name === 'list_dir') {
        const path = String(record.input.path || '');
        const short = path.split('/').slice(-2).join('/') || '/';
        dirs.add(short);
      } else if (record.name === 'file_read') {
        const path = String(record.input.path || '');
        files.add(path.split('/').pop() || path);
      }
    }

    const recentHistory = this.compactToolHistory.slice(-15);
    const skipped = this.compactToolHistory.length - recentHistory.length;

    const lines = [
      `\n## YOUR PROGRESS SO FAR (${this.compactToolHistory.length} tool calls)`,
      '',
    ];

    if (dirs.size > 0) {
      lines.push(`Directories explored: ${Array.from(dirs).join(', ')}`);
    }
    if (files.size > 0) {
      const fileList = Array.from(files);
      const shown = fileList.slice(0, 12);
      const moreCount = fileList.length - shown.length;
      lines.push(
        `Files read: ${shown.join(', ')}${moreCount > 0 ? `, +${moreCount} more` : ''}`
      );
    }

    lines.push('');
    lines.push('Recent:');
    if (skipped > 0) lines.push(`  (${skipped} earlier calls omitted)`);
    recentHistory.forEach((t, i) => {
      lines.push(`  ${skipped + i + 1}. ${t}`);
    });

    lines.push('');
    lines.push(
      "DO NOT repeat tool calls you've already made. Use the blackboard to track what you've learned and move on to new areas."
    );

    return lines.join('\n');
  }

  /**
   * Format a tool call into a compact one-line summary
   */
  private formatCompactToolCall(
    name: string,
    input: Record<string, unknown>,
    result: { success: boolean; output: string; error?: string }
  ): string {
    const success = result.success ? '✓' : '✗';

    switch (name) {
      case 'list_dir': {
        const path = String(input.path || '');
        const shortPath = path.split('/').slice(-2).join('/');
        const match = result.output.match(/Found (\d+) items/);
        const count = match ? match[1] : '?';
        return `${success} list_dir(${shortPath}) → ${count} items`;
      }
      case 'file_read': {
        const filePath = String(input.path || '');
        const fileName = filePath.split('/').pop() || filePath;
        const lineMatch = result.output.match(/\((\d+) lines\)/);
        const lineCount = lineMatch ? lineMatch[1] : '?';
        return `${success} file_read(${fileName}) → ${lineCount} lines`;
      }
      case 'grep_search': {
        const pattern = String(input.pattern || '');
        const matchCount = result.output.match(/Found (\d+) matches/);
        const matches = matchCount ? matchCount[1] : '0';
        return `${success} grep_search("${pattern}") → ${matches} matches`;
      }
      case 'update_blackboard': {
        const section = String(input.section || '');
        return `${success} update_blackboard(${section})`;
      }
      default:
        return `${success} ${name}(...)`;
    }
  }

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
