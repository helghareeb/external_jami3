import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { extractMatnForComparison, splitSanadMatn } from '@/lib/hadithText'
import {
  buildGhareebSourceFromRef,
  buildGhareebWord,
  dedupeGhareebWords,
  GHAREEB_SOURCE_BOOK_IDS,
  parseGhareebTags,
  stripTashkeel,
  type GhareebSource,
  type GhareebWord,
} from '@/lib/ghareeb'

export const dynamic = 'force-dynamic'

interface LexiconRow {
  form_id: number
  form_text: string
  word_id: number
  word_text: string
}

interface ContentRow {
  book_id?: number
  part_text: string | null
  tarf: string | null
  content: string | null
  source_book: string | null
  source_ref_id: number | null
  ref_id?: number | null
}

const BOOK_PRIORITY: Record<number, number> = {
  78: 0,
  79: 1,
  80: 2,
  95: 3,
  12: 4,
  13: 5,
  14: 6,
}

function extractAttrRefIds(content: string | null): number[] {
  if (!content) return []
  const ids: number[] = []
  const re = /ربط\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    for (const tok of m[1].trim().split(/\s+/)) {
      const n = parseInt(tok, 10)
      if (!isNaN(n) && n > 0) ids.push(n)
    }
  }
  return ids
}

function normArWord(text: string): string {
  return stripTashkeel(text)
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}

async function wordsFromGhareebTags(content: string): Promise<GhareebWord[]> {
  const tags = parseGhareebTags(content)
  if (tags.length === 0) return []

  const uniqueRefIds = Array.from(
    new Set(tags.map(t => t.refId).filter((r): r is number => r !== null && r > 0))
  )
  const uniqueRawWords = Array.from(
    new Set(tags.map(t => t.word).filter(Boolean))
  )

  const bookIds = [...GHAREEB_SOURCE_BOOK_IDS]
  const refPattern =
    uniqueRefIds.length > 0
      ? `ربط="([^"]*\\s)?(${uniqueRefIds.join('|')})(\\s|")`
      : null

  const [lhRes, regexRes, lexRes] = await Promise.all([
    uniqueRefIds.length > 0
      ? pool
          .query<ContentRow>(
            `SELECT lh.lexicon_item_id::int AS ref_id,
                    hsc.book_id::int AS book_id,
                    hsc.part_text,
                    hsc.tarf,
                    hsc.content,
                    hsc.book_name AS source_book,
                    hsc.id::bigint AS source_ref_id
             FROM lexicon_hadith lh
             JOIN hadith_service_content hsc ON hsc.id = lh.hadith_id
             WHERE lh.lexicon_item_id = ANY($1::int[])
               AND hsc.book_id = ANY($2::int[])
             ORDER BY
               CASE hsc.book_id
                 WHEN 78 THEN 0
                 WHEN 79 THEN 1
                 WHEN 80 THEN 2
                 WHEN 95 THEN 3
                 WHEN 12 THEN 4
                 WHEN 13 THEN 5
                 WHEN 14 THEN 6
                 ELSE 7
               END,
               hsc.id`,
            [uniqueRefIds, bookIds]
          )
          .catch(() => ({ rows: [] as ContentRow[] }))
      : Promise.resolve({ rows: [] as ContentRow[] }),

    refPattern
      ? pool
          .query<ContentRow>(
            `SELECT hsc.book_id::int AS book_id,
                    hsc.part_text,
                    hsc.tarf,
                    hsc.content,
                    hsc.book_name AS source_book,
                    hsc.id::bigint AS source_ref_id
             FROM hadith_service_content hsc
             WHERE hsc.book_id = ANY($1::int[])
               AND hsc.content ~ $2
             ORDER BY
               CASE hsc.book_id
                 WHEN 78 THEN 0
                 WHEN 79 THEN 1
                 WHEN 80 THEN 2
                 WHEN 95 THEN 3
                 WHEN 12 THEN 4
                 WHEN 13 THEN 5
                 WHEN 14 THEN 6
                 ELSE 7
               END,
               hsc.id`,
            [bookIds, refPattern]
          )
          .catch(() => ({ rows: [] as ContentRow[] }))
      : Promise.resolve({ rows: [] as ContentRow[] }),

    uniqueRefIds.length > 0 || uniqueRawWords.length > 0
      ? pool
          .query<LexiconRow & { norm_text: string }>(
            `WITH input_words AS (
               SELECT DISTINCT normalize_hadith(w) AS nw
               FROM unnest($2::text[]) AS w
             )
             SELECT li.id AS form_id,
                    li.text AS form_text,
                    word.id AS word_id,
                    word.text AS word_text,
                    normalize_hadith(li.text) AS norm_text
             FROM lexicon_items li
             JOIN lexicon_items word ON word.id = li.parent_id
             WHERE li.lexicon_id = 1
               AND (
                 li.id = ANY($1::int[])
                 OR (li.is_leaf = true AND normalize_hadith(li.text) IN (SELECT nw FROM input_words))
               )
             ORDER BY length(li.text) ASC`,
            [uniqueRefIds, uniqueRawWords]
          )
          .catch(() => ({ rows: [] as Array<LexiconRow & { norm_text: string }> }))
      : Promise.resolve({ rows: [] as Array<LexiconRow & { norm_text: string }> }),
  ])

  const refSet = new Set(uniqueRefIds)
  const rowsByRef = new Map<number, ContentRow[]>()
  const seenPerRef = new Map<number, Set<number>>()

  const pushRow = (refId: number, row: ContentRow) => {
    const hscId = row.source_ref_id != null ? Number(row.source_ref_id) : 0
    if (!seenPerRef.has(refId)) seenPerRef.set(refId, new Set())
    const seen = seenPerRef.get(refId)!
    if (hscId && seen.has(hscId)) return
    if (hscId) seen.add(hscId)
    if (!rowsByRef.has(refId)) rowsByRef.set(refId, [])
    rowsByRef.get(refId)!.push(row)
  }

  for (const row of lhRes.rows) {
    if (row.ref_id) pushRow(Number(row.ref_id), row)
  }
  for (const row of regexRes.rows) {
    for (const rid of extractAttrRefIds(row.content)) {
      if (refSet.has(rid)) pushRow(rid, row)
    }
  }

  const lexById = new Map<number, LexiconRow>()
  const lexByNorm = new Map<string, LexiconRow>()
  for (const row of lexRes.rows) {
    if (!lexById.has(row.form_id)) lexById.set(row.form_id, row)
    const nk = (row.norm_text ?? '').trim() || normArWord(row.form_text)
    if (nk && !lexByNorm.has(nk)) lexByNorm.set(nk, row)
  }

  const words: GhareebWord[] = []
  for (const tag of tags) {
    if (!tag.word) continue
    let sources: GhareebSource[] = []
    if (tag.refId) {
      const candidateRows = [...(rowsByRef.get(tag.refId) || [])].sort((a, b) => {
        const pa = BOOK_PRIORITY[a.book_id ?? -1] ?? 7
        const pb = BOOK_PRIORITY[b.book_id ?? -1] ?? 7
        if (pa !== pb) return pa - pb
        return Number(a.source_ref_id || 0) - Number(b.source_ref_id || 0)
      })
      for (const row of candidateRows) {
        if (sources.length >= 8) break
        const src = buildGhareebSourceFromRef(row, tag.refId)
        if (src) sources.push(src)
      }
    }

    const lex =
      (tag.refId ? lexById.get(tag.refId) : undefined) ??
      lexByNorm.get(normArWord(tag.word)) ??
      null

    let formId = lex?.form_id ?? tag.refId ?? 0
    if (!formId) {
      let h = 0
      for (const c of stripTashkeel(tag.word)) h = (h * 31 + c.charCodeAt(0)) | 0
      formId = Math.abs(h) || 1
    }

    words.push(
      buildGhareebWord(
        {
          formId,
          formText: tag.word,
          wordId: lex?.word_id ?? lex?.form_id ?? 0,
          wordText: lex?.form_text ?? stripTashkeel(tag.word),
        },
        sources
      )
    )
  }

  return words
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }

  try {
    const hadithRes = await pool.query<{ content: string }>(
      `SELECT content FROM hadith_toc WHERE main_id = $1`,
      [hadithId]
    )
    if (!hadithRes.rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const content = hadithRes.rows[0].content
    const matnCompare = extractMatnForComparison(content)
    const { matn: matnDisplay } = splitSanadMatn(content)
    const matn = matnDisplay || matnCompare

    const words = dedupeGhareebWords(await wordsFromGhareebTags(content))

    return NextResponse.json(
      { words, matn },
      { headers: { 'X-Ghareeb-Sources': 'v2' } }
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
