import Link from '@/app/components/Link'
import GwamhBrowser from '@/app/components/GwamhBrowser'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'جوامع الآثار — آثار الصحابة والتابعين — جامع خادم الحرمين',
  description: 'موسوعة آثار الصحابة الموقوفة وآثار التابعين المقطوعة مصنّفة بالراوي عبر كتب الحديث.',
}

export default async function GwamhPage({
  searchParams,
}: {
  searchParams: Promise<{ gamh?: string; narrator?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const rawGamh = parseInt(sp.gamh || '1', 10)
  const gamhId = rawGamh === 2 ? 2 : 1
  const narratorId = sp.narrator ? parseInt(sp.narrator, 10) : NaN
  const query = (sp.q || '').trim()
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  return (
    <div dir="rtl" className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
        <Link href="/" className="hover:text-green-700">الرئيسية</Link>
        <span>›</span>
        <Link href="/indexes" className="hover:text-green-700">الفهارس</Link>
        <span>›</span>
        <span className="text-green-900 font-medium">جوامع الآثار</span>
      </nav>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-green-900 font-display">جوامع الآثار (الصحابة والتابعين)</h1>
        <p className="text-sm text-gray-500">
          تصفّح الآثار الموقوفة على الصحابة (٤٤٦ صحابياً) والآثار المقطوعة عن التابعين (١٬٠٣١ تابعياً) وفق جدول الجوامع في الموسوعة
        </p>
      </div>

      <GwamhBrowser
        initialGamhId={gamhId}
        initialNarratorId={Number.isSafeInteger(narratorId) && narratorId > 0 ? narratorId : null}
        initialQuery={query}
        initialPage={page}
      />
    </div>
  )
}
