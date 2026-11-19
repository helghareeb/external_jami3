import pool from '@/lib/db'
import Link from '@/app/components/Link'
import { parseCompoundMatnXml } from '@/lib/compoundMatn'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'المتون المجمعة — جامع خادم الحرمين',
  description: 'تصفح المتون المجمعة المعتمدة في الموسوعة مع مواضع الفروق والأسانيد وعزوها للكتب',
}

interface CompoundListRow {
  id: number
  hadith_main_id: number
  book_id: number
  book_title: string
  tarf: string | null
  tarqeem_matboa1: string | null
  tarqeem_harf: string | null
  group_size: number
}

interface BookFilterOption {
  id: number
  title: string
  cnt: number
}

interface SelectedCompoundRow {
  id: number
  hadith_main_id: number
  matn: string
  asaned_comp: string | null
  book_title: string
  tarf: string | null
}

function stripTags(raw: string | null): string {
  return (raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default async function CompoundMatnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; book?: string; id?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q || '').trim()
  const bookFilter = sp.book ? parseInt(sp.book, 10) || 0 : 0
  const requestedId = sp.id ? parseInt(sp.id, 10) || 0 : 0
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const limit = 24
  const offset = (page - 1) * limit

  const whereParts: string[] = []
  const params: Array<string | number> = []
  if (bookFilter > 0) {
    params.push(bookFilter)
    whereParts.push(`ht.book_id = $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    whereParts.push(`(ht.tarf ILIKE $${params.length} OR cm.matn ILIKE $${params.length})`)
  }
  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

  const [booksRes, cntRes, listRes, overallRes] = await Promise.all([
    pool
      .query<BookFilterOption>(
        `SELECT ht.book_id AS id, b.title, COUNT(*)::int AS cnt
         FROM hadith_compound_matn cm
         JOIN hadith_toc ht ON ht.main_id = cm.hadith_main_id
         JOIN books b ON b.id = ht.book_id
         GROUP BY ht.book_id, b.title, b.tarteeb
         ORDER BY cnt DESC, b.tarteeb ASC NULLS LAST
         LIMIT 30`
      )
      .catch(() => ({ rows: [] as BookFilterOption[] })),
    pool
      .query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM hadith_compound_matn cm
         JOIN hadith_toc ht ON ht.main_id = cm.hadith_main_id
         ${whereSql}`,
        params
      )
      .catch(() => ({ rows: [{ total: 0 }] })),
    pool
      .query<CompoundListRow>(
        `SELECT cm.id, cm.hadith_main_id, ht.book_id, b.title AS book_title,
                regexp_replace(coalesce(ht.tarf, ''), '<[^>]+>', ' ', 'g') AS tarf,
                ht.tarqeem_matboa1, ht.tarqeem_harf,
                (SELECT COUNT(DISTINCT t.hadith_id)::int FROM takhrij t WHERE t.compound_matn_id = cm.id) AS group_size
         FROM hadith_compound_matn cm
         JOIN hadith_toc ht ON ht.main_id = cm.hadith_main_id
         JOIN books b ON b.id = ht.book_id
         ${whereSql}
         ORDER BY cm.id ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      )
      .catch(() => ({ rows: [] as CompoundListRow[] })),
    pool
      .query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM hadith_compound_matn`)
      .catch(() => ({ rows: [{ total: 0 }] })),
  ])

  const books = booksRes.rows
  const total = cntRes.rows[0]?.total ?? 0
  const list = listRes.rows
  const overallTotal = overallRes.rows[0]?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const activeId = requestedId > 0 ? requestedId : (list[0]?.id ?? 0)
  const selectedRow =
    activeId > 0
      ? (
          await pool
            .query<SelectedCompoundRow>(
              `SELECT cm.id, cm.hadith_main_id, cm.matn, cm.asaned_comp,
                      b.title AS book_title,
                      regexp_replace(coalesce(ht.tarf, ''), '<[^>]+>', ' ', 'g') AS tarf
               FROM hadith_compound_matn cm
               JOIN hadith_toc ht ON ht.main_id = cm.hadith_main_id
               JOIN books b ON b.id = ht.book_id
               WHERE cm.id = $1`,
              [activeId]
            )
            .catch(() => ({ rows: [] as SelectedCompoundRow[] }))
        ).rows[0] ?? null
      : null

  const parsed = selectedRow ? parseCompoundMatnXml(selectedRow.id, selectedRow.matn) : null
  const footnoteEntries = parsed
    ? Object.entries(parsed.footnotes).sort(([a], [b]) => Number(a) - Number(b))
    : []

  function buildUrl(overrides: Record<string, string | number | undefined>) {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (bookFilter > 0) p.set('book', String(bookFilter))
    if (activeId > 0) p.set('id', String(activeId))
    if (page > 1) p.set('page', String(page))
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '' || v === 0) p.delete(k)
      else p.set(k, String(v))
    }
    const qs = p.toString()
    return qs ? `/compound-matn?${qs}` : '/compound-matn'
  }

  return (
    <div dir="rtl" className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">المتون المجمعة</h1>
        <p className="text-sm text-gray-500">
          {overallTotal.toLocaleString('ar-EG')} متناً مجمعاً معتمداً — يجمع ألفاظ الروايات في سياق واحد مع إحالة كل زيادة أو فرق إلى مصادرها
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div className="ui-card p-4 mb-5 space-y-3">
        <form action="/compound-matn" method="get" className="flex flex-wrap gap-2 items-center">
          {bookFilter > 0 && <input type="hidden" name="book" value={String(bookFilter)} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="ابحث في المتن المجمع أو طرف الحديث..."
            className="flex-1 min-w-[220px] rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-green-600"
          />
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg bg-green-800 text-white text-xs font-semibold hover:bg-green-700"
          >
            بحث
          </button>
          {(q || bookFilter > 0) && (
            <Link href="/compound-matn" className="text-xs text-green-700 hover:underline px-2">
              إعادة تعيين
            </Link>
          )}
        </form>

        {books.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 ml-1">المصدر:</span>
            <Link
              href={buildUrl({ book: 0, page: 1, id: 0 })}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                bookFilter === 0 ? 'bg-green-800 text-white border-green-800' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
              }`}
            >
              الكل ({overallTotal.toLocaleString('ar-EG')})
            </Link>
            {books.slice(0, 12).map(b => (
              <Link
                key={b.id}
                href={buildUrl({ book: b.id, page: 1, id: 0 })}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  bookFilter === b.id ? 'bg-green-800 text-white border-green-800' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
                }`}
              >
                {b.title} ({b.cnt.toLocaleString('ar-EG')})
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Right column: Paginated list */}
        <aside className="lg:col-span-5 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between">
            <span>قائمة المتون المجمعة ({total.toLocaleString('ar-EG')})</span>
            <span>صفحة {page.toLocaleString('ar-EG')} / {totalPages.toLocaleString('ar-EG')}</span>
          </div>
          {list.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">لا توجد متون مطابقة للبحث</p>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
              {list.map(row => {
                const isActive = selectedRow?.id === row.id
                return (
                  <Link
                    key={row.id}
                    href={buildUrl({ id: row.id })}
                    className={`block px-4 py-3 text-sm transition-colors ${
                      isActive ? 'bg-green-50 border-r-4 border-green-700' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-green-800">{row.book_title}</span>
                      {row.group_size > 0 && (
                        <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          {row.group_size.toLocaleString('ar-EG')} رواية
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">
                      {stripTags(row.tarf) || `المتن المجمع #${row.id}`}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs">
              {page > 1 ? (
                <Link href={buildUrl({ page: page - 1, id: 0 })} className="text-green-800 font-semibold hover:underline">
                  ← السابق
                </Link>
              ) : <span className="text-gray-300">← السابق</span>}
              {page < totalPages ? (
                <Link href={buildUrl({ page: page + 1, id: 0 })} className="text-green-800 font-semibold hover:underline">
                  التالي →
                </Link>
              ) : <span className="text-gray-300">التالي →</span>}
            </div>
          )}
        </aside>

        {/* Left column: Parsed Compound Matn viewer */}
        <section className="lg:col-span-7 space-y-4">
          {selectedRow && parsed ? (
            <div className="ui-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-border pb-3">
                <div>
                  <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                    المتن المجمع #{selectedRow.id}
                  </span>
                  <h2 className="text-base font-bold text-green-900 mt-1.5">{selectedRow.book_title}</h2>
                </div>
                <Link
                  href={`/hadith/${selectedRow.hadith_main_id}`}
                  className="text-xs font-semibold text-white bg-green-800 hover:bg-green-700 px-3 py-1.5 rounded-lg"
                >
                  فتح الحديث الأصل ←
                </Link>
              </div>

              {parsed.identicalNoteText && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {parsed.identicalNoteText}
                </p>
              )}

              <div className="text-base leading-[2.1] text-ink bg-[#FFFDF7] border border-[#E5D9BD] rounded-xl p-4">
                {parsed.segments.map((seg, idx) => {
                  if (seg.type === 'text') return <span key={idx}>{seg.text}</span>
                  return (
                    <span key={idx} className="inline">
                      <span
                        className="bg-amber-100/70 border-b border-amber-400 px-0.5 rounded-sm"
                        title={seg.summaryText || undefined}
                      >
                        {seg.text}
                      </span>
                      {seg.mmid && (
                        <sup className="text-[10px] font-bold text-green-800 mx-0.5">
                          [{seg.mmid}]
                        </sup>
                      )}
                    </span>
                  )
                })}
              </div>

              {selectedRow.asaned_comp && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 leading-relaxed">
                  <span className="font-bold text-green-900 block mb-1">تركيب الإسناد المجمع:</span>
                  {stripTags(selectedRow.asaned_comp)}
                </div>
              )}

              {footnoteEntries.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  <h3 className="text-xs font-bold text-green-900">
                    عزو المواضع والفروق ({footnoteEntries.length.toLocaleString('ar-EG')})
                  </h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {footnoteEntries.map(([mmid, bookGroups]) => (
                      <div key={mmid} className="rounded-lg border border-border bg-surface p-2.5 text-xs">
                        <span className="font-bold text-green-800 ml-1.5">[{mmid}]</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {bookGroups.flatMap(bg =>
                            bg.docs.map(doc => (
                              <Link
                                key={`${mmid}-${doc.mainId}`}
                                href={`/hadith/${doc.mainId}`}
                                className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50/70 px-2 py-0.5 text-green-900 hover:bg-green-100"
                              >
                                <span>{doc.bookName}</span>
                                {(doc.hadithNum || doc.hadithNumH) && (
                                  <span className="text-gray-500">({doc.hadithNum || doc.hadithNumH})</span>
                                )}
                              </Link>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ui-card p-8 text-center text-sm text-gray-400">
              اختر متناً من القائمة لعرض تفاصيله وفروقه
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
