// AI客服系统类型定义

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  userId: string;
  messages: Message[];
  context: Record<string, any>;
  language: 'ar' | 'en';
  createdAt: Date;
  updatedAt: Date;
}

export interface AIModelConfig {
  modelName: string;
  modelPath?: string;
  apiEndpoint?: string;
  apiKey?: string;
  maxTokens: number;
  temperature: number;
  topP?: number;
}

// 模型接口 - 所有AI模型都需要实现这个接口
export interface AIModel {
  initialize(): Promise<void>;
  generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string>;
  dispose(): Promise<void>;
}

export interface KnowledgeBaseEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
  language: 'ar' | 'en';
  keywords: string[];
}
