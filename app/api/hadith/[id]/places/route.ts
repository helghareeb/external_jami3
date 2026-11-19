import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { formatPlaceEntryText, parsePlaceTags } from '@/lib/placesXml'

export const dynamic = 'force-dynamic'

interface PlaceServiceRow {
  id: number
  book_id: number
  book_name: string | null
  part_num: number | null
  page_num: number | null
  tarf: string | null
  content: string | null
}

interface LexiconPlaceRow {
  item_id: number
  title: string
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  try {
    const [hadithRes, lexiconRes] = await Promise.all([
      pool.query<{ content: string | null }>(
        `SELECT content FROM hadith_toc WHERE main_id = $1`,
        [hadithId]
      ),
      pool.query<LexiconPlaceRow>(
        `SELECT li.id AS item_id, li.text AS title
         FROM lexicon_hadith lh
         JOIN lexicon_items li ON li.id = lh.lexicon_item_id
         WHERE lh.hadith_id = $1 AND li.lexicon_id = 3
         ORDER BY li.left_value`,
        [hadithId]
      ).catch(() => ({ rows: [] as LexiconPlaceRow[] })),
    ])

    if (!hadithRes.rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const tags = parsePlaceTags(hadithRes.rows[0].content || '')
    const refIds = Array.from(
      new Set(tags.map(t => t.refId).filter((r): r is string => r !== null))
    ).slice(0, 30)

    let serviceRows: PlaceServiceRow[] = []
    if (refIds.length > 0) {
      // Match single or space-separated ربط="... refId ..." inside geographical lexicons (80: معجم البلدان, 95: معالم السيرة)
      const pattern = `ربط="([^"]*\\s)?(${refIds.join('|')})(\\s|")`
      const res = await pool.query<PlaceServiceRow>(
        `SELECT id, book_id, book_name, part_num, page_num, tarf, content
         FROM hadith_service_content
         WHERE book_id = ANY($1::int[])
           AND content ~ $2
         ORDER BY CASE book_id WHEN 95 THEN 0 ELSE 1 END, id
         LIMIT 100`,
        [[80, 95], pattern]
      ).catch(() => ({ rows: [] as PlaceServiceRow[] }))
      serviceRows = res.rows
    }

    const matchRef = (content: string | null, refId: string): boolean => {
      if (!content) return false
      return (
        content.includes(`ربط="${refId}"`) ||
        content.includes(`ربط="${refId} `) ||
        content.includes(` ${refId} `) ||
        content.includes(` ${refId}"`)
      )
    }

    const places = tags.map(t => {
      const matched = t.refId
        ? serviceRows.filter(r => matchRef(r.content, t.refId!))
        : []

      return {
        name: t.name,
        ref_id: t.refId,
        sources: matched.slice(0, 6).map(r => {
          const fullText = formatPlaceEntryText(r.content) || r.tarf || ''
          const excerpt = fullText.length > 420 ? fullText.slice(0, 420).replace(/\s+\S*$/, '') + '…' : fullText
          return {
            service_main_id: Number(r.id),
            book_id: Number(r.book_id),
            book_name: r.book_name || (Number(r.book_id) === 95 ? 'معجم المعالم الجغرافية في السيرة النبوية' : 'معجم البلدان'),
            part_num: Number(r.part_num || 0),
            page_num: Number(r.page_num || 0),
            tarf: r.tarf || null,
            excerpt,
            full_text: fullText,
          }
        }),
      }
    })

    return NextResponse.json({
      hadith_id: hadithId,
      places,
      lexicon_places: lexiconRes.rows,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
