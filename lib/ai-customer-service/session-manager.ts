import { ChatSession, Message } from './types';

export class SessionManager {
  private sessions: Map<string, ChatSession> = new Map();
  private readonly maxContextLength = 10;

  createSession(userId: string, language: 'ar' | 'en' = 'en'): ChatSession {
    const session: ChatSession = {
      id: this.generateSessionId(),
      userId,
      messages: [],
      context: {},
      language,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.messages.push(message);
    session.updatedAt = new Date();

    if (session.messages.length > this.maxContextLength) {
      session.messages = session.messages.slice(-this.maxContextLength);
    }
  }

  updateContext(sessionId: string, context: Record<string, any>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.context = { ...session.context, ...context };
    session.updatedAt = new Date();
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
