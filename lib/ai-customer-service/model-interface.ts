import { AIModel, AIModelConfig, Message } from './types';

/**
 * 抽象基类 - 所有AI模型的基础
 * 你可以继承这个类来实现自己的模型
 */
export abstract class BaseAIModel implements AIModel {
  protected config: AIModelConfig;
  protected initialized: boolean = false;

  constructor(config: AIModelConfig) {
    this.config = config;
  }

  abstract initialize(): Promise<void>;
  abstract generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string>;
  abstract dispose(): Promise<void>;

  protected formatMessages(messages: Message[]): string {
    return messages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n');
  }
}

/**
 * 自定义模型适配器
 * 这是你集成自己训练的模型的地方
 */
export class CustomModelAdapter extends BaseAIModel {
  private modelInstance: any = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load your trained model here
    // Example: this.modelInstance = await loadYourModel(this.config.modelPath);

    console.log('Custom model initialized:', this.config.modelName);
    this.initialized = true;
  }

  async generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Call your model to generate response
    // Example:
    // const prompt = this.formatMessages(messages);
    // const response = await this.modelInstance.generate(prompt, {
    //   maxTokens: this.config.maxTokens,
    //   temperature: this.config.temperature,
    //   context: context
    // });
    // return response;

    return 'AI response placeholder (integrate your model here)';
  }

  async dispose(): Promise<void> {
    if (this.modelInstance) {
      this.modelInstance = null;
    }
    this.initialized = false;
  }
}

export class OpenAIAdapter extends BaseAIModel {
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string> {
    throw new Error('OpenAI adapter not implemented yet');
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }
}

/**
 * DeepSeek adapter using DeepSeek's OpenAI-compatible Chat Completions API.
 * Secrets must come from server-side environment variables only.
 */
export class DeepSeekAdapter extends BaseAIModel {
  private readonly apiEndpoint: string;
  private readonly apiKey?: string;

  constructor(config: AIModelConfig) {
    super(config);
    this.apiEndpoint = config.apiEndpoint || 'https://api.deepseek.com/chat/completions';
    this.apiKey = config.apiKey;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    this.initialized = true;
  }

  async generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages: this.toDeepSeekMessages(messages, context),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DeepSeek API request failed with status ${response.status}: ${errorText.slice(0, 500)}`
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('DeepSeek API returned an empty response');
    }

    return content.trim();
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private toDeepSeekMessages(
    messages: Message[],
    context?: Record<string, any>
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const deepSeekMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const knowledgeBase = context?.knowledgeBase;
    if (Array.isArray(knowledgeBase) && knowledgeBase.length > 0) {
      deepSeekMessages.splice(1, 0, {
        role: 'system',
        content: `Relevant As'a knowledge base entries:\n${knowledgeBase
          .map((entry: any, index: number) => {
            const question = entry?.question || '';
            const answer = entry?.answer || '';
            return `${index + 1}. Q: ${question}\nA: ${answer}`;
          })
          .join('\n\n')}`,
      });
    }

    return deepSeekMessages;
  }
}
