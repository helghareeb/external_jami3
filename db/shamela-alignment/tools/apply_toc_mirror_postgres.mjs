// Apply item 6 (toc-mirror-plan.json from db/shamela_toc_mirror.py): the contents tree of books 1-5 = the
// edition's index.
//
//   node apply_toc_mirror_postgres.mjs <toc-mirror-plan.json> <backup dir> [--commit]
//
// Rehearse on a local copy first (DATABASE_URL to a restored dump); production last, with --commit.
// In one transaction, with the table locked against writes:
//   guard   every changed column still holds the value the plan was made from; max(main_id) unchanged
//   backup  every row of books 1-5 (whole), the other rows the plan touches, and left/right of every row
//           of other books that moves
//   apply   other books after a grown book move up by the room it takes (their order and links unchanged);
//           changed columns; chapter rows removed; new rows added
//   check   no row under a removed chapter; left values distinct across the table; every row of books 1-5
//           inside its parent; the reading chain closed both ways; contents read back
// Without --commit it rolls back. Connection from DATABASE_URL (never printed).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const { Client } = require('pg')
const [file, backupDir, flag] = process.argv.slice(2)
const commit = flag === '--commit'
const plan = JSON.parse(readFileSync(file, 'utf8'))
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const local = /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } })
await client.connect()
const q = (sql, params) => client.query(sql, params)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
mkdirSync(backupDir, { recursive: true })
const INT = new Set(['parent_id', 'left_value', 'right_value', 'prev_paragraph_id', 'next_paragraph_id', 'paragraph_id', 'part_num', 'page_num', 'id', 'mosanef_id', 'book_id', 'main_id'])
const t0 = Date.now()
const step = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${s}`)

await q('BEGIN')
try {
  await q('LOCK TABLE hadith_toc IN SHARE ROW EXCLUSIVE MODE')
  // ── guard ───────────────────────────────────────────────────────────────────────────────────────
  const maxNow = (await q('SELECT max(main_id)::int m FROM hadith_toc')).rows[0].m
  if (maxNow !== plan.max_main_id) throw new Error(`STOP: max(main_id) is ${maxNow}, the plan was made at ${plan.max_main_id}`)
  const ids = plan.updates.map(u => u.main_id)
  const cur = new Map((await q('SELECT * FROM hadith_toc WHERE main_id = ANY($1::int[])', [ids])).rows.map(r => [r.main_id, r]))
  const drift = plan.updates.filter(u => !cur.has(u.main_id) || Object.entries(u.old).some(([c, v]) => (cur.get(u.main_id)[c] ?? null) !== (v ?? null)))
  if (drift.length) throw new Error(`STOP: ${drift.length} rows differ from the plan's base (e.g. ${drift.slice(0, 5).map(u => u.main_id).join(', ')})`)
  const del = (await q('SELECT main_id FROM hadith_toc WHERE main_id = ANY($1::int[]) AND book_id BETWEEN 1 AND 5 AND NOT is_paragraph', [plan.deletes])).rows
  if (del.length !== plan.deletes.length) throw new Error(`STOP: ${plan.deletes.length - del.length} rows to remove are not chapter rows of books 1-5`)
  step(`guard: ${plan.updates.length} rows match, ${plan.deletes.length} chapter rows to remove, max main_id ${maxNow}`)

  // ── backup ──────────────────────────────────────────────────────────────────────────────────────
  const books = (await q('SELECT * FROM hadith_toc WHERE book_id BETWEEN 1 AND 5')).rows
  const others = [...cur.values()].filter(r => r.book_id < 1 || r.book_id > 5)
  writeFileSync(join(backupDir, `toc-mirror-rows-before-${stamp}.jsonl`), [...books, ...others].map(r => JSON.stringify(r)).join('\n') + '\n')
  const minEnd = plan.grown.length ? Math.min(...plan.grown.map(g => g[0])) : null
  if (minEnd !== null) {
    const moving = (await q('SELECT main_id, left_value, right_value FROM hadith_toc WHERE NOT (book_id BETWEEN 1 AND 5) AND right_value > $1', [minEnd])).rows
    writeFileSync(join(backupDir, `toc-mirror-nested-set-others-before-${stamp}.json`), JSON.stringify(moving.map(r => [r.main_id, r.left_value, r.right_value])))
    step(`backup: ${books.length} rows of books 1-5, ${others.length} other rows, left/right of ${moving.length} rows of other books`)
  }
  const dupBefore = (await q('SELECT count(*)::int n FROM (SELECT left_value FROM hadith_toc GROUP BY 1 HAVING count(*) > 1) d')).rows[0].n

  // ── other books after a grown book move up ──────────────────────────────────────────────────────
  if (minEnd !== null) {
    const r = await q(`UPDATE hadith_toc SET
        left_value  = left_value  + (SELECT coalesce(sum(g), 0) FROM unnest($1::int[], $2::int[]) o(e, g) WHERE o.e < left_value),
        right_value = right_value + (SELECT coalesce(sum(g), 0) FROM unnest($1::int[], $2::int[]) o(e, g) WHERE o.e < right_value)
      WHERE NOT (book_id BETWEEN 1 AND 5) AND right_value > $3`, [plan.grown.map(g => g[0]), plan.grown.map(g => g[1]), minEnd])
    step(`other books: ${r.rowCount} rows moved up`)
  }
  // ── changed columns, one column at a time ───────────────────────────────────────────────────────
  const byCol = {}
  for (const u of plan.updates) for (const [c, v] of Object.entries(u.set)) (byCol[c] ||= []).push([u.main_id, v])
  for (const [c, pairs] of Object.entries(byCol)) {
    const type = INT.has(c) ? 'int' : 'text'
    for (let i = 0; i < pairs.length; i += 5000) {
      const part = pairs.slice(i, i + 5000)
      const r = await q(`UPDATE hadith_toc h SET ${c} = v.val FROM unnest($1::int[], $2::${type}[]) AS v(main_id, val) WHERE h.main_id = v.main_id`,
        [part.map(p => p[0]), part.map(p => p[1])])
      if (r.rowCount !== part.length) throw new Error(`${c}: ${r.rowCount} of ${part.length}`)
    }
    step(`${c}: ${pairs.length} rows`)
  }
  const orphans = (await q('SELECT count(*)::int n FROM hadith_toc WHERE parent_id = ANY($1::int[])', [plan.deletes])).rows[0].n
  if (orphans) throw new Error(`${orphans} rows still under a chapter row to be removed`)
  const d = await q('DELETE FROM hadith_toc WHERE main_id = ANY($1::int[]) AND book_id BETWEEN 1 AND 5 AND NOT is_paragraph', [plan.deletes])
  step(`removed ${d.rowCount} chapter rows`)
  for (const row of plan.inserts) {
    const cols = Object.keys(row)
    await q(`INSERT INTO hadith_toc (${cols.join(', ')}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(', ')})`, cols.map(c => row[c]))
  }
  step(`added ${plan.inserts.length} rows`)

  // ── checks ──────────────────────────────────────────────────────────────────────────────────────
  const dupAfter = (await q('SELECT count(*)::int n FROM (SELECT left_value FROM hadith_toc GROUP BY 1 HAVING count(*) > 1) d')).rows[0].n
  if (dupAfter !== dupBefore) throw new Error(`nested set: duplicate left values ${dupBefore} → ${dupAfter}`)
  const outside = (await q(`SELECT count(*)::int n FROM hadith_toc c JOIN hadith_toc p ON p.main_id = c.parent_id
                            WHERE c.book_id BETWEEN 1 AND 5 AND NOT (p.left_value < c.left_value AND c.right_value < p.right_value)`)).rows[0].n
  if (outside) throw new Error(`nested set: ${outside} rows of books 1-5 outside their parent`)
  const overlap = (await q(`SELECT count(*)::int n FROM hadith_toc a JOIN hadith_toc b ON a.book_id <> b.book_id
                            AND a.parent_id = 0 AND b.parent_id = 0 AND a.left_value < b.right_value AND b.left_value < a.right_value`)).rows[0].n
  if (overlap) throw new Error(`nested set: ${overlap} pairs of book ranges overlap`)
  const chainIds = [...plan.inserts.filter(r => r.is_paragraph).map(r => r.main_id),
                    ...plan.updates.filter(u => 'prev_paragraph_id' in u.set || 'next_paragraph_id' in u.set).map(u => u.main_id)]
  const broken = (await q(`SELECT n.main_id FROM hadith_toc n
                           LEFT JOIN hadith_toc a ON a.main_id = n.prev_paragraph_id LEFT JOIN hadith_toc b ON b.main_id = n.next_paragraph_id
                           WHERE n.main_id = ANY($1::int[]) AND n.is_paragraph
                             AND ((n.prev_paragraph_id <> 0 AND a.next_paragraph_id <> n.main_id) OR (n.next_paragraph_id <> 0 AND b.prev_paragraph_id <> n.main_id))`,
                          [chainIds])).rows
  if (broken.length) throw new Error(`reading chain broken at ${broken.slice(0, 10).map(r => r.main_id).join(', ')}`)
  const contentIds = [...plan.updates.filter(u => 'content' in u.set).map(u => u.main_id), ...plan.inserts.map(r => r.main_id)]
  const want = new Map([...plan.updates.filter(u => 'content' in u.set).map(u => [u.main_id, u.set.content]), ...plan.inserts.map(r => [r.main_id, r.content])])
  const back = (await q('SELECT main_id, content FROM hadith_toc WHERE main_id = ANY($1::int[])', [contentIds])).rows
  const wrong = back.filter(r => r.content !== want.get(r.main_id)).length + (contentIds.length - back.length)
  if (wrong) throw new Error(`read-back differs for ${wrong} rows`)
  step(`checks: left values distinct (${dupAfter} duplicates, as before), books 1-5 nested, no book ranges overlap, chain closed (${chainIds.length} rows), ${contentIds.length} contents read back`)
  if (commit) { await q('COMMIT'); step('COMMITTED') }
  else { await q('ROLLBACK'); step('REHEARSAL OK (rolled back)') }
} catch (e) {
  await q('ROLLBACK').catch(() => {})
  console.error('rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
