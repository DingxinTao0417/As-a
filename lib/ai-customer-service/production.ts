import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { KnowledgeBase } from './knowledge-base';
import { ChatSession, Message } from './types';

export type CustomerServiceLanguage = 'ar' | 'en';

export type CustomerServiceChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type CustomerServicePageContext = {
  pagePath?: string;
  pageTitle?: string;
  userRole?: 'guest' | 'seeker' | 'provider' | 'admin' | 'both';
  providerId?: string;
  serviceId?: string;
  orderId?: string;
  locale?: CustomerServiceLanguage;
};

export type BusinessContext = {
  user: {
    authStatus: 'guest' | 'authenticated';
    id?: string;
    email?: string;
    role?: string;
    userType?: string;
    isAdmin?: boolean;
  };
  provider?: {
    id?: string;
    displayName?: string;
    status?: string;
    onboardingCompleted?: boolean;
    categories?: unknown;
  };
  recentOrders: Array<{
    id: string;
    status: string | null;
    currency: string | null;
    amountCents: number | null;
    createdAt: string | null;
    serviceName: string | null;
  }>;
  page: CustomerServicePageContext;
};

export type CustomerServiceCompletionOptions = {
  messages: CustomerServiceChatMessage[];
  language?: CustomerServiceLanguage;
  session?: ChatSession;
  pageContext?: CustomerServicePageContext;
  stream?: boolean;
};

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com',
});

const knowledgeBase = new KnowledgeBase();
knowledgeBase.loadDefaultEntries();

export function detectLanguageFromText(text: string, fallback: CustomerServiceLanguage = 'en'): CustomerServiceLanguage {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : fallback;
}

export function sanitizeChatMessages(messages: unknown): CustomerServiceChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message): message is Partial<CustomerServiceChatMessage> => {
      return Boolean(
        message &&
          typeof message === 'object' &&
          'role' in message &&
          'content' in message &&
          typeof (message as Partial<CustomerServiceChatMessage>).content === 'string'
      );
    })
    .map((message) => {
      const role: CustomerServiceChatMessage['role'] =
        message.role === 'assistant' || message.role === 'system' ? message.role : 'user';

      return {
        role,
        content: String(message.content).slice(0, 4000),
      };
    })
    .slice(-20);
}

export function extractKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const english = normalized.match(/[a-z0-9']{3,}/g) || [];
  const arabic = normalized.match(/[\u0600-\u06FF]{2,}/g) || [];
  return Array.from(new Set([...english, ...arabic]));
}

export function classifyFallbackIntent(text: string): string | null {
  const normalized = text.toLowerCase();

  const rules: Array<{ id: string; patterns: RegExp[] }> = [
    {
      id: 'payment_failure',
      patterns: [/payment.*(failed|declined|error|stuck)/, /card.*(declined|failed)/, /دفع/, /بطاقة/, /فشل/],
    },
    {
      id: 'refund_dispute',
      patterns: [/refund|chargeback|dispute|money back|cancel.*paid/, /استرداد|نزاع|فلوسي|إرجاع/],
    },
    {
      id: 'account_security',
      patterns: [/password|otp|verification code|hacked|stolen|login code|2fa/, /كلمة المرور|رمز|تحقق|مخترق/],
    },
    {
      id: 'policy_uncertain',
      patterns: [/guarantee|legal|lawsuit|compensation|sama|tax|contract/, /قانون|تعويض|ضمان|ساما|ضريبة/],
    },
    {
      id: 'human_handoff',
      patterns: [/human|agent|representative|support ticket|complaint/, /موظف|إنسان|شكوى|تذكرة|الدعم/],
    },
  ];

  return rules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))?.id || null;
}

export function buildFallbackInstruction(intent: string | null, language: CustomerServiceLanguage): string {
  if (!intent) {
    return language === 'ar'
      ? 'إذا لم تكن الإجابة مؤكدة من السياق أو قاعدة المعرفة، قل ذلك بوضوح ووجّه المستخدم للتواصل مع الدعم البشري بدلاً من التخمين.'
      : 'If the answer is not supported by context or the knowledge base, say so clearly and guide the user to human support instead of guessing.';
  }

  const english: Record<string, string> = {
    payment_failure: 'Payment failure fallback: do not promise payment capture, reversal, or refunds. Ask the user to verify payment status in Orders, avoid sharing card details, and escalate to human support if money was deducted or the status is unclear.',
    refund_dispute: 'Refund/dispute fallback: do not approve or reject refunds. Explain that paid-order disputes need human review, ask for the order ID only if they are comfortable sharing it in-app, and route to a support ticket.',
    account_security: 'Account security fallback: never ask for passwords, OTPs, full card numbers, or private codes. Tell the user to reset password through official flows and contact support if they suspect compromise.',
    policy_uncertain: 'Policy/legal fallback: do not invent legal, tax, SAMA, compensation, or guarantee claims. Provide general guidance only and escalate to human support for official answers.',
    human_handoff: 'Human handoff fallback: acknowledge the request and explain that the conversation should be escalated to the support team. Collect only non-sensitive context such as topic and order ID.',
  };

  const arabic: Record<string, string> = {
    payment_failure: 'قاعدة فشل الدفع: لا تعد المستخدم بسحب أو عكس أو استرداد المبلغ. اطلب منه مراجعة حالة الطلب، وعدم مشاركة بيانات البطاقة، وصعّد للدعم البشري إذا تم خصم مبلغ أو كانت الحالة غير واضحة.',
    refund_dispute: 'قاعدة الاسترداد/النزاع: لا توافق أو ترفض الاسترداد. وضّح أن نزاعات الطلبات المدفوعة تحتاج مراجعة بشرية، واطلب رقم الطلب فقط داخل المنصة إذا كان المستخدم مرتاحاً، ثم وجّه لتذكرة دعم.',
    account_security: 'قاعدة أمان الحساب: لا تطلب كلمات مرور أو رموز OTP أو أرقام بطاقات كاملة أو رموز خاصة. وجّه المستخدم لاستخدام مسار إعادة تعيين كلمة المرور الرسمي والتواصل مع الدعم عند الاشتباه بالاختراق.',
    policy_uncertain: 'قاعدة السياسة/القانون: لا تخترع ادعاءات قانونية أو ضريبية أو ضمانات أو تعويضات أو تفاصيل تنظيمية. قدّم إرشاداً عاماً فقط وصعّد للدعم البشري للإجابات الرسمية.',
    human_handoff: 'قاعدة التحويل للبشر: اعترف بطلب المستخدم واشرح أن المحادثة يجب أن تُحوّل لفريق الدعم. اجمع سياقاً غير حساس فقط مثل الموضوع ورقم الطلب.',
  };

  return language === 'ar' ? arabic[intent] : english[intent];
}

export async function getBusinessContext(pageContext: CustomerServicePageContext = {}): Promise<BusinessContext> {
  const context: BusinessContext = {
    user: { authStatus: 'guest' },
    recentOrders: [],
    page: pageContext,
  };

  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (!user) return context;

    context.user = {
      authStatus: 'authenticated',
      id: user.id,
      email: user.email || undefined,
    };

    const { data: profile } = await supabase
      .from('profiles')
      .select('id,email,role,user_type,is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      context.user.role = profile.role || undefined;
      context.user.userType = profile.user_type || undefined;
      context.user.isAdmin = Boolean(profile.is_admin);
    }

    const { data: provider } = await supabase
      .from('providers')
      .select('id,display_name,name_en,name_ar,stripe_account_status,stripe_onboarding_completed,categories')
      .eq('user_id', user.id)
      .maybeSingle();

    if (provider) {
      context.provider = {
        id: provider.id,
        displayName: provider.display_name || provider.name_en || provider.name_ar || undefined,
        status: provider.stripe_account_status || undefined,
        onboardingCompleted: Boolean(provider.stripe_onboarding_completed),
        categories: provider.categories,
      };
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('id,status,currency,amount_cents,created_at,service_name_en,service_name_ar')
      .or(`seeker_id.eq.${user.id},provider_id.eq.${context.provider?.id || '00000000-0000-0000-0000-000000000000'}`)
      .order('created_at', { ascending: false })
      .limit(3);

    if (orders) {
      context.recentOrders = orders.map((order: any) => ({
        id: order.id,
        status: order.status,
        currency: order.currency,
        amountCents: order.amount_cents,
        createdAt: order.created_at,
        serviceName: pageContext.locale === 'ar' ? order.service_name_ar : order.service_name_en,
      }));
    }
  } catch (error) {
    console.error('AI customer service context lookup failed:', error);
  }

  return context;
}

export function buildSystemPrompt(params: {
  language: CustomerServiceLanguage;
  knowledgeText: string;
  businessContext: BusinessContext;
  fallbackInstruction: string;
}): string {
  const { language, knowledgeText, businessContext, fallbackInstruction } = params;

  const shared = `You are the production customer service assistant for As'a / أسعى, a Saudi Arabic-English service marketplace connecting service seekers with service providers.

Core rules:
- Reply in the same language as the user. If mixed, prefer the user's latest message language.
- Be concise, practical, warm, and support-oriented.
- Use the knowledge base and business context below. Do not invent unsupported platform rules.
- Never request passwords, OTP codes, full card numbers, API keys, private keys, or sensitive personal documents in chat.
- If the user needs official review, payment investigation, refund/dispute handling, legal/compliance answers, or account-security help, escalate to human support.
- If business context is missing, explain what the user can check in the app rather than pretending to see private data.

Fallback rule:
${fallbackInstruction}

Business context:
${JSON.stringify(businessContext, null, 2)}

Knowledge base:
${knowledgeText || 'No matching knowledge entries were found. Use only general safe guidance and ask clarifying questions.'}`;

  if (language === 'ar') {
    return `${shared}

تعليمات اللغة العربية:
- أجب بالعربية الواضحة عندما تكون رسالة المستخدم بالعربية.
- استخدم مصطلحات سعودية مناسبة مثل: مقدم الخدمة، طالب الخدمة، الطلب، حالة الطلب، ريال سعودي.
- لا تستخدم وعوداً قطعية بخصوص الدفع أو الاسترداد أو التحقق إلا إذا كانت موجودة صراحة في السياق.`;
  }

  return `${shared}

English style instructions:
- Use clear customer-support English.
- Use Saudi-market terms when relevant: provider, seeker, order, SAR, verification, payment status.
- Avoid absolute promises about payment, refunds, verification, or policy unless directly supported by context.`;
}

export async function createCustomerServiceCompletion(options: CustomerServiceCompletionOptions) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const messages = sanitizeChatMessages(options.messages);
  if (messages.length === 0) {
    throw new Error('messages must contain at least one message');
  }

  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const language = options.language || options.pageContext?.locale || detectLanguageFromText(latestUserMessage, 'en');
  const keywords = extractKeywords(latestUserMessage);
  const knowledgeEntries = knowledgeBase.searchByKeywords(keywords, language).slice(0, 6);
  const knowledgeText = knowledgeEntries
    .map((entry, index) => `${index + 1}. [${entry.category}] Q: ${entry.question}\nA: ${entry.answer}`)
    .join('\n\n');
  const fallbackIntent = classifyFallbackIntent(latestUserMessage);
  const fallbackInstruction = buildFallbackInstruction(fallbackIntent, language);
  const businessContext = await getBusinessContext({ ...options.pageContext, locale: language });
  const systemPrompt = buildSystemPrompt({ language, knowledgeText, businessContext, fallbackInstruction });

  return deepseek.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: Number(process.env.AI_TEMPERATURE || 0.35),
    max_tokens: Number(process.env.AI_MAX_TOKENS || 700),
    stream: options.stream === true,
  });
}

export function completionStreamToSSE(stream: AsyncIterable<any>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          if (content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        console.error('AI customer service stream error:', error);
        controller.error(error);
      }
    },
  });
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
