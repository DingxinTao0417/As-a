import Link from "next/link"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"

export const metadata = {
  title: "Terms of Service | شروط الاستخدام | As'aa",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto max-w-4xl px-4 py-12 flex-1 space-y-10" dir="rtl">
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">آخر تحديث: 2026-09-08</p>
          <h1 className="text-3xl font-bold">شروط الاستخدام</h1>
          <p className="text-muted-foreground leading-8">تنظم هذه الشروط استخدام منصة أسعى. باستخدامك للمنصة فإنك توافق على هذه الشروط وسياسة الخصوصية.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">طبيعة المنصة</h2>
          <p className="leading-8">أسعى منصة وسيطة تربط الباحثين عن الخدمات بمقدمي الخدمات المستقلين. لا تقدم أسعى الخدمات المهنية مباشرة ولا تكون طرفاً منفذاً للعمل بين المستخدمين إلا بالقدر اللازم لتشغيل المنصة ومعالجة المدفوعات.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">التسجيل والأهلية</h2>
          <ul className="list-disc ps-6 space-y-2 leading-8">
            <li>يجب أن يكون المستخدم بالغاً السن النظامية وقادراً على إبرام العقود.</li>
            <li>يجب تقديم معلومات صحيحة ومحدثة، وقد نطلب إثبات الهوية أو الأهلية المهنية.</li>
            <li>المنصة موجهة للمستخدمين داخل المملكة العربية السعودية أو المقيمين بإقامة/تأشيرة سارية حيث ينطبق ذلك.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">التزامات الباحث ومقدم الخدمة</h2>
          <p className="leading-8">يلتزم الباحث بوصف الطلب بدقة وسداد المستحقات. يلتزم مقدم الخدمة بتنفيذ العمل وفق الوصف والجودة المتفق عليها والامتثال للأنظمة المهنية والتجارية. يحظر استخدام المنصة للأنشطة غير النظامية أو المخالفة للآداب أو حقوق الغير.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">الدفع والرسوم والضريبة</h2>
          <p className="leading-8">تعرض الطلبات الحالية بالريال السعودي. تظهر قيمة الطلب ورسوم المنصة وصافي مقدم الخدمة قبل بدء الدفع. لا تعد أي نسبة ضريبية أو سياسة استرداد أو وسيلة دفع متاحة ما لم تظهر صراحة في مسار الطلب المعتمد. ستنشر القواعد النهائية للضريبة والاسترداد بعد اعتمادها وقبل إتاحة الدفع العام.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">الملكية الفكرية والمحتوى</h2>
          <p className="leading-8">يبقى كل طرف مالكاً لمحتواه وحقوقه السابقة. تنتقل مخرجات الخدمة وفق الاتفاق بين الباحث ومقدم الخدمة وبعد السداد الكامل ما لم ينص الاتفاق على خلاف ذلك. يمنح المستخدمون أسعى ترخيصاً محدوداً لعرض المحتوى وتشغيل الخدمة.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">إخلاء المسؤولية وإنهاء الحساب</h2>
          <p className="leading-8">تبذل أسعى عناية معقولة لتشغيل المنصة لكنها لا تضمن توفرها دون انقطاع أو نتائج مقدمي الخدمات. يجوز تعليق أو إنهاء الحساب عند مخالفة الشروط أو الاشتباه في الاحتيال أو بناءً على متطلبات نظامية.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">القانون والاختصاص</h2>
          <p className="leading-8">تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتسعى الأطراف أولاً لحل النزاعات ودياً ثم عبر الجهات المختصة داخل المملكة.</p>
          <p><Link className="underline" href="/privacy">سياسة الخصوصية</Link></p>
        </section>

        <section className="space-y-4 border-t pt-8" dir="ltr">
          <h2 className="text-2xl font-bold">Terms Summary</h2>
          <p className="leading-7">As'aa is an intermediary marketplace, not the direct provider of listed services. Users must be legally eligible, provide accurate information, comply with applicable law, review the amount and fee shown on each order, and respect intellectual property. Tax, refund, payment-method, and public-launch terms will be published after approval. Accounts may be suspended for violations, fraud, or legal requirements.</p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
