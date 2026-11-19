import pool from '@/lib/db'
import Link from '@/app/components/Link'
import { notFound } from 'next/navigation'
import { hadithSectionMeta } from '@/lib/entityMeta'

export const dynamic = 'force-dynamic'

interface WitnessHadith {
  companion_id: number | null
  companion_name: string | null
  companion_abb: string | null
  hadith_id: number
  tarf: string | null
  book_title: string
  takhrij_author: string | null
  takhrij_death: number | null
  chain_count: number
}

interface CompanionFacet {
  companion_id: number | null
  companion_name: string
  cnt: number
}

function stripTags(s: string | null) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return hadithSectionMeta(id, `/hadith/${id}/witnesses`, 'الشواهد والمتابعات')
}

export default async function HadithWitnessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string; companion?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const hadithId = parseInt(id)
  if (isNaN(hadithId)) notFound()

  const pageNum = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const companionParam = (sp.companion || '').trim()
  const companionFilterId = companionParam === 'none' ? -1 : parseInt(companionParam, 10) || 0
  const pageSize = 60
  const offset = (pageNum - 1) * pageSize

  const [hadithRes, groupRes, matnGroupRes] = await Promise.all([
    pool.query(
      `SELECT ht.main_id,
              regexp_replace(coalesce(ht.tarf,''), '<[^>]+>', ' ', 'g') AS tarf,
              b.title AS book_title, b.takhrij_author,
              EXISTS (SELECT 1 FROM hadith_shawahed hs WHERE hs.hadith_main_id = ht.main_id) AS has_witness_flag
       FROM hadith_toc ht
       JOIN books b ON b.id = ht.book_id
       WHERE ht.main_id = $1`,
      [hadithId]
    ),
    pool.query<{ group_id: number }>(
      `SELECT group_id FROM takhrij WHERE hadith_id = $1 AND group_id IS NOT NULL ORDER BY group_id`,
      [hadithId]
    ),
    pool.query<{ group_id: number }>(
      `SELECT DISTINCT group_id FROM hadith_group_matn WHERE hadith_main_id = $1 AND group_id IS NOT NULL ORDER BY group_id`,
      [hadithId]
    ),
  ])

  const hadith = hadithRes.rows[0]
  if (!hadith) notFound()

  const groupIds = groupRes.rows.map(row => Number(row.group_id))
  const matnGroupIds = matnGroupRes.rows.map(row => Number(row.group_id))
  if (matnGroupIds.length === 0) {
    return (
      <div dir="rtl">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 flex-wrap">
          <Link href="/books" className="hover:text-green-700">الكتب</Link>
          <span>›</span>
          <Link href={`/hadith/${hadithId}`} className="hover:text-green-700">الحديث {hadithId}</Link>
          <span>›</span>
          <span className="text-gray-700">الشواهد والمتابعات</span>
        </div>
        <h1 className="text-xl font-bold text-green-900 mb-3">الشواهد والمتابعات</h1>
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-8 text-center text-gray-500">
          {hadith.has_witness_flag
            ? 'المصدر يشير إلى وجود شواهد لهذا الحديث، لكن علاقات المجموعة التي تربطها بالروايات الأخرى غير مخزنة في الجداول الحالية.'
            : 'لم يُعثر على شواهد أو متابعات لهذا الحديث في قاعدة البيانات'}
        </div>
        <div className="mt-4">
          <Link href={`/hadith/${hadithId}`} className="text-green-700 hover:underline text-sm">← عودة للحديث</Link>
        </div>
      </div>
    )
  }

  // Match Windows Catalog.xml view `Shwahed`: HGamhAlMatn \ HTakhreeg
  const companionSqlFilter =
    companionFilterId === -1
      ? 'WHERE companion_id IS NULL'
      : companionFilterId > 0
        ? 'WHERE companion_id = $6'
        : ''

  const dataParams: (number | number[])[] = [matnGroupIds, hadithId, groupIds, pageSize, offset]
  if (companionFilterId > 0) dataParams.push(companionFilterId)

  const [facetsRes, witnessesRes] = await Promise.all([
    pool.query<CompanionFacet>(
      `WITH base AS (
         SELECT DISTINCT ON (g2.hadith_main_id)
                comp.id AS companion_id,
                COALESCE(comp.abb_name, comp.name, '— غير محدد الصحابي') AS companion_name
         FROM hadith_group_matn g2
         JOIN hadith_toc ht ON ht.main_id = g2.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
         LEFT JOIN isnad_hadiths ih2 ON ih2.hadith_id = g2.hadith_main_id
         LEFT JOIN isnad_chains ic2 ON ic2.id = ih2.isnad_id
         LEFT JOIN narrators comp ON comp.id = ic2.narrator_id_array[1] AND comp.is_companion = true
         WHERE g2.group_id = ANY($1::int[])
           AND g2.hadith_main_id != $2
           AND NOT (g2.hadith_main_id IN (
             SELECT t2.hadith_id
             FROM takhrij t2
             WHERE t2.group_id = ANY($3::int[])
           ))
         ORDER BY g2.hadith_main_id, comp.id ASC NULLS LAST
       )
       SELECT companion_id, companion_name, COUNT(*)::int AS cnt
       FROM base
       GROUP BY companion_id, companion_name
       ORDER BY (companion_id IS NULL), cnt DESC, companion_name`,
      [matnGroupIds, hadithId, groupIds]
    ).catch(() => ({ rows: [] as CompanionFacet[] })),

    pool.query<WitnessHadith>(
      `WITH base AS (
         SELECT DISTINCT ON (g2.hadith_main_id)
                comp.id AS companion_id,
                comp.name AS companion_name,
                comp.abb_name AS companion_abb,
                g2.hadith_main_id AS hadith_id,
                regexp_replace(coalesce(ht.tarf,''), '<[^>]+>', ' ', 'g') AS tarf,
                b.title AS book_title,
                b.takhrij_author,
                b.takhrij_death,
                b.strong AS book_strong,
                (
                  SELECT COUNT(DISTINCT ic3.id)::int
                  FROM isnad_hadiths ih3
                  JOIN isnad_chains ic3 ON ic3.id = ih3.isnad_id
                  WHERE ih3.hadith_id = g2.hadith_main_id
                ) AS chain_count
         FROM hadith_group_matn g2
         JOIN hadith_toc ht ON ht.main_id = g2.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
         JOIN books b ON b.id = ht.book_id
         LEFT JOIN isnad_hadiths ih2 ON ih2.hadith_id = g2.hadith_main_id
         LEFT JOIN isnad_chains ic2 ON ic2.id = ih2.isnad_id
         LEFT JOIN narrators comp ON comp.id = ic2.narrator_id_array[1] AND comp.is_companion = true
         WHERE g2.group_id = ANY($1::int[])
           AND g2.hadith_main_id != $2
           AND NOT (g2.hadith_main_id IN (
             SELECT t2.hadith_id
             FROM takhrij t2
             WHERE t2.group_id = ANY($3::int[])
           ))
         ORDER BY g2.hadith_main_id, comp.id ASC NULLS LAST
       )
       SELECT companion_id, companion_name, companion_abb, hadith_id, tarf,
              book_title, takhrij_author, takhrij_death, chain_count
       FROM base
       ${companionSqlFilter}
       ORDER BY (companion_id IS NULL), companion_id ASC NULLS LAST,
                book_strong ASC NULLS LAST, takhrij_death ASC NULLS LAST, hadith_id ASC
       LIMIT $4 OFFSET $5`,
      dataParams
    ).catch(() => ({ rows: [] as WitnessHadith[] })),
  ])

  const facets = facetsRes.rows
  const totalWitnesses = facets.reduce((sum, f) => sum + Number(f.cnt), 0)
  const uniqueCompanionsCount = facets.length
  const filteredTotal = companionFilterId
    ? Number(facets.find(f => (companionFilterId === -1 ? f.companion_id === null : Number(f.companion_id) === companionFilterId))?.cnt ?? witnessesRes.rows.length)
    : totalWitnesses
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize))
  const witnesses = witnessesRes.rows

  // Group by companion for a cleaner display
  const byCompanion = new Map<string, WitnessHadith[]>()
  for (const w of witnesses) {
    const key = w.companion_name || '— غير محدد الصحابي'
    if (!byCompanion.has(key)) byCompanion.set(key, [])
    byCompanion.get(key)!.push(w)
  }

  function pageHref(targetPage: number, compVal = companionParam) {
    const p = new URLSearchParams()
    if (compVal) p.set('companion', compVal)
    if (targetPage > 1) p.set('page', String(targetPage))
    const qs = p.toString()
    return qs ? `/hadith/${hadithId}/witnesses?${qs}` : `/hadith/${hadithId}/witnesses`
  }

  return (
    <div dir="rtl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 flex-wrap">
        <Link href="/books" className="hover:text-green-700">الكتب</Link>
        <span>›</span>
        <Link href={`/hadith/${hadithId}`} className="hover:text-green-700">الحديث {hadithId}</Link>
        <span>›</span>
        <span className="text-gray-700">الشواهد والمتابعات</span>
      </div>

      <h1 className="text-xl font-bold text-green-900 mb-1">الشواهد والمتابعات</h1>
      <p className="text-sm text-gray-600 line-clamp-2 mb-1">{stripTags(hadith.tarf).slice(0, 150)}</p>
      <p className="text-xs text-gray-400 mb-4">{hadith.book_title} — {hadith.takhrij_author}</p>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-800">
        <span className="font-semibold">التعريف: </span>
        الشاهد هو حديث يُروى عن صحابي آخر بنفس معنى الحديث — يُستأنس به في الحكم على الأسانيد الأخرى.
        المتابعة هي رواية نفس الصحابي لكنها من طريق آخر. كلاهما يُستخدم لتقوية الحديث.
      </div>

      {totalWitnesses === 0 ? (
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-8 text-center text-gray-500">
          لم يُعثر على شواهد أو متابعات لهذا الحديث
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <div className="bg-green-800 text-white rounded-xl p-3 text-center">
              <div className="text-xl font-bold">{totalWitnesses.toLocaleString('ar-EG')}</div>
              <div className="text-xs opacity-80">طريق موازٍ</div>
            </div>
            <div className="bg-amber-600 text-white rounded-xl p-3 text-center">
              <div className="text-xl font-bold">{uniqueCompanionsCount.toLocaleString('ar-EG')}</div>
              <div className="text-xs opacity-80">مجموعة صحابي</div>
            </div>
            <div className="bg-indigo-700 text-white rounded-xl p-3 text-center">
              <div className="text-xl font-bold">{matnGroupIds.length.toLocaleString('ar-EG')}</div>
              <div className="text-xs opacity-80">عدد مجاميع المتن</div>
            </div>
          </div>

          {facets.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-100 p-3 mb-5">
              <div className="text-xs font-semibold text-gray-500 mb-2">تصفية بالصحابي ({facets.length.toLocaleString('ar-EG')}):</div>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                <Link
                  href={pageHref(1, '')}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    !companionParam ? 'bg-green-800 text-white border-green-800' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-green-50'
                  }`}
                >
                  الكل ({totalWitnesses.toLocaleString('ar-EG')})
                </Link>
                {facets.map((f, idx) => {
                  const val = f.companion_id != null ? String(f.companion_id) : 'none'
                  const active = companionParam === val
                  return (
                    <Link
                      key={`${val}-${idx}`}
                      href={pageHref(1, val)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active ? 'bg-green-800 text-white border-green-800' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-green-50'
                      }`}
                    >
                      {f.companion_name} ({Number(f.cnt).toLocaleString('ar-EG')})
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {/* Grouped by companion */}
          <div className="space-y-5">
            {Array.from(byCompanion.entries()).map(([companionName, hadiths]) => (
              <div key={companionName}>
                <h2 className="text-sm font-bold text-green-900 mb-2 flex items-center gap-2">
                  {hadiths[0].companion_id ? (
                    <>
                      <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
                      <Link href={`/narrator/${hadiths[0].companion_id}`}
                        className="hover:underline hover:text-green-700">
                        {companionName}
                      </Link>
                      <span className="text-xs font-normal text-gray-400">
                        ({hadiths.length} طريق)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1 h-4 bg-gray-400 rounded-full inline-block" />
                      <span className="text-gray-600">{companionName}</span>
                    </>
                  )}
                </h2>
                <div className="space-y-2 pr-3">
                  {hadiths.map(w => (
                    <Link key={w.hadith_id} href={`/hadith/${w.hadith_id}`}
                      className="block bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-green-200 hover:shadow-sm transition-all group">
                      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                        <span className="text-xs text-green-700 font-medium">{w.book_title}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {w.takhrij_author && (
                            <span className="text-xs text-gray-400">{w.takhrij_author}</span>
                          )}
                          {w.chain_count > 1 && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                              {w.chain_count} سند
                            </span>
                          )}
                          {w.takhrij_death && (
                            <span className="text-xs text-gray-400">ت {w.takhrij_death}هـ</span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2 group-hover:text-green-900">
                        {stripTags(w.tarf).slice(0, 200) || '...'}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6 text-sm">
              {pageNum > 1 && (
                <Link href={pageHref(pageNum - 1)} className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-gray-50">
                  السابق
                </Link>
              )}
              <span className="text-xs text-gray-500">
                صفحة {pageNum.toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')} ({filteredTotal.toLocaleString('ar-EG')} طريق)
              </span>
              {pageNum < totalPages && (
                <Link href={pageHref(pageNum + 1)} className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-gray-50">
                  التالي
                </Link>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-6 flex items-center gap-4 text-sm flex-wrap">
        <Link href={`/hadith/${hadithId}`} className="text-green-700 hover:underline">← الحديث</Link>
        <Link href={`/hadith/${hadithId}/all-narrators`} className="text-green-700 hover:underline">← جميع الرواة</Link>
        <Link href={`/hadith/${hadithId}/chain-analysis`} className="text-green-700 hover:underline">← تحليل الإسناد</Link>
        <Link href="/scholars/parallel-routes" className="text-green-700 hover:underline">← الشواهد والمتابعات العامة</Link>
      </div>
    </div>
  )
}
