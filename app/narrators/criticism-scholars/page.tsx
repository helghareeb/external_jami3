import pool from '@/lib/db'
import Link from '@/app/components/Link'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'أقوال أهل العلم في أحوال الرواة — جامع خادم الحرمين',
  description: 'تصفح أقوال أئمة الجرح والتعديل في الرواة مرتبةً حسب كل عالم ولفظ الجرح أو التعديل',
}

interface CriticRow {
  scientist_name: string
  scientist_noun_id: number | null
  say_count: number
  narrator_count: number
}

interface GarhTagRow {
  garh_label: string
  cnt: number
}

interface SayingRow {
  id: number
  narrator_id: number
  narrator_name: string
  narrator_abb: string | null
  martaba_ibn_hajar: string | null
  death_year_num: number | null
  garh_label: string | null
  say_text: string
}

function garhColor(label: string | null): string {
  if (!label) return 'bg-gray-100 text-gray-600 border-gray-200'
  if (/ثقة|ثبت|حجة|صدوق|لا بأس|إمام|حافظ|عدل/.test(label)) return 'bg-green-50 text-green-800 border-green-200'
  if (/لين|فيه شيء|محله|مقبول|يعتبر|صويلح/.test(label)) return 'bg-amber-50 text-amber-800 border-amber-200'
  if (/ضعيف|متروك|كذاب|وضاع|منكر|واه|ليس بشيء|هالك|ساقط/.test(label)) return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

export default async function CriticismScholarsPage({
  searchParams,
}: {
  searchParams: Promise<{ critic?: string; q?: string; garh?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q || '').trim()
  const requestedCritic = (sp.critic || '').trim()
  const garhFilter = (sp.garh || '').trim()
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const limit = 30
  const offset = (page - 1) * limit

  const criticParams: string[] = []
  let criticWhere = `WHERE scientist_name IS NOT NULL AND scientist_name != ''`
  if (q) {
    criticParams.push(`%${q}%`)
    criticWhere += ` AND scientist_name ILIKE $1`
  }

  const criticsRes = await pool
    .query<CriticRow>(
      `SELECT scientist_name,
              MIN(scientist_noun_id)::int AS scientist_noun_id,
              COUNT(*)::int AS say_count,
              COUNT(DISTINCT narrator_id)::int AS narrator_count
       FROM narrator_criticism
       ${criticWhere}
       GROUP BY scientist_name
       ORDER BY say_count DESC, scientist_name ASC
       LIMIT 200`,
      criticParams
    )
    .catch(() => ({ rows: [] as CriticRow[] }))

  const critics = criticsRes.rows
  const activeCritic =
    (requestedCritic && critics.find(c => c.scientist_name === requestedCritic)?.scientist_name) ||
    requestedCritic ||
    critics[0]?.scientist_name ||
    ''

  let garhTags: GarhTagRow[] = []
  let sayings: SayingRow[] = []
  let totalSayings = 0

  if (activeCritic) {
    const sayParams: Array<string | number> = [activeCritic]
    let garhCond = ''
    if (garhFilter) {
      sayParams.push(garhFilter)
      garhCond = `AND nc.garh_label = $${sayParams.length}`
    }

    const [tagsRes, cntRes, listRes] = await Promise.all([
      pool
        .query<GarhTagRow>(
          `SELECT garh_label, COUNT(*)::int AS cnt
           FROM narrator_criticism
           WHERE scientist_name = $1
             AND garh_label IS NOT NULL
             AND garh_label != ''
           GROUP BY garh_label
           ORDER BY cnt DESC
           LIMIT 18`,
          [activeCritic]
        )
        .catch(() => ({ rows: [] as GarhTagRow[] })),
      pool
        .query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM narrator_criticism nc
           WHERE nc.scientist_name = $1 ${garhCond}`,
          sayParams
        )
        .catch(() => ({ rows: [{ total: 0 }] })),
      pool
        .query<SayingRow>(
          `SELECT nc.id, nc.narrator_id,
                  n.name AS narrator_name, n.abb_name AS narrator_abb,
                  n.martaba_ibn_hajar, n.death_year_num,
                  nc.garh_label, nc.say_text
           FROM narrator_criticism nc
           JOIN narrators n ON n.id = nc.narrator_id
           WHERE nc.scientist_name = $1 ${garhCond}
           ORDER BY n.hadiths_count DESC NULLS LAST, nc.id ASC
           LIMIT $${sayParams.length + 1} OFFSET $${sayParams.length + 2}`,
          [...sayParams, limit, offset]
        )
        .catch(() => ({ rows: [] as SayingRow[] })),
    ])

    garhTags = tagsRes.rows
    totalSayings = cntRes.rows[0]?.total ?? 0
    sayings = listRes.rows
  }

  const activeCriticInfo = critics.find(c => c.scientist_name === activeCritic)
  const totalPages = Math.max(1, Math.ceil(totalSayings / limit))

  function buildUrl(overrides: Record<string, string | number | undefined>) {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (activeCritic) p.set('critic', activeCritic)
    if (garhFilter) p.set('garh', garhFilter)
    if (page > 1) p.set('page', String(page))
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '' || v === 0) p.delete(k)
      else p.set(k, String(v))
    }
    return `/narrators/criticism-scholars?${p.toString()}`
  }

  return (
    <div dir="rtl" className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-green-900 mb-1">أقوال أهل العلم في أحوال الرواة</h1>
        <p className="text-sm text-gray-500">
          أقوال أئمة النقد والجرح والتعديل في رواة الحديث — تصفح أقوال كل إمام ولفظ الجرح والتعديل الصادر عنه
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right sidebar: Critics list */}
        <aside className="lg:col-span-4 ui-card overflow-hidden">
          <div className="bg-green-900 text-white px-4 py-3 text-xs font-bold flex items-center justify-between">
            <span>أئمة الجرح والتعديل ({critics.length.toLocaleString('ar-EG')})</span>
          </div>
          <form action="/narrators/criticism-scholars" method="get" className="p-3 border-b border-gray-100 flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="ابحث باسم العالم الناقد..."
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
            {critics.map(c => {
              const active = c.scientist_name === activeCritic
              return (
                <Link
                  key={c.scientist_name}
                  href={buildUrl({ critic: c.scientist_name, garh: '', page: 1 })}
                  className={`flex items-center justify-between gap-2 px-4 py-2.5 text-xs transition-colors ${
                    active ? 'bg-green-50 border-r-4 border-green-700 font-bold' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-green-900 truncate">{c.scientist_name}</span>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {c.say_count.toLocaleString('ar-EG')} قول
                  </span>
                </Link>
              )
            })}
            {critics.length === 0 && (
              <p className="p-6 text-center text-xs text-gray-400">لم يُعثر على عالم بهذا الاسم</p>
            )}
          </div>
        </aside>

        {/* Left panel: Selected critic's sayings */}
        <section className="lg:col-span-8 space-y-4">
          {activeCritic ? (
            <>
              <div className="ui-card p-4 bg-amber-50/40 border-amber-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-green-900">{activeCritic}</h2>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {totalSayings.toLocaleString('ar-EG')} قولاً
                      {activeCriticInfo ? ` في ${activeCriticInfo.narrator_count.toLocaleString('ar-EG')} راوٍ` : ''}
                    </p>
                  </div>
                  {activeCriticInfo?.scientist_noun_id && (
                    <Link
                      href={`/narrator/${activeCriticInfo.scientist_noun_id}`}
                      className="text-xs text-green-800 hover:underline font-semibold"
                    >
                      ترجمة الناقد ←
                    </Link>
                  )}
                </div>

                {garhTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-amber-200/70">
                    <Link
                      href={buildUrl({ garh: '', page: 1 })}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                        !garhFilter
                          ? 'bg-green-800 text-white border-green-800'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
                      }`}
                    >
                      الكل
                    </Link>
                    {garhTags.map(t => (
                      <Link
                        key={t.garh_label}
                        href={buildUrl({ garh: t.garh_label, page: 1 })}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                          garhFilter === t.garh_label
                            ? 'bg-green-800 text-white border-green-800'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
                        }`}
                      >
                        {t.garh_label} ({t.cnt.toLocaleString('ar-EG')})
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {sayings.length === 0 ? (
                <div className="ui-card p-8 text-center text-sm text-gray-400">
                  لا توجد أقوال مطابقة للتصفية الحالية
                </div>
              ) : (
                <div className="space-y-2.5">
                  {sayings.map(s => (
                    <div key={s.id} className="ui-card p-4 space-y-2 hover:border-green-200 transition-colors">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Link
                          href={`/narrator/${s.narrator_id}`}
                          className="text-sm font-bold text-green-900 hover:underline"
                        >
                          {s.narrator_abb || s.narrator_name}
                        </Link>
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.garh_label && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${garhColor(s.garh_label)}`}>
                              {s.garh_label}
                            </span>
                          )}
                          {s.death_year_num != null && s.death_year_num > 0 && (
                            <span className="text-xs text-gray-400">ت {s.death_year_num}هـ</span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">{s.say_text}</p>
                    </div>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  {page > 1 && (
                    <Link
                      href={buildUrl({ page: page - 1 })}
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
                      href={buildUrl({ page: page + 1 })}
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
              اختر عالماً لعرض أقواله في الرواة
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
