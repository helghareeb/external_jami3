import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

type IsnadFilterType = 'all' | 'marfoa' | 'mawkof' | 'maktoa' | 'marfoa_hokm'

interface IsnadTreeNodeRow {
  id: number
  name: string
  parent_id: number
  is_leaf: boolean
  left_value: number
  right_value: number
  rawy_id: number | null
  is_marfoa: boolean
  is_mawkof: boolean
  is_maktoa: boolean
  is_marfoa_hokm: boolean
  descendants: number
}

function parseFilterType(raw: string | null): IsnadFilterType {
  if (raw === 'marfoa' || raw === 'mawkof' || raw === 'maktoa' || raw === 'marfoa_hokm') return raw
  return 'all'
}

function treeTypeCondition(filter: IsnadFilterType, alias = 't'): string {
  switch (filter) {
    case 'marfoa':
      return `${alias}.is_marfoa = true`
    case 'mawkof':
      return `${alias}.is_mawkof = true`
    case 'maktoa':
      return `${alias}.is_maktoa = true`
    case 'marfoa_hokm':
      return `${alias}.is_marfoa_hokm = true`
    default:
      return 'true'
  }
}

function isnadTypeCode(filter: IsnadFilterType): number | null {
  switch (filter) {
    case 'marfoa':
      return 1
    case 'mawkof':
      return 2
    case 'maktoa':
      return 3
    default:
      return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawNodeId = parseInt(searchParams.get('nodeId') || '', 10)
  const rawRawyId = parseInt(searchParams.get('rawyId') || '', 10)
  const rawParentId = parseInt(searchParams.get('parentId') || '0', 10)
  const filterType = parseFilterType(searchParams.get('type'))
  const q = (searchParams.get('q') || '').trim()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '30', 10) || 30))
  const offset = (page - 1) * limit

  try {
    // Mode A: Browse from a specific tree node (breadcrumb + children + matching hadiths)
    if (Number.isSafeInteger(rawNodeId) && rawNodeId > 0) {
      const bcRes = await pool.query<IsnadTreeNodeRow>(
        `WITH RECURSIVE anc AS (
           SELECT id, name, parent_id, is_leaf, left_value, right_value, rawy_id,
                  is_marfoa, is_mawkof, is_maktoa, is_marfoa_hokm,
                  ((right_value - left_value - 1) / 2)::int AS descendants,
                  1 AS lvl
           FROM isnad_tree WHERE id = $1
           UNION ALL
           SELECT t.id, t.name, t.parent_id, t.is_leaf, t.left_value, t.right_value, t.rawy_id,
                  t.is_marfoa, t.is_mawkof, t.is_maktoa, t.is_marfoa_hokm,
                  ((t.right_value - t.left_value - 1) / 2)::int AS descendants,
                  a.lvl + 1
           FROM isnad_tree t
           JOIN anc a ON t.id = a.parent_id
         )
         SELECT id, name, parent_id, is_leaf, left_value, right_value, rawy_id,
                is_marfoa, is_mawkof, is_maktoa, is_marfoa_hokm, descendants
         FROM anc
         ORDER BY lvl DESC`,
        [rawNodeId]
      )

      if (bcRes.rows.length === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      const breadcrumb = bcRes.rows
      const childCond = treeTypeCondition(filterType, 't')
      const childrenRes = await pool.query<IsnadTreeNodeRow>(
        `SELECT t.id, t.name, t.parent_id, t.is_leaf, t.left_value, t.right_value, t.rawy_id,
                t.is_marfoa, t.is_mawkof, t.is_maktoa, t.is_marfoa_hokm,
                ((t.right_value - t.left_value - 1) / 2)::int AS descendants
         FROM isnad_tree t
         WHERE t.parent_id = $1 AND ${childCond}
         ORDER BY t.left_value ASC
         LIMIT 150`,
        [rawNodeId]
      )

      const prefix = breadcrumb
        .map(b => (b.rawy_id != null ? Number(b.rawy_id) : null))
        .filter((v): v is number => v !== null && v > 0)

      let hadiths: Array<{
        main_id: number
        book_id: number
        book_title: string
        tarf: string | null
        tarqeem_matboa1: string | null
        tarqeem_harf: string | null
        isnad_type: number | null
      }> = []
      let totalHadiths = 0

      if (prefix.length > 0) {
        const typeCode = isnadTypeCode(filterType)
        const ihFilter = typeCode != null ? 'AND ih.isnad_type = $3' : ''
        const countParams: unknown[] = typeCode != null ? [prefix, prefix.length, typeCode] : [prefix, prefix.length]
        const dataParams: unknown[] =
          typeCode != null ? [prefix, prefix.length, typeCode, limit, offset] : [prefix, prefix.length, limit, offset]
        const limIdx = typeCode != null ? '$4' : '$3'
        const offIdx = typeCode != null ? '$5' : '$4'

        const [cntRes, hRes] = await Promise.all([
          pool.query<{ total: number }>(
            `SELECT COUNT(DISTINCT ih.hadith_id)::int AS total
             FROM isnad_chains ic
             JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
             WHERE ic.narrator_id_array @> $1::int[]
               AND ic.narrator_id_array[1:$2] = $1::int[]
               ${ihFilter}`,
            countParams
          ),
          pool.query<{
            main_id: number
            book_id: number
            book_title: string
            tarf: string | null
            tarqeem_matboa1: string | null
            tarqeem_harf: string | null
            isnad_type: number | null
          }>(
            `SELECT DISTINCT ON (ht.main_id)
                    ht.main_id, ht.book_id, b.title AS book_title,
                    regexp_replace(coalesce(ht.tarf, ''), '<[^>]+>', ' ', 'g') AS tarf,
                    ht.tarqeem_matboa1, ht.tarqeem_harf, ih.isnad_type
             FROM isnad_chains ic
             JOIN isnad_hadiths ih ON ih.isnad_id = ic.id
             JOIN hadith_toc ht ON ht.main_id = ih.hadith_id
             JOIN books b ON b.id = ht.book_id
             WHERE ic.narrator_id_array @> $1::int[]
               AND ic.narrator_id_array[1:$2] = $1::int[]
               ${ihFilter}
             ORDER BY ht.main_id ASC
             LIMIT ${limIdx} OFFSET ${offIdx}`,
            dataParams
          ),
        ])

        totalHadiths = cntRes.rows[0]?.total ?? 0
        hadiths = hRes.rows
      }

      return NextResponse.json({
        mode: 'node',
        breadcrumb,
        children: childrenRes.rows,
        prefix,
        hadiths,
        totalHadiths,
        page,
        limit,
      })
    }

    // Mode B: Find tree positions for a specific narrator ID
    if (Number.isSafeInteger(rawRawyId) && rawRawyId > 0) {
      const nodesRes = await pool.query<IsnadTreeNodeRow>(
        `SELECT t.id, t.name, t.parent_id, t.is_leaf, t.left_value, t.right_value, t.rawy_id,
                t.is_marfoa, t.is_mawkof, t.is_maktoa, t.is_marfoa_hokm,
                ((t.right_value - t.left_value - 1) / 2)::int AS descendants
         FROM isnad_tree t
         WHERE t.rawy_id = $1
         ORDER BY (t.parent_id = 0) DESC, (t.right_value - t.left_value) DESC
         LIMIT 25`,
        [rawRawyId]
      )
      return NextResponse.json({ mode: 'rawy', rawyId: rawRawyId, nodes: nodesRes.rows })
    }

    // Mode C: Root or parent-filtered directory listing (default parentId = 0)
    const parentId = Number.isSafeInteger(rawParentId) && rawParentId >= 0 ? rawParentId : 0
    const typeCond = treeTypeCondition(filterType, 't')
    const params: unknown[] = [parentId]
    let searchCond = ''
    if (q) {
      params.push(`%${q}%`)
      searchCond = `AND t.name ILIKE $${params.length}`
    }

    const [cntRes, rowsRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM isnad_tree t
         WHERE t.parent_id = $1 AND ${typeCond} ${searchCond}`,
        params
      ),
      pool.query<IsnadTreeNodeRow>(
        `SELECT t.id, t.name, t.parent_id, t.is_leaf, t.left_value, t.right_value, t.rawy_id,
                t.is_marfoa, t.is_mawkof, t.is_maktoa, t.is_marfoa_hokm,
                ((t.right_value - t.left_value - 1) / 2)::int AS descendants
         FROM isnad_tree t
         WHERE t.parent_id = $1 AND ${typeCond} ${searchCond}
         ORDER BY (t.right_value - t.left_value) DESC, t.left_value ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
    ])

    return NextResponse.json({
      mode: 'list',
      parentId,
      nodes: rowsRes.rows,
      total: cntRes.rows[0]?.total ?? 0,
      page,
      limit,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
