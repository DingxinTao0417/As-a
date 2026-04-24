export { AICustomerService } from './service';
export { CustomModelAdapter, OpenAIAdapter, DeepSeekAdapter, BaseAIModel } from './model-interface';
export { SessionManager } from './session-manager';
export { KnowledgeBase } from './knowledge-base';
export {
  buildFallbackInstruction,
  buildSystemPrompt,
  classifyFallbackIntent,
  completionStreamToSSE,
  createCustomerServiceCompletion,
  detectLanguageFromText,
  extractKeywords,
  getBusinessContext,
  sanitizeChatMessages,
  sseResponse,
} from './production';
export type {
  Message,
  ChatSession,
  AIModelConfig,
  AIModel,
  KnowledgeBaseEntry,
} from './types';
