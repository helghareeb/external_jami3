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
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '80', 10) || 80))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)

  const [groupRes, matnGroupRes] = await Promise.all([
    pool.query<{ group_id: number }>(
      `SELECT DISTINCT group_id FROM takhrij WHERE hadith_id = $1 AND group_id IS NOT NULL ORDER BY group_id`,
      [hadithId]
    ).catch(() => ({ rows: [] as Array<{ group_id: number }> })),
    pool.query<{ group_id: number }>(
      `SELECT DISTINCT group_id FROM hadith_group_matn WHERE hadith_main_id = $1 AND group_id IS NOT NULL ORDER BY group_id`,
      [hadithId]
    ).catch(() => ({ rows: [] as Array<{ group_id: number }> })),
  ])

  const groupIds = groupRes.rows.map(r => Number(r.group_id))
  const matnGroupIds = matnGroupRes.rows.map(r => Number(r.group_id))
  const groupId = matnGroupIds[0] ?? groupIds[0] ?? null
  if (matnGroupIds.length === 0) {
    return NextResponse.json({ witnesses: [], total: 0, companionCount: 0, groupId: null, groupIds: [] })
  }

  // Match Windows Catalog.xml view `Shwahed`: HGamhAlMatn \ HTakhreeg
  const [countRes, witnessesRes] = await Promise.all([
    pool.query<{ total: number; companion_count: number }>(
      `SELECT COUNT(DISTINCT g2.hadith_main_id)::int AS total,
              COUNT(DISTINCT comp.id)::int AS companion_count
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
         ))`,
      [matnGroupIds, hadithId, groupIds]
    ).catch(() => ({ rows: [{ total: 0, companion_count: 0 }] })),

    pool.query(
      `SELECT companion_id, companion_name, companion_abb, hadith_id, tarf,
              book_title, takhrij_author, takhrij_death, chain_count
       FROM (
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
       ) sub
       ORDER BY (companion_id IS NULL), companion_id ASC NULLS LAST,
                book_strong ASC NULLS LAST, takhrij_death ASC NULLS LAST, hadith_id ASC
       LIMIT $4 OFFSET $5`,
      [matnGroupIds, hadithId, groupIds, limit, offset]
    ).catch(() => ({ rows: [] })),
  ])

  const total = Number(countRes.rows[0]?.total ?? witnessesRes.rows.length)
  const companionCount = Number(countRes.rows[0]?.companion_count ?? 0)

  return NextResponse.json({
    witnesses: witnessesRes.rows,
    total,
    companionCount,
    groupId,
    groupIds: matnGroupIds,
  })
}
