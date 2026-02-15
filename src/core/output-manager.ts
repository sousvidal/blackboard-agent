import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { Blackboard } from './blackboard.js';
import { logger } from '../utils/logger.js';

export interface ToolCallRecord {
  timestamp: string;
  iteration: number;
  name: string;
  input: Record<string, unknown>;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface AgentStats {
  totalTokens: {
    input: number;
    output: number;
    total: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
  iterations: number;
  toolCalls: number;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

export interface AnalysisMetadata {
  analysisId: string;
  targetPath: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  iterations: number;
  toolCalls: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    cacheCreation: number;
    cacheRead: number;
  };
  blackboardTokens: number;
  model: string;
  success: boolean;
  error?: string;
}

export class OutputManager {
  private outputDir: string;
  private analysisId: string;
  private analysisPath: string;

  constructor(workspaceRoot: string) {
    this.outputDir = join(workspaceRoot, '.output');
    this.analysisId = this.generateAnalysisId();
    this.analysisPath = join(this.outputDir, this.analysisId);
  }

  /**
   * Generate a timestamped analysis ID
   */
  private generateAnalysisId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `analysis-${year}-${month}-${day}-${hours}${minutes}${seconds}`;
  }

  /**
   * Create the output directory structure
   */
  async createOutputFolder(): Promise<void> {
    if (!existsSync(this.analysisPath)) {
      await mkdir(this.analysisPath, { recursive: true });
      logger.info(
        { analysisPath: this.analysisPath },
        'Created analysis output folder'
      );
    }
  }

  /**
   * Save the full conversation
   */
  async saveConversation(
    messages: MessageParam[],
    targetPath: string
  ): Promise<void> {
    const conversationPath = join(this.analysisPath, 'conversation.json');

    const data = {
      timestamp: new Date().toISOString(),
      targetPath,
      messages,
    };

    await writeFile(conversationPath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info({ conversationPath }, 'Saved conversation');
  }

  /**
   * Save the blackboard
   */
  async saveBlackboard(blackboard: Blackboard): Promise<void> {
    // Save JSON
    const jsonPath = join(this.analysisPath, 'blackboard.json');
    const jsonData = blackboard.toJSON();
    await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

    // Save Markdown
    const mdPath = join(this.analysisPath, 'blackboard.md');
    const markdown = blackboard.toMarkdown();
    await writeFile(mdPath, markdown, 'utf-8');

    logger.info({ jsonPath, mdPath }, 'Saved blackboard');
  }

  /**
   * Save metadata
   */
  async saveMetadata(options: {
    stats: AgentStats;
    blackboard: Blackboard;
    targetPath: string;
    model: string;
    success: boolean;
    error?: string;
  }): Promise<void> {
    const { stats, blackboard, targetPath, model, success, error } = options;
    const metadataPath = join(this.analysisPath, 'metadata.json');

    const metadata: AnalysisMetadata = {
      analysisId: this.analysisId,
      targetPath,
      startTime: stats.startTime.toISOString(),
      endTime: stats.endTime?.toISOString() || new Date().toISOString(),
      durationMs: stats.durationMs || 0,
      iterations: stats.iterations,
      toolCalls: stats.toolCalls,
      tokens: {
        input: stats.totalTokens.input,
        output: stats.totalTokens.output,
        total: stats.totalTokens.total,
        cacheCreation: stats.totalTokens.cacheCreation || 0,
        cacheRead: stats.totalTokens.cacheRead || 0,
      },
      blackboardTokens: blackboard.getTotalTokens(),
      model,
      success,
      error,
    };

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    logger.info({ metadataPath }, 'Saved metadata');
  }

  /**
   * Save tool call history
   */
  async saveToolCalls(toolCalls: ToolCallRecord[]): Promise<void> {
    const toolCallsPath = join(this.analysisPath, 'tool-calls.json');
    await writeFile(toolCallsPath, JSON.stringify(toolCalls, null, 2), 'utf-8');
    logger.info({ toolCallsPath, count: toolCalls.length }, 'Saved tool calls');
  }

  /**
   * Save summary
   */
  async saveSummary(summary: string): Promise<void> {
    const summaryPath = join(this.analysisPath, 'summary.md');
    await writeFile(summaryPath, summary, 'utf-8');
    logger.info({ summaryPath }, 'Saved summary');
  }

  /**
   * Get the analysis ID
   */
  getAnalysisId(): string {
    return this.analysisId;
  }

  /**
   * Get the analysis path
   */
  getAnalysisPath(): string {
    return this.analysisPath;
  }
}
