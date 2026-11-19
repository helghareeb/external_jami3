import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id)
  if (isNaN(hadithId)) return NextResponse.json({ parallels: [] })

  // Get ALL group_ids for this hadith (a hadith can appear in multiple takhrij groups)
  const groupRes = await pool.query<{ group_id: number }>(
    `SELECT DISTINCT group_id FROM takhrij WHERE hadith_id = $1 AND group_id IS NOT NULL ORDER BY group_id`,
    [hadithId]
  )
  if (groupRes.rows.length === 0) return NextResponse.json({ parallels: [] })

  const groupIds = groupRes.rows.map(r => Number(r.group_id))
  const groupId = groupIds[0]

  // Get all parallel hadiths across matching groups (excluding current, deduplicated per hadith)
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.hadith_id)
         t.hadith_id AS main_id,
         t.book_id,
         b.tarteeb,
         b.title AS book_title,
         b.takhrij_author,
         b.takhrij_death,
         h.tarf,
         h.content,
         h.part_num,
         h.page_num,
         h.tarqeem_harf,
         h.tarqeem_matboa1,
         h.section_text,
         h.chapter_text,
         jg.grade_hint,
         comp.companion_id,
         n.name AS companion_name
       FROM takhrij t
       JOIN hadith_toc h ON h.main_id = t.hadith_id
       JOIN books b ON b.id = t.book_id
       LEFT JOIN LATERAL (
         SELECT ic.narrator_id_array[1] as companion_id
         FROM isnad_hadiths ih2
         JOIN isnad_chains ic ON ic.id = ih2.isnad_id
         WHERE ih2.hadith_id = t.hadith_id AND ic.narrator_id_array[1] IS NOT NULL
         LIMIT 1
       ) comp ON true
       LEFT JOIN narrators n ON n.id = comp.companion_id
       LEFT JOIN LATERAL (
         SELECT CASE
           WHEN say_text ~* 'صحيح' THEN 'صحيح'
           WHEN say_text ~* 'إسناده حسن|حديث حسن|سنده حسن' AND say_text !~* 'صحيح' THEN 'حسن'
           WHEN say_text ~* 'ضعيف|منكر|متروك|موضوع' THEN 'ضعيف'
           ELSE NULL END as grade_hint
         FROM hadith_judgments j2
         WHERE j2.hadith_id = t.hadith_id
           AND (j2.say_text ~* 'صحيح|إسناده حسن|حديث حسن|سنده حسن|ضعيف|منكر|متروك')
         ORDER BY CASE
           WHEN j2.say_text ~* 'صحيح' THEN 1
           WHEN j2.say_text ~* 'حسن' THEN 2
           ELSE 3 END
         LIMIT 1
       ) jg ON true
       WHERE t.group_id = ANY($1::int[])
         AND t.hadith_id != $2
       ORDER BY t.hadith_id, t.group_id
     ) sub
     ORDER BY sub.tarteeb NULLS LAST, sub.book_id, sub.main_id
     LIMIT 1500`,
    [groupIds, hadithId]
  )

  return NextResponse.json({ parallels: rows, groupId, groupIds })
}
