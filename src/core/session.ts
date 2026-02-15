import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { Blackboard, BlackboardData } from './blackboard.js';
import { logger } from '../utils/logger.js';

export interface SessionMetadata {
  id: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
}

export class SessionManager {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = join(homedir(), '.blackboard-agent', 'sessions');
  }

  /**
   * Ensure sessions directory exists
   */
  private async ensureSessionsDir(): Promise<void> {
    if (!existsSync(this.sessionsDir)) {
      await mkdir(this.sessionsDir, { recursive: true });
      logger.info(
        { sessionsDir: this.sessionsDir },
        'Created sessions directory'
      );
    }
  }

  /**
   * Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  /**
   * Save a blackboard session
   */
  async saveSession(blackboard: Blackboard): Promise<void> {
    await this.ensureSessionsDir();

    const sessionPath = this.getSessionPath(blackboard.getId());
    const data = blackboard.toJSON();

    await writeFile(sessionPath, JSON.stringify(data, null, 2), 'utf-8');

    logger.info(
      {
        sessionId: blackboard.getId(),
        targetPath: blackboard.getTargetPath(),
        tokens: blackboard.getTotalTokens(),
      },
      'Session saved'
    );
  }

  /**
   * Load a blackboard session
   */
  async loadSession(sessionId: string): Promise<Blackboard | null> {
    const sessionPath = this.getSessionPath(sessionId);

    if (!existsSync(sessionPath)) {
      return null;
    }

    try {
      const content = await readFile(sessionPath, 'utf-8');
      const data = JSON.parse(content) as BlackboardData;
      const blackboard = Blackboard.fromJSON(data);

      logger.info(
        {
          sessionId,
          targetPath: blackboard.getTargetPath(),
          tokens: blackboard.getTotalTokens(),
        },
        'Session loaded'
      );

      return blackboard;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to load session');
      return null;
    }
  }

  /**
   * Find existing session for a target path
   */
  async findSessionByPath(targetPath: string): Promise<Blackboard | null> {
    await this.ensureSessionsDir();

    try {
      const files = await readdir(this.sessionsDir);

      // Look for the most recent session for this path
      let latestSession: Blackboard | null = null;
      let latestDate = new Date(0);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const sessionId = file.replace('.json', '');
        const session = await this.loadSession(sessionId);

        if (
          session &&
          session.getTargetPath() === targetPath &&
          session.getUpdatedAt() > latestDate
        ) {
          latestSession = session;
          latestDate = session.getUpdatedAt();
        }
      }

      return latestSession;
    } catch (error) {
      logger.error({ error, targetPath }, 'Failed to find session by path');
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionMetadata[]> {
    await this.ensureSessionsDir();

    try {
      const files = await readdir(this.sessionsDir);
      const sessions: SessionMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const sessionId = file.replace('.json', '');
        const session = await this.loadSession(sessionId);

        if (session) {
          sessions.push({
            id: session.getId(),
            targetPath: session.getTargetPath(),
            createdAt: session.getCreatedAt().toISOString(),
            updatedAt: session.getUpdatedAt().toISOString(),
            totalTokens: session.getTotalTokens(),
          });
        }
      }

      // Sort by updated date, most recent first
      sessions.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return sessions;
    } catch (error) {
      logger.error({ error }, 'Failed to list sessions');
      return [];
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(sessionId);

    if (!existsSync(sessionPath)) {
      return false;
    }

    try {
      const { unlink } = await import('fs/promises');
      await unlink(sessionPath);

      logger.info({ sessionId }, 'Session deleted');
      return true;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to delete session');
      return false;
    }
  }
}
