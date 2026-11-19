'use client'

import { useEffect, useState } from 'react'
import Link from '@/app/components/Link'
import { companionTitle } from '@/lib/narratorTitle'

interface BookRef {
  id: number
  title: string
}

interface NarratorBookItem {
  id: number
  name: string
  abb_name: string | null
  martaba_ibn_hajar: string | null
  is_companion: boolean
  companion_title: string | null
  tabaqa: string | null
  death_year_num: number | null
  symbols: string[]
  books: BookRef[]
}

const SYMBOL_TITLES: Record<string, string> = {
  'ع': 'الستة (البخاري ومسلم وأبو داود والترمذي والنسائي وابن ماجه)',
  '٤': 'أصحاب السنن الأربعة',
  'خ': 'صحيح البخاري',
  'م': 'صحيح مسلم',
  'د': 'سنن أبي داود',
  'ت': 'جامع الترمذي',
  'س': 'سنن النسائي',
  'ق': 'سنن ابن ماجه',
  'ط': 'موطأ مالك',
  'حم': 'مسند أحمد',
  'مي': 'مسند الدارمي',
}

export default function NarratorsBooksInline({ hadithId }: { hadithId: number }) {
  const [narrators, setNarrators] = useState<NarratorBookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/hadith/${hadithId}/narrators-books`)
      .then(r => r.json())
      .then(data => {
        setNarrators(data.narrators || [])
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
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 py-4">حدث خطأ في تحميل تخريج الرواة</p>
  if (narrators.length === 0) return <p className="text-sm text-gray-400 py-4">لا توجد بيانات رواة مسجلة لهذا الحديث</p>

  return (
    <div dir="rtl" className="space-y-3">
      <p className="text-xs text-gray-500">
        الكتب التي أخرجت لرواة هذا الإسناد وفق فهارس الرجال، مرتّبين من أعلى السند إلى شيخ المصنف
      </p>
      {narrators.map(nar => (
        <div key={nar.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/narrator/${nar.id}`}
                title={nar.name}
                className="text-sm font-bold text-green-900 hover:text-green-700 hover:underline"
              >
                {nar.abb_name || nar.name}
              </Link>
              {nar.symbols.map(sym => (
                <span
                  key={sym}
                  title={SYMBOL_TITLES[sym] || sym}
                  className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200 cursor-help"
                >
                  {sym}
                </span>
              ))}
              {nar.is_companion && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  {companionTitle(nar)}
                </span>
              )}
              {nar.martaba_ibn_hajar && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-800 border border-green-200">
                  {nar.martaba_ibn_hajar}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {nar.tabaqa && <span>{nar.tabaqa}</span>}
              {nar.death_year_num != null && nar.death_year_num > 0 && <span>ت {nar.death_year_num}هـ</span>}
            </div>
          </div>

          {nar.books.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {nar.books.map(book => (
                <Link
                  key={book.id}
                  href={`/books/${book.id}`}
                  className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                    book.id <= 6
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100 font-medium'
                      : book.id <= 9
                        ? 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {book.title}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">لا توجد كتب مسجلة في فهرس الكتب لهذا الراوي</p>
          )}
        </div>
      ))}
    </div>
  )
}
