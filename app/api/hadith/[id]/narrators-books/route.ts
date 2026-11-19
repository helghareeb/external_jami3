import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

interface RawNarratorBookRow {
  id: number
  name: string
  abb_name: string | null
  martaba_ibn_hajar: string | null
  is_companion: boolean
  companion_title: string | null
  tabaqa: string | null
  death_year_num: number | null
  min_ord: number
  book_id: number | null
  book_title: string | null
}

function computeHadithSymbols(bookIds: number[]): string[] {
  const s = new Set(bookIds)
  const out: string[] = []
  const hasSix = [1, 2, 3, 4, 5, 6].every(id => s.has(id))
  if (hasSix) {
    out.push('ع')
  } else {
    if (s.has(1)) out.push('خ')
    if (s.has(2)) out.push('م')
    const hasFour = [3, 4, 5, 6].every(id => s.has(id))
    if (hasFour) {
      out.push('٤')
    } else {
      if (s.has(3)) out.push('د')
      if (s.has(4)) out.push('ت')
      if (s.has(5)) out.push('س')
      if (s.has(6)) out.push('ق')
    }
  }
  if (s.has(7)) out.push('ط')
  if (s.has(8)) out.push('حم')
  if (s.has(9)) out.push('مي')
  return out
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  try {
    const res = await pool.query<RawNarratorBookRow>(
      `WITH chain_nars AS (
         SELECT pos.nar_id, MIN(pos.ord)::int AS min_ord
         FROM isnad_hadiths ih
         JOIN isnad_chains ic ON ic.id = ih.isnad_id
         JOIN LATERAL unnest(ic.narrator_id_array) WITH ORDINALITY AS pos(nar_id, ord) ON true
         WHERE ih.hadith_id = $1
         GROUP BY pos.nar_id
       )
       SELECT n.id, n.name, n.abb_name, n.martaba_ibn_hajar,
              n.is_companion, n.companion_title, n.tabaqa, n.death_year_num,
              cn.min_ord,
              b.id AS book_id,
              b.title AS book_title
       FROM chain_nars cn
       JOIN narrators n ON n.id = cn.nar_id
       LEFT JOIN narrator_books nb ON nb.narrator_id = n.id
       LEFT JOIN books b ON b.id = nb.book_id
       ORDER BY cn.min_ord ASC, n.id ASC, b.id ASC`,
      [hadithId]
    )

    const byNar = new Map<number, {
      id: number
      name: string
      abb_name: string | null
      martaba_ibn_hajar: string | null
      is_companion: boolean
      companion_title: string | null
      tabaqa: string | null
      death_year_num: number | null
      books: Array<{ id: number; title: string }>
      seenBooks: Set<number>
    }>()

    for (const row of res.rows) {
      const nid = Number(row.id)
      let entry = byNar.get(nid)
      if (!entry) {
        entry = {
          id: nid,
          name: row.name,
          abb_name: row.abb_name,
          martaba_ibn_hajar: row.martaba_ibn_hajar,
          is_companion: Boolean(row.is_companion),
          companion_title: row.companion_title,
          tabaqa: row.tabaqa,
          death_year_num: row.death_year_num != null ? Number(row.death_year_num) : null,
          books: [],
          seenBooks: new Set<number>(),
        }
        byNar.set(nid, entry)
      }
      if (row.book_id != null && row.book_title) {
        const bid = Number(row.book_id)
        if (!entry.seenBooks.has(bid)) {
          entry.seenBooks.add(bid)
          entry.books.push({ id: bid, title: row.book_title })
        }
      }
    }

    const narrators = Array.from(byNar.values()).map(({ seenBooks: _seen, ...rest }) => ({
      ...rest,
      symbols: computeHadithSymbols(rest.books.map(b => b.id)),
    }))

    return NextResponse.json({ hadith_id: hadithId, narrators })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
