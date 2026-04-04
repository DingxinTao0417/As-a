import { AIModel, Message } from './types';
import { SessionManager } from './session-manager';
import { KnowledgeBase } from './knowledge-base';

export class AICustomerService {
  private model: AIModel;
  private sessionManager: SessionManager;
  private knowledgeBase: KnowledgeBase;

  constructor(model: AIModel) {
    this.model = model;
    this.sessionManager = new SessionManager();
    this.knowledgeBase = new KnowledgeBase();
    this.knowledgeBase.loadDefaultEntries();
  }

  async initialize(): Promise<void> {
    await this.model.initialize();
  }

  async startSession(userId: string, language: 'ar' | 'en' = 'en'): Promise<string> {
    const session = this.sessionManager.createSession(userId, language);

    const systemMessage: Message = {
      role: 'system',
      content: this.getSystemPrompt(language),
      timestamp: new Date(),
    };

    this.sessionManager.addMessage(session.id, systemMessage);
    return session.id;
  }

  async sendMessage(sessionId: string, userMessage: string): Promise<string> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message: Message = {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    this.sessionManager.addMessage(sessionId, message);

    const keywords = this.extractKeywords(userMessage);
    const knowledgeEntries = this.knowledgeBase.searchByKeywords(
      keywords,
      session.language
    );

    const context = {
      knowledgeBase: knowledgeEntries.slice(0, 3),
      userLanguage: session.language,
    };

    const response = await this.model.generateResponse(
      session.messages,
      context
    );

    const assistantMessage: Message = {
      role: 'assistant',
      content: response,
      timestamp: new Date(),
    };

    this.sessionManager.addMessage(sessionId, assistantMessage);

    return response;
  }

  async endSession(sessionId: string): Promise<void> {
    this.sessionManager.deleteSession(sessionId);
  }

  private getSystemPrompt(language: 'ar' | 'en'): string {
    if (language === 'ar') {
      return 'You are a helpful customer service assistant.';
    }
    return 'You are a helpful customer service assistant.';
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3);
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}
