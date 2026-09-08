/**
 * Fictional showcase data, matching the checked-in Supabase migrations.
 * Pure and deterministic: no network, filesystem, random values or credentials.
 * Auth IDs can be replaced with IDs returned by the Supabase Admin API.
 */
export const DEMO_DATASET_ID = "asaa-showcase-v1"
export const DEMO_ANCHOR = "2026-09-07T12:00:00.000Z"

const id = (kind, index) => `d3a0000${kind}-0000-4000-8000-${String(index).padStart(12, "0")}`
const markAr = (text) => `${text} — عرض تجريبي`
const markEn = (text) => `${text} — Demo`
const message = (ar, en) => `عرض تجريبي • Demo\n${ar}\n${en}`
const disclaimerAr = "هذه بيانات عرض خيالية، وليست خدمة متاحة للشراء. الأسعار والمواعيد والتقييمات أمثلة توضيحية؛ لا تمثل أعمالاً أو مؤهلات حقيقية."
const disclaimerEn = "Fictional showcase data; this service is not available for purchase. Prices, delivery times and reviews are illustrative and do not represent real work or credentials."

export const DEMO_USER_IDS = Object.freeze({
  providerDevelopment: id(1, 1),
  providerDesign: id(1, 2),
  providerMarketing: id(1, 3),
  providerWriting: id(1, 4),
  providerVideo: id(1, 5),
  providerConsulting: id(1, 6),
  seekerLaunch: id(1, 7),
  seekerStudio: id(1, 8),
  seekerOperations: id(1, 9),
})

const providerSpecs = [
  {
    key: "providerDevelopment", email: "asaa-demo-development@example.invalid", category: "development",
    name_ar: "فريق مدار الرقمي", name_en: "Madar Digital Studio",
    title_ar: "تطوير مواقع عربية وإنجليزية", title_en: "Arabic and English website development",
    bio_ar: "فريق خيالي يعمل على صفحات إطلاق المشاريع الصغيرة ولوحات المتابعة. يعرض هذا الملف كيفية الاتفاق على نطاق واضح، مراجعة نسخة أولية، ثم تسليم ملفات منظمة.",
    bio_en: "A fictional team focused on small-business launch pages and dashboards. This profile demonstrates a clear brief, a prototype review and an organized handover.",
    skills: ["Next.js", "Responsive UI", "RTL / LTR", "Accessible forms"], hourly_rate: 180,
    services: [
      {
        name_ar: "صفحة إطلاق ثنائية اللغة لمقهى جديد", name_en: "Bilingual launch page for a new café",
        description_ar: "صفحة متجاوبة لمشروع المقهى الخيالي «فسحة»: نبذة، قائمة مختصرة، معرض صور ونموذج استفسار تجريبي. يبدأ العمل بمراجعة المحتوى، ثم تصميم الصفحة بالعربية والإنجليزية وتسليم الكود مع تعليمات التشغيل. تشمل جولة تعديلات واحدة؛ الاستضافة والنطاق وخدمة البريد خارج النطاق.",
        description_en: "A responsive page for the fictional Fusha café, with an introduction, a short menu, an image gallery and a demonstration enquiry form. The package covers a content review, Arabic and English layouts, and a code handover with setup notes. Includes one revision round; hosting, a domain and email delivery are outside the scope.",
        price: 1800, price_type: "fixed", delivery_time: "5 أيام عمل / 5 business days",
        features: ["عربي وإنجليزي / Arabic and English", "تصميم للجوال / Mobile layout", "جولة تعديل واحدة / One revision round", "الكود ودليل التشغيل / Source code and setup notes"],
      },
      {
        name_ar: "لوحة متابعة حجوزات ببيانات تجريبية", name_en: "Booking dashboard with sample data",
        description_ar: "واجهة لوحة متابعة تعرض حجوزات خيالية وحالاتها، مع البحث وتصفية الحالة وعرض ملخص يومي. مناسب لعرض فكرة المنتج على الفريق قبل تطوير التكاملات. التسليم نموذج يعمل ببيانات تجريبية؛ لا يشمل ربط بوابة دفع أو بيانات عملاء حقيقية.",
        description_en: "A dashboard prototype showing fictional bookings, status filters, search and a daily summary. It helps a team review the product idea before building integrations. The handover uses sample data and excludes payment integrations and real customer records.",
        price: 2400, price_type: "starting_from", delivery_time: "7 أيام عمل / 7 business days",
        features: ["بحث وتصفية / Search and filters", "ملخص يومي / Daily overview", "حالات فارغة وتحميل / Empty and loading states", "بيانات خيالية فقط / Fictional data only"],
      },
    ],
  },
  {
    key: "providerDesign", email: "asaa-demo-design@example.invalid", category: "design",
    name_ar: "استوديو سطر", name_en: "Satr Design Studio",
    title_ar: "هوية بصرية وتجارب استخدام", title_en: "Visual identity and user experience",
    bio_ar: "استوديو خيالي يوضح رحلة تصميم هوية بسيطة وواجهات قابلة للمراجعة. يركز العرض على مخرجات محددة وتوثيق قرارات اللون والخط، دون استخدام علامات تجارية أو أعمال عملاء حقيقيين.",
    bio_en: "A fictional studio demonstrating simple brand systems and reviewable interface designs. The showcase focuses on concrete deliverables and documented color and type choices, without using real client work or trademarks.",
    skills: ["Figma", "Brand systems", "Prototyping", "Arabic typography"], hourly_rate: 160,
    services: [
      {
        name_ar: "هوية مصغرة لمتجر حرفي", name_en: "Mini identity for a craft shop",
        description_ar: "هوية أولية لمتجر «خيط» الخيالي تشمل اتجاهين للشعار، لوحة ألوان، اقتراح خط عربي وإنجليزي، وثلاثة قوالب منشورات. يختار العميل اتجاهاً واحداً لتطويره في جولتي مراجعة. التسليم ملفات SVG وPNG ودليل استخدام مختصر؛ تسجيل العلامة خارج النطاق.",
        description_en: "A starter identity for the fictional Khayt craft shop: two logo directions, a color palette, Arabic and English type suggestions, and three social post templates. One direction is developed over two review rounds. Deliverables are SVG and PNG assets and a short usage guide; trademark registration is outside the scope.",
        price: 950, price_type: "fixed", delivery_time: "4 أيام عمل / 4 business days",
        features: ["اتجاهان للشعار / Two logo directions", "ثلاثة قوالب / Three templates", "جولتا مراجعة / Two review rounds", "دليل مختصر / Short usage guide"],
      },
      {
        name_ar: "تصميم خمس شاشات لحجز المواعيد", name_en: "Five-screen appointment booking design",
        description_ar: "تصميم واجهة حجز مواعيد لمشروع خيالي: قائمة الخدمات، اختيار الموعد، تفاصيل العميل، المراجعة والتأكيد. يشمل نموذج Figma قابلاً للنقر ونسخة للجوال وملاحظات التسليم للمطور. لا يتضمن برمجة التطبيق أو اختبار مستخدمين ميدانياً.",
        description_en: "A booking flow for a fictional product: service selection, appointment time, customer details, review and confirmation. Includes a clickable Figma prototype, mobile layouts and developer handover notes. Application development and field user research are outside the scope.",
        price: 1450, price_type: "fixed", delivery_time: "6 أيام عمل / 6 business days",
        features: ["خمس شاشات / Five screens", "نموذج قابل للنقر / Clickable prototype", "تخطيط RTL / RTL layout", "ملاحظات للمطور / Developer handover"],
      },
    ],
  },
  {
    key: "providerMarketing", email: "asaa-demo-marketing@example.invalid", category: "marketing",
    name_ar: "فريق خطوة للمحتوى", name_en: "Khatwa Content Team",
    title_ar: "تخطيط محتوى المشاريع الصغيرة", title_en: "Content planning for small businesses",
    bio_ar: "فريق خيالي يعرض طريقة تحويل أهداف مشروع صغير إلى تقويم محتوى واضح. الأرقام المقترحة في العرض ليست توقعات أداء، ولا يتضمن الملف نتائج حملات أو نسب نمو منسوبة لعملاء.",
    bio_en: "A fictional team showing how small-business goals become a practical content calendar. Suggested figures are not performance forecasts, and this profile makes no claims about client campaigns or growth results.",
    skills: ["Content calendars", "Audience briefs", "Campaign planning", "Arabic copy"], hourly_rate: 120,
    services: [
      {
        name_ar: "خطة محتوى أسبوعين لإطلاق مقهى", name_en: "Two-week content plan for a café launch",
        description_ar: "خطة لإطلاق مقهى «فسحة» الخيالي: ثلاثة محاور محتوى، عشرة أفكار منشورات، أربعة نصوص فيديو قصيرة وتقويم نشر قابل للتعديل. تشمل جلسة مراجعة واحدة. لا يشمل السعر النشر أو التصوير أو ميزانية الإعلان، ولا توجد وعود بمبيعات أو وصول معين.",
        description_en: "A launch plan for the fictional Fusha café: three content themes, ten post ideas, four short-video scripts and an editable publishing calendar. Includes one review session. Posting, photography and advertising spend are excluded; no sales or reach outcome is promised.",
        price: 650, price_type: "fixed", delivery_time: "3 أيام عمل / 3 business days",
        features: ["عشر أفكار منشورات / Ten post ideas", "أربعة نصوص فيديو / Four video scripts", "تقويم قابل للتعديل / Editable calendar", "جلسة مراجعة / Review session"],
      },
      {
        name_ar: "مراجعة محتوى صفحة تعريف المشروع", name_en: "Business profile content review",
        description_ar: "مراجعة مكتبية لصفحة تعريف مشروع خيالي مع ملاحظات على وضوح الرسالة، ترتيب المعلومات ودعوات التواصل. التسليم قائمة أولويات وخمس صيغ بديلة للنصوص. يُحدد عدد الصفحات والوقت قبل البدء؛ لا تشمل الخدمة إدارة الحساب أو إعداد إعلانات.",
        description_en: "A desk review of a fictional business profile, covering message clarity, information order and contact prompts. Deliverables include a prioritized checklist and five alternative copy suggestions. Page count and time are agreed in advance; account management and ad setup are excluded.",
        price: 120, price_type: "hourly", delivery_time: "موعد متفق عليه / Scheduled session",
        features: ["ملاحظات مرتبة / Prioritized notes", "خمس صيغ بديلة / Five copy alternatives", "ملخص بعد الجلسة / Session summary", "النطاق يحدد مسبقاً / Scope agreed in advance"],
      },
    ],
  },
  {
    key: "providerWriting", email: "asaa-demo-writing@example.invalid", category: "writing",
    name_ar: "استوديو حكاية", name_en: "Hikaya Writing Studio",
    title_ar: "كتابة وتحرير عربي وإنجليزي", title_en: "Arabic and English writing and editing",
    bio_ar: "استوديو خيالي يكتب أوصاف منتجات ونصوص مواقع واضحة. توضح نماذج العرض حدود عدد الكلمات وآلية المراجعة، ولا تمثل ترجمة معتمدة أو استشارة متخصصة.",
    bio_en: "A fictional studio for clear product descriptions and website copy. Showcase packages demonstrate word limits and a review process; they are not certified translations or specialist advice.",
    skills: ["Arabic editing", "Product descriptions", "Website copy", "Plain language"], hourly_rate: 100,
    services: [
      {
        name_ar: "وصف عشرة منتجات لمتجر حرفي", name_en: "Ten craft-store product descriptions",
        description_ar: "كتابة وصف عربي وإنجليزي لعشرة منتجات خيالية، حتى 80 كلمة لكل منتج في كل لغة. يتضمن كل وصف الاستخدام والخامات وطريقة العناية بناءً على موجز تجريبي متفق عليه. تشمل جولة تحرير واحدة؛ أي مواصفات واقعية يجب أن يقدمها صاحب المتجر ويعتمدها.",
        description_en: "Arabic and English descriptions for ten fictional products, up to 80 words per product in each language. Each covers use, materials and care based on an agreed sample brief. Includes one editing round; real product specifications would need to be supplied and approved by the shop owner.",
        price: 450, price_type: "fixed", delivery_time: "3 أيام عمل / 3 business days",
        features: ["عشرة منتجات / Ten products", "نسختان لكل وصف / Two language versions", "حتى 80 كلمة / Up to 80 words each", "جولة تحرير / One editing round"],
      },
      {
        name_ar: "تحرير صفحة من نحن بالعربية", name_en: "Arabic About Us page editing",
        description_ar: "تحرير مسودة عربية حتى 600 كلمة لمشروع خيالي، مع تحسين التسلسل والوضوح واقتراح عنوانين ومقدمة بديلة. التسليم نسخة بتعليقات ونسخة نهائية. يشمل جولة مراجعة واحدة، ولا يشمل اختراع قصة تأسيس أو أرقام إنجازات.",
        description_en: "Editing an Arabic draft of up to 600 words for a fictional project, improving flow and clarity and suggesting two headings and an alternative introduction. Includes an annotated draft, a clean final version and one revision. Invented founder stories and achievement figures are excluded.",
        price: 280, price_type: "fixed", delivery_time: "يومان عمل / 2 business days",
        features: ["حتى 600 كلمة / Up to 600 words", "تعليقات تحريرية / Editorial notes", "نسخة نهائية / Clean final copy", "جولة مراجعة / One revision round"],
      },
    ],
  },
  {
    key: "providerVideo", email: "asaa-demo-video@example.invalid", category: "video",
    name_ar: "استوديو لقطة", name_en: "Laqta Motion Studio",
    title_ar: "مونتاج فيديو قصير ورسوم متحركة", title_en: "Short-video editing and motion graphics",
    bio_ar: "استوديو خيالي يوضح خطوات إعداد فيديو قصير من لقطات يملكها العميل أو مواد مصرح بها. لا يتضمن العرض أسماء عملاء أو أعمالاً منشورة، وتستخدم جميع الطلبات سيناريوهات تجريبية.",
    bio_en: "A fictional studio demonstrating short-video production from client-owned or licensed assets. The profile includes no named clients or published portfolio claims; all orders use sample scenarios.",
    skills: ["Video editing", "Subtitles", "Motion titles", "Vertical video"], hourly_rate: 150,
    services: [
      {
        name_ar: "مونتاج فيديو تعريفي عمودي مدته 30 ثانية", name_en: "30-second vertical introduction video",
        description_ar: "مونتاج فيديو لمبادرة خيالية من لقطات تجريبية يزود بها العميل، مع عناوين عربية وترجمة إنجليزية ونسخة عمودية. يشمل ترتيب المشاهد وتصحيحاً لونياً بسيطاً وجولة تعديل واحدة. التصوير والتعليق الصوتي وشراء الموسيقى خارج النطاق.",
        description_en: "An introduction video for a fictional initiative, edited from client-supplied sample footage with Arabic titles, English subtitles and a vertical export. Includes scene ordering, basic color adjustment and one revision. Filming, voice-over and music purchases are excluded.",
        price: 800, price_type: "fixed", delivery_time: "4 أيام عمل / 4 business days",
        features: ["فيديو 30 ثانية / 30-second video", "مقاس عمودي / Vertical format", "عناوين وترجمة / Titles and subtitles", "جولة تعديل / One revision round"],
      },
      {
        name_ar: "ثلاث مقدمات متحركة للمنشورات", name_en: "Three animated social post openers",
        description_ar: "ثلاث مقدمات متحركة قصيرة لهوية مشروع خيالي، مدة كل منها حتى خمس ثوانٍ. يعتمد التنفيذ على الشعار والألوان المعتمدة في الموجز. التسليم ملفات MP4 ونسخة بخلفية شفافة عند ملاءمة التصميم؛ لا يشمل تصميم شعار جديد.",
        description_en: "Three short animated openers for a fictional brand, each up to five seconds. Production follows the logo and colors agreed in the brief. Deliverables are MP4 files and a transparent-background version where the design supports it. A new logo design is excluded.",
        price: 550, price_type: "fixed", delivery_time: "3 أيام عمل / 3 business days",
        features: ["ثلاث مقدمات / Three openers", "حتى خمس ثوانٍ / Up to five seconds each", "ملفات MP4 / MP4 exports", "ألوان الموجز / Brief-based colors"],
      },
    ],
  },
  {
    key: "providerConsulting", email: "asaa-demo-consulting@example.invalid", category: "consulting",
    name_ar: "فريق بوصلة للتخطيط", name_en: "Bousla Planning Team",
    title_ar: "تنظيم المشاريع والعمليات", title_en: "Project and operations planning",
    bio_ar: "فريق خيالي يساعد في عرض طريقة تنظيم نطاق مشروع صغير ومتابعة مهامه. المحتوى توضيحي عام، ولا يمثل استشارة قانونية أو مالية أو ادعاء بخبرة معتمدة.",
    bio_en: "A fictional team demonstrating how to scope a small project and track its tasks. The content is general and illustrative; it is not legal or financial advice and does not claim accredited expertise.",
    skills: ["Project briefs", "Process mapping", "Task planning", "Workshop notes"], hourly_rate: 220,
    services: [
      {
        name_ar: "جلسة تنظيم نطاق مشروع صغير", name_en: "Small-project scoping session",
        description_ar: "جلسة تخطيط تجريبية مدتها ساعة لمناقشة أهداف مشروع خيالي وحدوده وأولوياته. التسليم موجز من صفحة واحدة وقائمة قرارات وخطوات تالية. السعر لساعة واحدة، وأي متابعة إضافية تحتاج اتفاقاً مستقلاً؛ لا تشمل الخدمة إعداد دراسة جدوى.",
        description_en: "A one-hour sample planning session to discuss a fictional project's goals, limits and priorities. Deliverables are a one-page brief, a decision log and next steps. The price covers one hour; extra follow-up needs a separate agreement. A feasibility study is excluded.",
        price: 220, price_type: "hourly", delivery_time: "موعد متفق عليه / Scheduled session",
        features: ["جلسة ساعة / One-hour session", "موجز صفحة واحدة / One-page brief", "قائمة قرارات / Decision log", "خطوات تالية / Next steps"],
      },
      {
        name_ar: "خريطة استقبال طلبات العملاء", name_en: "Customer enquiry intake process map",
        description_ar: "توثيق مسار استقبال استفسارات مشروع خيالي من الرسالة الأولى حتى إغلاق الطلب. يشمل مخططاً مبسطاً، خمس حالات للمتابعة وقالب رد أولي عربي وإنجليزي. لا يتضمن إعداد نظام CRM أو جمع بيانات عملاء حقيقية.",
        description_en: "Documenting how a fictional team handles enquiries from the first message to closure. Includes a simple process map, five tracking statuses and an initial-reply template in Arabic and English. CRM setup and collecting real customer information are excluded.",
        price: 700, price_type: "fixed", delivery_time: "3 أيام عمل / 3 business days",
        features: ["مخطط عملية / Process map", "خمس حالات متابعة / Five tracking statuses", "قالب رد بلغتين / Bilingual reply template", "ملاحظات تسليم / Handover notes"],
      },
    ],
  },
]

const seekerSpecs = [
  { key: "seekerLaunch", email: "asaa-demo-launch@example.invalid", name: "مشروع فسحة / Fusha Launch — عرض تجريبي / Demo" },
  { key: "seekerStudio", email: "asaa-demo-shop@example.invalid", name: "متجر خيط / Khayt Shop — عرض تجريبي / Demo" },
  { key: "seekerOperations", email: "asaa-demo-operations@example.invalid", name: "مبادرة رواق / Riwaq Initiative — عرض تجريبي / Demo" },
]

/**
 * @param {{anchor?: string | Date, userIds?: Partial<typeof DEMO_USER_IDS>}} [options]
 * @returns Plain records in dependency order; authUsers must be created first.
 */
export function createDemoFixtures({ anchor = DEMO_ANCHOR, userIds = {} } = {}) {
  const anchorTime = new Date(anchor).getTime()
  if (!Number.isFinite(anchorTime)) throw new Error("Demo anchor must be a valid date")
  if (Object.keys(userIds).some((key) => !(key in DEMO_USER_IDS))) throw new Error("Unknown demo user key")
  const users = { ...DEMO_USER_IDS, ...userIds }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (Object.values(users).some((value) => typeof value !== "string" || !uuidPattern.test(value))) throw new Error("Demo user IDs must be UUIDs")
  if (new Set(Object.values(users).map((value) => value.toLowerCase())).size !== Object.keys(users).length) throw new Error("Demo users must have distinct IDs")
  const at = (days, hours = 0) => new Date(anchorTime + (days * 24 + hours) * 3_600_000).toISOString()

  const profiles = [
    ...providerSpecs.map((spec) => ({ id: users[spec.key], email: spec.email, full_name: `${spec.name_ar} / ${spec.name_en} — عرض تجريبي / Demo`, role: "provider" })),
    ...seekerSpecs.map((spec) => ({ id: users[spec.key], email: spec.email, full_name: spec.name, role: "seeker" })),
  ].map((profile) => ({ ...profile, phone: null, avatar_url: "/placeholder.svg", is_admin: false, deletion_requested_at: null, created_at: at(-40), updated_at: at(-30) }))
  const authUsers = profiles.map((profile) => ({
    id: profile.id, email: profile.email, email_confirm: true,
    user_metadata: { full_name: profile.full_name, role: profile.role, demo_dataset: DEMO_DATASET_ID },
  }))
  const providers = providerSpecs.map((spec, index) => ({
    id: id(2, index + 1), user_id: users[spec.key],
    name_ar: markAr(spec.name_ar), name_en: markEn(spec.name_en),
    title_ar: spec.title_ar, title_en: spec.title_en,
    bio_ar: `${disclaimerAr}\n\n${spec.bio_ar}`, bio_en: `${disclaimerEn}\n\n${spec.bio_en}`,
    avatar_url: "/placeholder.svg", display_name: markEn(spec.name_en), title: spec.title_en,
    bio: `${disclaimerEn}\n\n${spec.bio_en}`, category: spec.category,
    hourly_rate: spec.hourly_rate, starting_price: Math.min(...spec.services.map((service) => service.price)),
    skills: [...spec.skills], categories: [spec.category], rating: 0, reviews_count: 0, completed_projects: 0,
    is_verified: false, tap_destination_id: null, tap_account_status: "not_connected", tap_onboarding_completed: false,
    created_at: at(-39, index), updated_at: at(-30, index),
  }))
  const services = providerSpecs.flatMap((spec, providerIndex) => spec.services.map((service, serviceIndex) => ({
    id: id(3, providerIndex * 2 + serviceIndex + 1), provider_id: providers[providerIndex].id,
    ...service, name_ar: markAr(service.name_ar), name_en: markEn(service.name_en),
    description_ar: `${disclaimerAr}\n\n${service.description_ar}`,
    description_en: `${disclaimerEn}\n\n${service.description_en}`,
    features: [...service.features], category: spec.category,
    // A bare local SVG is supported by Next Image; no external hosts or uploads.
    image_urls: ["/placeholder.svg"], is_active: true,
    created_at: at(-30 + providerIndex, serviceIndex), updated_at: at(-25 + providerIndex, serviceIndex),
  })))

  const conversationSpecs = [
    { seeker: "seekerLaunch", provider: 0, created: -25, pinnedSeeker: true, pinnedProvider: true, archived: false },
    { seeker: "seekerStudio", provider: 1, created: -19, pinnedSeeker: false, pinnedProvider: false, archived: false },
    { seeker: "seekerLaunch", provider: 2, created: -7, pinnedSeeker: true, pinnedProvider: false, archived: false },
    { seeker: "seekerStudio", provider: 3, created: -4, pinnedSeeker: false, pinnedProvider: true, archived: false },
    { seeker: "seekerOperations", provider: 4, created: -17, pinnedSeeker: false, pinnedProvider: false, archived: false },
    { seeker: "seekerOperations", provider: 5, created: -6, pinnedSeeker: false, pinnedProvider: false, archived: true },
    { seeker: "seekerLaunch", provider: 5, created: -2, pinnedSeeker: false, pinnedProvider: false, archived: false },
  ]
  const conversations = conversationSpecs.map((spec, index) => ({
    id: id(4, index + 1), seeker_id: users[spec.seeker], provider_id: providers[spec.provider].id,
    is_pinned_by_seeker: spec.pinnedSeeker, is_pinned_by_provider: spec.pinnedProvider,
    is_archived_by_seeker: spec.archived, is_archived_by_provider: spec.archived,
    seeker_cleared_at: null, provider_cleared_at: null, created_at: at(spec.created), last_message_at: at(spec.created),
  }))
  const orderSpecs = [
    { conversation: 0, service: 0, status: "completed", created: -24, paid: -23, completed: -19 },
    { conversation: 0, service: 1, status: "pending", created: -2 },
    { conversation: 1, service: 2, status: "completed", created: -18, paid: -17, completed: -12 },
    { conversation: 2, service: 4, status: "awaiting_confirmation", created: -6, paid: -5, completed: -1 },
    { conversation: 3, service: 6, status: "paid", created: -3, paid: -2 },
    { conversation: 4, service: 8, status: "completed", created: -16, paid: -15, completed: -9 },
    { conversation: 5, service: 10, status: "cancelled", created: -5, cancelled: -4 },
    { conversation: 6, service: 11, status: "pending", created: -1 },
  ]
  const orders = orderSpecs.map((spec, index) => {
    const service = services[spec.service]
    const conversation = conversations[spec.conversation]
    const fee = Math.round(service.price * 15) / 100
    return {
      id: id(6, index + 1), conversation_id: conversation.id, seeker_id: conversation.seeker_id,
      provider_id: service.provider_id, service_id: service.id,
      service_name_ar: service.name_ar, service_name_en: service.name_en,
      service_description_ar: service.description_ar, service_description_en: service.description_en,
      amount: service.price, platform_fee: fee, provider_amount: Math.round((service.price - fee) * 100) / 100,
      currency: "SAR", status: spec.status,
      // Statuses demonstrate screens only. No Tap transaction, payout or checkout exists.
      tap_charge_id: null, tap_transaction_id: null, checkout_started_at: null,
      paid_at: spec.paid === undefined ? null : at(spec.paid),
      completed_at: spec.completed === undefined ? null : at(spec.completed),
      cancelled_at: spec.cancelled === undefined ? null : at(spec.cancelled), created_at: at(spec.created),
    }
  })

  // sender: 0 = seeker, 1 = provider. Both languages stay visible in chat.
  const messageSpecs = [
    [0, 0, -25, 1, "نحتاج صفحة عربية وإنجليزية للمقهى الخيالي، مع قائمة مختصرة تناسب الجوال.", "We need an Arabic and English page for the fictional café, with a short mobile-friendly menu."],
    [0, 1, -24, 1, "النطاق يشمل صفحة واحدة وجولة تعديل. جميع النماذج ستستخدم بيانات العرض فقط.", "The scope covers one page and one revision. All forms will use showcase data only."],
    [0, 0, -19, 1, "راجعنا النسختين وأكدنا الاستلام. ترتيب القائمة واضح على الجوال.", "We reviewed both languages and confirmed delivery. The menu is clear on mobile."],
    [0, 1, -2, 1, "أرسلت عرضاً منفصلاً للوحة الحجوزات التجريبية، وهو بانتظار مراجعتكم.", "I sent a separate proposal for the sample booking dashboard. It is awaiting your review."],
    [1, 0, -19, 1, "نريد هوية هادئة لمتجر خيط الخيالي، مع قوالب يمكن للفريق تعديلها.", "We would like a calm identity for the fictional Khayt shop, with templates our team can edit."],
    [1, 1, -18, 1, "سأعرض اتجاهين ثم نطور اختياركم مع جولتي مراجعة ضمن الحزمة.", "I will present two directions, then develop your choice over the two included review rounds."],
    [1, 1, -12, -1, "اكتملت ملفات الشعار والقوالب ودليل الاستخدام التجريبي.", "The sample logo files, templates and usage guide are ready."],
    [1, 0, -12, 1, "تم الاستلام. ألوان القوالب مناسبة، وقد احتجنا توضيحاً إضافياً لتصدير المقاسات.", "Delivery confirmed. The template colors work well; we needed an extra explanation of export sizes."],
    [2, 0, -7, 1, "نحتاج أفكار أسبوعين لإطلاق المقهى، دون إدارة نشر أو إعلانات.", "We need two weeks of café-launch ideas, without posting management or advertising."],
    [2, 1, -6, 1, "سأجهز عشرة أفكار وأربعة نصوص قصيرة، مع توضيح المواد المطلوبة لكل منشور.", "I will prepare ten ideas and four short scripts, noting which assets each post needs."],
    [2, 0, -5, 1, "تم تسجيل حالة الدفع التجريبية؛ هذا العرض لا يتضمن أي عملية مالية حقيقية.", "The sample payment status is recorded; this showcase contains no real financial transaction."],
    [2, 1, -1, 1, "خطة المحتوى جاهزة للمراجعة. الطلب ينتظر تأكيد الاستلام في سيناريو العرض.", "The content plan is ready for review. This showcase order is awaiting delivery confirmation."],
    [3, 0, -4, 1, "لدينا عشرة منتجات خيالية؛ سأرسل الخامات وطريقة العناية ضمن الموجز.", "We have ten fictional products. I will include materials and care guidance in the brief."],
    [3, 1, -3, 1, "متفقون على 80 كلمة كحد أقصى لكل منتج بكل لغة، مع جولة تحرير واحدة.", "Agreed: up to 80 words per product in each language, with one editing round."],
    [3, 1, -2, 1, "حالة الطلب التجريبية أصبحت مدفوعاً، وسأبدأ بمراجعة المسودة الأولى.", "The sample order now shows Paid. I will start reviewing the first draft."],
    [3, 0, -1, 2, "يرجى الحفاظ على أسماء الخامات كما وردت في الموجز الخيالي.", "Please keep the material names consistent with the fictional brief."],
    [4, 0, -17, 1, "نريد فيديو عمودياً من 30 ثانية للتعريف بمبادرة رواق الخيالية.", "We would like a 30-second vertical introduction for the fictional Riwaq initiative."],
    [4, 1, -16, 1, "سأستخدم اللقطات التجريبية المتفق عليها مع عناوين عربية وترجمة إنجليزية.", "I will use the agreed sample footage, with Arabic titles and English subtitles."],
    [4, 1, -9, -1, "جهزت نسخة المراجعة النهائية؛ النصوص الآن أقصر لتسهيل القراءة.", "The final review version is ready. The titles are now shorter for easier reading."],
    [4, 0, -9, 1, "أكدنا الاستلام. الإيقاع والترجمة مناسبان لعرض الفكرة على الفريق.", "Delivery confirmed. The pacing and subtitles suit our internal concept presentation."],
    [5, 0, -6, 1, "نبحث عن جلسة لتنظيم نطاق مشروع المبادرة الخيالي.", "We are considering a session to scope the fictional initiative."],
    [5, 1, -5, 1, "العرض لساعة واحدة مع موجز وقائمة خطوات؛ يمكن تحديد الموعد لاحقاً.", "The proposal covers one hour, a brief and next steps. We can agree on a time later."],
    [5, 0, -4, -1, "تغير توقيت العرض الداخلي. نرجو إلغاء الطلب التجريبي قبل الدفع.", "Our internal presentation date changed. Please cancel the sample order before payment."],
    [5, 1, -4, 1, "تم إلغاء الطلب في سيناريو العرض. لم تبدأ أي عملية دفع.", "The order is cancelled in this showcase scenario. No payment was started."],
    [6, 0, -2, 1, "نريد توضيح مسار الاستفسارات للمقهى من الرسالة الأولى حتى الإغلاق.", "We would like to map the café enquiry flow from the first message to closure."],
    [6, 1, -2, 2, "سأقترح خمس حالات للمتابعة وقالب رد أولي باللغتين.", "I will propose five tracking statuses and an initial-reply template in both languages."],
    [6, 0, -1, -1, "مناسب. لنجعل جميع الأسماء والطلبات داخل المخطط خيالية.", "That works. Please keep all names and enquiries in the map fictional."],
    [6, 1, -1, 3, "أضفت الطلب التجريبي بالنطاق المتفق عليه، وهو بانتظار موافقتكم.", "I added the sample order with the agreed scope. It is awaiting your approval."],
  ]
  const messages = messageSpecs.map(([conversationIndex, sender, days, hours, ar, en], index) => {
    const conversation = conversations[conversationIndex]
    const provider = providers[conversationSpecs[conversationIndex].provider]
    return {
      id: id(5, index + 1), conversation_id: conversation.id,
      sender_id: sender === 0 ? conversation.seeker_id : provider.user_id,
      content: message(ar, en), is_read: ![3, 11, 15, 27].includes(index), created_at: at(days, hours),
    }
  })
  for (const conversation of conversations) {
    conversation.last_message_at = messages.filter((item) => item.conversation_id === conversation.id)
      .map((item) => item.created_at).sort().at(-1) ?? conversation.created_at
  }

  const completedOrders = orders.filter((order) => order.status === "completed")
  const service_history = completedOrders.map((order, index) => ({
    id: id(7, index + 1), order_id: order.id, seeker_id: order.seeker_id, provider_id: order.provider_id,
    service_id: order.service_id, service_name_ar: order.service_name_ar, service_name_en: order.service_name_en,
    service_description_ar: order.service_description_ar, service_description_en: order.service_description_en,
    amount: order.amount, status: "completed", created_at: order.completed_at,
  }))
  const reviewSpecs = [
    { rating: 5, ar: "تقييم خيالي للعرض: النسختان واضحتان، وتسليم الكود مع ملاحظات التشغيل ساعدنا في مراجعة الصفحة.", en: "Fictional showcase review: both languages are clear, and the code handover notes made the page easy to review." },
    { rating: 4, ar: "تقييم خيالي للعرض: القوالب متناسقة. احتجنا شرحاً إضافياً للمقاسات، ثم أصبح دليل التسليم واضحاً.", en: "Fictional showcase review: the templates are consistent. We needed extra guidance on sizes, after which the handover guide was clear." },
    { rating: 5, ar: "تقييم خيالي للعرض: العناوين سهلة القراءة، وجولة التعديل حسنت إيقاع النسخة التجريبية.", en: "Fictional showcase review: the titles are easy to read, and the revision improved the pacing of the sample video." },
  ]
  const reviews = completedOrders.map((order, index) => ({
    id: id(8, index + 1), order_id: order.id, service_id: order.service_id, reviewer_id: order.seeker_id,
    rating: reviewSpecs[index].rating, comment: message(reviewSpecs[index].ar, reviewSpecs[index].en),
    service_name: `${order.service_name_ar} / ${order.service_name_en}`,
    created_at: new Date(new Date(order.completed_at).getTime() + 24 * 3_600_000).toISOString(),
  }))
  for (const provider of providers) {
    const finished = completedOrders.filter((order) => order.provider_id === provider.id)
    const providerReviews = reviews.filter((review) => finished.some((order) => order.id === review.order_id))
    provider.completed_projects = finished.length
    provider.reviews_count = providerReviews.length
    provider.rating = providerReviews.length ? Math.round(providerReviews.reduce((sum, review) => sum + review.rating, 0) / providerReviews.length * 100) / 100 : 0
  }
  const favoriteSpecs = [["seekerLaunch", 0], ["seekerLaunch", 2], ["seekerLaunch", 5], ["seekerStudio", 1], ["seekerStudio", 3], ["seekerOperations", 4]]
  const favorites = favoriteSpecs.map(([seeker, provider], index) => ({
    id: id(9, index + 1), user_id: users[seeker], provider_id: providers[provider].id, created_at: at(-20 + index),
  }))

  return {
    datasetId: DEMO_DATASET_ID, anchor: new Date(anchorTime).toISOString(),
    authUsers, profiles, providers, services, conversations, messages, orders, service_history, reviews, favorites,
  }
}
