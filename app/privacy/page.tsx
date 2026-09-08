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
          <p className="text-sm text-muted-foreground">آخر تحديث: 2026-09-07</p>
          <h1 className="text-3xl font-bold">سياسة الخصوصية</h1>
          <p className="text-muted-foreground leading-8">
            تصف هذه المسودة وظائف البيانات الحالية في منصة أسعى. يجب استكمال بيانات الجهة المشغلة وأسس المعالجة وفترات الاحتفاظ ووسيلة التواصل الرسمية ومراجعتها قانونياً قبل الإطلاق العام.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">هوية المتحكم وبيانات التواصل</h2>
          <p className="leading-8">ستُضاف الهوية القانونية للجهة المشغلة ووسيلة التواصل المعتمدة في النسخة النهائية قبل الإطلاق العام. تتوفر حالياً أدوات تعديل بيانات الحساب وتنزيل نسخة وطلب حذف الحساب في <Link className="underline" href="/profile">الملف الشخصي</Link>.</p>
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
          <h2 className="text-xl font-semibold">استخدام البيانات</h2>
          <p className="leading-8">تُستخدم بيانات الحساب لتسجيل الدخول وعرض الملف الشخصي. تُستخدم بيانات الخدمات والمحادثات والطلبات لتشغيل السوق، وتُرسل معلومات الطلب اللازمة إلى مزود الدفع عند بدء عملية الدفع.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">مشاركة البيانات والنقل الدولي</h2>
          <p className="leading-8">يستخدم التطبيق Supabase للحسابات وقاعدة البيانات وتخزين الملفات، وTap لمعالجة الدفع عند تفعيله. عند استخدام المساعد الذكي تُرسل رسائلك إلى خدمة المساعد المُعدّة للمنصة. يجب توثيق مزودي الاستضافة والمساعد والتحليلات الفعليين ومواقع المعالجة وضوابط نقل البيانات قبل الإطلاق العام.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">الاحتفاظ والحقوق</h2>
          <p className="leading-8">يمكنك تعديل بيانات ملفك وتنزيل نسخة من بيانات حسابك وطلب الحذف من صفحة الملف الشخصي. طلب الحذف يعطل الوصول للحساب ويخفي الخدمات؛ ولا يمحو فوراً سجلات المحادثات والمعاملات. يجب استكمال فترات الاحتفاظ وإجراءات معالجة الطلبات في السياسة النهائية.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">ملفات تعريف الارتباط والتحديثات</h2>
          <p className="leading-8">نستخدم ملفات تعريف الارتباط للجلسات الآمنة، تفضيلات اللغة، والتحليلات عند تفعيلها. سننشر أي تحديثات مهمة على هذه الصفحة وقد نرسل إشعاراً عند الحاجة.</p>
        </section>

        <section className="space-y-4 border-t pt-8" dir="ltr">
          <h2 className="text-2xl font-bold">Privacy Policy Summary</h2>
          <p className="leading-7">This draft describes current data features and needs legal review before public launch. Account, service, order, conversation, and payment data support the marketplace. Supabase handles authentication, database records, and file storage; Tap handles payments when enabled. Messages sent to the AI assistant are shared with its configured service. Profile tools support editing, export, and deletion requests. A deletion request disables account access and hides listings while message and transaction records remain pending the retention process. The operator's legal identity, official privacy contact, processing locations, and retention periods must be finalized before public launch.</p>
          <p><Link className="underline" href="/terms">Terms of Service</Link></p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
