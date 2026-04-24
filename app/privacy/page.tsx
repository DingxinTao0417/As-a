import Link from "next/link"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"

export const metadata = {
  title: "Privacy Policy | سياسة الخصوصية | As'aa",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto max-w-4xl px-4 py-12 flex-1 space-y-10" dir="rtl">
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">آخر تحديث: 2026-04-24</p>
          <h1 className="text-3xl font-bold">سياسة الخصوصية</h1>
          <p className="text-muted-foreground leading-8">
            توضح هذه السياسة كيف تجمع منصة أسعى وتستخدم وتحمي بياناتك الشخصية وفق متطلبات نظام حماية البيانات الشخصية في المملكة العربية السعودية. هذه صفحة إرشادية ويجب مراجعتها قانونياً قبل الإطلاق العام.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">هوية المتحكم وبيانات التواصل</h2>
          <p className="leading-8">المتحكم في البيانات هو منصة أسعى للخدمات المهنية. للاستفسارات أو طلبات الخصوصية: <a className="underline" href="mailto:support@asa.sa">support@asa.sa</a>.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">البيانات التي نجمعها</h2>
          <ul className="list-disc pr-6 space-y-2 leading-8">
            <li>بيانات الحساب مثل الاسم، البريد الإلكتروني، رقم الهاتف، نوع المستخدم، والصورة الشخصية.</li>
            <li>بيانات الخدمات والطلبات والمحادثات والتقييمات والمفضلات.</li>
            <li>بيانات الدفع اللازمة للمعالجة عبر مزود الدفع، ولا نخزن بيانات البطاقة الكاملة.</li>
            <li>بيانات تقنية مثل عنوان IP، معلومات الجهاز، سجلات الاستخدام، وملفات تعريف الارتباط.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">أغراض وأساس المعالجة</h2>
          <p className="leading-8">نستخدم البيانات لتقديم الخدمة، إدارة الحسابات والطلبات، معالجة المدفوعات، دعم العملاء، الأمن ومنع الاحتيال، التحليلات وتحسين المنصة، والامتثال للالتزامات النظامية. نعتمد على تنفيذ العقد، موافقتك عند اللزوم، المصالح المشروعة، والالتزام القانوني.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">مشاركة البيانات والنقل الدولي</h2>
          <p className="leading-8">قد نشارك البيانات مع مزودي البنية التحتية والاستضافة وقاعدة البيانات مثل Supabase وVercel، مزود الدفع Tap Payment، مزودي الدعم والتحليلات والمراقبة مثل Sentry عند تفعيله، والجهات المختصة عند وجود التزام نظامي. قد تتم معالجة بعض البيانات خارج المملكة مع تطبيق الضمانات المناسبة.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">الاحتفاظ والحقوق</h2>
          <p className="leading-8">نحتفظ بالبيانات طوال مدة الحساب أو حسب الحاجة للطلبات والنزاعات والمتطلبات المحاسبية والنظامية. يمكنك طلب الوصول، التصحيح، الحذف، تقييد المعالجة، الاعتراض، أو نقل البيانات عبر صفحة الملف الشخصي أو البريد أعلاه.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">ملفات تعريف الارتباط والتحديثات</h2>
          <p className="leading-8">نستخدم ملفات تعريف الارتباط للجلسات الآمنة، تفضيلات اللغة، والتحليلات عند تفعيلها. سننشر أي تحديثات مهمة على هذه الصفحة وقد نرسل إشعاراً عند الحاجة.</p>
        </section>

        <section className="space-y-4 border-t pt-8" dir="ltr">
          <h2 className="text-2xl font-bold">Privacy Policy Summary</h2>
          <p className="leading-7">As'aa collects account, contact, order, payment-processing, support, analytics, and technical data to provide the marketplace, process payments, secure the platform, provide customer support, and comply with law. We may share data with payment processors, Supabase/Vercel hosting and database providers, monitoring vendors such as Sentry if enabled, and authorities where required. Users may request access, correction, deletion, restriction, objection, and portability by contacting <a className="underline" href="mailto:support@asa.sa">support@asa.sa</a>.</p>
          <p><Link className="underline" href="/terms">Terms of Service</Link></p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
