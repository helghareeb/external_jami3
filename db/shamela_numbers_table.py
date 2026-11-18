"""hadith_numbers: every numbering a hadith of books 1-5 has had — so citations keep finding their hadith when
a book moves to a newer edition (decided 2026-11-19).

  scheme 'harf'      Harf's numbering (tarqeem_harf): tied to no print; the stable key across editions
  scheme 'edition'   every number the current edition prints in the row (its tags and the number column)
  scheme 'previous'  the number column before the 2026-11-18 rebuild (the earlier print), from its backup

A value is stored as its hadith number: «2072 (م)» → 2072, «5034 / 7» → 5034 (number / place in the chapter),
and Muslim's «1697/ 1698» → both. The number search
falls back to 'previous' when the current edition has no hadith with the number typed. Future edition
updates match on 'harf' first, then add the outgoing edition's numbers as 'previous' — nothing is lost.

Rebuilds the rows of books 1-5 in one transaction; rolls back unless --commit.
  DATABASE_URL=… python db/shamela_numbers_table.py <pre-rebuild backup jsonl> [--commit]
"""
import json, os, re, sys, collections
import psycopg2
from psycopg2.extras import execute_values

sys.stdout.reconfigure(encoding="utf-8")
backup, commit = sys.argv[1], "--commit" in sys.argv[2:]

def numbers(v, book=None):
    """the hadith number(s) in a stored value. Its first number; «N / M» elsewhere is the number and its place
    in the chapter (Nasa'i's earlier print: «5034 / 7») — only Muslim's «1697/ 1698» names two hadith numbers"""
    found = re.findall(r"\d+", (v or "").split("(")[0])
    return found if book == 2 else found[:1]

conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
cur = conn.cursor()
cur.execute("""CREATE TABLE IF NOT EXISTS hadith_numbers (
                 main_id integer NOT NULL, book_id integer NOT NULL, scheme text NOT NULL, number text NOT NULL,
                 PRIMARY KEY (main_id, scheme, number))""")
cur.execute("CREATE INDEX IF NOT EXISTS idx_hadith_numbers_lookup ON hadith_numbers (book_id, scheme, number)")
cur.execute("DELETE FROM hadith_numbers WHERE book_id BETWEEN 1 AND 5")

rows = set()
cur.execute("SELECT main_id, book_id, tarqeem_harf, tarqeem_matboa1, content FROM hadith_toc WHERE book_id BETWEEN 1 AND 5 AND is_paragraph")
present = {}
for mid, b, harf, matboa, x in cur.fetchall():
    present[mid] = b
    for n in numbers(harf):
        rows.add((mid, b, "harf", n))
    for v in [matboa] + re.findall(r'<رقم_حديث نوع="مطبوع">([^<]*)</رقم_حديث>', x or ""):
        for n in numbers(v, b):
            rows.add((mid, b, "edition", n))
prev = 0
for line in open(backup, encoding="utf-8"):
    r = json.loads(line)
    if r["main_id"] in present:
        for n in numbers(r.get("tarqeem_matboa1")):
            rows.add((r["main_id"], present[r["main_id"]], "previous", n)); prev += 1
execute_values(cur, "INSERT INTO hadith_numbers (main_id, book_id, scheme, number) VALUES %s", sorted(rows), page_size=5000)
cur.execute("SELECT scheme, count(*), count(DISTINCT main_id) FROM hadith_numbers WHERE book_id BETWEEN 1 AND 5 GROUP BY 1 ORDER BY 1")
print("rows by scheme (numbers, hadiths):", cur.fetchall())
cur.execute("""SELECT book_id, count(*) FROM hadith_numbers p WHERE scheme = 'previous' AND NOT EXISTS
               (SELECT 1 FROM hadith_numbers e WHERE e.main_id = p.main_id AND e.scheme = 'edition' AND e.number = p.number)
               GROUP BY 1 ORDER BY 1""")
print("previous numbers that differ from the hadith's current ones, by book:", cur.fetchall())
if commit:
    conn.commit(); print("COMMITTED")
else:
    conn.rollback(); print("REHEARSAL (rolled back)")
conn.close()
