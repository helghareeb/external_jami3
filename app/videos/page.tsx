import Link from '@/app/components/Link'
import UiIcon from '@/app/components/UiIcon'

export const metadata = {
  title: 'أفلام الموسوعة — جامع خادم الحرمين',
  description: 'جولة مرئية في ميزات موسوعة الحديث النبوي الشريف وصفحة الحديث',
}

const MAIN_FILM = { src: 'promo', title: 'الجامع — موسوعة الحديث النبوي الشريف' }

const ENCYCLOPEDIA_FILMS = [
  { src: 'about', title: 'ما الجامع؟', note: 'منصّةٌ تعرض كتب السنة كما هي؛ لا تحكم على حديثٍ ولا راوٍ، والحكم من الدرر السنية' },
  { src: 'connect', title: 'الجامع في مساعدك الذكي', note: 'في ثلاث خطوات ودون حساب: انسخ الرابط، وأضفه إلى Claude أو ChatGPT أو Claude Code أو Codex، ثم اسأله' },
  { src: 'library', title: 'مكتبتي', note: 'مكتبة بحثية في حسابك: احفظ، ودوّن، وظلّل، ووثّق إلى Zotero وEndNote وLaTeX، وشارك مشرفك' },
  { src: 'tashkeel', title: 'مطابقة التشكيل', note: 'زُبْد وزَبَد وزَبْد: حروفٌ واحدة ومعانٍ مختلفة — بحثٌ يفرّق بينها بحركاتها' },
  { src: 'mcp-uses', title: 'ماذا تسأل مساعدك؟', note: 'أسئلةٌ حقيقية لمساعدٍ متصلٍ بالموسوعة: «أهذا حديث؟»، و«ما أصله؟»، والروايات وأحوال الرواة' },
  { src: 'migration-film', title: 'من سطح المكتب إلى الويب', note: 'كيف نُقل البرنامج من تطبيق ويندوز إلى موقعٍ على الويب' },
  { src: 'numbering-film', title: 'ترقيم حرف والترقيم المطبوع', note: 'لماذا يختلف رقم الحديث من طبعةٍ لأخرى، وكيف تعزو بدقة' },
]

const FEATURE_FILMS = [
  { src: 'feature-sanad', title: 'السند والمتن' },
  { src: 'feature-isnad-tree', title: 'شجرة الإسناد' },
  { src: 'feature-narrators', title: 'الجرح والتعديل' },
  { src: 'feature-takhrij', title: 'التخريج' },
  { src: 'feature-matn-compare', title: 'مطابقة المتون' },
  { src: 'feature-sharh-gharib', title: 'الشروح وغريب الحديث' },
  { src: 'feature-search', title: 'البحث' },
  { src: 'feature-rulings', title: 'أقوال العلماء' },
]

export default function VideosPage() {
  return (
    <div dir="rtl" className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-green-800 hover:text-green-950 font-sans mb-2">
          <UiIcon name="arrow" size={14} className="rotate-180" />
          العودة إلى الرئيسية
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink font-display">أفلام الموسوعة</h1>
        <p className="text-sm text-muted mt-1 font-sans">جولةٌ مرئية في ميزات موسوعة الحديث النبوي الشريف وصفحة الحديث</p>
      </div>

      <section className="mb-8">
        <video
          controls
          preload="metadata"
          playsInline
          poster={`/media/${MAIN_FILM.src}-poster.jpg`}
          aria-label={MAIN_FILM.title}
          className="w-full aspect-video rounded-2xl border border-[#D9C9A8] bg-[#faf6ec] shadow-[0_18px_50px_rgba(15,61,46,.14)]"
        >
          <source src={`/media/${MAIN_FILM.src}.mp4`} type="video/mp4" />
          <track kind="captions" src={`/media/${MAIN_FILM.src}.ar.vtt`} srcLang="ar" label="العربية" default />
        </video>
        <p className="text-base font-bold text-green-900 mt-3 font-display">{MAIN_FILM.title}</p>
      </section>

      <section className="ui-card rounded-2xl p-5 sm:p-6 mb-8">
        <h2 className="text-lg font-bold text-green-900 mb-1 font-display">التعريف بالموسوعة وأدواتها</h2>
        <p className="text-sm text-muted mb-5 font-sans">أفلام قصيرة تشرح فكرة المنصة، والربط بالذكاء الاصطناعي، والمكتبة البحثية، ونظام الترقيم</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {ENCYCLOPEDIA_FILMS.map(film => (
            <div key={film.src}>
              <video
                controls
                preload="none"
                playsInline
                poster={`/media/${film.src}-poster.jpg`}
                aria-label={film.title}
                className="w-full aspect-video rounded-xl border border-[#D9C9A8] bg-[#faf6ec]"
              >
                <source src={`/media/${film.src}.mp4`} type="video/mp4" />
                <track kind="captions" src={`/media/${film.src}.ar.vtt`} srcLang="ar" label="العربية" default />
              </video>
              <p className="text-sm font-semibold text-green-900 mt-2 font-display">{film.title}</p>
              <p className="text-xs text-muted font-sans">{film.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-card rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold text-green-900 mb-1 font-display">ميزات صفحة الحديث</h2>
        <p className="text-sm text-muted mb-5 font-sans">عرضٌ موجز لأبرز أقسام صفحة الحديث وأدوات التحليل</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {FEATURE_FILMS.map(film => (
            <div key={film.src}>
              <video
                controls
                preload="none"
                playsInline
                poster={`/media/${film.src}-poster.jpg`}
                aria-label={film.title}
                className="w-full aspect-square rounded-xl border border-[#D9C9A8] bg-[#faf6ec]"
              >
                <source src={`/media/${film.src}.mp4`} type="video/mp4" />
              </video>
              <p className="text-sm font-semibold text-green-900 mt-1.5 font-display text-center">{film.title}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
