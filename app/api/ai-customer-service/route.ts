import {
  classifyFallbackIntent,
  completionStreamToSSE,
  createCustomerServiceCompletion,
  CustomerServicePageContext,
  detectLanguageFromText,
  sanitizeChatMessages,
  sseResponse,
} from '@/lib/ai-customer-service/production';
import { AICustomerService, CustomModelAdapter, DeepSeekAdapter } from '@/lib/ai-customer-service';

let aiService: AICustomerService | null = null;

async function getLegacyAIService(): Promise<AICustomerService> {
  if (!aiService) {
    const provider = process.env.AI_MODEL_PROVIDER || 'deepseek';
    const maxTokens = Number(process.env.AI_MAX_TOKENS || 512);
    const temperature = Number(process.env.AI_TEMPERATURE || 0.4);

    const modelAdapter = provider === 'deepseek'
      ? new DeepSeekAdapter({
          modelName: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          apiKey: process.env.DEEPSEEK_API_KEY,
          apiEndpoint: process.env.DEEPSEEK_API_ENDPOINT || 'https://api.deepseek.com/chat/completions',
          maxTokens,
          temperature,
        })
      : new CustomModelAdapter({
          modelName: 'custom-model',
          modelPath: process.env.AI_MODEL_PATH || './ai_services/qwen-3b',
          maxTokens,
          temperature,
        });

    aiService = new AICustomerService(modelAdapter);
    await aiService.initialize();
  }

  return aiService;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      action,
      sessionId,
      message,
      messages,
      userId,
      language,
      stream,
      pageContext,
    }: {
      action?: 'start' | 'send' | 'end';
      sessionId?: string;
      message?: string;
      messages?: unknown;
      userId?: string;
      language?: 'ar' | 'en';
      stream?: boolean;
      pageContext?: CustomerServicePageContext;
    } = body;

    switch (action) {
      case 'start': {
        if (!userId) {
          return jsonError('userId is required');
        }

        const service = await getLegacyAIService();
        const newSessionId = await service.startSession(userId, language || 'en');
        return Response.json({ sessionId: newSessionId });
      }

      case 'send': {
        if (!message && !messages) {
          return jsonError('message or messages is required');
        }

        const latestLanguage = language || detectLanguageFromText(message || '', 'en');
        const sanitizedMessages = messages
          ? sanitizeChatMessages(messages)
          : [{ role: 'user' as const, content: message || '' }];

        if (stream) {
          const completion = await createCustomerServiceCompletion({
            messages: sanitizedMessages,
            language: latestLanguage,
            pageContext,
            stream: true,
          });

          return sseResponse(completionStreamToSSE(completion as AsyncIterable<any>));
        }

        if (sessionId) {
          const service = await getLegacyAIService();
          const response = await service.sendMessage(sessionId, message || sanitizedMessages.at(-1)?.content || '');
          return Response.json({ response });
        }

        const completion = await createCustomerServiceCompletion({
          messages: sanitizedMessages,
          language: latestLanguage,
          pageContext,
          stream: false,
        });
        const content = (completion as any).choices?.[0]?.message?.content;
        return Response.json({ response: content || '' });
      }

      case 'end': {
        if (!sessionId) {
          return jsonError('sessionId is required');
        }

        const service = await getLegacyAIService();
        await service.endSession(sessionId);
        return Response.json({ success: true });
      }

      default: {
        if (messages) {
          const sanitizedMessages = sanitizeChatMessages(messages);
          const latestUserMessage = [...sanitizedMessages].reverse().find((item) => item.role === 'user')?.content || '';
          const completion = await createCustomerServiceCompletion({
            messages: sanitizedMessages,
            language: language || detectLanguageFromText(latestUserMessage, 'en'),
            pageContext,
            stream: true,
          });
          return sseResponse(completionStreamToSSE(completion as AsyncIterable<any>));
        }

        return jsonError('Invalid action');
      }
    }
  } catch (error) {
    console.error('AI Customer Service Error:', error);
    return Response.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({
    status: 'ok',
    provider: process.env.AI_MODEL_PROVIDER || 'deepseek',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    fallbackRules: [
      classifyFallbackIntent('payment failed'),
      classifyFallbackIntent('refund dispute'),
      classifyFallbackIntent('password was hacked'),
    ].filter(Boolean),
  });
}
