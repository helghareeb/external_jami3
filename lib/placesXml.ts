import { renderHadithInlineText, stripXmlToVerbatim } from './hadithText'

export interface ParsedPlaceTag {
  name: string
  refId: string | null
}

function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`)
  return attrs.match(re)?.[1] ?? null
}

/** Extract unique `<علم_مكان ...>...</علم_مكان>` tags from hadith XML. */
export function parsePlaceTags(xml: string): ParsedPlaceTag[] {
  if (!xml) return []
  const re = /<علم_مكان(?=[\s>])([^>]*)>([\s\S]*?)<\/علم_مكان>/g
  const seen = new Set<string>()
  const out: ParsedPlaceTag[] = []
  let m: RegExpExecArray | null

  while ((m = re.exec(xml)) !== null) {
    const rawRef = getAttr(m[1], 'ربط')?.trim() || null
    const refId = rawRef && /^\d+$/.test(rawRef) ? rawRef : null
    const name = stripXmlToVerbatim(m[2]).replace(/[،؛:.!؟"«»]/g, '').trim()
    if (!name && !refId) continue

    const key = refId ? `ref:${refId}` : `name:${name}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({ name: name || refId || '', refId })
  }

  return out
}

export function formatPlaceEntryText(xml: string | null | undefined): string {
  if (!xml) return ''
  return renderHadithInlineText(xml)
}
