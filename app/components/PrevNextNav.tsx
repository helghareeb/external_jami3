import Link from '@/app/components/Link'

export interface AdjacentHadithInfo {
  main_id: number
  book_id: number
  book_title: string
  number: string | null
}

interface Props {
  prevId: number | null
  nextId: number | null
  prevHadith?: AdjacentHadithInfo | null
  nextHadith?: AdjacentHadithInfo | null
  currentBookId?: number
  variant?: 'top' | 'bottom'
}

function formatMeta(info: AdjacentHadithInfo | null | undefined, currentBookId?: number): string | null {
  if (!info) return null
  const numPart = info.number ? `رقم ${info.number}` : null
  if (currentBookId !== undefined && info.book_id !== currentBookId) {
    return numPart ? `${info.book_title} · ${numPart}` : info.book_title
  }
  return numPart
}

export default function PrevNextNav({
  prevId,
  nextId,
  prevHadith,
  nextHadith,
  currentBookId,
  variant = 'bottom',
}: Props) {
  if (prevId === null && nextId === null) return null

  const prevMeta = formatMeta(prevHadith, currentBookId)
  const nextMeta = formatMeta(nextHadith, currentBookId)

  if (variant === 'top') {
    return (
      <nav
        aria-label="التنقل بين الأحاديث"
        dir="rtl"
        className="mb-3 flex items-center justify-between gap-2 font-sans"
      >
        <div className="min-w-0">
          {prevId !== null && (
            <Link
              href={`/hadith/${prevId}`}
              aria-label="الحديث السابق"
              title="الحديث السابق (سهم يمين)"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs sm:text-sm font-medium text-ink hover:border-green-300 hover:text-green-800 transition-colors shadow-xs max-w-full"
            >
              <span aria-hidden="true" className="text-green-700 shrink-0">→</span>
              <span className="truncate">
                الحديث السابق
                {prevMeta && <span className="text-gray-400 font-normal mr-1.5">({prevMeta})</span>}
              </span>
            </Link>
          )}
        </div>
        <div className="min-w-0">
          {nextId !== null && (
            <Link
              href={`/hadith/${nextId}`}
              aria-label="الحديث التالي"
              title="الحديث التالي (سهم يسار)"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs sm:text-sm font-medium text-ink hover:border-green-300 hover:text-green-800 transition-colors shadow-xs max-w-full"
            >
              <span className="truncate">
                الحديث التالي
                {nextMeta && <span className="text-gray-400 font-normal mr-1.5">({nextMeta})</span>}
              </span>
              <span aria-hidden="true" className="text-green-700 shrink-0">←</span>
            </Link>
          )}
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label="التنقل بين الأحاديث"
      dir="rtl"
      className="mt-6 pt-4 border-t border-border flex items-stretch justify-between gap-3 font-sans"
    >
      <div className="flex-1 min-w-0 flex justify-start">
        {prevId !== null && (
          <Link
            href={`/hadith/${prevId}`}
            aria-label="الحديث السابق"
            title="الحديث السابق (سهم يمين)"
            className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink hover:border-green-300 hover:text-green-800 transition-colors shadow-xs max-w-full"
          >
            <span aria-hidden="true" className="text-green-700 shrink-0">→</span>
            <span className="min-w-0">
              <span className="block font-medium">الحديث السابق</span>
              {prevMeta && <span className="block text-xs text-gray-400 truncate">{prevMeta}</span>}
            </span>
          </Link>
        )}
      </div>
      <div className="flex-1 min-w-0 flex justify-end">
        {nextId !== null && (
          <Link
            href={`/hadith/${nextId}`}
            aria-label="الحديث التالي"
            title="الحديث التالي (سهم يسار)"
            className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink hover:border-green-300 hover:text-green-800 transition-colors shadow-xs max-w-full text-left"
          >
            <span className="min-w-0">
              <span className="block font-medium">الحديث التالي</span>
              {nextMeta && <span className="block text-xs text-gray-400 truncate">{nextMeta}</span>}
            </span>
            <span aria-hidden="true" className="text-green-700 shrink-0">←</span>
          </Link>
        )}
      </div>
    </nav>
  )
}
