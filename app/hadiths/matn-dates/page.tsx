import pool from '@/lib/db'
import Link from '@/app/components/Link'
import HadithNumber from '@/app/components/HadithNumber'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'تواريخ المتون — جامع خادم الحرمين',
  description: 'الأحاديث المرتبطة بالوقائع والأحداث التاريخية من البعثة النبوية إلى وفاة النبي ﷺ',
}

interface DateRow {
  id: number
  text: string
}

interface DateHadithRow {
  main_id: number
  book_id: number
  book_title: string
  tarf: string | null
  chapter_text: string | null
  tarqeem_harf: string | null
  tarqeem_matboa1: string | null
  part_num: number | null
  page_num: number | null
}

function stripTags(raw: string | null): string {
  return (raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default async function MatnDatesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; page?: string }>
}) {
  const sp = await searchParams
  const requestedDate = sp.date ? parseInt(sp.date, 10) || 0 : 0
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const limit = 30
  const offset = (page - 1) * limit

  const datesRes = await pool
    .query<DateRow>(`SELECT id, text FROM matn_dates ORDER BY id ASC`)
    .catch(() => ({ rows: [] as DateRow[] }))

  const dates = datesRes.rows
  const selected =
    (requestedDate > 0 ? dates.find(d => d.id === requestedDate) : null) ??
    dates.find(d => d.id === 82) ??
    dates[0] ??
    null

  let hadiths: DateHadithRow[] = []
  let total = 0

  if (selected) {
    const tsTerm = `تواريخ ربط ${selected.id}`
    const likePat = `%<تواريخ%ربط="${selected.id}"%`
    const [cntRes, listRes] = await Promise.all([
      pool
        .query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM hadith_toc ht
           WHERE ht.is_leaf = true
             AND ht.is_paragraph = true
             AND to_tsvector('simple', COALESCE(ht.content, '')) @@ plainto_tsquery('simple', $1)
             AND ht.content LIKE $2`,
          [tsTerm, likePat]
        )
        .catch(() => ({ rows: [{ total: 0 }] })),
      pool
        .query<DateHadithRow>(
          `SELECT ht.main_id, ht.book_id, b.title AS book_title,
                  ht.tarf, ht.chapter_text, ht.tarqeem_harf, ht.tarqeem_matboa1,
                  ht.part_num, ht.page_num
           FROM hadith_toc ht
           JOIN books b ON b.id = ht.book_id
           WHERE ht.is_leaf = true
             AND ht.is_paragraph = true
             AND to_tsvector('simple', COALESCE(ht.content, '')) @@ plainto_tsquery('simple', $1)
             AND ht.content LIKE $2
           ORDER BY b.tarteeb ASC NULLS LAST, ht.main_id ASC
           LIMIT $3 OFFSET $4`,
          [tsTerm, likePat, limit, offset]
        )
        .catch(() => ({ rows: [] as DateHadithRow[] })),
    ])
    total = cntRes.rows[0]?.total ?? 0
    hadiths = listRes.rows
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  function buildUrl(dateId: number, pg = 1) {
    const p = new URLSearchParams()
    p.set('date', String(dateId))
    if (pg > 1) p.set('page', String(pg))
    return `/hadiths/matn-dates?${p.toString()}`
  }

  return (
    <div dir="rtl" className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">تواريخ المتون</h1>
        <p className="text-sm text-gray-500">
          الأحاديث المؤرَّخة بوقائع السيرة والغزوات وأحداث البعثة والهجرة النبوية — {dates.length} حدثاً تاريخياً معتمداً
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right column: 40 matn_dates events */}
        <aside className="lg:col-span-5 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-3 text-xs font-bold flex items-center justify-between">
            <span>الوقائع التاريخية ({dates.length})</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
            {dates.map((d, idx) => {
              const active = selected?.id === d.id
              return (
                <Link
                  key={d.id}
                  href={buildUrl(d.id, 1)}
                  className={`flex items-center gap-2.5 px-4 py-3 text-xs sm:text-sm transition-colors ${
                    active ? 'bg-green-50 border-r-4 border-green-700 font-bold text-green-900' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-[11px] text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                  <span className="leading-snug">{d.text}</span>
                </Link>
              )
            })}
          </div>
        </aside>

        {/* Left column: hadiths matching selected event */}
        <section className="lg:col-span-7 space-y-4">
          {selected ? (
            <>
              <div className="ui-card p-4 bg-amber-50/40 border-amber-200">
                <h2 className="text-base font-bold text-green-900">{selected.text}</h2>
                <p className="text-xs text-gray-600 mt-1">
                  {total.toLocaleString('ar-EG')} حديثاً مرتبطاً بهذا الحدث التاريخي
                </p>
              </div>

              {hadiths.length === 0 ? (
                <div className="ui-card p-8 text-center text-sm text-gray-400">
                  لا توجد أحاديث موسومة بهذا التاريخ في قاعدة البيانات
                </div>
              ) : (
                <div className="space-y-2.5">
                  {hadiths.map(h => (
                    <Link
                      key={h.main_id}
                      href={`/hadith/${h.main_id}`}
                      className="block ui-card p-4 hover:border-green-300 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-green-800">{h.book_title}</span>
                        <div className="flex items-center gap-2">
                          {(h.part_num || h.page_num) && (
                            <span className="text-[11px] text-gray-400">
                              {h.part_num ? `ج${h.part_num}` : ''}{h.page_num ? ` ص${h.page_num}` : ''}
                            </span>
                          )}
                          <HadithNumber harf={h.tarqeem_harf} matboa={h.tarqeem_matboa1} />
                        </div>
                      </div>
                      <p className="text-sm text-gray-800 leading-relaxed line-clamp-2">
                        {stripTags(h.tarf) || `حديث ${h.main_id}`}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {page > 1 && (
                    <Link
                      href={buildUrl(selected.id, page - 1)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-white text-xs hover:border-green-300"
                    >
                      السابق
                    </Link>
                  )}
                  <span className="text-xs text-gray-500">
                    صفحة {page.toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}
                  </span>
                  {page < totalPages && (
                    <Link
                      href={buildUrl(selected.id, page + 1)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-white text-xs hover:border-green-300"
                    >
                      التالي
                    </Link>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="ui-card p-8 text-center text-sm text-gray-400">
              اختر حدثاً من القائمة لعرض أحاديثه
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
