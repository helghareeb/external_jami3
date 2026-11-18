// Apply a verified rebuild (updates.jsonl from db/shamela_import.py) to a PostgreSQL database.
//
//   node apply_postgres.mjs <updates.jsonl> <snapshot export dir> <backup dir> [--commit]
//
// The connection string comes from DATABASE_URL (or db/dbenv.js's .env fallback); it is never printed.
//
// Safety:
//  - Backup first: every hadith_toc row that will change, and books 1-5, are written to <backup dir>
//    before anything else, so the exact previous state can be restored.
//  - Guard: a row is only updated if its current content, numbers and page still equal the snapshot the
//    rebuild was made from. If any row differs, nothing is written.
//  - One transaction. Without --commit it is a rehearsal: everything runs, then it is rolled back.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EDITIONS, CARDS } from './editions.mjs'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const { Client } = require('pg')
const { url } = require('C:/Users/manaf/Desktop/hadith/db/dbenv.js')

const [updatesFile, exportDir, backupDir, flag] = process.argv.slice(2)
const commit = flag === '--commit'
const updates = readFileSync(updatesFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const snap = new Map()
for (let b = 1; b <= 5; b++) {
  for (const l of readFileSync(join(exportDir, `db_book${b}.jsonl`), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l)
    snap.set(r.main_id, r)
  }
}

const client = new Client({ connectionString: url(), ssl: { rejectUnauthorized: false }, statement_timeout: 600000 })
await client.connect()
const t0 = Date.now()
const ids = updates.map(u => u.main_id)

// 1. backup
mkdirSync(backupDir, { recursive: true })
const before = await client.query(
  `SELECT main_id, book_id, content, tarf, tarqeem_matboa1, part_num, page_num FROM hadith_toc WHERE main_id = ANY($1::int[])`, [ids])
const books = await client.query('SELECT * FROM books WHERE id BETWEEN 1 AND 5 ORDER BY id')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(backupDir, `hadith_toc-books1-5-before-${stamp}.jsonl`), before.rows.map(r => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(join(backupDir, `books-1-5-before-${stamp}.json`), JSON.stringify(books.rows))
console.log(`backup: ${before.rows.length} hadith rows, ${books.rows.length} book rows -> ${backupDir}`)

// 2. guard: production must still hold exactly what the rebuild was made from
const cur = new Map(before.rows.map(r => [r.main_id, r]))
const drift = []
for (const u of updates) {
  const c = cur.get(u.main_id), s = snap.get(u.main_id)
  if (!c || !s || c.content !== s.content || (c.tarqeem_matboa1 ?? null) !== (s.tarqeem_matboa1 ?? null)
      || c.part_num !== s.part_num || c.page_num !== s.page_num) drift.push(u.main_id)
}
if (drift.length) {
  console.error(`STOP: ${drift.length} rows changed since the snapshot (e.g. ${drift.slice(0, 5).join(', ')}). Nothing written.`)
  await client.end()
  process.exit(2)
}
console.log(`guard: all ${updates.length} rows match the snapshot`)

// 3. apply in one transaction
await client.query('BEGIN')
try {
  for (const [id, name] of Object.entries(EDITIONS)) {
    await client.query('UPDATE books SET print1_edition = $1, part_page_edition = $1, card_info = $2 WHERE id = $3',
      [name, CARDS[id], Number(id)])
  }
  // Batched: one statement per 1,000 rows (the database is a network hop away), each row still
  // guarded by its old content; any row that does not update aborts the whole transaction.
  let n = 0
  const B = 1000
  for (let i = 0; i < updates.length; i += B) {
    const chunk = updates.slice(i, i + B)
    const r = await client.query(
      `UPDATE hadith_toc h SET content = v.content, tarf = COALESCE(v.tarf, h.tarf), tarqeem_matboa1 = v.matboa,
              part_num = v.part, page_num = v.page
         FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[])
              AS v(main_id, content, tarf, matboa, part, page, old_content)
        WHERE h.main_id = v.main_id AND h.book_id BETWEEN 1 AND 5 AND h.content = v.old_content`,
      [chunk.map(u => u.main_id), chunk.map(u => u.content), chunk.map(u => u.tarf), chunk.map(u => u.tarqeem_matboa1),
       chunk.map(u => u.part_num), chunk.map(u => u.page_num), chunk.map(u => snap.get(u.main_id).content)])
    if (r.rowCount !== chunk.length) throw new Error(`rows ${i}-${i + chunk.length}: ${r.rowCount} of ${chunk.length} updated`)
    n += r.rowCount
    console.log(`  ${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  }
  if (commit) {
    await client.query('COMMIT')
    console.log(`COMMITTED: ${n} hadith rows and 5 books in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  } else {
    await client.query('ROLLBACK')
    console.log(`REHEARSAL OK (rolled back): ${n} hadith rows and 5 books would be written; ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
} catch (e) {
  await client.query('ROLLBACK')
  console.error('rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
