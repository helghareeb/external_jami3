import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

interface CategoryRow {
  id: number
  name: string
  count: number
}

interface GwamhItemRow {
  gamh_id: number
  id: number
  text: string
  abb_name: string | null
  tabaqa: string | null
  death_year_num: number | null
  is_companion: boolean
  hadiths_count: number
  athar_count: number
}

interface GwamhHadithRow {
  main_id: number
  book_id: number
  book_title: string
  tarf: string | null
  tarqeem_matboa1: string | null
  tarqeem_harf: string | null
  part_num: number
  page_num: number
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawGamh = parseInt(searchParams.get('gamhId') || '1', 10)
  const gamhId = rawGamh === 2 ? 2 : 1
  const rawNarrator = parseInt(searchParams.get('narratorId') || '', 10)
  const q = (searchParams.get('q') || '').trim()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '36', 10) || 36))
  const offset = (page - 1) * limit

  try {
    // Legacy GwamhItems mixes some non-companions into gamh_id=1 and companions into gamh_id=2.
    // Enforce true classification from narrators.is_companion so آثار الصحابة strictly lists companions
    // and آثار التابعين strictly lists non-companions.
    const categoriesRes = await pool.query<CategoryRow>(
      `SELECT g.id, g.name,
              (SELECT COUNT(*)::int
               FROM gwamh_items gi
               JOIN narrators n ON n.id = gi.id
               WHERE gi.gamh_id = g.id
                 AND ((g.id = 1 AND n.is_companion = true)
                      OR (g.id = 2 AND COALESCE(n.is_companion, false) = false))) AS count
       FROM gwamh g
       ORDER BY g.id`
    )
    const categories = categoriesRes.rows
    const targetIsnadType = gamhId === 1 ? 2 : 3

    // When a narrator is selected, load their direct موقوف (isnad_type=2) or مقطوع (isnad_type=3) narrations
    if (Number.isSafeInteger(rawNarrator) && rawNarrator > 0) {
      const narInfoRes = await pool.query<{
        id: number
        text: string
        name: string | null
        abb_name: string | null
        tabaqa: string | null
        death_year_num: number | null
        is_companion: boolean | null
      }>(
        `SELECT COALESCE(gi.id, n.id) AS id,
                COALESCE(gi.text, n.name) AS text,
                n.name, n.abb_name, n.tabaqa, n.death_year_num, n.is_companion
         FROM narrators n
         LEFT JOIN gwamh_items gi ON gi.id = n.id AND gi.gamh_id = $2
         WHERE n.id = $1`,
        [rawNarrator, gamhId]
      )
      const narrator = narInfoRes.rows[0] ?? null
      const eligible =
        narrator != null &&
        (gamhId === 1 ? Boolean(narrator.is_companion) : !Boolean(narrator.is_companion))

      const matchScope = 'root' as const
      let total = 0
      let hadiths: GwamhHadithRow[] = []

      if (eligible) {
        const [cntRes, hRes] = await Promise.all([
          pool.query<{ total: number }>(
            `SELECT COUNT(DISTINCT ih.hadith_id)::int AS total
             FROM isnad_chains ic
             JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
             WHERE ic.narrator_id_array @> ARRAY[$1]::int[]
               AND ic.narrator_id_array[1] = $1
               AND ih.isnad_type = $2`,
            [rawNarrator, targetIsnadType]
          ),
          pool.query<GwamhHadithRow>(
            `SELECT DISTINCT ON (ht.main_id)
                    ht.main_id, ht.book_id, b.title AS book_title,
                    regexp_replace(coalesce(ht.tarf, ''), '<[^>]+>', ' ', 'g') AS tarf,
                    ht.tarqeem_matboa1, ht.tarqeem_harf,
                    ht.part_num, ht.page_num
             FROM isnad_chains ic
             JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
             JOIN hadith_toc ht ON ht.main_id = ih.hadith_id
             JOIN books b ON b.id = ht.book_id
             WHERE ic.narrator_id_array @> ARRAY[$1]::int[]
               AND ic.narrator_id_array[1] = $1
               AND ih.isnad_type = $2
             ORDER BY ht.main_id ASC
             LIMIT $3 OFFSET $4`,
            [rawNarrator, targetIsnadType, limit, offset]
          ),
        ])
        total = cntRes.rows[0]?.total ?? 0
        hadiths = hRes.rows
      }

      return NextResponse.json({
        categories,
        gamhId,
        narrator,
        isnadType: targetIsnadType,
        matchScope,
        hadiths,
        total,
        page,
        limit,
      })
    }

    // Directory listing of narrators in this جامع — strictly separated by الصحابة / التابعين, alphabetically sorted
    const roleCond =
      gamhId === 1
        ? 'AND n.is_companion = true'
        : 'AND COALESCE(n.is_companion, false) = false'

    const baseParams: unknown[] = [gamhId]
    let searchCond = ''
    if (q) {
      baseParams.push(`%${q}%`)
      searchCond = `AND (gi.text ILIKE $${baseParams.length} OR n.name ILIKE $${baseParams.length} OR n.abb_name ILIKE $${baseParams.length})`
    }

    const itemsParams: unknown[] = [...baseParams, targetIsnadType, limit, offset]
    const typeIdx = baseParams.length + 1
    const limIdx = baseParams.length + 2
    const offIdx = baseParams.length + 3

    const [cntRes, itemsRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM gwamh_items gi
         JOIN narrators n ON n.id = gi.id
         WHERE gi.gamh_id = $1 ${roleCond} ${searchCond}`,
        baseParams
      ),
      pool.query<GwamhItemRow>(
        `SELECT gi.gamh_id, gi.id, gi.text,
                n.abb_name, n.tabaqa, n.death_year_num,
                COALESCE(n.is_companion, false) AS is_companion,
                COALESCE(n.hadiths_count, 0)::int AS hadiths_count,
                (SELECT COUNT(DISTINCT ih.hadith_id)::int
                 FROM isnad_chains ic
                 JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
                 WHERE ic.narrator_id_array @> ARRAY[gi.id]::int[]
                   AND ic.narrator_id_array[1] = gi.id
                   AND ih.isnad_type = $${typeIdx}) AS athar_count
         FROM gwamh_items gi
         JOIN narrators n ON n.id = gi.id
         WHERE gi.gamh_id = $1 ${roleCond} ${searchCond}
         ORDER BY COALESCE(NULLIF(n.abb_name, ''), gi.text) ASC, gi.id ASC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        itemsParams
      ),
    ])

    return NextResponse.json({
      categories,
      gamhId,
      items: itemsRes.rows,
      total: cntRes.rows[0]?.total ?? 0,
      page,
      limit,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
