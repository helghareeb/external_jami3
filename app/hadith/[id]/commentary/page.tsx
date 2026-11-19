import pool from '@/lib/db'
import Link from '@/app/components/Link'
import { notFound } from 'next/navigation'
import { hadithSectionMeta } from '@/lib/entityMeta'

export const dynamic = 'force-dynamic'

function decodeEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function stripServiceTags(xml: string | null): string {
  if (!xml) return ''
  return decodeEntities(
    xml
      .replace(/<رقم_الفقرة[^>]*\/>/g, '')
      .replace(/<الصفحات[^>]*\/>/g, '')
      .replace(/<نه\/>/g, '\n')
      .replace(/<متن[^>]*>/g, '')
      .replace(/<\/متن>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return hadithSectionMeta(id, `/hadith/${id}/commentary`, 'الخدمات العلمية للحديث')
}

interface ContentRow {
  id: number
  book_name: string
  section_text: string | null
  part_num: number
  page_num: number
  tarf: string | null
  content: string | null
  type_id?: number
  type_name?: string | null
  is_group_fallback?: boolean
  fallback_hadith_id?: number | null
  fallback_book_title?: string | null
}

export default async function HadithCommentaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type?: string; types?: string; includeGroup?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) notFound()

  const requestedTypes = (sp.types || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isSafeInteger(n) && n > 0)

  const [hadithRes, linksRes, groupSharhCountRes] = await Promise.all([
    pool.query(
      `SELECT ht.main_id,
              regexp_replace(coalesce(ht.tarf,''), '<[^>]+>', ' ', 'g') AS tarf,
              b.title AS book_title, b.id AS book_id
       FROM hadith_toc ht
       JOIN books b ON b.id = ht.book_id
       WHERE ht.main_id = $1`,
      [hadithId]
    ),
    pool.query<{ type_id: number; type_name: string; count: number }>(
      `SELECT hsl.type_id::int AS type_id,
              coalesce(hst.name, 'غير محدد') AS type_name,
              COUNT(*)::int AS count
       FROM hadith_service_links hsl
       LEFT JOIN hadith_service_types hst ON hst.id = hsl.type_id
       WHERE hsl.hadith_id = $1
       GROUP BY hsl.type_id, hst.name
       ORDER BY hsl.type_id`,
      [hadithId]
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT hsl.service_content_id)::int AS n
       FROM takhrij t_self
       JOIN takhrij t_other ON t_other.group_id = t_self.group_id AND t_other.hadith_id <> $1
       JOIN hadith_service_links hsl ON hsl.hadith_id = t_other.hadith_id AND hsl.type_id = 6
       WHERE t_self.hadith_id = $1`,
      [hadithId]
    ).catch(() => ({ rows: [{ n: 0 }] })),
  ])

  const hadith = hadithRes.rows[0]
  if (!hadith) notFound()

  const typeGroups = [...linksRes.rows]
  const groupSharhCount = groupSharhCountRes.rows[0]?.n ?? 0
  if (!typeGroups.some(g => g.type_id === 6) && groupSharhCount > 0) {
    typeGroups.push({ type_id: 6, type_name: 'الشروح', count: groupSharhCount })
    typeGroups.sort((a, b) => a.type_id - b.type_id)
  }

  const parsedType = sp.type ? parseInt(sp.type, 10) : NaN
  const selectedTypeId =
    requestedTypes.length > 0
      ? (typeGroups.find(g => requestedTypes.includes(g.type_id))?.type_id ?? requestedTypes[0])
      : (!isNaN(parsedType) ? parsedType : typeGroups[0]?.type_id)

  const includeGroupFallback = selectedTypeId === 6 || sp.includeGroup === '1'

  let contentRows: ContentRow[] = []

  if (requestedTypes.length > 0) {
    const res = await pool.query<ContentRow>(
      `SELECT DISTINCT ON (hsc.id, hsl.type_id)
              hsc.id, hsc.book_name,
              hsc.section_text, hsc.part_num, hsc.page_num,
              hsc.tarf, hsc.content,
              hsl.type_id::int AS type_id,
              coalesce(hst.name, 'غير محدد') AS type_name
       FROM hadith_service_links hsl
       JOIN hadith_service_content hsc ON hsc.id = hsl.service_content_id
       LEFT JOIN hadith_service_types hst ON hst.id = hsl.type_id
       WHERE hsl.hadith_id = $1 AND hsl.type_id = ANY($2::int[])
       ORDER BY hsc.id, hsl.type_id DESC
       LIMIT 100`,
      [hadithId, requestedTypes]
    )
    contentRows = res.rows.sort((a, b) => (b.type_id ?? 0) - (a.type_id ?? 0) || a.id - b.id)
  } else if (selectedTypeId && typeGroups.length > 0) {
    const res = await pool.query<ContentRow>(
      `SELECT hsc.id, hsc.book_name,
              hsc.section_text, hsc.part_num, hsc.page_num,
              hsc.tarf, hsc.content,
              hsl.type_id::int AS type_id,
              coalesce(hst.name, 'غير محدد') AS type_name,
              false AS is_group_fallback
       FROM hadith_service_links hsl
       JOIN hadith_service_content hsc ON hsc.id = hsl.service_content_id
       LEFT JOIN hadith_service_types hst ON hst.id = hsl.type_id
       WHERE hsl.hadith_id = $1 AND hsl.type_id = $2
       ORDER BY hsc.book_id, hsc.id
       LIMIT 100`,
      [hadithId, selectedTypeId]
    )
    contentRows = res.rows

    if (includeGroupFallback && selectedTypeId === 6 && contentRows.length < 100) {
      const directIds = new Set(contentRows.map(r => Number(r.id)))
      const fbRes = await pool.query<ContentRow>(
        `SELECT DISTINCT ON (hsc.id)
                hsc.id, hsc.book_name,
                hsc.section_text, hsc.part_num, hsc.page_num,
                hsc.tarf, hsc.content,
                hsl.type_id::int AS type_id,
                coalesce(hst.name, 'الشروح') AS type_name,
                true AS is_group_fallback,
                t_other.hadith_id AS fallback_hadith_id,
                b_src.title AS fallback_book_title
         FROM takhrij t_self
         JOIN takhrij t_other ON t_other.group_id = t_self.group_id AND t_other.hadith_id <> $1
         JOIN hadith_service_links hsl ON hsl.hadith_id = t_other.hadith_id AND hsl.type_id = 6
         JOIN hadith_service_content hsc ON hsc.id = hsl.service_content_id
         LEFT JOIN hadith_service_types hst ON hst.id = hsl.type_id
         LEFT JOIN books b_src ON b_src.id = t_other.book_id
         WHERE t_self.hadith_id = $1
         ORDER BY hsc.id, hsc.book_id, t_other.hadith_id
         LIMIT 120`,
        [hadithId]
      ).catch(() => ({ rows: [] as ContentRow[] }))
      const extras = fbRes.rows.filter(r => !directIds.has(Number(r.id))).slice(0, 100 - contentRows.length)
      contentRows = [...contentRows, ...extras]
    }
  }

  const selectedGroup = typeGroups.find(g => g.type_id === selectedTypeId)

  return (
    <div dir="rtl" className="max-w-4xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4 flex-wrap">
        <Link href={`/books/${hadith.book_id}`} className="text-green-700 hover:underline">
          {hadith.book_title}
        </Link>
        <span>←</span>
        <Link href={`/hadith/${hadithId}`} className="text-green-700 hover:underline">
          {hadith.tarf?.slice(0, 60) || `حديث ${hadithId}`}…
        </Link>
        <span>←</span>
        <span>الخدمات العلمية</span>
      </div>

      <h1 className="text-lg font-bold text-green-900 mb-4">الخدمات العلمية للحديث</h1>

      {typeGroups.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-amber-800 font-medium">لا تتوفر خدمات علمية لهذا الحديث بعد</p>
          <p className="text-xs text-amber-600 mt-1">قد تكون البيانات لا تزال قيد التحميل</p>
          <Link href={`/hadith/${hadithId}`} className="inline-block mt-3 text-sm text-green-700 hover:underline">
            ← العودة للحديث
          </Link>
        </div>
      ) : (
        <>
          {/* Type tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {typeGroups.map(g => {
              const active = requestedTypes.length > 0 ? requestedTypes.includes(g.type_id) : g.type_id === selectedTypeId
              return (
                <Link
                  key={g.type_id}
                  href={`/hadith/${hadithId}/commentary?type=${g.type_id}`}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    active
                      ? 'bg-green-700 text-white border-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-green-300 bg-white'
                  }`}
                >
                  {g.type_name}
                  <span className={`mr-1.5 text-xs ${active ? 'text-green-200' : 'text-gray-400'}`}>
                    {g.count}
                  </span>
                </Link>
              )
            })}
          </div>

          {/* Content */}
          {(selectedGroup || requestedTypes.length > 0) && (
            <div>
              <h2 className="font-bold text-green-800 text-base mb-4 pb-2 border-b border-gray-100">
                {requestedTypes.includes(11) && requestedTypes.includes(12)
                  ? 'مختلف الحديث (أصل ومخالف)'
                  : (selectedGroup?.type_name ?? 'النصوص')}
              </h2>
              {contentRows.length === 0 ? (
                <p className="text-sm text-gray-400">لا توجد نصوص متاحة لهذا النوع</p>
              ) : (
                <div className="space-y-5">
                  {contentRows.map(row => (
                    <div key={`${row.id}-${row.type_id ?? ''}`} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/service-content/${row.id}`} className="text-sm font-semibold text-green-800 hover:underline">
                            {row.book_name}
                          </Link>
                          {requestedTypes.length > 1 && row.type_name && (
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                              row.type_id === 12
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {row.type_name}
                            </span>
                          )}
                          {row.is_group_fallback && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                              شرح عبر رواية أخرى{row.fallback_book_title ? ` (${row.fallback_book_title})` : ''}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {row.section_text?.trim() && <span>{row.section_text.trim()} · </span>}
                          {row.part_num > 0 && <span>ج{row.part_num} </span>}
                          {row.page_num > 0 && <span>ص{row.page_num}</span>}
                        </span>
                      </div>
                      <div className="p-4 text-sm leading-loose text-gray-800 whitespace-pre-line">
                        {stripServiceTags(row.content) || stripServiceTags(row.tarf) || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Back link */}
      <div className="mt-8 pt-4 border-t border-gray-100">
        <Link href={`/hadith/${hadithId}`} className="text-sm text-green-700 hover:underline">
          ← العودة لصفحة الحديث
        </Link>
      </div>
    </div>
  )
}
