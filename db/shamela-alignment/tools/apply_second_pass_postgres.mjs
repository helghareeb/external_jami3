// Apply the second pass (second-pass-plan.json from db/shamela_second_pass.py) to PostgreSQL.
//
//   node apply_second_pass_postgres.mjs <second-pass-plan.json> <backup dir> [--commit]
//
// Content updates, as before: backup first; each row only if it still holds exactly the content (and
// tarf / number) the plan was made from, else nothing is written.
// New rows: placed from the live table inside the same transaction —
//   * a fresh main_id each (max + 1 …);
//   * the nested set (left_value/right_value, one numbering across all books) opened in a single pass:
//     every value at or after an insertion point moves up by the room the inserts before it need;
//   * the reading chain (prev/next_paragraph_id) relinked around the new row;
//   * `id` (the row's place in its book) shared with its neighbour, never shifted: some pages join on
//     hadith_toc.id, which for Bukhari equals main_id.
// The left/right of every row that moves are saved to the backup first. Checks inside the transaction:
// left values still distinct, every new row inside its parent, the chain closed both ways, and the
// content read back. Without --commit it rolls back. Connection from DATABASE_URL (never printed).
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

const ups = plan.updates
const ins = plan.inserts
const anchorIds = [...new Set(ins.flatMap(i => [i.anchor, i.chapter_anchor].filter(Boolean)))]
const touched = [...new Set([...ups.map(u => u.main_id), ...anchorIds])]

await q('BEGIN')
try {
  await q('LOCK TABLE hadith_toc IN SHARE ROW EXCLUSIVE MODE')
  // ── backup ──────────────────────────────────────────────────────────────────────────────────────
  const before = (await q('SELECT * FROM hadith_toc WHERE main_id = ANY($1::int[])', [touched])).rows
  const cur = new Map(before.map(r => [r.main_id, r]))
  const chainIds = before.flatMap(r => [r.prev_paragraph_id, r.next_paragraph_id]).filter(Boolean)
  const chain = (await q('SELECT main_id, prev_paragraph_id, next_paragraph_id FROM hadith_toc WHERE main_id = ANY($1::int[])', [chainIds])).rows
  writeFileSync(join(backupDir, `second-pass-rows-before-${stamp}.jsonl`), [...before, ...chain].map(r => JSON.stringify(r)).join('\n') + '\n')

  // ── guard ───────────────────────────────────────────────────────────────────────────────────────
  const drift = ups.filter(u => {
    const r = cur.get(u.main_id)
    return !r || r.content !== u.old_content || ('old_tarf' in u && r.tarf !== u.old_tarf) ||
      ('old_tarqeem' in u && r.tarqeem_matboa1 !== u.old_tarqeem)
  }).map(u => u.main_id)
  if (drift.length) throw new Error(`STOP: ${drift.length} rows differ from what the plan was made from (e.g. ${drift.slice(0, 5).join(', ')})`)
  console.log(`guard: all ${ups.length} rows match`)

  // ── content updates ─────────────────────────────────────────────────────────────────────────────
  for (const u of ups) {
    const sets = ['content = $2'], vals = [u.main_id, u.content]
    if ('tarf' in u) { vals.push(u.tarf); sets.push(`tarf = $${vals.length}`) }
    if ('tarqeem_matboa1' in u) { vals.push(u.tarqeem_matboa1); sets.push(`tarqeem_matboa1 = $${vals.length}`) }
    const r = await q(`UPDATE hadith_toc SET ${sets.join(', ')} WHERE main_id = $1 AND book_id BETWEEN 1 AND 5`, vals)
    if (r.rowCount !== 1) throw new Error(`update ${u.main_id}: ${r.rowCount}`)
  }

  // ── where each new row goes (live values) ───────────────────────────────────────────────────────
  const ops = ins.map((i, k) => {
    const R = cur.get(i.anchor)
    if (i.where === 'after') return { k, i, l: R.right_value + 1, size: 2, parent: R.parent_id, id: R.id }
    if (i.where === 'before') return { k, i, l: R.left_value, size: 2, parent: R.parent_id, id: R.id - 1 }
    const X = cur.get(i.chapter_anchor)                 // before-chapter: a chapter row, the hadith inside it
    if (R.parent_id !== X.main_id) throw new Error(`chapter anchor ${X.main_id} is not the parent of ${R.main_id}`)
    return { k, i, l: X.left_value, size: 4, parent: X.parent_id, id: X.id - 1, X }
  })
  for (const o of ops) o.pos = o.l + ops.filter(p => p.l < o.l || (p.l === o.l && p.k < o.k)).reduce((s, p) => s + p.size, 0)
  const minL = Math.min(...ops.map(o => o.l))
  const moving = (await q('SELECT main_id, left_value, right_value FROM hadith_toc WHERE right_value >= $1', [minL])).rows
  writeFileSync(join(backupDir, `second-pass-nested-set-before-${stamp}.json`), JSON.stringify(moving.map(r => [r.main_id, r.left_value, r.right_value])))
  console.log(`nested set: ${moving.length} rows saved, opening ${ops.reduce((s, o) => s + o.size, 0)} places at ${ops.length} points`)
  const dupBefore = (await q('SELECT count(*)::int n FROM (SELECT left_value FROM hadith_toc GROUP BY 1 HAVING count(*) > 1) d')).rows[0].n
  await q(`UPDATE hadith_toc SET
      left_value  = left_value  + (SELECT coalesce(sum(s), 0) FROM unnest($1::int[], $2::int[]) o(l, s) WHERE o.l <= left_value),
      right_value = right_value + (SELECT coalesce(sum(s), 0) FROM unnest($1::int[], $2::int[]) o(l, s) WHERE o.l <= right_value)
    WHERE right_value >= $3`, [ops.map(o => o.l), ops.map(o => o.size), minL])

  // ── insert, and relink the reading chain ────────────────────────────────────────────────────────
  let next = (await q('SELECT max(main_id)::int m FROM hadith_toc')).rows[0].m + 1
  const created = []
  const insertRow = async (row) => {
    const cols = Object.keys(row)
    await q(`INSERT INTO hadith_toc (${cols.join(', ')}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(', ')})`, cols.map(c => row[c]))
  }
  for (const o of ops) {
    const { i } = o
    const R = (await q('SELECT * FROM hadith_toc WHERE main_id = $1', [i.anchor])).rows[0]
    let parent = o.parent, nodeLeft = o.pos
    if (o.X) {                                            // the chapter row first, the hadith inside it
      const cid = next++
      await insertRow({
        main_id: cid, book_id: R.book_id, book_name: R.book_name, id: o.id, content: i.chapter_title, parent_id: o.parent,
        is_leaf: false, is_paragraph: false, paragraph_id: next, next_paragraph_id: 0, prev_paragraph_id: 0,
        left_value: o.pos, right_value: o.pos + 3, section_text: null, chapter_text: null, part_num: 0, page_num: 0,
        tarf: i.chapter_title, tarqeem_harf: null, tarqeem_matboa1: null, mosanef_id: o.X.mosanef_id ?? 0,
        books_takhrij: o.X.books_takhrij, tarqeem_matboa2: null, dorar_key: null,
      })
      created.push({ main_id: cid, label: `chapter «${i.chapter_title}»`, parent: o.parent })
      parent = cid
      nodeLeft = o.pos + 1
    }
    const nid = next++
    const before = i.where !== 'after'
    const prev = before ? R.prev_paragraph_id : R.main_id
    const nxt = before ? R.main_id : R.next_paragraph_id
    await insertRow({
      main_id: nid, book_id: R.book_id, book_name: R.book_name, id: o.id, content: i.content, parent_id: parent,
      is_leaf: true, is_paragraph: true, paragraph_id: nid, next_paragraph_id: nxt, prev_paragraph_id: prev,
      left_value: nodeLeft, right_value: nodeLeft + 1, section_text: i.section_text, chapter_text: i.chapter_text,
      part_num: i.part_num, page_num: i.page_num, tarf: i.tarf, tarqeem_harf: i.tarqeem_harf, tarqeem_matboa1: i.tarqeem_matboa1,
      mosanef_id: R.mosanef_id ?? 0, books_takhrij: null, tarqeem_matboa2: null, dorar_key: null,
    })
    if (prev) await q('UPDATE hadith_toc SET next_paragraph_id = $1 WHERE main_id = $2', [nid, prev])
    if (nxt) await q('UPDATE hadith_toc SET prev_paragraph_id = $1 WHERE main_id = $2', [nid, nxt])
    created.push({ main_id: nid, label: i.label, parent, anchor: i.anchor, content: i.content })
  }

  // ── checks ──────────────────────────────────────────────────────────────────────────────────────
  const dupAfter = (await q('SELECT count(*)::int n FROM (SELECT left_value FROM hadith_toc GROUP BY 1 HAVING count(*) > 1) d')).rows[0].n
  if (dupAfter !== dupBefore) throw new Error(`nested set: duplicate left values ${dupBefore} → ${dupAfter}`)
  const bad = (await q(`SELECT n.main_id FROM hadith_toc n JOIN hadith_toc p ON p.main_id = n.parent_id
                        WHERE n.main_id = ANY($1::int[]) AND NOT (p.left_value < n.left_value AND n.right_value < p.right_value)`,
                       [created.map(c => c.main_id)])).rows
  if (bad.length) throw new Error(`nested set: ${bad.length} new rows outside their parent`)
  const broken = (await q(`SELECT n.main_id FROM hadith_toc n
                           LEFT JOIN hadith_toc a ON a.main_id = n.prev_paragraph_id LEFT JOIN hadith_toc b ON b.main_id = n.next_paragraph_id
                           WHERE n.main_id = ANY($1::int[]) AND n.is_paragraph
                             AND ((n.prev_paragraph_id <> 0 AND a.next_paragraph_id <> n.main_id) OR (n.next_paragraph_id <> 0 AND b.prev_paragraph_id <> n.main_id))`,
                          [created.map(c => c.main_id)])).rows
  if (broken.length) throw new Error(`reading chain broken at ${broken.map(r => r.main_id).join(', ')}`)
  const back = new Map((await q('SELECT main_id, content FROM hadith_toc WHERE main_id = ANY($1::int[])',
    [[...ups.map(u => u.main_id), ...created.map(c => c.main_id)]])).rows.map(r => [r.main_id, r.content]))
  const wrong = [...ups.filter(u => back.get(u.main_id) !== u.content).map(u => u.main_id),
                 ...created.filter(c => c.content && back.get(c.main_id) !== c.content).map(c => c.main_id)]
  if (wrong.length) throw new Error(`read-back differs: ${wrong.join(', ')}`)
  writeFileSync(join(backupDir, `second-pass-created-${stamp}.json`), JSON.stringify(created.map(({ content, ...c }) => c), null, 1))
  console.log(`checks: nested set distinct (${dupAfter} duplicates, as before), new rows inside their parents, chain closed, read back identical`)
  for (const c of created) console.log(`  new ${c.main_id}: ${c.label}`)
  if (commit) { await q('COMMIT'); console.log(`COMMITTED: ${ups.length} rows updated, ${created.length} rows added`) }
  else { await q('ROLLBACK'); console.log(`REHEARSAL OK (rolled back): ${ups.length} rows would be updated, ${created.length} added`) }
} catch (e) {
  await q('ROLLBACK').catch(() => {})
  console.error('rolled back:', e.message)
  process.exitCode = 1
}
await client.end()
