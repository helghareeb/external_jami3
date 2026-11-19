import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const url = new URL(req.url)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24))

  const groupRes = await pool.query<{ group_id: number }>(
    `SELECT DISTINCT group_id
     FROM hadith_group_matn
     WHERE hadith_main_id = $1 AND group_id IS NOT NULL
     ORDER BY group_id`,
    [hadithId]
  ).catch(() => ({ rows: [] as Array<{ group_id: number }> }))

  const groupIds = groupRes.rows.map(r => Number(r.group_id))
  const groupId = groupIds[0] ?? null
  if (groupIds.length === 0) {
    return NextResponse.json({ members: [], total: 0, groupId: null, groupIds: [] })
  }

  const [countRes, membersRes] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT COUNT(DISTINCT gm.hadith_main_id)::int AS total
       FROM hadith_group_matn gm
       JOIN hadith_toc ht ON ht.main_id = gm.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
       WHERE gm.group_id = ANY($1::int[]) AND gm.hadith_main_id != $2`,
      [groupIds, hadithId]
    ).catch(() => ({ rows: [{ total: 0 }] })),
    pool.query<{
      hadith_id: number
      book_name: string
      tarf: string | null
      part_num: number | null
      page_num: number | null
    }>(
      `SELECT hadith_id, book_name, tarf, part_num, page_num
       FROM (
         SELECT DISTINCT ON (gm.hadith_main_id)
                gm.hadith_main_id AS hadith_id,
                ht.book_name,
                ht.tarf,
                ht.part_num,
                ht.page_num,
                ht.book_id,
                b.strong
         FROM hadith_group_matn gm
         JOIN hadith_toc ht ON ht.main_id = gm.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
         LEFT JOIN books b ON b.id = ht.book_id
         WHERE gm.group_id = ANY($1::int[]) AND gm.hadith_main_id != $2
         ORDER BY gm.hadith_main_id, ht.book_id
       ) sub
       ORDER BY sub.strong ASC NULLS LAST, sub.book_id ASC, sub.hadith_id ASC
       LIMIT $3`,
      [groupIds, hadithId, limit]
    ).catch(() => ({ rows: [] })),
  ])

  const total = Number(countRes.rows[0]?.total ?? membersRes.rows.length)

  return NextResponse.json({
    members: membersRes.rows,
    total,
    groupId,
    groupIds,
  })
}
