import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

interface TypeGroupRow {
  type_id: number
  type_name: string
  count: number
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const rawType = parseInt(url.searchParams.get('type') || '', 10)
  const typeId = Number.isSafeInteger(rawType) && rawType > 0 ? rawType : null
  const requestedTypes = (url.searchParams.get('types') || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isSafeInteger(n) && n > 0)
  const includeGroup = url.searchParams.get('includeGroup') === '1'

  const groupsRes = await pool.query<TypeGroupRow>(
    `SELECT hsl.type_id::int AS type_id,
            coalesce(hst.name, 'غير محدد') AS type_name,
            COUNT(*)::int AS count
     FROM hadith_service_links hsl
     LEFT JOIN hadith_service_types hst ON hst.id = hsl.type_id
     WHERE hsl.hadith_id = $1
     GROUP BY hsl.type_id, hst.name
     ORDER BY hsl.type_id`,
    [hadithId]
  ).catch(() => ({ rows: [] as TypeGroupRow[] }))

  const typeGroups: TypeGroupRow[] = [...groupsRes.rows]
  let selectedTypeId: number | null =
    requestedTypes.length > 0
      ? (typeGroups.find(g => requestedTypes.includes(Number(g.type_id)))?.type_id ?? null)
      : (typeId ?? (typeGroups[0]?.type_id != null ? Number(typeGroups[0].type_id) : null))

  let contentRows: ContentRow[] = []

  if (requestedTypes.length > 0) {
    if (typeGroups.some(g => requestedTypes.includes(Number(g.type_id)))) {
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
      ).catch(() => ({ rows: [] as ContentRow[] }))
      // Put type_id = 12 (مخالف) first, then 11 (أصل), ordered cleanly by book/id
      contentRows = res.rows.sort((a, b) => (b.type_id ?? 0) - (a.type_id ?? 0) || a.id - b.id)
    }
  } else if (selectedTypeId) {
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
    ).catch(() => ({ rows: [] as ContentRow[] }))
    contentRows = res.rows

    // Group-level شرح fallback (type_id = 6 across parallel narrations in the same takhrij groups)
    if (includeGroup && selectedTypeId === 6 && contentRows.length < 100) {
      const directIds = new Set(contentRows.map(r => Number(r.id)))
      const remaining = 100 - contentRows.length
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

      const extras = fbRes.rows.filter(r => !directIds.has(Number(r.id))).slice(0, remaining)
      if (extras.length > 0) {
        contentRows = [...contentRows, ...extras]
        if (!typeGroups.some(g => Number(g.type_id) === 6)) {
          typeGroups.push({ type_id: 6, type_name: 'الشروح', count: contentRows.length })
          typeGroups.sort((a, b) => Number(a.type_id) - Number(b.type_id))
        }
      }
    }
  }

  // Enforce strict API contract invariants
  if (typeGroups.length === 0) {
    contentRows = []
    selectedTypeId = null
  }

  return NextResponse.json({ typeGroups, contentRows, selectedTypeId })
}
