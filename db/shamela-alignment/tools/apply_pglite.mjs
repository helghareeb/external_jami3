// Apply a dry-run import (updates.jsonl from db/shamela_import.py) to a PGlite data directory, in one
// transaction. Use it on a COPY — never on offline-build/pgdata itself.
//   node apply_pglite.mjs <pglite data dir copy> <updates.jsonl>
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const imp = p => import('file:///' + require.resolve(p).replace(/\\/g, '/'))
const { PGlite } = await imp('@electric-sql/pglite')
const { pg_trgm } = await imp('@electric-sql/pglite/contrib/pg_trgm')
const { unaccent } = await imp('@electric-sql/pglite/contrib/unaccent')

const [dir, file] = process.argv.slice(2)
const db = await PGlite.create({ dataDir: dir, extensions: { pg_trgm, unaccent } })

import { EDITIONS, CARDS } from './editions.mjs'

const t0 = Date.now()
let n = 0
await db.exec('BEGIN')
try {
  for (const [id, name] of Object.entries(EDITIONS)) {
    await db.query('UPDATE books SET print1_edition = $1, part_page_edition = $1, card_info = $2 WHERE id = $3',
      [name, CARDS[id], Number(id)])
  }
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    const u = JSON.parse(line)
    const r = await db.query(
      `UPDATE hadith_toc SET content = $1, tarf = COALESCE($2, tarf), tarqeem_matboa1 = $3, part_num = $4, page_num = $5
        WHERE main_id = $6 AND book_id BETWEEN 1 AND 5`,
      [u.content, u.tarf, u.tarqeem_matboa1, u.part_num, u.page_num, u.main_id])
    if (r.affectedRows !== 1) throw new Error(`main_id ${u.main_id}: ${r.affectedRows} rows`)
    if (++n % 2000 === 0) process.stdout.write(`${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`)
  }
  await db.exec('COMMIT')
} catch (e) {
  await db.exec('ROLLBACK')
  console.error('rolled back:', e.message)
  process.exit(1)
}
await db.exec('CHECKPOINT')
await db.close()
console.log(`updated ${n} hadith rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
