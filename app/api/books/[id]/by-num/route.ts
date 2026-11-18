import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { printedLabel } from '@/lib/hadithText'

export const dynamic = 'force-dynamic'

// A hadith by its number in a book. The number must match exactly: «187» is hadith 187, never 1870-1879.
// A stored value may carry a label — «2072 (م)», «1367 م» — and Muslim prints two Abd al-Baqi numbers
// together on some narrations — «1697/ 1698» — either of which finds it.
// With the printed numbering, a number can also sit inside a row that holds more than one of the
// edition's hadiths (Bukhari 1854 was printed in the row of 1853); such a row is found by that number too.
// Several rows can share a number (Muslim's narrations of one Abd al-Baqi number): all are returned,
// in book order, for the reader to choose, each with its number as printed («1 - (8)») and opening words.
// A number not in the current edition is looked up among the previous print's numbers (hadith_numbers,
// scheme 'previous'); when the current edition does have it but the previous print gave it to another
// hadith, that one is offered too — old citations keep finding their hadith.
// a value's first number; «N / M» elsewhere is the number and its place in the chapter, but Muslim's
// «1697/ 1698» names two Abd al-Baqi numbers, and either finds it
const NUMBERS_IN = (col: string) =>
  `($2 = (regexp_match(coalesce(${col}, ''), '[0-9]+'))[1]
    OR (h.book_id = 2 AND $2 = ANY(regexp_split_to_array(split_part(coalesce(${col}, ''), '(', 1), '[^0-9]+'))))`

type Row = { main_id: number; number: string | null; content: string | null; opening: string; previous?: boolean }

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const bookId = parseInt(id)
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('num')?.trim() ?? ''
  // Arabic-Indic digits typed into the box count as the same number; a suffix the reader types
  // («692/1», «12 م») is dropped and every row with that number is listed.
  const num = (raw.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d+/) || [''])[0]
  const pref = searchParams.get('pref') === 'harf' ? 'harf' : 'matboa'

  if (!num || !/^\d+$/.test(num) || isNaN(bookId)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const SELECT = `SELECT h.main_id, btrim(h.tarqeem_matboa1) AS number, h.content,
                         left(regexp_replace(coalesce(h.tarf, ''), '<[^>]+>', '', 'g'), 70) AS opening`
  const numColumn = pref === 'harf' ? 'tarqeem_harf' : 'tarqeem_matboa1'
  let rows: Row[] = (await pool.query(
    `${SELECT} FROM hadith_toc h
     WHERE h.book_id = $1 AND h.is_leaf = true AND h.is_paragraph = true AND ${NUMBERS_IN(`h.${numColumn}`)}
     ORDER BY h.id, h.main_id LIMIT 20`,
    [bookId, num]
  )).rows

  if (rows.length === 0 && pref === 'matboa') {
    // a printed number inside a row that holds more than one of the edition's hadiths
    rows = (await pool.query(
      `${SELECT} FROM hadith_toc h
       WHERE h.book_id = $1 AND h.is_leaf = true AND h.is_paragraph = true AND h.content LIKE $2
       ORDER BY h.id, h.main_id LIMIT 20`,
      [bookId, `%<رقم_حديث نوع="مطبوع">${num} </رقم_حديث>%`]
    )).rows
  }

  // the previous print's numbering (books re-based on a newer edition)
  let previous: Row[] = []
  if (pref === 'matboa') {
    previous = (await pool.query(
      `${SELECT}, true AS previous FROM hadith_numbers n JOIN hadith_toc h ON h.main_id = n.main_id
       WHERE n.scheme = 'previous' AND n.number = $2 AND h.book_id = $1
       ORDER BY h.id, h.main_id LIMIT 20`,
      [bookId, num]
    ).catch(() => ({ rows: [] as Row[] }))).rows
    const have = new Set(rows.map(r => r.main_id))
    previous = previous.filter(r => !have.has(r.main_id))
  }

  const all = [...rows, ...previous]
  if (all.length === 0) {
    return NextResponse.json({ found: false })
  }
  const item = (r: Row) => ({ main_id: r.main_id, number: printedLabel(r.content, r.number), opening: r.opening, previous: !!r.previous })
  if (all.length === 1 && !previous.length) {
    return NextResponse.json({ found: true, main_id: all[0].main_id })
  }
  return NextResponse.json({
    found: true,
    main_id: all[0].main_id,
    multiple: all.map(r => r.main_id),
    items: all.map(item),
    // only the previous print has this number: say which number the hadith has now
    previous_only: rows.length === 0,
  })
}
