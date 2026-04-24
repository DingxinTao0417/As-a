import { KnowledgeBaseEntry } from './types';

export class KnowledgeBase {
  private entries: Map<string, KnowledgeBaseEntry> = new Map();

  addEntry(entry: KnowledgeBaseEntry): void {
    this.entries.set(entry.id, entry);
  }

  searchByKeywords(keywords: string[], language: 'ar' | 'en'): KnowledgeBaseEntry[] {
    const results: KnowledgeBaseEntry[] = [];

    for (const entry of Array.from(this.entries.values())) {
      if (entry.language !== language) continue;

      const matchScore = this.calculateMatchScore(keywords, entry.keywords);
      if (matchScore > 0) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => {
      const scoreA = this.calculateMatchScore(keywords, a.keywords);
      const scoreB = this.calculateMatchScore(keywords, b.keywords);
      return scoreB - scoreA;
    });
  }

  searchByCategory(category: string, language: 'ar' | 'en'): KnowledgeBaseEntry[] {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.category === category && entry.language === language
    );
  }

  getAll(language?: 'ar' | 'en'): KnowledgeBaseEntry[] {
    const entries = Array.from(this.entries.values());
    return language ? entries.filter((entry) => entry.language === language) : entries;
  }

  private calculateMatchScore(keywords1: string[], keywords2: string[]): number {
    const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
    const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

    let matches = 0;
    for (const keyword of Array.from(set1)) {
      if (set2.has(keyword)) {
        matches++;
      }
    }

    return matches;
  }

  loadDefaultEntries(): void {
    const defaultEntries: KnowledgeBaseEntry[] = [
      {
        id: 'en-account-create',
        question: 'How do I create an account?',
        answer: 'Choose Sign Up, enter your email and basic profile details, then follow the verification steps shown in the app. Do not share passwords or verification codes with support chat.',
        category: 'account',
        language: 'en',
        keywords: ['account', 'signup', 'sign', 'register', 'create', 'email', 'verification', 'login'],
      },
      {
        id: 'ar-account-create',
        question: 'كيف أنشئ حساباً؟',
        answer: 'اختر إنشاء حساب، أدخل بريدك الإلكتروني وبياناتك الأساسية، ثم اتبع خطوات التحقق داخل التطبيق. لا تشارك كلمة المرور أو رموز التحقق داخل المحادثة.',
        category: 'account',
        language: 'ar',
        keywords: ['حساب', 'تسجيل', 'إنشاء', 'دخول', 'بريد', 'تحقق', 'رمز'],
      },
      {
        id: 'en-provider-register',
        question: 'How do I register as a provider?',
        answer: 'Go to Become a Provider or Provider Registration, complete your public profile, add your services, categories, languages, and availability, then submit for review if verification is required.',
        category: 'provider_onboarding',
        language: 'en',
        keywords: ['provider', 'register', 'onboarding', 'verification', 'profile', 'service', 'availability', 'categories'],
      },
      {
        id: 'ar-provider-register',
        question: 'كيف أسجل كمقدم خدمة؟',
        answer: 'انتقل إلى التسجيل كمقدم خدمة، أكمل ملفك العام، أضف خدماتك وتصنيفاتك ولغاتك وأوقات التوفر، ثم أرسل الطلب للمراجعة إذا كان التحقق مطلوباً.',
        category: 'provider_onboarding',
        language: 'ar',
        keywords: ['مقدم', 'خدمة', 'تسجيل', 'توثيق', 'ملف', 'تصنيفات', 'توفر'],
      },
      {
        id: 'en-find-provider',
        question: 'How do I find the right provider?',
        answer: 'Browse services by category, use search and filters, compare provider ratings, completed projects, response time, languages, and profile details before starting a conversation.',
        category: 'service_discovery',
        language: 'en',
        keywords: ['find', 'provider', 'search', 'browse', 'category', 'filter', 'rating', 'languages', 'service'],
      },
      {
        id: 'ar-find-provider',
        question: 'كيف أجد مقدم الخدمة المناسب؟',
        answer: 'تصفح الخدمات حسب التصنيف، استخدم البحث والفلاتر، وقارن التقييمات وعدد المشاريع ووقت الاستجابة واللغات وتفاصيل الملف قبل بدء المحادثة.',
        category: 'service_discovery',
        language: 'ar',
        keywords: ['أجد', 'مقدم', 'خدمة', 'بحث', 'تصنيف', 'فلتر', 'تقييم', 'لغات'],
      },
      {
        id: 'en-orders',
        question: 'How do orders work?',
        answer: 'After a seeker and provider agree on the scope, an order can be created with the service name, description, amount, and status. Track order progress from your Orders or History pages.',
        category: 'orders',
        language: 'en',
        keywords: ['order', 'orders', 'status', 'scope', 'amount', 'history', 'progress', 'completed', 'cancelled'],
      },
      {
        id: 'ar-orders',
        question: 'كيف تعمل الطلبات؟',
        answer: 'بعد اتفاق طالب الخدمة ومقدم الخدمة على النطاق، يمكن إنشاء طلب باسم الخدمة والوصف والمبلغ والحالة. تابع تقدم الطلب من صفحة الطلبات أو السجل.',
        category: 'orders',
        language: 'ar',
        keywords: ['طلب', 'طلبات', 'حالة', 'نطاق', 'مبلغ', 'سجل', 'مكتمل', 'ملغي'],
      },
      {
        id: 'en-payments',
        question: 'How do payments work?',
        answer: 'Payment status is shown on the order. If payment fails or money appears deducted while the order is not marked paid, do not retry repeatedly; save the order ID and contact support for review.',
        category: 'payments',
        language: 'en',
        keywords: ['payment', 'pay', 'paid', 'failed', 'declined', 'card', 'money', 'deducted', 'checkout', 'sar'],
      },
      {
        id: 'ar-payments',
        question: 'كيف يعمل الدفع؟',
        answer: 'تظهر حالة الدفع داخل الطلب. إذا فشل الدفع أو تم خصم مبلغ ولم يظهر الطلب كمدفوع، لا تكرر المحاولة كثيراً؛ احتفظ برقم الطلب وتواصل مع الدعم للمراجعة.',
        category: 'payments',
        language: 'ar',
        keywords: ['دفع', 'مدفوع', 'فشل', 'بطاقة', 'خصم', 'مبلغ', 'ريال', 'طلب'],
      },
      {
        id: 'en-refunds',
        question: 'Can I get a refund?',
        answer: 'Refunds and disputes require human review. Provide the order ID, a short explanation, and any relevant non-sensitive details through the official support channel. The AI assistant cannot approve refunds.',
        category: 'refunds',
        language: 'en',
        keywords: ['refund', 'dispute', 'cancel', 'money', 'chargeback', 'return', 'complaint'],
      },
      {
        id: 'ar-refunds',
        question: 'هل يمكنني استرداد المبلغ؟',
        answer: 'طلبات الاسترداد والنزاعات تحتاج مراجعة بشرية. قدّم رقم الطلب وشرحاً مختصراً وتفاصيل غير حساسة عبر قناة الدعم الرسمية. المساعد الآلي لا يوافق على الاسترداد.',
        category: 'refunds',
        language: 'ar',
        keywords: ['استرداد', 'نزاع', 'إلغاء', 'مبلغ', 'شكوى', 'إرجاع'],
      },
      {
        id: 'en-messages',
        question: 'How do conversations work?',
        answer: 'Use messages to discuss scope, timeline, and requirements before creating or accepting an order. Keep communication on-platform so support can help if an order issue needs review.',
        category: 'messages',
        language: 'en',
        keywords: ['message', 'chat', 'conversation', 'scope', 'timeline', 'requirements'],
      },
      {
        id: 'ar-messages',
        question: 'كيف تعمل المحادثات؟',
        answer: 'استخدم الرسائل لمناقشة النطاق والمدة والمتطلبات قبل إنشاء أو قبول الطلب. يُفضّل إبقاء التواصل داخل المنصة حتى يستطيع الدعم المساعدة عند وجود مشكلة.',
        category: 'messages',
        language: 'ar',
        keywords: ['رسالة', 'محادثة', 'تواصل', 'نطاق', 'مدة', 'متطلبات'],
      },
      {
        id: 'en-security',
        question: 'What should I do if my account may be compromised?',
        answer: 'Do not share passwords, OTPs, or card details. Reset your password through the official login flow and contact support if you notice unfamiliar orders, messages, or profile changes.',
        category: 'security',
        language: 'en',
        keywords: ['security', 'password', 'otp', 'hacked', 'compromised', 'verification', 'code', 'login'],
      },
      {
        id: 'ar-security',
        question: 'ماذا أفعل إذا كان حسابي مخترقاً؟',
        answer: 'لا تشارك كلمة المرور أو رموز OTP أو بيانات البطاقة. أعد تعيين كلمة المرور من المسار الرسمي وتواصل مع الدعم إذا لاحظت طلبات أو رسائل أو تغييرات غير معروفة.',
        category: 'security',
        language: 'ar',
        keywords: ['أمان', 'كلمة', 'مرور', 'رمز', 'مخترق', 'تحقق', 'دخول'],
      },
      {
        id: 'en-human-support',
        question: 'How do I reach human support?',
        answer: 'Ask to contact human support and include only non-sensitive context such as your issue type, order ID, and what you already tried. Do not include passwords, OTPs, or full payment details.',
        category: 'handoff',
        language: 'en',
        keywords: ['human', 'support', 'agent', 'representative', 'ticket', 'complaint', 'help'],
      },
      {
        id: 'ar-human-support',
        question: 'كيف أتواصل مع الدعم البشري؟',
        answer: 'اطلب التواصل مع الدعم البشري واذكر معلومات غير حساسة فقط مثل نوع المشكلة ورقم الطلب وما جرّبته. لا ترسل كلمات مرور أو رموز تحقق أو بيانات دفع كاملة.',
        category: 'handoff',
        language: 'ar',
        keywords: ['دعم', 'بشري', 'موظف', 'تذكرة', 'شكوى', 'مساعدة'],
      },
    ];

    defaultEntries.forEach((entry) => this.addEntry(entry));
  }
}
