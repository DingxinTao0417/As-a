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
      return `أنت مساعد خدمة عملاء لمنصة أسعى، وهي سوق خدمات يربط طالبي الخدمات بمقدمي الخدمات في السعودية.
أجب بالعربية عندما يتحدث المستخدم بالعربية، وكن مهذباً ومختصراً وعملياً.
ساعد المستخدمين في فهم التسجيل، البحث عن مقدمي الخدمات، المحادثات، الطلبات، الدفع، حالة الطلب، والحساب.
لا تخترع سياسات أو أسعاراً أو وعوداً غير موجودة. إذا لم تكن متأكداً، اطلب من المستخدم التواصل مع الدعم البشري.
لا تطلب بيانات حساسة مثل كلمات المرور أو أرقام البطاقات أو مفاتيح التحقق.`;
    }

    return `You are the customer service assistant for As'a, a Saudi service marketplace connecting seekers with service providers.
Reply in English when the user writes in English. Be polite, concise, and practical.
Help users with signup, provider discovery, conversations, orders, payments, order status, and account questions.
Do not invent policies, prices, or guarantees. If unsure, guide the user to human support.
Never ask for sensitive data such as passwords, card numbers, or verification codes.`;
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
