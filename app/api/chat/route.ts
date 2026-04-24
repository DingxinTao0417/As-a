import {
  completionStreamToSSE,
  createCustomerServiceCompletion,
  detectLanguageFromText,
  sanitizeChatMessages,
  sseResponse,
} from '@/lib/ai-customer-service/production';

export async function POST(req: Request) {
  try {
    const { messages, language, pageContext } = await req.json();
    const sanitizedMessages = sanitizeChatMessages(messages);
    const latestUserMessage = [...sanitizedMessages].reverse().find((message) => message.role === 'user')?.content || '';

    if (sanitizedMessages.length === 0) {
      return Response.json(
        { error: 'messages must contain at least one message' },
        { status: 400 }
      );
    }

    const completion = await createCustomerServiceCompletion({
      messages: sanitizedMessages,
      language: language || detectLanguageFromText(latestUserMessage, 'en'),
      pageContext,
      stream: true,
    });

    return sseResponse(completionStreamToSSE(completion as AsyncIterable<any>));
  } catch (error) {
    console.error('Chat API Error:', error);
    return Response.json(
      {
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
