import { cache, Suspense, type ReactNode } from 'react'
import pool from '@/lib/db'
import { parsePlaceTags } from '@/lib/placesXml'
import { parseAyaTags, parseQiraaTags } from '@/lib/quranXml'
import { INLINE_SERVICE_CONFIGS } from './HadithServiceSection'
import Chips, { type Chip } from './Chips'

// Same rule as NarratorsByRegionInline
function primaryCity(living: string | null, birth: string | null): string {
  const raw = (living || birth || '').trim()
  if (!raw) return ''
  return raw.split('،')[0].replace(/قال.*?:/g, '').trim()
}

const fetchSectionChips = cache(async (hadithId: number): Promise<Record<string, Chip[]>> => {
  const empty = { rows: [] as never[] }
  const [commentaryRes, groupSharhRes, groupRes, witnessesRes, narratorsRes, contentRes, rwahBooksRes] = await Promise.all([
    // /api/hadith/[id]/commentary — per service type (content capped at 100 there)
    pool.query<{ type_id: number; n: number; books: number }>(
      `SELECT hsl.type_id::int AS type_id, COUNT(*)::int AS n, COUNT(DISTINCT hsc.book_id)::int AS books
       FROM hadith_service_links hsl
       JOIN hadith_service_content hsc ON hsc.id = hsl.service_content_id
       WHERE hsl.hadith_id = $1
       GROUP BY hsl.type_id`,
      [hadithId]
    ).catch(() => empty),
    // Group-level شرح fallback count (type_id = 6 via takhrij, excluding direct links)
    pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT hsl.service_content_id)::int AS n
       FROM takhrij t_self
       JOIN takhrij t_other ON t_other.group_id = t_self.group_id AND t_other.hadith_id <> $1
       JOIN hadith_service_links hsl ON hsl.hadith_id = t_other.hadith_id AND hsl.type_id = 6
       WHERE t_self.hadith_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM hadith_service_links hd
           WHERE hd.hadith_id = $1 AND hd.type_id = 6 AND hd.service_content_id = hsl.service_content_id
         )`,
      [hadithId]
    ).catch(() => empty),
    // Parallel count across ALL takhrij groups (matches /parallel & /matn-similarity)
    pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT t.hadith_id)::int AS n
       FROM takhrij t
       JOIN hadith_toc h ON h.main_id = t.hadith_id
       JOIN books b ON b.id = t.book_id
       WHERE t.group_id IN (SELECT DISTINCT group_id FROM takhrij WHERE hadith_id = $1 AND group_id IS NOT NULL)
         AND t.hadith_id <> $1`,
      [hadithId]
    ).catch(() => empty),
    // /api/hadith/[id]/witnesses-inline — HGamhAlMatn \ HTakhreeg (matches Windows Shwahed)
    pool.query<{ total_witnesses: number; companions: number; unknown: boolean }>(
      `SELECT COUNT(DISTINCT g2.hadith_main_id)::int AS total_witnesses,
              COUNT(DISTINCT comp.id)::int AS companions,
              COALESCE(bool_or(comp.id IS NULL), false) AS unknown
       FROM hadith_group_matn g2
       JOIN hadith_toc ht ON ht.main_id = g2.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
       LEFT JOIN isnad_hadiths ih2 ON ih2.hadith_id = g2.hadith_main_id
       LEFT JOIN isnad_chains ic2 ON ic2.id = ih2.isnad_id
       LEFT JOIN narrators comp ON comp.id = ic2.narrator_id_array[1] AND comp.is_companion = true
       WHERE g2.group_id IN (SELECT DISTINCT group_id FROM hadith_group_matn WHERE hadith_main_id = $1 AND group_id IS NOT NULL)
         AND g2.hadith_main_id != $1
         AND NOT (g2.hadith_main_id IN (
           SELECT t2.hadith_id
           FROM takhrij t2
           WHERE t2.group_id IN (SELECT DISTINCT group_id FROM takhrij WHERE hadith_id = $1 AND group_id IS NOT NULL)
         ))`,
      [hadithId]
    ).catch(() => empty),
    // /api/hadith/[id]/narrators-by-region
    pool.query<{ living_city: string | null; birth_city: string | null }>(
      `SELECT DISTINCT ON (n.id) n.living_city, n.birth_city
       FROM isnad_hadiths ih
       JOIN isnad_chains ic ON ic.id = ih.isnad_id
       JOIN narrators n ON n.id = ANY(ic.narrator_id_array)
       WHERE ih.hadith_id = $1
       ORDER BY n.id`,
      [hadithId]
    ).catch(() => empty),
    // XML tags in hadith_toc.content for tafsir (<آية>), qiraat (<قراءة>), places (<علم_مكان>)
    pool.query<{ content: string | null }>(
      `SELECT content FROM hadith_toc WHERE main_id = $1`,
      [hadithId]
    ).catch(() => empty),
    // /api/hadith/[id]/narrators-books — narrator count and distinct narrator_books count
    pool.query<{ narrators: number; books: number }>(
      `SELECT COUNT(DISTINCT cn.n_id)::int AS narrators,
              COUNT(DISTINCT nb.book_id)::int AS books
       FROM (
         SELECT DISTINCT unnest(ic.narrator_id_array) AS n_id
         FROM isnad_hadiths ih
         JOIN isnad_chains ic ON ic.id = ih.isnad_id
         WHERE ih.hadith_id = $1
       ) cn
       LEFT JOIN narrator_books nb ON nb.narrator_id = cn.n_id`,
      [hadithId]
    ).catch(() => empty),
  ])

  const chips: Record<string, Chip[]> = {}

  const byType = new Map(commentaryRes.rows.map(r => [Number(r.type_id), r]))
  const groupSharhN = Number(groupSharhRes.rows[0]?.n ?? 0)
  for (const cfg of INLINE_SERVICE_CONFIGS) {
    if (cfg.kind !== 'commentary') continue
    if (cfg.commentaryTypes && cfg.commentaryTypes.length > 0) {
      let totalN = 0
      let maxBooks = 0
      for (const tid of cfg.commentaryTypes) {
        const r = byType.get(tid)
        if (r) {
          totalN += Number(r.n)
          maxBooks = Math.max(maxBooks, Number(r.books))
        }
      }
      if (totalN > 0) chips[cfg.id] = [{ text: `${Math.min(totalN, 100)} نص` }]
      continue
    }
    if (cfg.commentaryType == null) continue
    const r = byType.get(cfg.commentaryType)
    if (r && r.n > 0) {
      const list: Chip[] = [{ text: `${Math.min(r.n, 100)} نص في ${r.books} كتاب` }]
      if (cfg.includeGroupFallback && cfg.commentaryType === 6 && groupSharhN > 0) {
        list.push({ text: `+${groupSharhN} بالمجموعة`, tone: 'info' })
      }
      chips[cfg.id] = list
    } else if (cfg.includeGroupFallback && cfg.commentaryType === 6 && groupSharhN > 0) {
      chips[cfg.id] = [{ text: `${groupSharhN} شرح بالمجموعة`, tone: 'info' }]
    }
  }

  const others = groupRes.rows[0]?.n ?? 0
  if (others > 0) {
    chips['matn-similarity'] = [{ text: `${others} رواية للمقارنة` }]
    chips['variants'] = [{ text: `${others + 1} رواية` }]
  }

  const w = witnessesRes.rows[0]
  if (w && w.total_witnesses > 0) {
    chips['svc-shawahed'] = [
      { text: `${w.total_witnesses} شاهد` },
      { text: `${w.companions + (w.unknown ? 1 : 0)} مجموعة`, tone: 'violet' },
    ]
  }

  const rawContent = contentRes.rows[0]?.content || ''
  const placeCount = parsePlaceTags(rawContent).length
  const ayaCount = parseAyaTags(rawContent).length
  const qiraaCount = parseQiraaTags(rawContent).length

  if (narratorsRes.rows.length > 0 || placeCount > 0) {
    const cities = new Set(narratorsRes.rows.map(n => primaryCity(n.living_city, n.birth_city)).filter(Boolean))
    const countryChips: Chip[] = []
    if (placeCount > 0) countryChips.push({ text: `${placeCount} مكان`, tone: 'violet' })
    if (narratorsRes.rows.length > 0) countryChips.push({ text: `${narratorsRes.rows.length} راوٍ` })
    if (cities.size > 0) countryChips.push({ text: `${cities.size} بلد`, tone: 'info' })
    chips['svc-countries'] = countryChips
  }

  if (ayaCount > 0) chips['svc-tafsser'] = [{ text: `${ayaCount} آية` }]
  if (qiraaCount > 0) chips['svc-kerat'] = [{ text: `${qiraaCount} قراءة` }]

  const rwahStats = rwahBooksRes.rows[0]
  if (rwahStats && rwahStats.narrators > 0) {
    chips['svc-rwah'] = [
      { text: `${rwahStats.narrators} راوٍ` },
      ...(rwahStats.books > 0 ? [{ text: `${rwahStats.books} كتاب`, tone: 'info' as const }] : []),
    ]
  }

  return chips
})

async function SectionBadges({ hadithId, sectionId }: { hadithId: number; sectionId: string }) {
  const chips = (await fetchSectionChips(hadithId))[sectionId]
  return chips ? <Chips chips={chips} /> : null
}

// Badge slots for the sections whose counts need the database, keyed by section id. Each streams
// in on its own (Suspense) so the page never waits on these counts.
export function sectionBadgeSlots(hadithId: number, sectionIds: string[]): Record<string, ReactNode> {
  return Object.fromEntries(sectionIds.map(id => [
    id,
    <Suspense key={id} fallback={null}><SectionBadges hadithId={hadithId} sectionId={id} /></Suspense>,
  ]))
}
