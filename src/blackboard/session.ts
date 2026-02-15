import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
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

function parseSessionData(content: string): BlackboardData | null {
  try {
    return JSON.parse(content) as BlackboardData;
  } catch {
    return null;
  }
}

function toSessionMetadata(session: Blackboard): SessionMetadata {
  return {
    id: session.getId(),
    targetPath: session.getTargetPath(),
    createdAt: session.getCreatedAt().toISOString(),
    updatedAt: session.getUpdatedAt().toISOString(),
    totalTokens: session.getTotalTokens(),
  };
}

export class SessionManager {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = join(homedir(), '.blackboard-agent', 'sessions');
  }

  private async ensureSessionsDir(): Promise<void> {
    if (!existsSync(this.sessionsDir)) {
      await mkdir(this.sessionsDir, { recursive: true });
      logger.info(
        { sessionsDir: this.sessionsDir },
        'Created sessions directory'
      );
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private getJsonSessionIds(files: string[]): string[] {
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

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

  async loadSession(sessionId: string): Promise<Blackboard | null> {
    const sessionPath = this.getSessionPath(sessionId);
    if (!existsSync(sessionPath)) return null;

    const content = await readFile(sessionPath, 'utf-8').catch(() => null);
    if (content === null) return null;

    const data = parseSessionData(content);
    if (!data) {
      logger.error({ sessionId }, 'Failed to load session');
      return null;
    }

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
  }

  async findSessionByPath(targetPath: string): Promise<Blackboard | null> {
    await this.ensureSessionsDir();

    const files = await readdir(this.sessionsDir).catch(() => [] as string[]);
    const sessionIds = this.getJsonSessionIds(files);
    const sessions = await Promise.all(
      sessionIds.map((id) => this.loadSession(id))
    );

    const matching = sessions.filter(
      (s): s is Blackboard => s !== null && s.getTargetPath() === targetPath
    );
    if (matching.length === 0) return null;

    return matching.reduce((latest, s) =>
      s.getUpdatedAt() > latest.getUpdatedAt() ? s : latest
    );
  }

  async listSessions(): Promise<SessionMetadata[]> {
    await this.ensureSessionsDir();

    const files = await readdir(this.sessionsDir).catch(() => [] as string[]);
    const sessionIds = this.getJsonSessionIds(files);
    const sessions = await Promise.all(
      sessionIds.map((id) => this.loadSession(id))
    );

    return sessions
      .filter((s): s is Blackboard => s !== null)
      .map(toSessionMetadata)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(sessionId);
    if (!existsSync(sessionPath)) return false;

    const deleted = await unlink(sessionPath)
      .then(() => true)
      .catch(() => false);
    if (deleted) {
      logger.info({ sessionId }, 'Session deleted');
    } else {
      logger.error({ sessionId }, 'Failed to delete session');
    }
    return deleted;
  }
}
