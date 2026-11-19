import type { Metadata } from 'next'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'سياسة الخصوصية وحذف الحساب — الجامع',
  description: 'سياسة الخصوصية وحماية البيانات وآلية حذف الحساب في موسوعة الحديث النبوي الشريف (hadith.dev) وتطبيقات الجامع للأندرويد وسطح المكتب.',
}

export default function PrivacyPage() {
  return (
    <div dir="rtl" className="max-w-3xl mx-auto space-y-6 font-sans">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-green-900">سياسة الخصوصية وحذف الحساب</h1>
        <p className="text-sm text-muted">
          موسوعة الحديث النبوي الشريف — <bdi dir="ltr">hadith.dev</bdi> وتطبيق «الجامع» للأندرويد (<bdi dir="ltr">dev.hadith.dev</bdi> / <bdi dir="ltr">dev.hadith.app</bdi>)
          وتطبيقه لسطح المكتب (ويندوز وماك ولينكس، ومنه نسخة متجر مايكروسوفت)
        </p>
        <p className="text-xs text-muted">آخر تحديث: ١٩ نوفمبر ٢٠٢٦</p>
      </header>

      <section className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-bold text-green-900">١. القراءة والبحث دون حساب</h2>
        <p>
          يمكنك تصفح الموسوعة والبحث في الأحاديث والرواة والأسانيد وقراءة الكتب مجانًا دون إنشاء حساب، ودون إعلانات،
          ودون أي حزم تتبّع إعلانية أو أطراف ثالثة. لا يضع الموقع ملفات تعريف ارتباط لتتبّع القراءة العامة.
        </p>
      </section>

      <section className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-bold text-green-900">٢. الإحصاءات التشغيلية المبسطة</h2>
        <p>
          يحتفظ الخادم بإحصاءات تصفّح إجمالية لحساب الزيارات اليومية باستخدام تجزئة يومية أحادية الاتجاه (SHA-256)
          لا تُخزِّن عنوان الشبكة بصورته الصريحة ولا تمكّن من متابعة الزائر عبر الأيام.
        </p>
      </section>

      <section className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-bold text-green-900">٣. الحساب الاختياري ومكتبة الباحث</h2>
        <p>
          إن اخترت تسجيل الدخول عبر <a href="/login" className="text-green-800 underline underline-offset-2">صفحة الدخول</a>،
          فإننا نستخدم بريدك الإلكتروني لإرسال رابط أو رمز دخول صالح لمرة واحدة فقط (دون كلمة مرور، عبر خدمة البريد الإلكتروني Resend)،
          ونحفظ ملف تعريف جلسة آمنًا (<code dir="ltr" className="text-xs bg-paper px-1 rounded">hd_session</code>).
        </p>
        <ul className="list-disc pr-5 space-y-1.5">
          <li><b>مكتبتي:</b> المجموعات البحثية والعناصر المحفوظة والملاحظات والتظليلات التي تضيفها برغبتك لتزامنها بين أجهزتك.</li>
          <li><b>واجهة MCP:</b> الرموز الشخصية أو رموز OAuth وعداد الاستخدام اليومي عند ربط مساعدات الذكاء الاصطناعي بحسابك.</li>
          <li><b>لا مشاركة تجارية:</b> لا نبيع بياناتك ولا نشاركها مع جهات تسويق أو إعلانات.</li>
        </ul>
      </section>

      <section className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-bold text-green-900">٤. بيانات العمل دون إنترنت على الجهاز</h2>
        <p>
          عند تحميل نسخة الموسوعة للعمل دون إنترنت عبر صفحة{' '}
          <a href="/offline" className="text-green-800 underline underline-offset-2">الجامع دون إنترنت</a>،
          تُحفظ قاعدة البيانات محليًا على جهازك فقط. يمكنك حذفها في أي وقت من الصفحة نفسها أو عبر مسح بيانات التطبيق من إعدادات الجهاز،
          وفي تطبيق سطح المكتب بإزالة التطبيق وحذف مجلده. تُنزَّل الملفات وتحديثات التطبيقات من <bdi dir="ltr">files.hadith.dev</bdi> لإيصالها فقط.
        </p>
      </section>

      <section id="delete-account" className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed scroll-mt-20">
        <h2 className="text-base font-bold text-green-900">٥. حذف الحساب والبيانات نهائيًا</h2>
        <p>
          يمكنك حذف حسابك وجميع بياناتك المرتبطة به فورًا ونهائيًا من داخل التطبيق أو عبر المتصفح:
        </p>
        <ol className="list-decimal pr-5 space-y-1.5">
          <li>افتح صفحة <a href="/account" className="text-green-800 underline underline-offset-2">حسابي</a> (وسجّل الدخول إن لم تكن مسجلًا).</li>
          <li>انزل إلى قسم <b>«حذف الحساب نهائيًا»</b> واضغط زر الحذف ثم أكّد الطلب.</li>
          <li>
            يُحذف الحساب فورًا وبشكل نهائي، ويشمل ذلك: عنوان البريد الإلكتروني، والجلسات النشطة، ورموز MCP، وجميع المجموعات البحثية والمحفوظات والملاحظات والتظليلات وسجلات استخدام الحساب.
          </li>
        </ol>
        <p className="text-muted">
          إن تعذّر عليك الوصول إلى بريدك الإلكتروني أو رغبت في طلب حذف يدوي، راسلنا على{' '}
          <a href="mailto:support@hadith.dev" className="underline underline-offset-2" dir="ltr">support@hadith.dev</a>{' '}
          أو تواصل معنا عبر واتساب:{' '}
          <a href="https://wa.me/61426047327" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" dir="ltr">
            +61 426 047 327
          </a>.
        </p>
      </section>

      <section dir="ltr" lang="en" className="ui-card rounded-2xl p-5 space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-bold text-green-900">English Summary (Privacy Policy &amp; Account Deletion)</h2>
        <p>
          <strong>Al-Jami&apos; — Hadith Encyclopedia</strong> (<code>hadith.dev</code> / Android package <code>dev.hadith.app</code> / desktop app for Windows, macOS and Linux, including the Microsoft Store version)
          provides full access to classical hadith collections without requiring an account, with zero ads and zero third-party ad/analytics SDKs.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Optional Account Data:</strong> If you sign in at <code>/login</code>, we collect only your email address for passwordless one-time login links/codes, an authentication session cookie, and optional user-created library data (collections, notes, highlights, and MCP API/OAuth tokens). Data is transmitted exclusively over HTTPS.
          </li>
          <li>
            <strong>Offline Storage:</strong> Optional offline database files downloaded via <code>/offline</code> are stored locally on your device and can be deleted anytime from <code>/offline</code>, Android App Settings, or by uninstalling the desktop app and removing its folder. Files and app updates are downloaded from <code>files.hadith.dev</code> only to deliver them.
          </li>
          <li>
            <strong>Immediate Account &amp; Data Deletion:</strong> Signed-in users can permanently delete their account and all associated server data at any time in the app or on the web via <a href="/account" className="text-green-800 underline"><code>https://hadith.dev/account</code></a> (&ldquo;حذف الحساب نهائيًا&rdquo;). Deleting an account immediately and permanently erases the email address, active sessions, MCP tokens, collections, notes, highlights, and account usage records. For manual deletion assistance, email <a href="mailto:support@hadith.dev" className="text-green-800 underline">support@hadith.dev</a> or contact support via WhatsApp at <code>+61 426 047 327</code>.
          </li>
        </ul>
      </section>
    </div>
  )
}
