import pool from '@/lib/db'
import Link from '@/app/components/Link'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'تعريفات الكتب والمصنفين — جامع خادم الحرمين',
  description: 'بطاقات التعريف بكتب السنة والكتب الخدمية ومؤلفيها ومناهجهم في التصنيف',
}

interface BookDefinitionRow {
  id: number
  title: string
  summary: string | null
  card_info: string | null
  takhrij_author: string | null
  takhrij_death: number | null
  section_name: string | null
  author_id: number | null
  author_name: string | null
  author_short_name: string | null
  author_death: number | null
  author_info: string | null
}

function parseRichTextBlocks(raw: string | null): Array<{ heading?: string; text: string }> {
  if (!raw || !raw.trim()) return []
  const normalized = raw
    .replace(/<\/عنوان_رئيسي>/g, '\n')
    .replace(/<عنوان_رئيسي[^>]*>/g, '##HEADING##')
    .replace(/<نه\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')

  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean)
  const blocks: Array<{ heading?: string; text: string }> = []
  let currentHeading: string | undefined

  for (const line of lines) {
    if (line.startsWith('##HEADING##')) {
      currentHeading = line.replace(/^##HEADING##/, '').trim()
    } else {
      blocks.push({ heading: currentHeading, text: line })
      currentHeading = undefined
    }
  }
  if (currentHeading) blocks.push({ heading: currentHeading, text: '' })
  return blocks
}

export default async function DefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; book?: string; q?: string }>
}) {
  const sp = await searchParams
  const tab = sp.tab === 'service' ? 'service' : 'hadith'
  const q = (sp.q || '').trim()
  const requestedBook = sp.book ? parseInt(sp.book, 10) || 0 : 0

  // Legacy Catalog.xml ranges: HadithBooks (left_value > 2 AND right_value < 23),
  // ServiceBooks (left_value > 24 AND right_value < 49)
  const rangeCond =
    tab === 'hadith'
      ? 's.left_value > 2 AND s.right_value < 23'
      : 's.left_value > 24 AND s.right_value < 49'

  const booksRes = await pool
    .query<BookDefinitionRow>(
      `SELECT DISTINCT ON (b.tarteeb, b.id)
              b.id, b.title, b.summary, b.card_info,
              b.takhrij_author, b.takhrij_death,
              s.name AS section_name,
              a.id AS author_id,
              a.name AS author_name,
              a.short_name AS author_short_name,
              a.death_date AS author_death,
              a.info AS author_info
       FROM books b
       JOIN section_books sb ON sb.book_id = b.id
       JOIN sections s ON s.id = sb.section_id
       LEFT JOIN authors a ON a.id = b.author_id
       WHERE ${rangeCond}
       ORDER BY b.tarteeb ASC NULLS LAST, b.id ASC`
    )
    .catch(() => ({ rows: [] as BookDefinitionRow[] }))

  const allBooks = booksRes.rows
  const filteredBooks = q
    ? allBooks.filter(
        b =>
          b.title.includes(q) ||
          (b.takhrij_author && b.takhrij_author.includes(q)) ||
          (b.author_name && b.author_name.includes(q)) ||
          (b.author_short_name && b.author_short_name.includes(q))
      )
    : allBooks

  const selected =
    (requestedBook > 0 ? allBooks.find(b => b.id === requestedBook) : null) ??
    filteredBooks[0] ??
    allBooks[0] ??
    null

  const cardBlocks = parseRichTextBlocks(selected?.card_info ?? null)
  const summaryBlocks = parseRichTextBlocks(selected?.summary ?? null)
  const authorBlocks = parseRichTextBlocks(selected?.author_info ?? null)

  function buildUrl(overrides: Record<string, string | number | undefined>) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    if (q) p.set('q', q)
    if (selected) p.set('book', String(selected.id))
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '' || v === 0) p.delete(k)
      else p.set(k, String(v))
    }
    return `/definitions?${p.toString()}`
  }

  return (
    <div dir="rtl" className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">التعريف بالكتب والمصنفين</h1>
        <p className="text-sm text-gray-500">
          البطاقة التعريفية للكتاب ومنهج مصنّفه وترجمة المؤلف — للمصادر المسندة والكتب الخدمية
        </p>
      </div>

      {/* Tabs & search */}
      <div className="ui-card p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="ui-segmented">
          <Link
            href="/definitions?tab=hadith"
            className={`ui-segmented-item ${tab === 'hadith' ? 'ui-segmented-item-active' : ''}`}
          >
            كتب المتون
          </Link>
          <Link
            href="/definitions?tab=service"
            className={`ui-segmented-item ${tab === 'service' ? 'ui-segmented-item-active' : ''}`}
          >
            الكتب الخدمية
          </Link>
        </div>

        <form action="/definitions" method="get" className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
          <input type="hidden" name="tab" value={tab} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="تصفية باسم الكتاب أو المؤلف..."
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-green-600"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-green-800 text-white text-xs font-semibold hover:bg-green-700"
          >
            بحث
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right panel: book list */}
        <aside className="lg:col-span-4 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between">
            <span>{tab === 'hadith' ? 'كتب المتون' : 'الكتب الخدمية'}</span>
            <span>{filteredBooks.length.toLocaleString('ar-EG')} كتاباً</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
            {filteredBooks.map(b => {
              const active = selected?.id === b.id
              const authorLabel = b.author_short_name || b.takhrij_author || b.author_name
              const deathLabel = b.author_death || b.takhrij_death
              return (
                <Link
                  key={b.id}
                  href={buildUrl({ book: b.id })}
                  className={`block px-4 py-3 text-sm transition-colors ${
                    active ? 'bg-green-50 border-r-4 border-green-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-semibold text-green-900 leading-snug">{b.title}</div>
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500 mt-1">
                    <span className="truncate">{authorLabel || b.section_name || '—'}</span>
                    {deathLabel ? <span className="shrink-0">ت {deathLabel}هـ</span> : null}
                  </div>
                </Link>
              )
            })}
            {filteredBooks.length === 0 && (
              <p className="p-6 text-center text-sm text-gray-400">لا توجد كتب مطابقة</p>
            )}
          </div>
        </aside>

        {/* Left panel: Book & Author definition */}
        <section className="lg:col-span-8 space-y-5">
          {selected ? (
            <>
              <div className="ui-card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap border-b border-border pb-3">
                  <div>
                    <h2 className="text-xl font-bold text-green-900">{selected.title}</h2>
                    <p className="text-xs text-gray-500 mt-1">
                      {[selected.section_name, selected.author_short_name || selected.takhrij_author || selected.author_name]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Link
                    href={`/books/${selected.id}`}
                    className="text-xs font-semibold bg-green-800 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                  >
                    تصفح الكتاب ←
                  </Link>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-amber-900 mb-2">تعريف بالكتاب ومنهجه</h3>
                  {cardBlocks.length === 0 && summaryBlocks.length === 0 ? (
                    <p className="text-sm text-gray-400">لا تتوفر بطاقة تعريف مسجلة لهذا الكتاب.</p>
                  ) : (
                    <div className="space-y-3 text-sm leading-8 text-gray-800">
                      {cardBlocks.length > 0 && (
                        <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 space-y-1">
                          {cardBlocks.map((bl, i) => (
                            <p key={i} className="text-xs sm:text-sm leading-relaxed">
                              {bl.text}
                            </p>
                          ))}
                        </div>
                      )}
                      {summaryBlocks.map((bl, i) => (
                        <div key={i}>
                          {bl.heading && (
                            <h4 className="font-bold text-green-900 text-sm mt-2 mb-1">{bl.heading}</h4>
                          )}
                          {bl.text && <p>{bl.text}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="ui-card p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border pb-2">
                  <h3 className="text-base font-bold text-green-900">
                    تعريف بالمؤلف:{' '}
                    {selected.author_name || selected.takhrij_author || selected.author_short_name || 'غير محدد'}
                  </h3>
                  {(selected.author_death || selected.takhrij_death) && (
                    <span className="text-xs text-gray-500">
                      ت {selected.author_death || selected.takhrij_death} هـ
                    </span>
                  )}
                </div>

                {authorBlocks.length === 0 ? (
                  <p className="text-sm text-gray-400">لا تتوفر ترجمة مفصلة للمؤلف في قاعدة البيانات.</p>
                ) : (
                  <div className="space-y-2 text-sm leading-8 text-gray-800">
                    {authorBlocks.map((bl, i) => (
                      <div key={i}>
                        {bl.heading && (
                          <h4 className="font-bold text-green-900 text-sm mt-2">{bl.heading}</h4>
                        )}
                        {bl.text && <p>{bl.text}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="ui-card p-8 text-center text-sm text-gray-400">
              اختر كتاباً لعرض بطاقته التعريفية
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
