import pool from '@/lib/db'
import Link from '@/app/components/Link'
import CollapsibleSection from './CollapsibleSection'
import Chips from './Chips'

interface GroupMember {
  hadith_id: number
  book_name: string
  tarf: string | null
  part_num: number | null
  page_num: number | null
}

export default async function MatnGroupSection({ hadithId }: { hadithId: number }) {
  const groupRes = await pool.query<{ group_id: number }>(
    `SELECT DISTINCT group_id
     FROM hadith_group_matn
     WHERE hadith_main_id = $1 AND group_id IS NOT NULL
     ORDER BY group_id`,
    [hadithId]
  ).catch(() => ({ rows: [] as Array<{ group_id: number }> }))

  const groupIds = groupRes.rows.map(r => Number(r.group_id))
  if (groupIds.length === 0) return null

  const [countRes, membersRes] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT COUNT(DISTINCT gm.hadith_main_id)::int AS total
       FROM hadith_group_matn gm
       JOIN hadith_toc ht ON ht.main_id = gm.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
       WHERE gm.group_id = ANY($1::int[]) AND gm.hadith_main_id != $2`,
      [groupIds, hadithId]
    ).catch(() => ({ rows: [{ total: 0 }] })),
    pool.query<GroupMember>(
      `SELECT hadith_id, book_name, tarf, part_num, page_num
       FROM (
         SELECT DISTINCT ON (gm.hadith_main_id)
                gm.hadith_main_id AS hadith_id, ht.book_name, ht.tarf, ht.part_num, ht.page_num,
                ht.book_id, b.strong
         FROM hadith_group_matn gm
         JOIN hadith_toc ht ON ht.main_id = gm.hadith_main_id AND ht.is_leaf = true AND ht.is_paragraph = true
         LEFT JOIN books b ON b.id = ht.book_id
         WHERE gm.group_id = ANY($1::int[]) AND gm.hadith_main_id != $2
         ORDER BY gm.hadith_main_id, ht.book_id
       ) sub
       ORDER BY sub.strong ASC NULLS LAST, sub.book_id ASC, sub.hadith_id ASC
       LIMIT 24`,
      [groupIds, hadithId]
    ).catch(() => ({ rows: [] as GroupMember[] })),
  ])

  const members = membersRes.rows
  const totalCount = Number(countRes.rows[0]?.total ?? members.length)
  if (members.length === 0) return null

  return (
    <CollapsibleSection
      id="matn-group"
      label="روايات بنفس المتن"
      badges={
        <Chips
          chips={[
            { text: `${totalCount} رواية` },
            ...(groupIds.length > 1 ? [{ text: `${groupIds.length} مجموعة`, tone: 'violet' as const }] : []),
          ]}
        />
      }
      sub={`روايات بنفس المتن في ${totalCount} موضع${groupIds.length > 1 ? ` عبر ${groupIds.length} مجموعة متن` : ''}`}
    >
      <div className="flex flex-wrap gap-2">
        {members.map(m => (
          <Link
            key={m.hadith_id}
            href={`/hadith/${m.hadith_id}`}
            className="inline-flex flex-col items-start bg-green-50 border border-green-200 rounded-lg px-3 py-2 hover:bg-green-100 hover:border-green-300 transition-colors max-w-xs"
            dir="rtl"
          >
            <span className="text-xs font-semibold text-green-800">{m.book_name}</span>
            {m.tarf && (
              <span className="text-xs text-gray-600 mt-0.5 line-clamp-2 leading-relaxed font-arabic">
                {m.tarf.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}
              </span>
            )}
            {(m.part_num || m.page_num) && (
              <span className="text-[10px] text-gray-400 mt-1">
                {m.part_num ? `ج${m.part_num} ` : ''}{m.page_num ? `ص${m.page_num}` : ''}
              </span>
            )}
          </Link>
        ))}
      </div>
      {totalCount > members.length && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 text-xs text-gray-500">
          <span>
            يُعرض أول {members.length} رواية من أصل {totalCount.toLocaleString('ar-EG')} في مجاميع المتن
          </span>
          <Link href={`/hadith/${hadithId}/witnesses`} className="text-green-700 hover:underline font-semibold">
            عرض صفحة الشواهد والمتابعات ←
          </Link>
        </div>
      )}
    </CollapsibleSection>
  )
}
