// Read-only export of the five books' hadith rows from a COPY of the local PGlite database.
//   node export_db.mjs <pglite data dir copy> <out dir>
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire('C:/Users/manaf/Desktop/hadith/package.json')
const { PGlite } = await import('file:///' + require.resolve('@electric-sql/pglite').replace(/\\/g, '/'))
const contrib = p => import('file:///' + require.resolve(p).replace(/\\/g, '/'))
const { pg_trgm } = await contrib('@electric-sql/pglite/contrib/pg_trgm')
const { unaccent } = await contrib('@electric-sql/pglite/contrib/unaccent')

const [dir, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const db = await PGlite.create({ dataDir: dir, extensions: { pg_trgm, unaccent } })

const cols = (await db.query(`select column_name from information_schema.columns where table_name='hadith_toc' order by ordinal_position`)).rows.map(r => r.column_name)
console.log('hadith_toc columns:', cols.join(', '))

for (const book of [1, 2, 3, 4, 5]) {
  const { rows } = await db.query(
    `select main_id, book_id, id, parent_id, is_leaf, is_paragraph, left_value, part_num, page_num,
            tarqeem_harf, tarqeem_matboa1, tarqeem_matboa2, chapter_text, content
       from hadith_toc where book_id = $1 order by left_value, main_id`, [book])
  writeFileSync(join(out, `db_book${book}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  const withMatn = rows.filter(r => r.content && r.content.includes('<متن')).length
  const withNum = rows.filter(r => r.tarqeem_matboa1).length
  console.log(`book ${book}: rows=${rows.length} with <متن>=${withMatn} with matboa1=${withNum}`)
}
await db.close()
