'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/app/components/Link'

interface Category {
  id: number
  name: string
  count: number
}

interface GwamhItem {
  gamh_id: number
  id: number
  text: string
  abb_name: string | null
  tabaqa: string | null
  death_year_num: number | null
  is_companion: boolean
  hadiths_count: number
}

interface NarratorInfo {
  id: number
  text: string
  name: string | null
  abb_name: string | null
  tabaqa: string | null
  death_year_num: number | null
  is_companion: boolean | null
}

interface GwamhHadith {
  main_id: number
  book_id: number
  book_title: string
  tarf: string | null
  tarqeem_matboa1: string | null
  tarqeem_harf: string | null
  part_num: number
  page_num: number
}

export default function GwamhBrowser({
  initialGamhId,
  initialNarratorId,
  initialQuery,
  initialPage,
}: {
  initialGamhId: number
  initialNarratorId: number | null
  initialQuery: string
  initialPage: number
}) {
  const router = useRouter()
  const [gamhId, setGamhId] = useState<number>(initialGamhId)
  const [narratorId, setNarratorId] = useState<number | null>(initialNarratorId)
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(initialPage)

  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<GwamhItem[]>([])
  const [narrator, setNarrator] = useState<NarratorInfo | null>(null)
  const [matchScope, setMatchScope] = useState<'root' | 'chain'>('root')
  const [hadiths, setHadiths] = useState<GwamhHadith[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function syncUrl(next: { gamh?: number; narrator?: number | null; q?: string; page?: number }) {
    const p = new URLSearchParams()
    const g = next.gamh ?? gamhId
    const n = next.narrator !== undefined ? next.narrator : narratorId
    const qStr = next.q !== undefined ? next.q : query
    const pg = next.page ?? page

    if (g !== 1) p.set('gamh', String(g))
    if (n) p.set('narrator', String(n))
    if (qStr && !n) p.set('q', qStr)
    if (pg > 1) p.set('page', String(pg))

    const qs = p.toString()
    router.replace(qs ? `/gwamh?${qs}` : '/gwamh', { scroll: false })
  }

  useEffect(() => {
    setLoading(true)
    setError(false)
    const p = new URLSearchParams()
    p.set('gamhId', String(gamhId))
    if (narratorId) p.set('narratorId', String(narratorId))
    else if (query) p.set('q', query)
    p.set('page', String(page))
    p.set('limit', narratorId ? '25' : '36')

    fetch(`/api/gwamh?${p.toString()}`)
      .then(r => r.json())
      .then(data => {
        setCategories(data.categories || [])
        if (narratorId) {
          setNarrator(data.narrator || null)
          setMatchScope(data.matchScope || 'root')
          setHadiths(data.hadiths || [])
          setTotal(data.total ?? 0)
        } else {
          setNarrator(null)
          setHadiths([])
          setItems(data.items || [])
          setTotal(data.total ?? 0)
        }
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [gamhId, narratorId, query, page])

  function selectTab(id: number) {
    setGamhId(id)
    setNarratorId(null)
    setPage(1)
    syncUrl({ gamh: id, narrator: null, page: 1 })
  }

  function selectNarrator(id: number | null) {
    setNarratorId(id)
    setPage(1)
    syncUrl({ narrator: id, page: 1 })
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    setNarratorId(null)
    setQuery(searchInput.trim())
    setPage(1)
    syncUrl({ narrator: null, q: searchInput.trim(), page: 1 })
  }

  const perPage = narratorId ? 25 : 36
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div dir="rtl" className="space-y-5">
      <div className="ui-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ui-segmented flex-wrap">
            {(categories.length > 0
              ? categories
              : [
                  { id: 1, name: 'آثار الصحابة', count: 711 },
                  { id: 2, name: 'آثار التابعيين', count: 1053 },
                ]
            ).map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => selectTab(cat.id)}
                className={`ui-segmented-item ${gamhId === cat.id ? 'ui-segmented-item-active' : ''}`}
              >
                {cat.name} ({cat.count.toLocaleString('ar-EG')})
              </button>
            ))}
          </div>

          <form onSubmit={onSearch} className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
            <input
              type="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="ابحث باسم الصحابي أو التابعي..."
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-green-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-green-800 text-white text-xs font-semibold hover:bg-green-700"
            >
              بحث
            </button>
          </form>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 py-4">تعذر تحميل بيانات جوامع الآثار</p>}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      )}

      {!loading && !narratorId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>عدد الأعلام: {total.toLocaleString('ar-EG')}</span>
            {query && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setQuery(''); setPage(1); syncUrl({ q: '', page: 1 }) }}
                className="text-green-700 hover:underline"
              >
                مسح البحث
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">لا توجد نتائج مطابقة</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(item => (
                <div key={`${item.gamh_id}-${item.id}`} className="ui-card p-3.5 flex flex-col justify-between gap-2.5 hover:border-green-300 transition-colors">
                  <div>
                    <button
                      type="button"
                      onClick={() => selectNarrator(item.id)}
                      className="text-right font-bold text-sm text-green-900 hover:underline leading-snug line-clamp-2"
                      title={item.text}
                    >
                      {item.abb_name || item.text}
                    </button>
                    {item.tabaqa && (
                      <p className="text-[11px] text-gray-500 mt-1">{item.tabaqa}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border text-xs">
                    <div className="flex items-center gap-2 text-gray-400">
                      {item.death_year_num != null && item.death_year_num > 0 && <span>ت {item.death_year_num}هـ</span>}
                      <Link href={`/narrator/${item.id}`} className="hover:text-green-700">الترجمة</Link>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectNarrator(item.id)}
                      className="font-semibold text-green-800 hover:underline"
                    >
                      عرض الآثار ←
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => { const np = page - 1; setPage(np); syncUrl({ page: np }) }}
                className="px-3 py-1 rounded-lg border border-border text-xs disabled:opacity-40"
              >
                السابق
              </button>
              <span className="text-xs text-gray-500">صفحة {page} من {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => { const np = page + 1; setPage(np); syncUrl({ page: np }) }}
                className="px-3 py-1 rounded-lg border border-border text-xs disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && narratorId && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-amber-950">
                  {narrator?.abb_name || narrator?.text || narrator?.name || `راوٍ ${narratorId}`}
                </h2>
                <Link href={`/narrator/${narratorId}`} className="text-xs text-green-700 hover:underline">
                  بطاقة الراوي ←
                </Link>
              </div>
              <p className="text-xs text-gray-600">
                {gamhId === 1 ? 'آثار الصحابي (موقوفات)' : 'آثار التابعي (مقطوعات)'}
                {' · '}
                {total.toLocaleString('ar-EG')} رواية
                {matchScope === 'chain' ? ' (في أثناء السند)' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => selectNarrator(null)}
              className="text-xs font-semibold text-green-800 hover:underline"
            >
              ← العودة إلى القائمة
            </button>
          </div>

          {hadiths.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">
              لا توجد {gamhId === 1 ? 'موقوفات' : 'مقطوعات'} مسجلة لهذا الراوي
            </p>
          ) : (
            <div className="space-y-2.5">
              {hadiths.map(h => (
                <Link
                  key={h.main_id}
                  href={`/hadith/${h.main_id}`}
                  className="block ui-card p-3.5 hover:border-green-300 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-green-800">
                      {h.book_title}
                      {(h.tarqeem_matboa1 || h.tarqeem_harf) ? ` (${(h.tarqeem_matboa1 || h.tarqeem_harf || '').trim()})` : ''}
                    </span>
                    {(h.part_num > 0 || h.page_num > 0) && (
                      <span className="text-[11px] text-gray-400">
                        {h.part_num > 0 ? `ج${h.part_num} ` : ''}{h.page_num > 0 ? `ص${h.page_num}` : ''}
                      </span>
                    )}
                  </div>
                  {h.tarf && <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">{h.tarf}</p>}
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => { const np = page - 1; setPage(np); syncUrl({ page: np }) }}
                className="px-3 py-1 rounded-lg border border-border text-xs disabled:opacity-40"
              >
                السابق
              </button>
              <span className="text-xs text-gray-500">صفحة {page} من {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => { const np = page + 1; setPage(np); syncUrl({ page: np }) }}
                className="px-3 py-1 rounded-lg border border-border text-xs disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
