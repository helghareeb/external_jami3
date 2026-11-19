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
    const categoriesRes = await pool.query<CategoryRow>(
      `SELECT g.id, g.name,
              (SELECT COUNT(*)::int FROM gwamh_items gi WHERE gi.gamh_id = g.id) AS count
       FROM gwamh g
       ORDER BY g.id`
    )
    const categories = categoriesRes.rows

    // When a narrator is selected, load their موقوف (isnad_type=2) or مقطوع (isnad_type=3) narrations
    if (Number.isSafeInteger(rawNarrator) && rawNarrator > 0) {
      const targetIsnadType = gamhId === 1 ? 2 : 3
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

      // Primary match: narrator at the root of the chain (narrator_id_array[1]) for this athar type
      let matchScope: 'root' | 'chain' = 'root'
      const rootCountRes = await pool.query<{ total: number }>(
        `SELECT COUNT(DISTINCT ih.hadith_id)::int AS total
         FROM isnad_chains ic
         JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
         WHERE ic.narrator_id_array @> ARRAY[$1]::int[]
           AND ic.narrator_id_array[1] = $1
           AND ih.isnad_type = $2`,
        [rawNarrator, targetIsnadType]
      )
      let total = rootCountRes.rows[0]?.total ?? 0
      if (total === 0) {
        matchScope = 'chain'
        const chainCountRes = await pool.query<{ total: number }>(
          `SELECT COUNT(DISTINCT ih.hadith_id)::int AS total
           FROM isnad_chains ic
           JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
           WHERE ic.narrator_id_array @> ARRAY[$1]::int[]
             AND ih.isnad_type = $2`,
          [rawNarrator, targetIsnadType]
        )
        total = chainCountRes.rows[0]?.total ?? 0
      }

      const scopeClause =
        matchScope === 'root'
          ? `ic.narrator_id_array @> ARRAY[$1]::int[] AND ic.narrator_id_array[1] = $1 AND ih.isnad_type = $2`
          : `ic.narrator_id_array @> ARRAY[$1]::int[] AND ih.isnad_type = $2`

      const hadithsRes = total > 0
        ? await pool.query<GwamhHadithRow>(
            `SELECT DISTINCT ON (ht.main_id)
                    ht.main_id, ht.book_id, b.title AS book_title,
                    regexp_replace(coalesce(ht.tarf, ''), '<[^>]+>', ' ', 'g') AS tarf,
                    ht.tarqeem_matboa1, ht.tarqeem_harf,
                    ht.part_num, ht.page_num
             FROM isnad_chains ic
             JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
             JOIN hadith_toc ht ON ht.main_id = ih.hadith_id
             JOIN books b ON b.id = ht.book_id
             WHERE ${scopeClause}
             ORDER BY ht.main_id ASC
             LIMIT $3 OFFSET $4`,
            [rawNarrator, targetIsnadType, limit, offset]
          )
        : { rows: [] as GwamhHadithRow[] }

      return NextResponse.json({
        categories,
        gamhId,
        narrator,
        isnadType: targetIsnadType,
        matchScope,
        hadiths: hadithsRes.rows,
        total,
        page,
        limit,
      })
    }

    // Directory listing of narrators in this جامع
    const params: unknown[] = [gamhId]
    let searchCond = ''
    if (q) {
      params.push(`%${q}%`)
      searchCond = `AND (gi.text ILIKE $${params.length} OR n.name ILIKE $${params.length} OR n.abb_name ILIKE $${params.length})`
    }

    const [cntRes, itemsRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM gwamh_items gi
         LEFT JOIN narrators n ON n.id = gi.id
         WHERE gi.gamh_id = $1 ${searchCond}`,
        params
      ),
      pool.query<GwamhItemRow>(
        `SELECT gi.gamh_id, gi.id, gi.text,
                n.abb_name, n.tabaqa, n.death_year_num,
                COALESCE(n.is_companion, false) AS is_companion,
                COALESCE(n.hadiths_count, 0)::int AS hadiths_count
         FROM gwamh_items gi
         LEFT JOIN narrators n ON n.id = gi.id
         WHERE gi.gamh_id = $1 ${searchCond}
         ORDER BY COALESCE(n.hadiths_count, 0) DESC, gi.text ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
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
