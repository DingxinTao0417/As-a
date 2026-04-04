'use client';

import { useState } from 'react';
import { AICustomerServiceChat } from '@/components/ai-chat';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';

export default function ChatExample() {
  const [showChat, setShowChat] = useState(false);

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">AI Customer Service Demo</h1>
        <p className="text-muted-foreground mb-8">
          Click the button below to open the AI customer service chat.
        </p>

        <Button onClick={() => setShowChat(true)} size="lg">
          <MessageCircle className="w-5 h-5 mr-2" />
          Open Chat
        </Button>

        {showChat && (
          <AICustomerServiceChat
            onClose={() => setShowChat(false)}
            language="en"
          />
        )}
      </div>
    </div>
  );
}
