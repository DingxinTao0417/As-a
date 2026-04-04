# AI Customer Service Integration Guide

## Overview

This AI customer service system provides a flexible framework for integrating your custom-trained LLM model. The architecture is designed to be modular and extensible.

## Architecture

```
lib/ai-customer-service/
├── types.ts                 # Type definitions
├── model-interface.ts       # Model adapters (integrate your model here)
├── session-manager.ts       # Session and context management
├── knowledge-base.ts        # Knowledge base for FAQ
├── service.ts              # Main AI service orchestrator
└── index.ts                # Public exports

app/api/ai-customer-service/
└── route.ts                # API endpoint

components/
└── ai-customer-service-chat.tsx  # Chat UI component
```

## Integration Steps

### 1. Integrate Your Trained Model

Edit `lib/ai-customer-service/model-interface.ts`:

```typescript
export class CustomModelAdapter extends BaseAIModel {
  private modelInstance: any = null;

  async initialize(): Promise<void> {
    // Load your model here
    // Example:
    // this.modelInstance = await loadModel(this.config.modelPath);
  }

  async generateResponse(
    messages: Message[],
    context?: Record<string, any>
  ): Promise<string> {
    // Call your model
    // Example:
    // const prompt = this.formatMessages(messages);
    // return await this.modelInstance.generate(prompt);
  }
}
```

### 2. Configure Environment Variables

Add to `.env.local`:

```bash
AI_MODEL_PATH=./ai_services/qwen-3b
```

### 3. Use the Chat Component

```typescript
import { AICustomerServiceChat } from '@/components/ai-customer-service-chat';

export default function Page() {
  return (
    <AICustomerServiceChat
      userId="user-123"
      language="en"
    />
  );
}
```

### 4. API Endpoints

**Start Session:**
```bash
POST /api/ai-customer-service
{
  "action": "start",
  "userId": "user-123",
  "language": "en"
}
```

**Send Message:**
```bash
POST /api/ai-customer-service
{
  "action": "send",
  "sessionId": "session_xxx",
  "message": "Hello"
}
```

**End Session:**
```bash
POST /api/ai-customer-service
{
  "action": "end",
  "sessionId": "session_xxx"
}
```

## Features

- Session management with context preservation
- Multi-language support (Arabic/English)
- Knowledge base integration
- Extensible model interface
- Real-time chat UI
- Auto-scroll and typing indicators

## Next Steps

1. Implement your model loading logic in `CustomModelAdapter`
2. Add business-specific knowledge to `KnowledgeBase`
3. Customize system prompts in `service.ts`
4. Style the chat component to match your design
5. Add database persistence for chat history (optional)
