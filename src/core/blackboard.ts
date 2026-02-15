import { estimateTokens } from '../utils/token-counter.js';

export interface BlackboardSection {
  name: string;
  content: string;
  tokens: number;
  updatedAt: Date;
}

export interface BlackboardData {
  id: string;
  targetPath: string;
  sections: Record<string, BlackboardSection>;
  totalTokens: number;
  maxTokens: number;
  createdAt: string;
  updatedAt: string;
}

export class Blackboard {
  private id: string;
  private targetPath: string;
  private sections: Map<string, BlackboardSection>;
  private maxTokens: number;
  private createdAt: Date;
  private updatedAt: Date;

  /** Hard cap: 20% overflow above maxTokens for critical late findings */
  private static readonly OVERFLOW_FACTOR = 1.2;

  constructor(targetPath: string, maxTokens: number = 4000, id?: string) {
    this.id = id || this.generateId();
    this.targetPath = targetPath;
    this.sections = new Map();
    this.maxTokens = maxTokens;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  private generateId(): string {
    return `bb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create a blackboard pre-populated with sections from a parent context.
   * Used by orchestrators to pass context to sub-agents.
   */
  static seed(
    targetPath: string,
    sections: Record<string, string>,
    maxTokens?: number
  ): Blackboard {
    const bb = new Blackboard(targetPath, maxTokens);
    const failures: string[] = [];
    for (const [name, content] of Object.entries(sections)) {
      const result = bb.updateSection(name, content, true);
      if (!result.success) {
        failures.push(`${name}: ${result.message}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Blackboard seed failed for ${failures.length} section(s):\n${failures.join('\n')}`
      );
    }
    return bb;
  }

  /**
   * Update a section with new content.
   * Sections are created dynamically on first write.
   */
  updateSection(
    sectionName: string,
    content: string,
    replace: boolean = false
  ): { success: boolean; message: string } {
    const currentSection = this.sections.get(sectionName);

    let newContent: string;

    if (replace || !currentSection) {
      newContent = content;
    } else {
      newContent = currentSection.content
        ? `${currentSection.content}\n\n${content}`
        : content;
    }

    const newTokens = estimateTokens(newContent);

    // Calculate new total
    const currentTotal = this.getTotalTokens();
    const currentSectionTokens = currentSection?.tokens ?? 0;
    const tokenDelta = newTokens - currentSectionTokens;
    const newTotal = currentTotal + tokenDelta;

    // Hard cap at maxTokens * OVERFLOW_FACTOR
    const hardCap = Math.floor(this.maxTokens * Blackboard.OVERFLOW_FACTOR);
    if (newTotal > hardCap) {
      return {
        success: false,
        message: `Update would exceed hard token limit (${newTotal} > ${hardCap}). Consider replacing content or removing other sections.`,
      };
    }

    this.sections.set(sectionName, {
      name: sectionName,
      content: newContent,
      tokens: newTokens,
      updatedAt: new Date(),
    });

    this.updatedAt = new Date();

    return {
      success: true,
      message: `Section '${sectionName}' updated (${newTokens} tokens)`,
    };
  }

  /**
   * Get content from a specific section
   */
  getSection(sectionName: string): string {
    return this.sections.get(sectionName)?.content || '';
  }

  /**
   * Get all sections as a formatted string for context
   */
  getAllSectionsForContext(): string {
    const parts: string[] = ['=== BLACKBOARD ===\n'];

    for (const [name, section] of this.sections.entries()) {
      if (section.content) {
        parts.push(`## ${name.toUpperCase()}`);
        parts.push(section.content);
        parts.push('');
      }
    }

    parts.push('=== END BLACKBOARD ===');
    return parts.join('\n');
  }

  /**
   * Get total tokens used across all sections
   */
  getTotalTokens(): number {
    let total = 0;
    for (const section of this.sections.values()) {
      total += section.tokens;
    }
    return total;
  }

  /**
   * Get remaining token capacity (reports against maxTokens, not overflow)
   */
  getRemainingTokens(): number {
    return Math.max(0, this.maxTokens - this.getTotalTokens());
  }

  /**
   * Get all populated sections
   */
  getSections(): BlackboardSection[] {
    return Array.from(this.sections.values()).filter(
      (section) => section.content.length > 0
    );
  }

  /**
   * Get section names that have content
   */
  getSectionNames(): string[] {
    return Array.from(this.sections.entries())
      .filter(([, section]) => section.content.length > 0)
      .map(([name]) => name);
  }

  /**
   * Remove a section entirely
   */
  removeSection(sectionName: string): boolean {
    const deleted = this.sections.delete(sectionName);
    if (deleted) {
      this.updatedAt = new Date();
    }
    return deleted;
  }

  /**
   * Export blackboard as markdown
   */
  toMarkdown(): string {
    const lines: string[] = [];

    lines.push('# Analysis Blackboard\n');
    lines.push(`**Target:** ${this.targetPath}`);
    lines.push(
      `**Tokens:** ${this.getTotalTokens()} / ${this.maxTokens} (${Math.round((this.getTotalTokens() / this.maxTokens) * 100)}%)`
    );
    lines.push(`**Last Updated:** ${this.updatedAt.toISOString()}\n`);
    lines.push('---\n');

    for (const [name, section] of this.sections.entries()) {
      if (section.content) {
        lines.push(`## ${this.formatSectionName(name)}\n`);
        lines.push(section.content);
        lines.push(
          `\n*${section.tokens} tokens, updated ${section.updatedAt.toLocaleString()}*\n`
        );
        lines.push('---\n');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format section name for display
   */
  private formatSectionName(name: string): string {
    return name
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Serialize to JSON
   */
  toJSON(): BlackboardData {
    const sectionsObj: Record<string, BlackboardSection> = {};
    for (const [key, value] of this.sections.entries()) {
      sectionsObj[key] = value;
    }

    return {
      id: this.id,
      targetPath: this.targetPath,
      sections: sectionsObj,
      totalTokens: this.getTotalTokens(),
      maxTokens: this.maxTokens,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Create from JSON data
   */
  static fromJSON(data: BlackboardData): Blackboard {
    const blackboard = new Blackboard(data.targetPath, data.maxTokens, data.id);

    blackboard.createdAt = new Date(data.createdAt);
    blackboard.updatedAt = new Date(data.updatedAt);

    for (const [key, sectionData] of Object.entries(data.sections)) {
      if (sectionData.content) {
        blackboard.sections.set(key, {
          ...sectionData,
          updatedAt: new Date(sectionData.updatedAt),
        });
      }
    }

    return blackboard;
  }

  getId(): string {
    return this.id;
  }

  getTargetPath(): string {
    return this.targetPath;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }
}
