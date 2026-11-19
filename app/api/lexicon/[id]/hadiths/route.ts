import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { buildLexiconHadithWhere } from '@/lib/ghareeb'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const itemId = parseInt(id, 10)
  if (isNaN(itemId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10) || 30))
  const offset = (page - 1) * limit

  try {
    const itemRes = await pool.query<{ id: number; text: string; lexicon_id: number; is_leaf: boolean }>(
      `SELECT id, text, lexicon_id, is_leaf FROM lexicon_items WHERE id = $1`,
      [itemId]
    )
    const item = itemRes.rows[0]
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const filter = buildLexiconHadithWhere(item)
    if (!filter) {
      return NextResponse.json({ item, hadiths: [], total: 0, page, limit })
    }

    const limIdx = filter.params.length + 1
    const offIdx = filter.params.length + 2

    const [countRes, hadithRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM hadith_toc ht
         WHERE ${filter.whereSql}`,
        filter.params
      ),
      pool.query(
        `SELECT ht.main_id, ht.book_id, b.title AS book_title,
                ht.tarf, ht.part_num, ht.page_num, ht.tarqeem_harf
         FROM hadith_toc ht
         JOIN books b ON b.id = ht.book_id
         WHERE ${filter.whereSql}
         ORDER BY b.tarteeb ASC NULLS LAST, ht.main_id ASC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...filter.params, limit, offset]
      ),
    ])

    return NextResponse.json({
      item,
      hadiths: hadithRes.rows,
      total: countRes.rows[0]?.total ?? 0,
      page,
      limit,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
