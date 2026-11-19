'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'

interface ReaderItem {
  id: number
  legacy_num: number
  name: string
}

interface QiraaSource {
  service_main_id: number
  book_name: string
  part_num: number
  page_num: number
  explanation: string | null
}

interface QiraaItem {
  qiraa_ref_id: string
  word_text: string
  sura_num: number | null
  sura_name: string | null
  aya_num: number | null
  readers: ReaderItem[]
  source: QiraaSource | null
}

interface QuranRef {
  sura: number
  aya: number
  sura_name: string
  aya_text: string | null
}

export default function QuranRefsInline({ hadithId }: { hadithId: number }) {
  const [qiraat, setQiraat] = useState<QiraaItem[]>([])
  const [refs, setRefs] = useState<QuranRef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/hadith/${hadithId}/quran-refs`)
      .then(r => r.json())
      .then(data => {
        setQiraat(data.qiraat || [])
        setRefs(data.quran_refs || [])
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
        {[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل القراءات والآيات</p>

  if (qiraat.length === 0 && refs.length === 0) {
    return <p className="text-sm text-gray-400 py-4">لا توجد قراءات قرآنية مرتبطة بهذا الحديث</p>
  }

  return (
    <div dir="rtl" className="space-y-3">
      {qiraat.length > 0 ? (
        qiraat.map(item => (
          <div key={item.qiraa_ref_id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-serif text-base font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-0.5">
                  ﴿{item.word_text}﴾
                </span>
                {item.sura_name && (
                  item.sura_num ? (
                    <Link href={`/quran/${item.sura_num}`} className="text-xs font-semibold text-green-800 hover:underline">
                      سورة {item.sura_name}{item.aya_num != null ? ` (${item.aya_num})` : ''}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-500">
                      سورة {item.sura_name}{item.aya_num != null ? ` (${item.aya_num})` : ''}
                    </span>
                  )
                )}
              </div>
              {item.source && (
                <Link
                  href={`/service-content/${item.source.service_main_id}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {item.source.book_name}
                  {item.source.part_num > 0 || item.source.page_num > 0
                    ? ` (ج${item.source.part_num} ص${item.source.page_num})`
                    : ''}
                </Link>
              )}
            </div>

            <div className="p-4 space-y-2.5">
              {item.readers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.readers.map(r => (
                    <span
                      key={r.id}
                      className="text-xs px-2.5 py-0.5 rounded-full bg-green-50 text-green-800 border border-green-200"
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              )}

              {item.source?.explanation && (
                <p className="text-sm leading-loose text-gray-800 whitespace-pre-line">
                  {item.source.explanation}
                </p>
              )}
            </div>
          </div>
        ))
      ) : (
        refs.map(ref => (
          <div key={`${ref.sura}-${ref.aya}`} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Link href={`/quran/${ref.sura}`} className="text-sm font-semibold text-green-800 hover:underline">
                سورة {ref.sura_name}
              </Link>
              <span className="text-xs text-gray-400">آية {ref.aya}</span>
            </div>
            {ref.aya_text && (
              <p className="text-sm text-gray-700 leading-loose font-serif">{ref.aya_text}</p>
            )}
          </div>
        ))
      )}
    </div>
  )
}
