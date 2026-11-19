'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'

interface NarratorRow {
  id: number
  name: string
  living_city: string | null
  birth_city: string | null
  journey_city: string | null
  death_year_num: number | null
}

interface PlaceSource {
  service_main_id: number
  book_id: number
  book_name: string
  part_num: number
  page_num: number
  tarf: string | null
  excerpt: string
  full_text: string
}

interface PlaceItem {
  name: string
  ref_id: string | null
  sources: PlaceSource[]
}

interface LexiconPlace {
  item_id: number
  title: string
}

function primaryCity(n: NarratorRow): string {
  const raw = (n.living_city || n.birth_city || '').trim()
  if (!raw) return ''
  return raw.split('،')[0].replace(/قال.*?:/g, '').trim()
}

export default function NarratorsByRegionInline({ hadithId }: { hadithId: number }) {
  const [narrators, setNarrators] = useState<NarratorRow[]>([])
  const [places, setPlaces] = useState<PlaceItem[]>([])
  const [lexiconPlaces, setLexiconPlaces] = useState<LexiconPlace[]>([])
  const [tab, setTab] = useState<'places' | 'narrators'>('narrators')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      fetch(`/api/hadith/${hadithId}/places`).then(r => r.json()).catch(() => ({ places: [], lexicon_places: [] })),
      fetch(`/api/hadith/${hadithId}/narrators-by-region`).then(r => r.json()).catch(() => ({ narrators: [] })),
    ])
      .then(([placesData, regData]) => {
        const loadedPlaces: PlaceItem[] = placesData.places || []
        const loadedLex: LexiconPlace[] = placesData.lexicon_places || []
        const loadedNarrators: NarratorRow[] = regData.narrators || []
        setPlaces(loadedPlaces)
        setLexiconPlaces(loadedLex)
        setNarrators(loadedNarrators)
        setTab(loadedPlaces.length > 0 || loadedLex.length > 0 ? 'places' : 'narrators')
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [hadithId])

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل البيانات الجغرافية</p>

  const hasPlaces = places.length > 0 || lexiconPlaces.length > 0

  if (!hasPlaces && narrators.length === 0) {
    return <p className="text-sm text-gray-400 py-4">لا تتوفر بيانات جغرافية لهذا الحديث</p>
  }

  const cityMap = new Map<string, NarratorRow[]>()
  const noCityList: NarratorRow[] = []
  for (const n of narrators) {
    const city = primaryCity(n)
    if (city) {
      const bucket = cityMap.get(city) || []
      bucket.push(n)
      cityMap.set(city, bucket)
    } else {
      noCityList.push(n)
    }
  }
  const cities = Array.from(cityMap.entries()).sort((a, b) => b[1].length - a[1].length)

  return (
    <div dir="rtl" className="space-y-4">
      {hasPlaces && narrators.length > 0 && (
        <div className="ui-segmented w-fit">
          <button
            type="button"
            onClick={() => setTab('places')}
            className={`ui-segmented-item ${tab === 'places' ? 'ui-segmented-item-active' : ''}`}
          >
            الأماكن المذكورة في الحديث ({places.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('narrators')}
            className={`ui-segmented-item ${tab === 'narrators' ? 'ui-segmented-item-active' : ''}`}
          >
            توزيع الرواة بالبلدان ({narrators.length})
          </button>
        </div>
      )}

      {tab === 'places' && hasPlaces && (
        <div className="space-y-3">
          {lexiconPlaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-500 font-medium">أعلام البلدان المرتبطة:</span>
              {lexiconPlaces.map(lp => (
                <span key={lp.item_id} className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {lp.title}
                </span>
              ))}
            </div>
          )}

          {places.map((place, idx) => (
            <div key={`${place.ref_id ?? 'name'}-${idx}`} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="bg-emerald-50/60 border-b border-emerald-100 px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-bold text-green-900">{place.name}</span>
                {place.sources.length > 0 && (
                  <span className="text-xs text-emerald-700">{place.sources.length} مصدر جغرافي</span>
                )}
              </div>

              {place.sources.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-500">ورد ذكر هذا الموضع في نص الحديث.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {place.sources.map(src => {
                    const isOpen = Boolean(expanded[src.service_main_id])
                    const isTruncated = src.full_text.length > src.excerpt.length
                    return (
                      <div key={src.service_main_id} className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Link
                            href={`/service-content/${src.service_main_id}`}
                            className="text-xs font-semibold text-green-800 hover:underline"
                          >
                            {src.book_name}
                          </Link>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            {(src.part_num > 0 || src.page_num > 0) && (
                              <span>
                                {src.part_num > 0 ? `ج${src.part_num} ` : ''}
                                {src.page_num > 0 ? `ص${src.page_num}` : ''}
                              </span>
                            )}
                            <Link href={`/service-content/${src.service_main_id}`} className="text-blue-600 hover:underline">
                              عرض الأصل ←
                            </Link>
                          </div>
                        </div>
                        <p className="text-sm leading-loose text-gray-800 whitespace-pre-line">
                          {isOpen ? src.full_text : src.excerpt}
                        </p>
                        {isTruncated && (
                          <button
                            type="button"
                            onClick={() => setExpanded(prev => ({ ...prev, [src.service_main_id]: !isOpen }))}
                            className="text-xs text-green-700 hover:underline font-medium"
                          >
                            {isOpen ? 'عرض مختصر' : 'عرض المزيد'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'narrators' && (
        <div className="space-y-5">
          {cities.map(([city, narrs]) => (
            <div key={city}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-green-900">{city}</h3>
                <span className="text-xs text-gray-400">{narrs.length} راوٍ</span>
              </div>
              <div className="space-y-1.5">
                {narrs.map(n => (
                  <Link
                    key={n.id}
                    href={`/narrator/${n.id}`}
                    className="flex items-start gap-3 px-4 py-2.5 bg-white border border-gray-100 rounded-xl hover:border-green-200 hover:shadow-sm transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 group-hover:text-green-800 leading-snug">{n.name}</p>
                      {n.journey_city && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          رحل إلى: {n.journey_city.split('،')[0].trim()}
                        </p>
                      )}
                    </div>
                    {n.death_year_num && (
                      <span className="text-xs text-gray-400 shrink-0 mt-1">ت {n.death_year_num}هـ</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {noCityList.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-gray-400">غير محدد البلد</h3>
                <span className="text-xs text-gray-400">{noCityList.length} راوٍ</span>
              </div>
              <div className="space-y-1.5">
                {noCityList.map(n => (
                  <Link
                    key={n.id}
                    href={`/narrator/${n.id}`}
                    className="flex items-start gap-3 px-4 py-2.5 bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-all group"
                  >
                    <p className="text-sm text-gray-600 group-hover:text-green-800 flex-1 leading-snug">{n.name}</p>
                    {n.death_year_num && (
                      <span className="text-xs text-gray-400 shrink-0 mt-1">ت {n.death_year_num}هـ</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
