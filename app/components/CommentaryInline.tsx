'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'

interface ContentRow {
  id: number
  book_name: string
  section_text: string | null
  part_num: number
  page_num: number
  tarf: string | null
  content: string | null
  type_id?: number
  type_name?: string | null
  is_group_fallback?: boolean
  fallback_hadith_id?: number | null
  fallback_book_title?: string | null
}

function decodeEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

function stripServiceTags(xml: string | null): string {
  if (!xml) return ''
  return decodeEntities(
    xml
      .replace(/<رقم_الفقرة[^>]*\/>/g, '')
      .replace(/<الصفحات[^>]*\/>/g, '')
      .replace(/<نه\/>/g, '\n')
      .replace(/<متن[^>]*>/g, '')
      .replace(/<\/متن>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// The texts of one service type (or combined related types like مختلف الحديث) linked to this hadith.
export default function CommentaryInline({
  hadithId,
  initialTypeId,
  commentaryTypes,
  includeGroupFallback = false,
}: {
  hadithId: number
  initialTypeId: number
  commentaryTypes?: number[]
  includeGroupFallback?: boolean
}) {
  const [contentRows, setContentRows] = useState<ContentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const typesKey = commentaryTypes && commentaryTypes.length > 0 ? commentaryTypes.join(',') : ''

  useEffect(() => {
    setLoading(true)
    setError(false)
    const params = new URLSearchParams()
    if (typesKey) {
      params.set('types', typesKey)
    } else {
      params.set('type', String(initialTypeId))
    }
    if (includeGroupFallback) params.set('includeGroup', '1')

    fetch(`/api/hadith/${hadithId}/commentary?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        setContentRows(data.contentRows || [])
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [hadithId, initialTypeId, typesKey, includeGroupFallback])

  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل المحتوى</p>

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
    </div>
  )

  if (contentRows.length === 0) return (
    <p className="text-sm text-gray-400 py-4">لا توجد نصوص متاحة</p>
  )

  const isMultiType = Boolean(commentaryTypes && commentaryTypes.length > 1)

  return (
    <div dir="rtl" className="space-y-4">
      {contentRows.map(row => (
        <div key={`${row.id}-${row.type_id ?? ''}`} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/service-content/${row.id}`} className="text-sm font-semibold text-green-800 hover:underline">
                {row.book_name}
              </Link>
              {isMultiType && row.type_name && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                  row.type_id === 12
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  {row.type_name}
                </span>
              )}
              {row.is_group_fallback && (
                row.fallback_hadith_id ? (
                  <Link
                    href={`/hadith/${row.fallback_hadith_id}`}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 hover:underline"
                  >
                    شرح عبر رواية أخرى ({row.fallback_book_title || 'نفس المجموعة'})
                  </Link>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                    شرح عبر رواية أخرى في نفس المجموعة
                  </span>
                )
              )}
            </div>
            <span className="text-xs text-gray-400">
              {row.section_text?.trim() && <span>{row.section_text.trim()} · </span>}
              {row.part_num > 0 && <span>ج{row.part_num} </span>}
              {row.page_num > 0 && <span>ص{row.page_num}</span>}
            </span>
          </div>
          <div className="p-4 text-sm leading-loose text-gray-800 whitespace-pre-line">
            {stripServiceTags(row.content) || stripServiceTags(row.tarf) || '—'}
          </div>
        </div>
      ))}
    </div>
  )
}
