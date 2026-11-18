"""DECISIONS item 5 (decided 2026-11-19): Muslim's numbers as the Turkish edition prints them, «١ - (٨)».

The edition puts before every narration two numbers: its number within the كتاب, then Abd al-Baqi's in
brackets. We kept only Abd al-Baqi's (<رقم_حديث نوع="مطبوع">8 </رقم_حديث>). This adds the narration's
number as a tag of its own just before it — <رقم_حديث نوع="فرعي">1 </رقم_حديث> — so every reader of the
existing tag is unaffected and the page shows «1 - (8)».

Each tag is matched to its mark in the edition by the text that follows it. Where the same Abd al-Baqi number
and the same opening words occur twice in the book (a narration repeated), book order decides. Also:
- four rows whose mark prints two Abd al-Baqi numbers, «٢٥ - (١٦٩٧/ ١٦٩٨)», which the import misread (the
  narration number became the tag, the two numbers stayed in the text): repaired to the printed form;
- a row that continues a narration after «(ح)» (no mark of its own) takes that narration's number.

Read-only; writes muslim-number-updates.jsonl for tools/apply_numbers_postgres.mjs. Checks: only number tags
and the four repaired marks change; every row well-formed.

  DATABASE_URL=… python db/shamela_muslim_numbers.py <shamela dump dir> <out dir>
"""
import json, os, re, sys, collections
import xml.etree.ElementTree as ET
import psycopg2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A

sys.stdout.reconfigure(encoding="utf-8")
dump_dir, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
norm = lambda s: re.sub(r"\s+", "", A.to_compare(re.sub(r"<[^>]+>", " ", s or "")))
SUB = lambda n: f'<رقم_حديث نوع="فرعي">{n} </رقم_حديث>'
TAG = re.compile(r'<رقم_حديث نوع="مطبوع">([0-9/ ]+?) </رقم_حديث>')

# the edition's marks, in book order: «N - (ABQ)» and «N - (ABQ/ ABQ)»
marks = collections.defaultdict(list)          # (abq, opening150) -> [order, sub]
marks40 = collections.defaultdict(list)
order = 0
for line in open(os.path.join(dump_dir, "711.tsv"), encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if len(p) < 2:
        continue
    t = re.sub(r"<[^>]+>|\(¬[٠-٩]+\)|⦗[^⦘]*⦘", " ", p[1])
    for m in re.finditer(r"(?<![٠-٩])([٠-٩]+)\s*-\s*\(([٠-٩]+)(?:/\s*([٠-٩]+))?\)", t):
        order += 1
        sub = m.group(1).translate(DIG)
        abqs = [m.group(2).translate(DIG)] + ([m.group(3).translate(DIG)] if m.group(3) else [])
        o = norm(t[m.end():m.end() + 600])
        for abq in abqs:
            marks[(abq, o[:150])].append((order, sub))
            marks40[(abq, o[:40])].append((order, sub))

conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
conn.set_session(readonly=True)
cur = conn.cursor()
cur.execute("SELECT main_id, tarqeem_matboa1, content FROM hadith_toc WHERE book_id = 2 AND is_paragraph ORDER BY left_value")
rows = cur.fetchall()
conn.close()

stats, used = collections.Counter(), collections.Counter()
updates, unresolved = [], []
last_sub = None
for mid, tarqeem, x in rows:
    x = x or ""
    new = x
    extra = {}
    # the four misread double numbers: «(١٦٩٧/ <tag>25</tag><حرف…>١٦٩٨) » → the printed form
    dbl = re.search(r'\(([٠-٩]+)/\s*((?:<[^/>][^>]*>)*)<رقم_حديث نوع="مطبوع">(\d+) </رقم_حديث>(<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>)?([٠-٩]+)\)\s*', new)
    if dbl:
        a, opening, sub, harf, b = dbl.group(1).translate(DIG), dbl.group(2), dbl.group(3), dbl.group(4) or "", dbl.group(5).translate(DIG)
        new = new[:dbl.start()] + opening + SUB(sub) + f'<رقم_حديث نوع="مطبوع">{a}/ {b} </رقم_حديث>' + harf + new[dbl.end():]
        if (tarqeem or "").strip() == sub:
            extra = {"old_tarqeem": tarqeem, "tarqeem_matboa1": f"{a}/ {b}"}
        stats["double Abd al-Baqi number repaired"] += 1
        last_sub = sub
    out, pos = [], 0
    for m in TAG.finditer(new):
        before = new[max(0, m.start() - 60):m.start()]
        if re.search(r'<رقم_حديث نوع="فرعي">[^<]*</رقم_حديث>\s*$', before):
            continue                                                        # already has its narration number
        abq = m.group(1).split("/")[0].strip()
        o = norm(re.sub(r"<رقم_حديث[^>]*>[^<]*</رقم_حديث>", " ", new[m.end():m.end() + 6000]))
        cands = marks.get((abq, o[:150])) or marks40.get((abq, o[:40])) or []
        subs = sorted(set(c for c in cands), key=lambda c: c[0])
        if len({s for _, s in subs}) == 1:
            sub = subs[0][1]
        elif subs:
            # the same narration printed twice in the book: the k-th occurrence of ours takes the k-th mark
            key = (abq, o[:150])
            k = used[key]; used[key] += 1
            sub = subs[min(k, len(subs) - 1)][1]
            stats["repeated narration, decided by book order"] += 1
        elif last_sub and re.match(r"\s*(<[^>]+>\s*)*\(ح\)", re.sub(r'<رقم_حديث[^>]*>[^<]*</رقم_حديث>', "", new[m.end():m.end() + 200])):
            sub = last_sub                                                  # continues the narration before «(ح)»
            stats["continuation after «(ح)»: the narration's number"] += 1
        else:
            unresolved.append((mid, abq))
            continue
        out.append((m.start(), sub))
        last_sub = sub
    for p, sub in sorted(out, reverse=True):
        new = new[:p] + SUB(sub) + new[p:]
    stats["narration numbers added"] += len(out)
    if new != x:
        strip = lambda s: re.sub(r'<رقم_حديث[^>]*>[^<]*</رقم_حديث>|[٠-٩]+/\s*|[٠-٩]+\)\s*|\(', "", s)
        if not dbl:
            assert re.sub(r'<رقم_حديث نوع="فرعي">[^<]*</رقم_حديث>', "", new) == x, f"row {mid}: more than number tags changed"
        ET.fromstring("<r>" + new + "</r>")
        updates.append({"main_id": mid, "book_id": 2, "old_content": x, "content": new, **extra})

with open(os.path.join(out_dir, "muslim-number-updates.jsonl"), "w", encoding="utf-8") as f:
    for u in updates:
        f.write(json.dumps(u, ensure_ascii=False) + "\n")
print(json.dumps(dict(rows=len(updates), unresolved=unresolved, **stats), ensure_ascii=False, indent=1))
