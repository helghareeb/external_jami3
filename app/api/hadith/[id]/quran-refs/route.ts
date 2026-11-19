import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { extractQiraaSegmentFromBook87, parseAyaTags, parseQiraaTags } from '@/lib/quranXml'

export const dynamic = 'force-dynamic'

interface QiraatBookRow {
  aya_id: number | null
  service_main_id: number
  book_name: string | null
  part_num: number | null
  page_num: number | null
  content: string | null
}

interface ReaderRow {
  id: number
  reader_name: string
  parent_id: number
}

interface AyaInfoRow {
  id: number
  sora_id: number
  aya_num: number
  text: string | null
  sura_name: string | null
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

    const rawContent = hadithRes.rows[0].content || ''
    const qiraaTags = parseQiraaTags(rawContent)
    const ayaTags = parseAyaTags(rawContent)

    // Resolve reader IDs from XML attributes AND quran_readers_ayat (reader_id maps to quran_readers.id = num + 1)
    const xmlReaderIds = new Set<number>()
    for (const qt of qiraaTags) {
      for (const n of qt.readerNums) xmlReaderIds.add(n + 1)
    }

    const qiraaRefInts = qiraaTags
      .map(qt => parseInt(qt.qiraaRefId, 10))
      .filter(n => Number.isSafeInteger(n) && n > 0)

    const readerAyaMap = new Map<string, number[]>()
    if (qiraaRefInts.length > 0) {
      const qraRes = await pool.query<{ reader_id: number; aya_id: number }>(
        `SELECT reader_id, aya_id FROM quran_readers_ayat WHERE aya_id = ANY($1::int[])`,
        [qiraaRefInts]
      ).catch(() => ({ rows: [] as Array<{ reader_id: number; aya_id: number }> }))
      for (const r of qraRes.rows) {
        const refKey = String(r.aya_id)
        const arr = readerAyaMap.get(refKey) || []
        arr.push(Number(r.reader_id))
        readerAyaMap.set(refKey, arr)
        xmlReaderIds.add(Number(r.reader_id) + 1)
      }
    }

    const readerNamesMap = new Map<number, { name: string; parent_name: string | null }>()
    if (xmlReaderIds.size > 0) {
      const readersRes = await pool.query<ReaderRow & { parent_name: string | null }>(
        `SELECT r.id, r.reader_name, r.parent_id, p.reader_name AS parent_name
         FROM quran_readers r
         LEFT JOIN quran_readers p ON p.id = r.parent_id AND p.id > 1
         WHERE r.id = ANY($1::int[])`,
        [Array.from(xmlReaderIds)]
      ).catch(() => ({ rows: [] as Array<ReaderRow & { parent_name: string | null }> }))
      for (const r of readersRes.rows) {
        readerNamesMap.set(Number(r.id), {
          name: r.reader_name,
          parent_name: r.parent_name,
        })
      }
    }

    // Fetch verse metadata for <آية> tags
    const allAyaIds = Array.from(
      new Set(
        [
          ...ayaTags.map(a => a.ayaId),
          ...qiraaTags.map(q => q.ayaId),
        ].filter((v): v is number => v !== null)
      )
    )
    const suraNums = ayaTags.filter(a => a.suraNum && a.ayaNum).map(a => a.suraNum!)
    const ayaNums = ayaTags.filter(a => a.suraNum && a.ayaNum).map(a => a.ayaNum!)

    const ayaInfoMap = new Map<number, AyaInfoRow>()
    const ayaCoordMap = new Map<string, AyaInfoRow>()
    if (allAyaIds.length > 0 || suraNums.length > 0) {
      const ayaRes = await pool.query<AyaInfoRow>(
        `SELECT a.id, a.sora_id, a.aya_num, a.text, s.name AS sura_name
         FROM quran_ayat a
         JOIN quran_suras s ON s.id = a.sora_id
         WHERE (cardinality($1::int[]) > 0 AND a.id = ANY($1::int[]))
            OR EXISTS (
              SELECT 1 FROM unnest($2::int[], $3::int[]) AS u(sura, aya)
              WHERE a.sora_id = u.sura AND a.aya_num = u.aya
            )
         ORDER BY a.sora_id, a.aya_num`,
        [allAyaIds, suraNums, ayaNums]
      ).catch(() => ({ rows: [] as AyaInfoRow[] }))
      for (const r of ayaRes.rows) {
        ayaInfoMap.set(Number(r.id), r)
        ayaCoordMap.set(`${r.sora_id}:${r.aya_num}`, r)
      }
    }

    // Fetch القراءات explanations from quran_ayat_qiraat (→ hadith_service_content book_id = 87)
    const book87ByAya = new Map<number, QiraatBookRow[]>()
    const book87Rows: QiraatBookRow[] = []
    if (allAyaIds.length > 0) {
      const qaqRes = await pool.query<QiraatBookRow>(
        `SELECT qaq.aya_id, hsc.id AS service_main_id, hsc.book_name, hsc.part_num, hsc.page_num, hsc.content
         FROM quran_ayat_qiraat qaq
         JOIN hadith_service_content hsc ON hsc.id = qaq.service_main_id
         WHERE qaq.aya_id = ANY($1::int[])
         ORDER BY hsc.id`,
        [allAyaIds]
      ).catch(() => ({ rows: [] as QiraatBookRow[] }))
      for (const r of qaqRes.rows) {
        book87Rows.push(r)
        if (r.aya_id != null) {
          const aid = Number(r.aya_id)
          const bucket = book87ByAya.get(aid) || []
          bucket.push(r)
          book87ByAya.set(aid, bucket)
        }
      }
    }

    // Fallback: any <قراءة ربط="..."> not yet covered in book87Rows
    const missingRefs = qiraaTags
      .map(qt => qt.qiraaRefId)
      .filter(refId => !book87Rows.some(r => r.content?.includes(`ربط="${refId}"`)))

    const book87ByRef = new Map<string, QiraatBookRow>()
    if (missingRefs.length > 0) {
      const pattern = `ربط="(${missingRefs.slice(0, 20).join('|')})"`
      const fbRes = await pool.query<QiraatBookRow>(
        `SELECT NULL::int AS aya_id, id AS service_main_id, book_name, part_num, page_num, content
         FROM hadith_service_content
         WHERE book_id = 87 AND content ~ $1
         LIMIT 20`,
        [pattern]
      ).catch(() => ({ rows: [] as QiraatBookRow[] }))
      for (const r of fbRes.rows) {
        for (const refId of missingRefs) {
          if (r.content?.includes(`ربط="${refId}"`)) book87ByRef.set(refId, r)
        }
      }
    }

    const qiraat = qiraaTags.map(qt => {
      const nums = qt.readerNums.length > 0 ? qt.readerNums : (readerAyaMap.get(qt.qiraaRefId) || [])
      const readers = nums.map(n => {
        const info = readerNamesMap.get(n + 1)
        const label = info
          ? info.parent_name ? `${info.parent_name} (${info.name})` : info.name
          : `قارئ ${n}`
        return { id: n + 1, legacy_num: n, name: label }
      })

      const candidates = (qt.ayaId ? book87ByAya.get(qt.ayaId) : undefined) || []
      const matchedRow =
        candidates.find(r => r.content?.includes(`ربط="${qt.qiraaRefId}"`)) ??
        candidates[0] ??
        book87ByRef.get(qt.qiraaRefId) ??
        null

      const ayaInfo =
        (qt.ayaId ? ayaInfoMap.get(qt.ayaId) : undefined) ??
        (qt.suraNum && qt.ayaNum ? ayaCoordMap.get(`${qt.suraNum}:${qt.ayaNum}`) : undefined)

      return {
        qiraa_ref_id: qt.qiraaRefId,
        word_text: qt.wordText,
        sura_num: ayaInfo?.sora_id ?? qt.suraNum,
        sura_name: ayaInfo?.sura_name ?? (qt.suraName || null),
        aya_num: ayaInfo?.aya_num ?? qt.ayaNum,
        readers,
        source: matchedRow ? {
          service_main_id: Number(matchedRow.service_main_id),
          book_name: matchedRow.book_name || 'البدور الزاهرة في القراءات العشر المتواترة',
          part_num: Number(matchedRow.part_num || 0),
          page_num: Number(matchedRow.page_num || 0),
          explanation: extractQiraaSegmentFromBook87(matchedRow.content, qt.qiraaRefId),
        } : null,
      }
    })

    // Backward-compatible quran_refs array populated from the resolved <آية> tags
    const seenCoords = new Set<string>()
    const quran_refs: Array<{ sura: number; aya: number; sura_name: string; aya_text: string | null }> = []
    for (const a of ayaTags) {
      const info =
        (a.ayaId ? ayaInfoMap.get(a.ayaId) : undefined) ??
        (a.suraNum && a.ayaNum ? ayaCoordMap.get(`${a.suraNum}:${a.ayaNum}`) : undefined)
      const sura = info?.sora_id ?? a.suraNum
      const aya = info?.aya_num ?? a.ayaNum
      if (!sura || !aya) continue
      const key = `${sura}:${aya}`
      if (seenCoords.has(key)) continue
      seenCoords.add(key)
      quran_refs.push({
        sura,
        aya,
        sura_name: info?.sura_name ?? (a.suraName || `سورة ${sura}`),
        aya_text: info?.text ?? (a.quotedText || null),
      })
    }

    return NextResponse.json({ hadith_id: hadithId, qiraat, quran_refs })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
