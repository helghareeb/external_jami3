import Link from '@/app/components/Link'
import pool from '@/lib/db'
import IsnadTreeBrowser from '@/app/components/IsnadTreeBrowser'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'شجرة الأسانيد الكاملة — جامع خادم الحرمين',
  description: 'تصفّح شجرة الأسانيد الشاملة (797,473 عقدة) من الصحابة والتابعين إلى المصنّفين عبر الكتب.',
}

export default async function IsnadTreePage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; rawy?: string; type?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const nodeId = sp.node ? parseInt(sp.node, 10) : NaN
  const rawyId = sp.rawy ? parseInt(sp.rawy, 10) : NaN
  const filterType =
    sp.type === 'marfoa' || sp.type === 'mawkof' || sp.type === 'maktoa' || sp.type === 'marfoa_hokm'
      ? sp.type
      : 'all'
  const query = (sp.q || '').trim()
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const statsRes = await pool
    .query<{ total: number; roots: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE parent_id = 0)::int AS roots FROM isnad_tree`
    )
    .catch(() => ({ rows: [{ total: 0, roots: 0 }] }))
  const stats = statsRes.rows[0] ?? { total: 0, roots: 0 }

  return (
    <div dir="rtl" className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
        <Link href="/" className="hover:text-green-700">الرئيسية</Link>
        <span>›</span>
        <Link href="/indexes" className="hover:text-green-700">الفهارس</Link>
        <span>›</span>
        <span className="text-green-900 font-medium">شجرة الأسانيد</span>
      </nav>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-green-900 font-display">شجرة الأسانيد الكاملة</h1>
        <p className="text-sm text-gray-500">
          تصفّح تدرّج الرواة من رأس السند إلى المصنّفين عبر جميع سلاسل الموسوعة
          {stats.total > 0 && (
            <span className="text-xs text-gray-400 mr-2">
              ({stats.roots.toLocaleString('ar-EG')} أصل · {stats.total.toLocaleString('ar-EG')} عقدة)
            </span>
          )}
        </p>
      </div>

      <IsnadTreeBrowser
        initialNodeId={Number.isSafeInteger(nodeId) && nodeId > 0 ? nodeId : null}
        initialRawyId={Number.isSafeInteger(rawyId) && rawyId > 0 ? rawyId : null}
        initialType={filterType}
        initialQuery={query}
        initialPage={page}
      />
    </div>
  )
}
