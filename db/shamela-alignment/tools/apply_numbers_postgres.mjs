// Apply the hadith-number corrections (number-updates.jsonl from db/shamela_sub_numbers.py) to PostgreSQL.
//
//   node apply_numbers_postgres.mjs <number-updates.jsonl> <backup dir> [--commit]
//
// Same safety as apply_postgres.mjs: backup of every row it touches first; a row is only changed if its
// content (and tarqeem_matboa1, where that changes) is still exactly what the update was made from — else
// nothing at all is written; one transaction; without --commit it rolls back. Connection from
// DATABASE_URL (never printed).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const { Client } = require('pg')
const [file, backupDir, flag] = process.argv.slice(2)
const commit = flag === '--commit'
const ups = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const local = /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } })
await client.connect()

const ids = ups.map(u => u.main_id)
const before = await client.query('SELECT main_id, book_id, content, tarqeem_matboa1 FROM hadith_toc WHERE main_id = ANY($1::int[])', [ids])
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(backupDir, `numbers-before-${stamp}.jsonl`), before.rows.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(`backup: ${before.rows.length} rows -> ${backupDir}`)

const cur = new Map(before.rows.map(r => [r.main_id, r]))
const drift = ups.filter(u => {
  const r = cur.get(u.main_id)
  return !r || r.content !== u.old_content || ('old_tarqeem' in u && r.tarqeem_matboa1 !== u.old_tarqeem)
}).map(u => u.main_id)
if (drift.length) {
  console.error(`STOP: ${drift.length} rows differ from what the update was made from (e.g. ${drift.slice(0, 5).join(', ')}). Nothing written.`)
  await client.end()
  process.exit(2)
}
const withNumber = ups.filter(u => 'tarqeem_matboa1' in u)
console.log(`guard: all ${ups.length} rows match (${withNumber.length} also change tarqeem_matboa1)`)

await client.query('BEGIN')
try {
  const r1 = await client.query(
    `UPDATE hadith_toc h SET content = v.content FROM unnest($1::int[], $2::text[]) AS v(main_id, content)
      WHERE h.main_id = v.main_id AND h.book_id BETWEEN 1 AND 5`,
    [ups.map(u => u.main_id), ups.map(u => u.content)])
  if (r1.rowCount !== ups.length) throw new Error(`content: ${r1.rowCount} of ${ups.length}`)
  const r2 = await client.query(
    `UPDATE hadith_toc h SET tarqeem_matboa1 = v.t FROM unnest($1::int[], $2::text[], $3::text[]) AS v(main_id, t, old)
      WHERE h.main_id = v.main_id AND h.book_id BETWEEN 1 AND 5 AND h.tarqeem_matboa1 = v.old`,
    [withNumber.map(u => u.main_id), withNumber.map(u => u.tarqeem_matboa1), withNumber.map(u => u.old_tarqeem)])
  if (r2.rowCount !== withNumber.length) throw new Error(`tarqeem_matboa1: ${r2.rowCount} of ${withNumber.length}`)
  // read back inside the transaction
  const after = await client.query('SELECT main_id, content, tarqeem_matboa1 FROM hadith_toc WHERE main_id = ANY($1::int[])', [ids])
  const got = new Map(after.rows.map(r => [r.main_id, r]))
  const wrong = ups.filter(u => got.get(u.main_id)?.content !== u.content ||
    ('tarqeem_matboa1' in u && got.get(u.main_id)?.tarqeem_matboa1 !== u.tarqeem_matboa1)).length
  if (wrong) throw new Error(`read-back: ${wrong} rows differ`)
  if (commit) { await client.query('COMMIT'); console.log(`COMMITTED: ${ups.length} rows (content), ${withNumber.length} tarqeem_matboa1; read back identical`) }
  else { await client.query('ROLLBACK'); console.log(`REHEARSAL OK (rolled back): ${ups.length} rows and ${withNumber.length} tarqeem_matboa1 would be written; read back identical`) }
} catch (e) {
  await client.query('ROLLBACK')
  console.error('rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
