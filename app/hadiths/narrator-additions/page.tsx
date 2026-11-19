import pool from '@/lib/db'
import Link from '@/app/components/Link'
import HadithNumber from '@/app/components/HadithNumber'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'زوائد الرواة عن المصنفين — جامع خادم الحرمين' }

interface BookExtraRow {
  book_id: number
  book_title: string
  takhrij_author: string | null
  rawy_id: number
  rawy_name: string
  expected_count: number
}

interface ExtraHadithRow {
  main_id: number
  tarf: string | null
  content: string | null
  chapter_text: string | null
  section_text: string | null
  tarqeem_harf: string | null
  tarqeem_matboa1: string | null
  part_num: number | null
  page_num: number | null
}

function stripTags(raw: string | null): string {
  return (raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default async function NarratorAdditionsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; rawy?: string; page?: string }>
}) {
  const sp = await searchParams
  const requestedBook = sp.book ? parseInt(sp.book, 10) : null
  const requestedRawy = sp.rawy ? parseInt(sp.rawy, 10) : null
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const limit = 30
  const offset = (page - 1) * limit

  const extraRes = await pool
    .query<BookExtraRow>(
      `SELECT be.book_id,
              b.title AS book_title,
              b.takhrij_author,
              be.rawy_id,
              COALESCE(NULLIF(n.abb_name, ''), NULLIF(be.rawy_name, ''), n.name) AS rawy_name,
              be.count::int AS expected_count
       FROM book_extra be
       JOIN books b ON b.id = be.book_id
       LEFT JOIN narrators n ON n.id = be.rawy_id
       ORDER BY be.count DESC, be.book_id ASC, be.rawy_id ASC`
    )
    .catch(() => ({ rows: [] as BookExtraRow[] }))

  const rows = extraRes.rows
  const selected =
    rows.find(
      r =>
        (requestedBook == null || r.book_id === requestedBook) &&
        (requestedRawy == null || r.rawy_id === requestedRawy) &&
        (requestedBook != null || requestedRawy != null)
    ) ?? rows[0] ?? null

  let hadiths: ExtraHadithRow[] = []
  let totalHadiths = 0

  if (selected) {
    const xmlPattern = `%<زيادات%ربط="${selected.rawy_id}"%`
    const [cntRes, listRes] = await Promise.all([
      pool
        .query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM hadith_toc
           WHERE book_id = $1
             AND is_leaf = true
             AND is_paragraph = true
             AND content LIKE $2`,
          [selected.book_id, xmlPattern]
        )
        .catch(() => ({ rows: [{ total: 0 }] })),
      pool
        .query<ExtraHadithRow>(
          `SELECT main_id, tarf, content, chapter_text, section_text,
                  tarqeem_harf, tarqeem_matboa1, part_num, page_num
           FROM hadith_toc
           WHERE book_id = $1
             AND is_leaf = true
             AND is_paragraph = true
             AND content LIKE $2
           ORDER BY left_value ASC
           LIMIT $3 OFFSET $4`,
          [selected.book_id, xmlPattern, limit, offset]
        )
        .catch(() => ({ rows: [] as ExtraHadithRow[] })),
    ])
    totalHadiths = cntRes.rows[0]?.total ?? 0
    hadiths = listRes.rows
  }

  const totalPages = Math.max(1, Math.ceil(totalHadiths / limit))
  const totalZawaed = rows.reduce((s, r) => s + r.expected_count, 0)

  function buildUrl(bookId: number, rawyId: number, pg = 1) {
    const p = new URLSearchParams()
    p.set('book', String(bookId))
    p.set('rawy', String(rawyId))
    if (pg > 1) p.set('page', String(pg))
    return `/hadiths/narrator-additions?${p.toString()}`
  }

  return (
    <div dir="rtl" className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">زوائد الرواة عن المصنفين</h1>
        <p className="text-sm text-gray-500">
          الأحاديث والآثار التي زادها رواة الكتب على أصول المصنفين — من جدول الزوائد المعتمد في البرنامج ({totalZawaed.toLocaleString('ar-EG')} موضعاً عبر {rows.length} ترجمة)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right panel (list of 12 BookExtra entries matching Windows CDlgDisplayRwahExtra) */}
        <aside className="lg:col-span-5 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-3 text-sm font-bold flex items-center justify-between">
            <span>قائمة الزوائد ({rows.length})</span>
            <span className="text-xs font-normal text-amber-200">{totalZawaed.toLocaleString('ar-EG')} حديثاً</span>
          </div>
          <div className="divide-y divide-gray-100">
            {rows.map((r, idx) => {
              const active = selected?.book_id === r.book_id && selected?.rawy_id === r.rawy_id
              return (
                <Link
                  key={`${r.book_id}-${r.rawy_id}`}
                  href={buildUrl(r.book_id, r.rawy_id, 1)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors ${
                    active ? 'bg-green-50 border-r-4 border-green-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                      <span className="font-bold text-green-900 truncate">{r.rawy_name}</span>
                    </div>
                    <p className="text-xs text-gray-500 mr-7 truncate mt-0.5">{r.book_title}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900">
                    {r.expected_count.toLocaleString('ar-EG')}
                  </span>
                </Link>
              )
            })}
          </div>
        </aside>

        {/* Left panel: hadiths for selected (book, rawy) */}
        <section className="lg:col-span-7 space-y-4">
          {selected ? (
            <>
              <div className="ui-card p-4 bg-amber-50/40 border-amber-200 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-green-900">{selected.rawy_name}</h2>
                    <Link href={`/narrator/${selected.rawy_id}`} className="text-xs text-green-700 hover:underline">
                      بطاقة الراوي ←
                    </Link>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    الكتاب:{' '}
                    <Link href={`/books/${selected.book_id}`} className="font-medium text-green-800 hover:underline">
                      {selected.book_title}
                    </Link>
                    {' · '}
                    <span>{totalHadiths.toLocaleString('ar-EG')} حديث من الزوائد</span>
                  </p>
                </div>
              </div>

              {hadiths.length === 0 ? (
                <div className="ui-card p-8 text-center text-sm text-gray-400">
                  لم يُعثر على نصوص موسومة بوسم الزوائد لهذا الراوي في هذا الكتاب
                </div>
              ) : (
                <div className="space-y-2.5">
                  {hadiths.map(h => {
                    const snippet = stripTags(h.tarf || h.content).slice(0, 220)
                    return (
                      <Link
                        key={h.main_id}
                        href={`/hadith/${h.main_id}`}
                        className="block ui-card p-4 hover:border-green-300 transition-all"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {h.chapter_text || h.section_text || selected.book_title}
                          </span>
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
                          {snippet || `حديث رقم ${h.main_id}`}
                        </p>
                      </Link>
                    )
                  })}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {page > 1 && (
                    <Link
                      href={buildUrl(selected.book_id, selected.rawy_id, page - 1)}
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
                      href={buildUrl(selected.book_id, selected.rawy_id, page + 1)}
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
              لا توجد بيانات زوائد مسجلة
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
