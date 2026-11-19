import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { cleanServiceProse, parseAyaTags } from '@/lib/quranXml'

export const dynamic = 'force-dynamic'

interface AyaDbRow {
  id: number
  sora_id: number
  aya_num: number
  text: string | null
  sura_name: string | null
}

interface TafsirServiceRow {
  sura: number
  aya: number
  service_main_id: number
  book_id: number
  book_name: string | null
  part_num: number | null
  page_num: number | null
  content: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  try {
    const hadithRes = await pool.query<{ content: string | null }>(
      `SELECT content FROM hadith_toc WHERE main_id = $1`,
      [hadithId]
    )
    if (!hadithRes.rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const tags = parseAyaTags(hadithRes.rows[0].content || '')
    if (tags.length === 0) {
      return NextResponse.json({ hadith_id: hadithId, ayat: [] })
    }

    const ayaIds = tags.map(t => t.ayaId).filter((v): v is number => v !== null)
    const tagSuras = tags.filter(t => t.suraNum && t.ayaNum).map(t => t.suraNum!)
    const tagAyas = tags.filter(t => t.suraNum && t.ayaNum).map(t => t.ayaNum!)

    const ayaRowsRes = await pool.query<AyaDbRow>(
      `SELECT a.id, a.sora_id, a.aya_num, a.text, s.name AS sura_name
       FROM quran_ayat a
       LEFT JOIN quran_suras s ON s.id = a.sora_id
       WHERE ($1::int[] IS NOT NULL AND cardinality($1::int[]) > 0 AND a.id = ANY($1::int[]))
          OR EXISTS (
            SELECT 1 FROM unnest($2::int[], $3::int[]) AS u(sura, aya)
            WHERE a.sora_id = u.sura AND a.aya_num = u.aya
          )`,
      [ayaIds, tagSuras, tagAyas]
    ).catch(() => ({ rows: [] as AyaDbRow[] }))

    const byId = new Map<number, AyaDbRow>()
    const byCoord = new Map<string, AyaDbRow>()
    for (const r of ayaRowsRes.rows) {
      byId.set(Number(r.id), r)
      byCoord.set(`${r.sora_id}:${r.aya_num}`, r)
    }

    // Build normalized coordinate list from tags + resolved quran_ayat rows
    const coords = new Map<string, { sura: number; aya: number }>()
    for (const t of tags) {
      const resolved = (t.ayaId ? byId.get(t.ayaId) : undefined) ?? (t.suraNum && t.ayaNum ? byCoord.get(`${t.suraNum}:${t.ayaNum}`) : undefined)
      const sura = resolved?.sora_id ?? t.suraNum
      const aya = resolved?.aya_num ?? t.ayaNum
      if (sura && aya) coords.set(`${sura}:${aya}`, { sura, aya })
    }

    const coordList = Array.from(coords.values())
    const tafsirMap = new Map<string, TafsirServiceRow[]>()

    if (coordList.length > 0) {
      const tafsirRes = await pool.query<TafsirServiceRow>(
        `SELECT DISTINCT ON (qas.sura, qas.aya, hsc.id)
                qas.sura, qas.aya, hsc.id AS service_main_id,
                hsc.book_id, hsc.book_name, hsc.part_num, hsc.page_num, hsc.content
         FROM unnest($1::int[], $2::int[]) AS u(sura, aya)
         JOIN quran_ayat_services qas ON qas.sura = u.sura AND qas.aya = u.aya
         JOIN hadith_service_content hsc ON hsc.id = qas.service_main_id
         ORDER BY qas.sura, qas.aya, hsc.id
         LIMIT 60`,
        [coordList.map(c => c.sura), coordList.map(c => c.aya)]
      ).catch(() => ({ rows: [] as TafsirServiceRow[] }))

      for (const row of tafsirRes.rows) {
        const key = `${row.sura}:${row.aya}`
        const bucket = tafsirMap.get(key) || []
        bucket.push(row)
        tafsirMap.set(key, bucket)
      }
    }

    const ayat = tags.map(t => {
      const resolved = (t.ayaId ? byId.get(t.ayaId) : undefined) ?? (t.suraNum && t.ayaNum ? byCoord.get(`${t.suraNum}:${t.ayaNum}`) : undefined)
      const suraNum = resolved?.sora_id ?? t.suraNum
      const ayaNum = resolved?.aya_num ?? t.ayaNum
      const key = suraNum && ayaNum ? `${suraNum}:${ayaNum}` : ''
      const tRows = (key ? tafsirMap.get(key) : undefined) || []

      return {
        aya_id: resolved?.id ?? t.ayaId,
        sura_num: suraNum,
        sura_name: resolved?.sura_name || t.suraName || (suraNum ? `سورة ${suraNum}` : ''),
        aya_num: ayaNum,
        verse_text: resolved?.text || null,
        quoted_text: t.quotedText,
        tafsir: tRows.map(tr => ({
          service_main_id: Number(tr.service_main_id),
          book_id: Number(tr.book_id),
          book_name: tr.book_name || 'تفسير الطبري',
          part_num: Number(tr.part_num || 0),
          page_num: Number(tr.page_num || 0),
          text: cleanServiceProse(tr.content),
        })),
      }
    })

    return NextResponse.json({ hadith_id: hadithId, ayat })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
