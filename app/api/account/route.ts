import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { currentUser, endSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Permanently deletes the signed-in reader's account and all associated library, token,
 * session, and usage data. Requires `{ confirm: true }` in the JSON body.
 */
export async function DELETE(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'سجّل الدخول أولًا' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'يلزم تأكيد حذف الحساب' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query('SAVEPOINT sp_mcp_events')
    try {
      await client.query('DELETE FROM mcp_events WHERE user_id = $1', [user.id])
      await client.query('RELEASE SAVEPOINT sp_mcp_events')
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT sp_mcp_events')
    }

    await client.query('SAVEPOINT sp_mcp_usage')
    try {
      await client.query('DELETE FROM mcp_usage WHERE subject = $1', [`u:${user.id}`])
      await client.query('RELEASE SAVEPOINT sp_mcp_usage')
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT sp_mcp_usage')
    }

    await client.query('DELETE FROM login_links WHERE email = $1', [user.email])
    await client.query('DELETE FROM users WHERE id = $1', [user.id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[account delete]', err)
    return NextResponse.json({ error: 'تعذّر حذف الحساب، حاول مجددًا' }, { status: 500 })
  } finally {
    client.release()
  }

  await endSession()
  return NextResponse.json({ ok: true })
}
