'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'

interface WitnessRow {
  companion_id: number | null
  companion_name: string | null
  companion_abb: string | null
  hadith_id: number
  tarf: string | null
  book_title: string
  takhrij_author: string | null
  takhrij_death: number | null
  chain_count: number
}

export default function WitnessesInline({ hadithId }: { hadithId: number }) {
  const [witnesses, setWitnesses] = useState<WitnessRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/hadith/${hadithId}/witnesses-inline?limit=80&offset=0`)
      .then(r => r.json())
      .then(data => {
        const list: WitnessRow[] = data.witnesses || []
        setWitnesses(list)
        setTotal(typeof data.total === 'number' ? data.total : list.length)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [hadithId])

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const r = await fetch(`/api/hadith/${hadithId}/witnesses-inline?limit=80&offset=${witnesses.length}`)
      const data = await r.json()
      const next: WitnessRow[] = data.witnesses || []
      setWitnesses(prev => {
        const seen = new Set(prev.map(w => w.hadith_id))
        return [...prev, ...next.filter(w => !seen.has(w.hadith_id))]
      })
      if (typeof data.total === 'number') setTotal(data.total)
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
    </div>
  )
  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل الشواهد</p>
  if (witnesses.length === 0) return (
    <p className="text-sm text-gray-400 py-4">لم يُعثر على شواهد أو متابعات لهذا الحديث</p>
  )

  const byCompanion = new Map<string, WitnessRow[]>()
  for (const w of witnesses) {
    const key = w.companion_name || '— غير محدد الصحابي'
    if (!byCompanion.has(key)) byCompanion.set(key, [])
    byCompanion.get(key)!.push(w)
  }

  return (
    <div dir="rtl">
      {/* Counts are in the section header (SectionBadges) */}
      <div className="space-y-4">
        {Array.from(byCompanion.entries()).map(([companionName, rows]) => (
          <div key={companionName}>
            <div className="text-xs font-bold text-violet-700 bg-violet-50 border border-violet-100 px-3 py-1.5 rounded-lg mb-2">
              {companionName}
            </div>
            <div className="space-y-2">
              {rows.map(w => (
                <div key={w.hadith_id}
                  className="bg-white border border-gray-100 rounded-xl p-3 hover:border-green-200 transition-colors">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-medium text-green-800">{w.book_title}</span>
                    {w.takhrij_death && <span className="text-xs text-gray-400">ت {w.takhrij_death}هـ</span>}
                    {w.chain_count > 0 && <span className="text-xs text-gray-400">{w.chain_count} سند</span>}
                    <Link href={`/hadith/${w.hadith_id}`}
                      className="text-xs text-green-700 hover:underline mr-auto">
                      رابط ←
                    </Link>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
                    {(w.tarf || '').slice(0, 150) || `حديث ${w.hadith_id}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {total > witnesses.length && (
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 font-medium disabled:opacity-50"
          >
            {loadingMore ? 'جارٍ التحميل…' : `عرض المزيد (${witnesses.length.toLocaleString('ar-EG')} من ${total.toLocaleString('ar-EG')})`}
          </button>
          <Link
            href={`/hadith/${hadithId}/witnesses`}
            className="text-green-700 hover:underline font-semibold"
          >
            عرض جميع الشواهد ({total.toLocaleString('ar-EG')}) ←
          </Link>
        </div>
      )}
    </div>
  )
}
