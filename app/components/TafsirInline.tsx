'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'

interface TafsirEntry {
  service_main_id: number
  book_id: number
  book_name: string
  part_num: number
  page_num: number
  text: string
}

interface AyaTafsirItem {
  aya_id: number | null
  sura_num: number | null
  sura_name: string
  aya_num: number | null
  verse_text: string | null
  quoted_text: string
  tafsir: TafsirEntry[]
}

export default function TafsirInline({ hadithId }: { hadithId: number }) {
  const [ayat, setAyat] = useState<AyaTafsirItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/hadith/${hadithId}/tafsir`)
      .then(r => r.json())
      .then(data => {
        setAyat(data.ayat || [])
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
        {[1, 2].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل التفسير</p>
  if (ayat.length === 0) return <p className="text-sm text-gray-400 py-4">لا توجد آيات مرتبطة بالتفسير في هذا الحديث</p>

  return (
    <div dir="rtl" className="space-y-4">
      {ayat.map((item, idx) => (
        <div key={`${item.sura_num ?? 'x'}-${item.aya_num ?? idx}`} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-amber-50/70 border-b border-amber-100 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {item.sura_num ? (
                <Link href={`/quran/${item.sura_num}`} className="text-sm font-bold text-green-900 hover:underline">
                  سورة {item.sura_name}
                </Link>
              ) : (
                <span className="text-sm font-bold text-green-900">{item.sura_name || 'آية قرآنية'}</span>
              )}
              {item.aya_num != null && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-800">
                  آية {item.aya_num}
                </span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-3">
            {(item.verse_text || item.quoted_text) && (
              <p className="text-base leading-loose font-serif text-gray-900 bg-gray-50/70 rounded-lg px-3.5 py-2.5 border border-gray-100">
                ﴿{item.verse_text || item.quoted_text}﴾
              </p>
            )}

            {item.tafsir.length === 0 ? (
              <p className="text-xs text-gray-400">لم يُربط نص تفسير مسجل لهذه الآية</p>
            ) : (
              <div className="space-y-3">
                {item.tafsir.map(entry => {
                  const isOpen = Boolean(expanded[entry.service_main_id])
                  const long = entry.text.length > 520
                  const shown = !long || isOpen
                    ? entry.text
                    : `${entry.text.slice(0, 520).replace(/\s+\S*$/, '')}…`

                  return (
                    <div key={entry.service_main_id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <Link
                          href={`/service-content/${entry.service_main_id}`}
                          className="text-xs font-semibold text-green-800 hover:underline"
                        >
                          {entry.book_name}
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          {(entry.part_num > 0 || entry.page_num > 0) && (
                            <span>
                              {entry.part_num > 0 ? `ج${entry.part_num} ` : ''}
                              {entry.page_num > 0 ? `ص${entry.page_num}` : ''}
                            </span>
                          )}
                          <Link
                            href={`/service-content/${entry.service_main_id}`}
                            className="text-blue-600 hover:underline"
                          >
                            عرض الموضع ←
                          </Link>
                        </div>
                      </div>
                      <p className="text-sm leading-loose text-gray-800 whitespace-pre-line">{shown}</p>
                      {long && (
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [entry.service_main_id]: !isOpen }))}
                          className="mt-2 text-xs text-green-700 hover:underline font-medium"
                        >
                          {isOpen ? 'عرض مختصر' : 'قراءة التفسير كاملًا'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
