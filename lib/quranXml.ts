import { renderHadithInlineText, stripXmlToVerbatim } from './hadithText'

export interface ParsedAyaTag {
  ayaId: number | null
  suraNum: number | null
  ayaNum: number | null
  suraName: string
  quotedText: string
}

export interface ParsedQiraaTag {
  qiraaRefId: string
  wordText: string
  readerNums: number[]
  ayaId: number | null
  suraNum: number | null
  ayaNum: number | null
  suraName: string
}

function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`)
  return attrs.match(re)?.[1] ?? null
}

/** Extract unique Quranic verse references from `<آية ...>...</آية>` tags in hadith XML. */
export function parseAyaTags(xml: string): ParsedAyaTag[] {
  if (!xml) return []
  const re = /<آية(?=[\s>])([^>]*)>([\s\S]*?)<\/آية>/g
  const seen = new Set<string>()
  const out: ParsedAyaTag[] = []
  let m: RegExpExecArray | null

  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1]
    const ayaIdRaw = getAttr(attrs, 'ربط')
    const suraNumRaw = getAttr(attrs, 'رقم_السورة')
    const ayaNumRaw = getAttr(attrs, 'الآية')
    const suraName = (getAttr(attrs, 'السورة') || '').trim()

    const ayaId = ayaIdRaw && /^\d+$/.test(ayaIdRaw.trim()) ? parseInt(ayaIdRaw.trim(), 10) : null
    const suraNum = suraNumRaw && /^\d+$/.test(suraNumRaw.trim()) ? parseInt(suraNumRaw.trim(), 10) : null
    const ayaNum = ayaNumRaw && /^\d+$/.test(ayaNumRaw.trim()) ? parseInt(ayaNumRaw.trim(), 10) : null

    if (!ayaId && !(suraNum && ayaNum)) continue
    const key = suraNum && ayaNum ? `${suraNum}:${ayaNum}` : `id:${ayaId}`
    if (seen.has(key)) continue
    seen.add(key)

    const quotedText = stripXmlToVerbatim(m[2])
    out.push({ ayaId, suraNum, ayaNum, suraName, quotedText })
  }

  return out
}

/**
 * Extract `<قراءة rبط="...">...</قراءة>` tags together with `<نوع_قراءة rبط="...">` reader IDs
 * and enclosing `<آية>` verse context when present.
 */
export function parseQiraaTags(xml: string): ParsedQiraaTag[] {
  if (!xml) return []
  const qiraaRe = /<قراءة(?=[\s>])([^>]*)>([\s\S]*?)<\/قراءة>/g
  const ayaRe = /<آية(?=[\s>])([^>]*)>[\s\S]*?<\/آية>/g

  // Precompute <آية> ranges so each <قراءة> knows which verse encloses it
  const ayaRanges: Array<{
    start: number
    end: number
    ayaId: number | null
    suraNum: number | null
    ayaNum: number | null
    suraName: string
  }> = []
  let am: RegExpExecArray | null
  while ((am = ayaRe.exec(xml)) !== null) {
    const attrs = am[1]
    const ayaIdRaw = getAttr(attrs, 'ربط')
    const suraNumRaw = getAttr(attrs, 'رقم_السورة')
    const ayaNumRaw = getAttr(attrs, 'الآية')
    ayaRanges.push({
      start: am.index,
      end: am.index + am[0].length,
      ayaId: ayaIdRaw && /^\d+$/.test(ayaIdRaw.trim()) ? parseInt(ayaIdRaw.trim(), 10) : null,
      suraNum: suraNumRaw && /^\d+$/.test(suraNumRaw.trim()) ? parseInt(suraNumRaw.trim(), 10) : null,
      ayaNum: ayaNumRaw && /^\d+$/.test(ayaNumRaw.trim()) ? parseInt(ayaNumRaw.trim(), 10) : null,
      suraName: (getAttr(attrs, 'السورة') || '').trim(),
    })
  }

  const seen = new Set<string>()
  const out: ParsedQiraaTag[] = []
  let qm: RegExpExecArray | null
  while ((qm = qiraaRe.exec(xml)) !== null) {
    const attrs = qm[1]
    const inner = qm[2]
    const qiraaRefId = (getAttr(attrs, 'ربط') || '').trim()
    if (!qiraaRefId || !/^\d+$/.test(qiraaRefId)) continue

    const readerMatch = inner.match(/<نوع_قراءة(?=[\s>])[^>]*ربط\s*=\s*"([^"]*)"[^>]*>/)
    const readerNums = readerMatch
      ? Array.from(
          new Set(
            readerMatch[1]
              .trim()
              .split(/\s+/)
              .filter(s => /^\d+$/.test(s))
              .map(s => parseInt(s, 10))
          )
        )
      : []

    const wordText = stripXmlToVerbatim(inner).replace(/[﴿﴾]/g, '').trim()
    if (seen.has(qiraaRefId)) continue
    seen.add(qiraaRefId)

    const pos = qm.index
    const enc = ayaRanges.find(a => pos >= a.start && pos <= a.end)
    out.push({
      qiraaRefId,
      wordText,
      readerNums,
      ayaId: enc?.ayaId ?? null,
      suraNum: enc?.suraNum ?? null,
      ayaNum: enc?.ayaNum ?? null,
      suraName: enc?.suraName ?? '',
    })
  }

  return out
}

/**
 * Extract the exact sentence for `qiraaRefId` inside book 87 (البدور الزاهرة) content,
 * stopping cleanly at the next `<نه/>` or next distinct `<قراءة>` entry after the commentary body.
 */
export function extractQiraaSegmentFromBook87(content: string | null | undefined, qiraaRefId: string): string | null {
  if (!content) return null
  const escaped = qiraaRefId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const markerRe = new RegExp(`<قراءة(?=[\\s>])[^>]*ربط="${escaped}"[^>]*>`)
  const m = markerRe.exec(content)
  if (!m) return stripXmlToVerbatim(content) || null

  // Walk backwards only to include an adjacent paired <قراءة> on the same line if joined by ،
  let start = m.index
  const lineStart = content.lastIndexOf('<نه/>', start)
  if (lineStart >= 0) start = lineStart + 5

  // Walk forward to the next <نه/> boundary (book 87 separates each qira'ah entry with <نه/>)
  const closeIdx = content.indexOf('</قراءة>', m.index)
  const bodyStart = closeIdx >= 0 ? closeIdx + 8 : m.index + m[0].length
  const nextNe = content.indexOf('<نه/>', bodyStart)
  const end = nextNe >= 0 ? nextNe : content.length

  const slice = content.slice(start, end)
  const cleaned = renderHadithInlineText(slice)
  return cleaned || stripXmlToVerbatim(slice) || null
}

/** Clean service content XML (e.g., تفسير الطبري book 84) into readable Arabic prose. */
export function cleanServiceProse(xml: string | null | undefined): string {
  if (!xml) return ''
  return renderHadithInlineText(xml)
}
