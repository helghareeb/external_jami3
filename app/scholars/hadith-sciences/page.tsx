import pool from '@/lib/db'
import Link from '@/app/components/Link'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'أقوال أهل العلم في علوم الحديث — جامع خادم الحرمين',
  description: 'أقوال المحدثين وأئمة علوم الحديث في مسائل المصطلح وأصول الرواية (مرتبة حسب العالم والمصطلح)',
}

interface ExpressionScholarRow {
  scientist_id: number
  scholar_name: string
  say_count: number
  term_count: number
}

interface ExpressionSayRow {
  link_id: number
  node_id: number
  tree_id: number | null
  term_text: string | null
  say: string
  service_main_id: number | null
  book_name: string | null
  part_num: number | null
  page_num: number | null
}

export default async function HadithSciencesPage({
  searchParams,
}: {
  searchParams: Promise<{ scholar?: string; q?: string }>
}) {
  const sp = await searchParams
  const requestedScholar = sp.scholar ? parseInt(sp.scholar, 10) || 0 : 0
  const q = (sp.q || '').trim()

  const scholarParams: string[] = []
  let whereClause = ''
  if (q) {
    scholarParams.push(`%${q}%`)
    whereClause = `WHERE COALESCE(NULLIF(n.abb_name, ''), n.name) ILIKE $1`
  }

  const [scholarsRes, totalRes] = await Promise.all([
    pool
      .query<ExpressionScholarRow>(
        `SELECT hes.scientist_id,
                COALESCE(NULLIF(n.abb_name, ''), n.name) AS scholar_name,
                COUNT(*)::int AS say_count,
                COUNT(DISTINCT hes.node_id)::int AS term_count
         FROM hadith_expressions_says hes
         JOIN narrators n ON n.id = hes.scientist_id
         ${whereClause}
         GROUP BY hes.scientist_id, COALESCE(NULLIF(n.abb_name, ''), n.name)
         ORDER BY say_count DESC, scholar_name ASC`,
        scholarParams
      )
      .catch(() => ({ rows: [] as ExpressionScholarRow[] })),
    pool
      .query<{ total_says: number; total_scholars: number; total_terms: number }>(
        `SELECT COUNT(*)::int AS total_says,
                COUNT(DISTINCT scientist_id)::int AS total_scholars,
                COUNT(DISTINCT node_id)::int AS total_terms
         FROM hadith_expressions_says`
      )
      .catch(() => ({ rows: [{ total_says: 0, total_scholars: 0, total_terms: 0 }] })),
  ])

  const scholars = scholarsRes.rows
  const stats = totalRes.rows[0] ?? { total_says: 0, total_scholars: 0, total_terms: 0 }
  const activeScholar =
    (requestedScholar > 0 ? scholars.find(s => s.scientist_id === requestedScholar) : null) ??
    scholars[0] ??
    null

  const sayings: ExpressionSayRow[] = activeScholar
    ? (
        await pool
          .query<ExpressionSayRow>(
            `SELECT hes.link_id,
                    hes.node_id,
                    het.id AS tree_id,
                    het.text AS term_text,
                    hes.say,
                    hes.service_main_id,
                    hsc.book_name,
                    hsc.part_num,
                    hsc.page_num
             FROM hadith_expressions_says hes
             LEFT JOIN hadith_expressions_tree het ON het.node_id = hes.node_id
             LEFT JOIN hadith_service_content hsc ON hsc.id = hes.service_main_id
             WHERE hes.scientist_id = $1
             ORDER BY het.left_value ASC NULLS LAST, hes.link_id ASC`,
            [activeScholar.scientist_id]
          )
          .catch(() => ({ rows: [] as ExpressionSayRow[] }))
      ).rows
    : []

  return (
    <div dir="rtl" className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">أقوال أهل العلم في علوم الحديث</h1>
        <p className="text-sm text-gray-500">
          {stats.total_says.toLocaleString('ar-EG')} قولاً عن {stats.total_scholars.toLocaleString('ar-EG')} إماماً في {stats.total_terms.toLocaleString('ar-EG')} مصطلحاً من مصطلحات علوم الحديث
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right sidebar: Scholars list */}
        <aside className="lg:col-span-4 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-3 text-xs font-bold flex items-center justify-between">
            <span>العلماء ({scholars.length.toLocaleString('ar-EG')})</span>
          </div>
          <form action="/scholars/hadith-sciences" method="get" className="p-3 border-b border-gray-100 flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="ابحث باسم العالم..."
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs focus:outline-none focus:border-green-600"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 rounded-lg bg-green-800 text-white text-xs font-semibold hover:bg-green-700"
            >
              بحث
            </button>
          </form>
          <div className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {scholars.map(s => {
              const active = activeScholar?.scientist_id === s.scientist_id
              return (
                <Link
                  key={s.scientist_id}
                  href={`/scholars/hadith-sciences?scholar=${s.scientist_id}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                  className={`flex items-center justify-between gap-2 px-4 py-2.5 text-xs transition-colors ${
                    active ? 'bg-green-50 border-r-4 border-green-700 font-bold' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-green-900 truncate">{s.scholar_name}</span>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {s.say_count.toLocaleString('ar-EG')} قول
                  </span>
                </Link>
              )
            })}
            {scholars.length === 0 && (
              <p className="p-6 text-center text-xs text-gray-400">لا توجد نتائج مطابقة</p>
            )}
          </div>
        </aside>

        {/* Left column: Scholar sayings */}
        <section className="lg:col-span-8 space-y-4">
          {activeScholar ? (
            <>
              <div className="ui-card p-4 bg-amber-50/40 border-amber-200 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-bold text-green-900">{activeScholar.scholar_name}</h2>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {activeScholar.say_count.toLocaleString('ar-EG')} قولاً في {activeScholar.term_count.toLocaleString('ar-EG')} مصطلحاً
                  </p>
                </div>
                <Link
                  href={`/narrator/${activeScholar.scientist_id}`}
                  className="text-xs text-green-800 font-semibold hover:underline"
                >
                  ترجمة العالم ←
                </Link>
              </div>

              <div className="space-y-3">
                {sayings.map(s => (
                  <div key={s.link_id} className="ui-card p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      {s.tree_id ? (
                        <Link
                          href={`/hadith-terms/${s.tree_id}`}
                          className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-900 border border-green-200 hover:bg-green-100"
                        >
                          {s.term_text || `مصطلح ${s.node_id}`}
                        </Link>
                      ) : (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-900 border border-green-200">
                          {s.term_text || `مصطلح ${s.node_id}`}
                        </span>
                      )}

                      {s.book_name && s.service_main_id ? (
                        <Link
                          href={`/service-content/${s.service_main_id}`}
                          className="text-xs text-blue-700 hover:underline"
                        >
                          {s.book_name}
                          {s.part_num || s.page_num
                            ? ` (${s.part_num ? `ج${s.part_num}` : ''}${s.part_num && s.page_num ? ' ' : ''}${s.page_num ? `ص${s.page_num}` : ''})`
                            : ''}
                        </Link>
                      ) : s.book_name ? (
                        <span className="text-xs text-gray-400">{s.book_name}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-800 leading-8">{s.say}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ui-card p-8 text-center text-sm text-gray-400">
              اختر عالماً لعرض أقواله في علوم الحديث
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
