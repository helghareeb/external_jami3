// Apply the chapter-title update (title-updates.jsonl from db/shamela_titles.py) to PostgreSQL.
//
//   node apply_titles_postgres.mjs <title-updates.jsonl> <backup dir> [--commit]
//
// Same safety as apply_postgres.mjs: backup of every row it touches first; each row is only changed if
// it still holds the old value the update was made from (else nothing is written); one transaction;
// without --commit it rolls back. Connection from DATABASE_URL (never printed).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const { Client } = require('pg')
const [file, backupDir, flag] = process.argv.slice(2)
const commit = flag === '--commit'
const all = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const titles = all.filter(u => 'content' in u)        // chapter rows: content
const chapterText = all.filter(u => 'chapter_text' in u)   // hadith rows: chapter_text
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const local = /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } })
await client.connect()

const ids = all.map(u => u.main_id)
const before = await client.query('SELECT main_id, book_id, content, chapter_text FROM hadith_toc WHERE main_id = ANY($1::int[])', [ids])
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(backupDir, `titles-before-${stamp}.jsonl`), before.rows.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(`backup: ${before.rows.length} rows -> ${backupDir}`)

const cur = new Map(before.rows.map(r => [r.main_id, r]))
const strip = s => (s ?? '').replace(/<[^>]+>/g, '').trim()
const drift = [
  ...titles.filter(u => strip(cur.get(u.main_id)?.content) !== (u.old ?? '').trim()).map(u => u.main_id),
  ...chapterText.filter(u => (cur.get(u.main_id)?.chapter_text ?? '').trim() !== (u.old ?? '').trim()).map(u => u.main_id),
]
if (drift.length) {
  console.error(`STOP: ${drift.length} rows differ from what the update was made from (e.g. ${drift.slice(0, 5).join(', ')}). Nothing written.`)
  await client.end()
  process.exit(2)
}
console.log(`guard: all ${titles.length} chapter rows and ${chapterText.length} hadith rows match`)

await client.query('BEGIN')
try {
  let n = 0
  for (let i = 0; i < titles.length; i += 1000) {
    const c = titles.slice(i, i + 1000)
    const r = await client.query(
      `UPDATE hadith_toc h SET content = v.content FROM unnest($1::int[], $2::text[]) AS v(main_id, content)
        WHERE h.main_id = v.main_id AND h.book_id BETWEEN 1 AND 5 AND h.is_paragraph IS NOT TRUE`,
      [c.map(u => u.main_id), c.map(u => u.content)])
    if (r.rowCount !== c.length) throw new Error(`titles ${i}: ${r.rowCount} of ${c.length}`)
    n += r.rowCount
  }
  for (let i = 0; i < chapterText.length; i += 1000) {
    const c = chapterText.slice(i, i + 1000)
    const r = await client.query(
      `UPDATE hadith_toc h SET chapter_text = v.ct FROM unnest($1::int[], $2::text[], $3::text[]) AS v(main_id, ct, old)
        WHERE h.main_id = v.main_id AND h.book_id BETWEEN 1 AND 5 AND h.chapter_text = v.old`,
      [c.map(u => u.main_id), c.map(u => u.chapter_text), c.map(u => u.old)])
    if (r.rowCount !== c.length) throw new Error(`chapter_text ${i}: ${r.rowCount} of ${c.length}`)
    n += r.rowCount
  }
  if (commit) { await client.query('COMMIT'); console.log(`COMMITTED: ${titles.length} chapter titles and ${chapterText.length} hadith rows' chapter_text`) }
  else { await client.query('ROLLBACK'); console.log(`REHEARSAL OK (rolled back): ${titles.length} chapter titles and ${chapterText.length} chapter_text would be written`) }
} catch (e) {
  await client.query('ROLLBACK')
  console.error('rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
