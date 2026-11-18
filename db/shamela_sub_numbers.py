"""Second pass on the edition rebuild (books 1-5): hadith numbers as the editions print them.

The import read «٦٢ (م ١) -» as plain «62», so a supplementary narration the edition attaches under a
number (its «م» items: 55 in the Sultaniyya, 389 in Bashar's Tirmidhi) showed as if it were that hadith.
It also read two chapter numbers as hadith numbers (Sultaniyya «٨ - بَابُ مَسْحِ الْيَدِ…», Muslim
«١ - [باب معرفة الإيمان…]»).

This finds every such tag by the edition text that follows it, and writes the corrections:
  - <رقم_حديث نوع="مطبوع">62 </رقم_حديث>  →  <رقم_حديث نوع="مطبوع">62 (م 1) </رقم_حديث>
  - the two chapter numbers become plain text as printed («٨ - », «١ - »)
  - tarqeem_matboa1 «62» → «62 (م 1)» on rows whose own number is the «م» item (not rows where the
    item only stands in front of the row's hadith)
  - 18 numbers the import wrote twice, side by side, keep one copy (the edition prints each once)
  - 8 Abu Dawud rows get their own printed number back; 2 rows get the right number column
    (hand-checked lists below)

Read-only against the database; writes number-updates.jsonl for tools/apply_numbers_postgres.mjs.

  DATABASE_URL=… python db/shamela_sub_numbers.py <shamela_dump dir> <out dir>
"""
import json, os, re, sys, collections
import psycopg2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A

sys.stdout.reconfigure(encoding="utf-8")
dump_dir, out_dir = sys.argv[1], sys.argv[2]
DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
SOURCES = {1: ["1681"], 2: ["711"], 3: ["654"], 4: ["7895", "642"], 5: ["829"]}
TAG = re.compile(r'<رقم_حديث نوع="مطبوع">([^<]*)</رقم_حديث>')
ANY_NUM_TAG = re.compile(r'<رقم_حديث[^>]*>[^<]*</رقم_حديث>')
DOUBLED = re.compile(r'(<رقم_حديث نوع="مطبوع">([^<]*)</رقم_حديث>)'
                     r'((?:\s|<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>|<(?!رقم_حديث)[^>]*>)*?<رقم_حديث نوع="مطبوع">\2</رقم_حديث>)')
MARK = re.compile(r"(?<![٠-٩])([٠-٩]+)\s*(?:\((م[^)]*)\))?\s*-")
# Chapter numbers the import tagged as hadith numbers, checked by hand against the edition pages
# (Sultaniyya page 451, Turkish Muslim page 79): (main_id, tag value) → the text as printed.
CHAPTER_NUMBERS = {(460, "8"): "٨ - ", (11631, "1"): "١ - "}
# Abu Dawud rows whose own printed number the import left out (the text starts with the edition's
# hadith of that number — checked against the Delhi pages); the tag goes before the text.
MISSING_LEAD_TAG = {90197: "859", 90073: "761", 93547: "3277", 91990: "2215", 94950: "4299",
                    95105: "4423", 90304: "941", 93644: "3337"}
# Number column wrong although the text is right: Muslim narration 23 opens as (٩٢٨) and only carries
# (٩٢٧) and (٩٢٩) inside it (Turkish page 2534); Abu Dawud 163 had no number at all.
NUMBER_COLUMN = {14086: ("927", "928"), 89277: (None, "163")}


def norm(s):
    return re.sub(r"\s+", "", A.to_compare(re.sub(r"<[^>]+>", " ", s or "")))


def openings(text):
    o = norm(text)
    return o[:150], o[:40]


# The editions' number marks: the «م» ones and the plain ones (a plain mark with the same opening
# words would make a match ambiguous, so it is never taken for an «م» item).
sub_long, sub_short, plain_long, plain_short = {}, collections.defaultdict(list), set(), collections.Counter()
for book, sids in SOURCES.items():
    for sid in sids:
        for line in open(os.path.join(dump_dir, f"{sid}.tsv"), encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) < 2:
                continue
            text = re.sub(r"<[^>]+>", " ", p[1])
            for m in MARK.finditer(text):
                n = m.group(1).translate(DIG)
                lo, sh = openings(text[m.end():m.end() + 600])
                if m.group(2):
                    label = re.sub(r"\s+", " ", m.group(2).translate(DIG)).strip()
                    sub_long[(book, n, lo)] = label
                    sub_short[(book, n, sh)].append(label)
                else:
                    plain_long.add((book, n, lo))
                    plain_short[(book, n, sh)] += 1

conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
conn.set_session(readonly=True)
cur = conn.cursor()
cur.execute("""SELECT main_id, book_id, content, tarqeem_matboa1 FROM hadith_toc
               WHERE book_id BETWEEN 1 AND 5 AND is_paragraph ORDER BY book_id, id""")
updates, used, stats = [], set(), collections.Counter()
for mid, book, original, tarqeem in cur.fetchall():
    original = original or ""
    # The import wrote 18 numbers twice (only markup between the copies; the edition prints each once):
    # drop the first copy, keep the one that stands where the edition's number does, before the text.
    content, n_doubled = DOUBLED.subn(r"\3", original)
    stats["doubled number removed"] += n_doubled
    if mid in MISSING_LEAD_TAG and f'<رقم_حديث نوع="مطبوع">{MISSING_LEAD_TAG[mid]} </رقم_حديث>' not in content:
        n = MISSING_LEAD_TAG[mid]
        tag = f'<رقم_حديث نوع="مطبوع">{n} </رقم_حديث>'
        harf = re.match(r'(<مسألة><رقم_الفقرة[^>]*/>)(?:(<حديث[^>]*>)?(<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>))?', content)
        if harf.group(3):                             # after a leading حرف number, as in the other rows
            content = content[:harf.end()] + tag + content[harf.end():]
        else:                                         # no حرف before the text
            content = content[:harf.end(1)] + tag + content[harf.end(1):]
        stats["missing printed number added"] += 1
    edits = []  # (start, end, replacement)
    subs = []   # (start, value, label)
    for m in TAG.finditer(content):
        value = m.group(1).strip()
        if (mid, value) in CHAPTER_NUMBERS:
            edits.append((m.start(), m.end(), CHAPTER_NUMBERS[(mid, value)]))
            stats["chapter number → plain text"] += 1
            continue
        if not value.isdigit():
            continue
        lo, sh = openings(ANY_NUM_TAG.sub(" ", content[m.end():m.end() + 6000]))
        label = None
        if (book, value, lo) in sub_long and (book, value, lo) not in plain_long:
            label = sub_long[(book, value, lo)]
            used.add((book, value, lo))
        elif len(sub_short.get((book, value, sh), [])) == 1 and not plain_short[(book, value, sh)]:
            label = sub_short[(book, value, sh)][0]
            used.update(k for k in sub_long if k[:2] == (book, value) and k[2][:40] == sh)
            stats["matched on the first 40 letters"] += 1
        if label:
            edits.append((m.start(), m.end(), f'<رقم_حديث نوع="مطبوع">{value} ({label}) </رقم_حديث>'))
            subs.append((m.start(), value, label))
            stats[f"book {book}: «م» label restored"] += 1
    fix_column = mid in NUMBER_COLUMN and (tarqeem or None) == NUMBER_COLUMN[mid][0]
    if not edits and content == original and not fix_column:
        continue
    new = content
    for s, e, r in sorted(edits, reverse=True):
        new = new[:s] + r + new[e:]
    upd = {"main_id": mid, "book_id": book, "old_content": original, "content": new}
    # The row's own number is the «م» item when it leads the row and no plain tag carries that number
    first = TAG.search(content)
    lead = [s for s in subs if s[0] == first.start()]
    plain_values = {m.group(1).strip() for m in TAG.finditer(new) if m.group(1).strip().isdigit()}
    if lead and (tarqeem or "").strip() == lead[0][1] and lead[0][1] not in plain_values:
        upd["old_tarqeem"] = tarqeem
        upd["tarqeem_matboa1"] = f"{lead[0][1]} ({lead[0][2]})"
        stats["rows numbered as their «م» item"] += 1
    if fix_column:
        upd["old_tarqeem"], upd["tarqeem_matboa1"] = tarqeem, NUMBER_COLUMN[mid][1]
        stats["number column corrected"] += 1
    updates.append(upd)
conn.close()

missing = [k[:2] + (sub_long[k],) for k in sub_long if k not in used]
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "number-updates.jsonl"), "w", encoding="utf-8") as f:
    for u in updates:
        f.write(json.dumps(u, ensure_ascii=False) + "\n")
print(json.dumps(dict(rows=len(updates), **stats), ensure_ascii=False, indent=1))
print("edition «م» marks with no tag found:", len(missing), missing[:20])
