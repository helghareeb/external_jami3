export interface CompoundMatnDoc {
  mainId: number
  bookName: string
  hadithNum: string
  hadithNum2: string
  hadithNumH: string
  partNum: string
  pageNum: string
}

export interface CompoundMatnBookGroup {
  bookName: string
  docs: CompoundMatnDoc[]
}

export type CompoundMatnSegment =
  | { type: 'text'; text: string }
  | { type: 'hit'; mmid: string; text: string; hids: number[]; summaryText: string | null }

export interface ParsedCompoundMatn {
  id: number
  isIdenticalNote: boolean
  identicalNoteText: string | null
  segments: CompoundMatnSegment[]
  mainHadiths: CompoundMatnBookGroup[]
  footnotes: Record<string, CompoundMatnBookGroup[]>
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function getAttr(attrs: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`)
  return decodeXmlEntities(attrs.match(re)?.[1] ?? '').trim()
}

function parseMutonBooks(fragment: string): CompoundMatnBookGroup[] {
  const groups: CompoundMatnBookGroup[] = []
  const bookRe = /<MutonBook\b([^>]*)>([\s\S]*?)<\/MutonBook>/g
  let bm: RegExpExecArray | null

  while ((bm = bookRe.exec(fragment)) !== null) {
    const bookName = getAttr(bm[1], 'BookName')
    const docs: CompoundMatnDoc[] = []
    const docRe = /<Document\b([^>]*)\/?>(?:<\/Document>)?/g
    let dm: RegExpExecArray | null
    while ((dm = docRe.exec(bm[2])) !== null) {
      const a = dm[1]
      const mainId = parseInt(getAttr(a, 'MainID'), 10)
      if (!Number.isFinite(mainId) || mainId <= 0) continue
      docs.push({
        mainId,
        bookName,
        hadithNum: getAttr(a, 'HadithNum'),
        hadithNum2: getAttr(a, 'HadithNum2'),
        hadithNumH: getAttr(a, 'HadithNumH'),
        partNum: getAttr(a, 'PartNum'),
        pageNum: getAttr(a, 'PageNum'),
      })
    }
    if (docs.length > 0) groups.push({ bookName, docs })
  }

  return groups
}

/** Parse one `hadith_compound_matn.matn` XML document (`<Root>...</Root>`). */
export function parseCompoundMatnXml(id: number, rawXml: string): ParsedCompoundMatn {
  const xml = (rawXml || '')
    .replace(/^<Root\b[^>]*>/, '')
    .replace(/<\/Root>\s*$/, '')

  // Extract structured blocks first
  const mainHadithMatch = xml.match(/<MMMainHadith>([\s\S]*?)<\/MMMainHadith>/)
  const mainHadiths = mainHadithMatch ? parseMutonBooks(mainHadithMatch[1]) : []

  const footnotes: Record<string, CompoundMatnBookGroup[]> = {}
  const fnBlockMatch = xml.match(/<MMPortionsFootNote>([\s\S]*?)<\/MMPortionsFootNote>/)
  if (fnBlockMatch) {
    const srcRe = /<MMPortionSources\b([^>]*)>([\s\S]*?)<\/MMPortionSources>/g
    let sm: RegExpExecArray | null
    while ((sm = srcRe.exec(fnBlockMatch[1])) !== null) {
      const mmid = getAttr(sm[1], 'ID')
      if (!mmid) continue
      footnotes[mmid] = parseMutonBooks(sm[2])
    }
  }

  const sameMatch = xml.match(/<CompounMatnSame>([\s\S]*?)<\/CompounMatnSame>/)
  const identicalNoteText = sameMatch ? decodeXmlEntities(sameMatch[1]).replace(/\s+/g, ' ').trim() : null

  // Body = everything before metadata blocks (<CompounMatnSame> / <MMMainHadith> / <MMPortionsFootNote>)
  const cutIndices = [
    xml.indexOf('<CompounMatnSame>'),
    xml.indexOf('<MMMainHadith>'),
    xml.indexOf('<MMPortionsFootNote>'),
  ].filter(idx => idx >= 0)
  const bodyEnd = cutIndices.length > 0 ? Math.min(...cutIndices) : xml.length
  const bodyXml = xml.slice(0, bodyEnd)

  const segments: CompoundMatnSegment[] = []
  const hitRe = /<MMHit\b([^>]*)>([\s\S]*?)<\/MMHit>/g
  let cursor = 0
  let hm: RegExpExecArray | null

  while ((hm = hitRe.exec(bodyXml)) !== null) {
    if (hm.index > cursor) {
      const plain = decodeXmlEntities(bodyXml.slice(cursor, hm.index).replace(/<[^>]+>/g, ''))
      if (plain) segments.push({ type: 'text', text: plain })
    }
    const attrs = hm[1]
    const mmid = getAttr(attrs, 'MMID')
    const summaryText = getAttr(attrs, 'MMSText') || null
    const hids = getAttr(attrs, 'HIDs')
      .split(/\s+/)
      .filter(s => /^\d+$/.test(s))
      .map(s => parseInt(s, 10))
    const hitText = decodeXmlEntities(hm[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    segments.push({
      type: 'hit',
      mmid,
      text: hitText,
      hids,
      summaryText,
    })
    cursor = hm.index + hm[0].length
  }

  if (cursor < bodyXml.length) {
    const tail = decodeXmlEntities(bodyXml.slice(cursor).replace(/<[^>]+>/g, ''))
    if (tail) segments.push({ type: 'text', text: tail })
  }

  return {
    id,
    isIdenticalNote: Boolean(sameMatch),
    identicalNoteText,
    segments,
    mainHadiths,
    footnotes,
  }
}
