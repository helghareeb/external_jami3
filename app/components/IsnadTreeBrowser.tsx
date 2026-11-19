'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/app/components/Link'

interface TreeNode {
  id: number
  name: string
  parent_id: number
  is_leaf: boolean
  rawy_id: number | null
  is_marfoa: boolean
  is_mawkof: boolean
  is_maktoa: boolean
  is_marfoa_hokm: boolean
  descendants: number
}

interface TreeHadith {
  main_id: number
  book_id: number
  book_title: string
  tarf: string | null
  tarqeem_matboa1: string | null
  tarqeem_harf: string | null
  isnad_type: number | null
}

type FilterType = 'all' | 'marfoa' | 'mawkof' | 'maktoa' | 'marfoa_hokm'

const FILTER_TABS: Array<{ id: FilterType; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'marfoa', label: 'مرفوع' },
  { id: 'mawkof', label: 'موقوف' },
  { id: 'maktoa', label: 'مقطوع' },
  { id: 'marfoa_hokm', label: 'مرفوع حكماً' },
]

const ISNAD_TYPE_LABEL: Record<number, string> = {
  1: 'مرفوع',
  2: 'موقوف',
  3: 'مقطوع',
  4: 'مرسل',
}

function TypePills({ node }: { node: TreeNode }) {
  return (
    <div className="flex flex-wrap gap-1">
      {node.is_marfoa && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-800 border border-green-200">مرفوع</span>}
      {node.is_mawkof && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">موقوف</span>}
      {node.is_maktoa && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200">مقطوع</span>}
      {node.is_marfoa_hokm && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">مرفوع حكماً</span>}
    </div>
  )
}

export default function IsnadTreeBrowser({
  initialNodeId,
  initialRawyId,
  initialType,
  initialQuery,
  initialPage,
}: {
  initialNodeId: number | null
  initialRawyId: number | null
  initialType: FilterType
  initialQuery: string
  initialPage: number
}) {
  const router = useRouter()
  const [nodeId, setNodeId] = useState<number | null>(initialNodeId)
  const [rawyId, setRawyId] = useState<number | null>(initialRawyId)
  const [filterType, setFilterType] = useState<FilterType>(initialType)
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(initialPage)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Mode list state
  const [listNodes, setListNodes] = useState<TreeNode[]>([])
  const [listTotal, setListTotal] = useState(0)

  // Mode node state
  const [breadcrumb, setBreadcrumb] = useState<TreeNode[]>([])
  const [children, setChildren] = useState<TreeNode[]>([])
  const [hadiths, setHadiths] = useState<TreeHadith[]>([])
  const [totalHadiths, setTotalHadiths] = useState(0)

  // Mode rawy lookup state
  const [rawyNodes, setRawyNodes] = useState<TreeNode[]>([])

  function syncUrl(next: { node?: number | null; rawy?: number | null; type?: FilterType; q?: string; page?: number }) {
    const p = new URLSearchParams()
    const n = next.node !== undefined ? next.node : nodeId
    const r = next.rawy !== undefined ? next.rawy : rawyId
    const t = next.type ?? filterType
    const qStr = next.q !== undefined ? next.q : query
    const pg = next.page ?? page

    if (n) p.set('node', String(n))
    else if (r) p.set('rawy', String(r))
    if (t !== 'all') p.set('type', t)
    if (qStr && !n && !r) p.set('q', qStr)
    if (pg > 1) p.set('page', String(pg))

    const qs = p.toString()
    router.replace(qs ? `/isnad-tree?${qs}` : '/isnad-tree', { scroll: false })
  }

  useEffect(() => {
    setLoading(true)
    setError(false)
    const p = new URLSearchParams()
    if (nodeId) p.set('nodeId', String(nodeId))
    else if (rawyId) p.set('rawyId', String(rawyId))
    else p.set('parentId', '0')
    if (filterType !== 'all') p.set('type', filterType)
    if (query && !nodeId && !rawyId) p.set('q', query)
    p.set('page', String(page))
    p.set('limit', nodeId ? '25' : '48')

    fetch(`/api/isnad-tree?${p.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.mode === 'node') {
          setBreadcrumb(data.breadcrumb || [])
          setChildren(data.children || [])
          setHadiths(data.hadiths || [])
          setTotalHadiths(data.totalHadiths ?? 0)
        } else if (data.mode === 'rawy') {
          const nodes: TreeNode[] = data.nodes || []
          // If the narrator has a root entry (or unique match), jump directly into it
          if (nodes.length === 1 || (nodes[0] && nodes[0].parent_id === 0)) {
            setRawyId(null)
            setNodeId(nodes[0].id)
            syncUrl({ node: nodes[0].id, rawy: null, page: 1 })
            return
          }
          setRawyNodes(nodes)
        } else {
          setListNodes(data.nodes || [])
          setListTotal(data.total ?? 0)
          setBreadcrumb([])
          setChildren([])
          setHadiths([])
          setTotalHadiths(0)
        }
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [nodeId, rawyId, filterType, query, page]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNode(id: number | null) {
    setRawyId(null)
    setNodeId(id)
    setPage(1)
    syncUrl({ node: id, rawy: null, page: 1 })
  }

  function changeType(t: FilterType) {
    setFilterType(t)
    setPage(1)
    syncUrl({ type: t, page: 1 })
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNodeId(null)
    setRawyId(null)
    setQuery(searchInput.trim())
    setPage(1)
    syncUrl({ node: null, rawy: null, q: searchInput.trim(), page: 1 })
  }

  const perPage = nodeId ? 25 : 48
  const totalPages = Math.max(1, Math.ceil((nodeId ? totalHadiths : listTotal) / perPage))

  return (
    <div dir="rtl" className="space-y-5">
      {/* Controls */}
      <div className="ui-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ui-segmented flex-wrap">
            {FILTER_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => changeType(t.id)}
                className={`ui-segmented-item ${filterType === t.id ? 'ui-segmented-item-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={onSearchSubmit} className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
            <input
              type="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="ابحث باسم رأس السند (صحابي أو تابعي)..."
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

        {/* Breadcrumb when browsing inside a chain */}
        {breadcrumb.length > 0 && (
          <nav aria-label="مسار السند" className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border text-xs">
            <button
              type="button"
              onClick={() => openNode(null)}
              className="text-green-700 hover:underline font-semibold"
            >
              الأصول
            </button>
            {breadcrumb.map((b, i) => {
              const isLast = i === breadcrumb.length - 1
              return (
                <span key={b.id} className="inline-flex items-center gap-1.5">
                  <span className="text-gray-400">‹</span>
                  {isLast ? (
                    <span className="font-bold text-ink">{b.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openNode(b.id)}
                      className="text-green-800 hover:underline"
                    >
                      {b.name}
                    </button>
                  )}
                </span>
              )
            })}
          </nav>
        )}
      </div>

      {error && <p className="text-sm text-red-500 py-4">تعذر تحميل بيانات شجرة الأسانيد</p>}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      )}

      {/* Mode B: multiple occurrences of a narrator */}
      {!loading && rawyId && rawyNodes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-green-900">مواضع الراوي في شجرة الأسانيد ({rawyNodes.length})</h2>
            <button type="button" onClick={() => openNode(null)} className="text-xs text-green-700 hover:underline">
              العودة للأصول
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rawyNodes.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => openNode(n.id)}
                className="text-right ui-card p-3.5 hover:border-green-300 transition-all space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-green-900">{n.name}</span>
                  <span className="text-xs text-gray-400">{n.descendants.toLocaleString('ar-EG')} فرع</span>
                </div>
                <TypePills node={n} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode C: root narrators directory */}
      {!loading && !nodeId && !rawyId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>عدد الأصول: {listTotal.toLocaleString('ar-EG')}</span>
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

          {listNodes.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">لا توجد نتائج مطابقة</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {listNodes.map(n => (
                <div key={n.id} className="ui-card p-3.5 flex flex-col justify-between gap-2 hover:border-green-300 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openNode(n.id)}
                      className="text-right font-bold text-sm text-green-900 hover:underline leading-snug"
                    >
                      {n.name}
                    </button>
                    {n.rawy_id && (
                      <Link
                        href={`/narrator/${n.rawy_id}`}
                        className="text-[11px] text-gray-500 hover:text-green-700 shrink-0"
                        title="صفحة الراوي"
                      >
                        الترجمة
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-border">
                    <TypePills node={n} />
                    <button
                      type="button"
                      onClick={() => openNode(n.id)}
                      className="text-xs font-medium text-green-800 hover:underline"
                    >
                      {n.descendants > 0 ? `${n.descendants.toLocaleString('ar-EG')} تفريع ←` : 'عرض ←'}
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

      {/* Mode A: active chain node + child transmitters + matching hadiths */}
      {!loading && nodeId && (
        <div className="space-y-6">
          {/* Active narrator summary */}
          {breadcrumb.length > 0 && (() => {
            const cur = breadcrumb[breadcrumb.length - 1]
            return (
              <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 flex items-center justify-between flex-wrap gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-green-900">{cur.name}</h2>
                    {cur.rawy_id && (
                      <Link href={`/narrator/${cur.rawy_id}`} className="text-xs text-green-700 hover:underline">
                        بطاقة الراوي ←
                      </Link>
                    )}
                  </div>
                  <TypePills node={cur} />
                </div>
                <div className="text-xs text-gray-600">
                  {cur.descendants.toLocaleString('ar-EG')} تفريع · {totalHadiths.toLocaleString('ar-EG')} حديث بهذا المسار
                </div>
              </div>
            )
          })()}

          {/* Child transmitters (الرواة عنه) */}
          {children.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-sm font-bold text-gray-700">الطبقة التالية — الآخذون عنه ({children.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {children.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => openNode(ch.id)}
                    className="text-right ui-card p-3 hover:border-green-300 transition-colors flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm text-green-900 leading-snug">{ch.name}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {ch.is_leaf ? 'نهاية سند' : `${ch.descendants.toLocaleString('ar-EG')} فرع`}
                      </span>
                    </div>
                    <TypePills node={ch} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Matching hadiths along this exact prefix */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-700">
              الأحاديث المروية بهذا المسار ({totalHadiths.toLocaleString('ar-EG')})
            </h3>
            {hadiths.length === 0 ? (
              <p className="text-xs text-gray-400">لا توجد أحاديث مطابقة لهذا المسار والمرشح</p>
            ) : (
              <div className="space-y-2">
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
                      {h.isnad_type && ISNAD_TYPE_LABEL[h.isnad_type] && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {ISNAD_TYPE_LABEL[h.isnad_type]}
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
        </div>
      )}
    </div>
  )
}
