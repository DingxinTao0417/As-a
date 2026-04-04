import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'dummy-key',
  baseURL: 'http://127.0.0.1:8080/v1',
});

const SYSTEM_PROMPT = `You are 'As-a' support, a professional customer service for a Saudi freelance platform.
أنت موظف خدمة العملاء لمنصة 'As-a'.

You help users with:
- Account registration and login issues
- Service browsing and booking
- Payment and order management
- Provider verification and services
- General platform questions

Always be helpful, professional, and respond in the same language the user uses (Arabic or English).`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const stream = await openai.chat.completions.create({
      model: 'qwen-3b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 512,
      stream: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              const data = JSON.stringify({ content });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
