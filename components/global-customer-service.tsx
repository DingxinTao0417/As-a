'use client';

import { useState } from 'react';
import { AICustomerServiceChat } from './ai-chat';
import { Button } from './ui/button';
import { MessageCircle } from 'lucide-react';

export function GlobalCustomerService() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg hover:scale-110 transition-transform z-40"
          aria-label="Open customer service chat"
        >
          <MessageCircle className="w-6 h-6" />
        </Button>
      )}

      {isOpen && (
        <AICustomerServiceChat
          onClose={() => setIsOpen(false)}
          language="en"
        />
      )}
    </>
  );
}
