import { NextRequest, NextResponse } from 'next/server';
import { AICustomerService, CustomModelAdapter } from '@/lib/ai-customer-service';

let aiService: AICustomerService | null = null;

async function getAIService(): Promise<AICustomerService> {
  if (!aiService) {
    const modelAdapter = new CustomModelAdapter({
      modelName: 'custom-model',
      modelPath: process.env.AI_MODEL_PATH || './ai_services/qwen-3b',
      maxTokens: 512,
      temperature: 0.7,
    });

    aiService = new AICustomerService(modelAdapter);
    await aiService.initialize();
  }

  return aiService;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sessionId, message, userId, language } = body;

    const service = await getAIService();

    switch (action) {
      case 'start': {
        if (!userId) {
          return NextResponse.json(
            { error: 'userId is required' },
            { status: 400 }
          );
        }

        const newSessionId = await service.startSession(
          userId,
          language || 'en'
        );

        return NextResponse.json({ sessionId: newSessionId });
      }

      case 'send': {
        if (!sessionId || !message) {
          return NextResponse.json(
            { error: 'sessionId and message are required' },
            { status: 400 }
          );
        }

        const response = await service.sendMessage(sessionId, message);
        return NextResponse.json({ response });
      }

      case 'end': {
        if (!sessionId) {
          return NextResponse.json(
            { error: 'sessionId is required' },
            { status: 400 }
          );
        }

        await service.endSession(sessionId);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('AI Customer Service Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
