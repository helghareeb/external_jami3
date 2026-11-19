import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { parseCompoundMatnXml } from '@/lib/compoundMatn'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const hadithId = parseInt(id, 10)
  if (isNaN(hadithId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  try {
    const idsRes = await pool.query<{ compound_matn_id: number }>(
      `SELECT DISTINCT compound_matn_id
       FROM takhrij
       WHERE hadith_id = $1 AND compound_matn_id IS NOT NULL AND compound_matn_id > 0
       ORDER BY compound_matn_id`,
      [hadithId]
    )

    const compoundIds = idsRes.rows.map(r => Number(r.compound_matn_id))
    if (compoundIds.length === 0) {
      return NextResponse.json({ hadith_id: hadithId, records: [] })
    }

    const res = await pool.query<{ id: number; hadith_main_id: number | null; matn: string | null }>(
      `SELECT id, hadith_main_id, matn
       FROM hadith_compound_matn
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [compoundIds]
    )

    const records = res.rows
      .filter(r => r.matn)
      .map(r => ({
        ...parseCompoundMatnXml(Number(r.id), r.matn!),
        hadith_main_id: r.hadith_main_id != null ? Number(r.hadith_main_id) : null,
      }))

    return NextResponse.json({ hadith_id: hadithId, records })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
