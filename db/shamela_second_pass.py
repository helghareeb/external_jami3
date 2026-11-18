"""Second pass on the edition rebuild of books 1-5 (decided 2026-11-18, db/shamela-alignment/second-pass/DECISIONS.html):

  1أ  rows the import skipped get the edition's text; the copies it wrote into a neighbour come out
  1ب  Tirmidhi rows whose hadith Bashar moved to his footnote: the number and the footnote, as printed
  2   narrations we never had get a row of their own (Shamela gives each its own hadith link)
  3   rows holding two of the edition's hadiths that Shamela links separately are split
  +   edition text that no row carried (found by the coverage check) is written where it belongs

Read-only against the database. Writes second-pass-plan.json (content updates and new rows) for
tools/apply_second_pass_postgres.mjs, after checking the result in memory: well-formed rows, every
edition page present and none twice, and every split row's text kept exactly.

  DATABASE_URL=… python db/shamela_second_pass.py <shamela dump dir (with footnotes)> <out dir>
"""
import html, json, os, re, sys, collections
from collections import Counter, defaultdict
import xml.etree.ElementTree as ET
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A
import shamela_import as I

sys.stdout.reconfigure(encoding="utf-8")
dump_dir, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
SCHEME = {sid: scheme for _, sids, _, scheme in A.BOOKS for sid in sids}
NUMTAG = lambda n: f'<رقم_حديث نوع="مطبوع">{n} </رقم_حديث>'

# ── edition ───────────────────────────────────────────────────────────────────────────────────────
UNITS, FEET, RAW = {}, {}, {}
def units_of(sid, pid):
    if sid not in UNITS:
        UNITS[sid] = A.load_shamela(dump_dir, sid, SCHEME[sid])
        for u in UNITS[sid]:
            u.sh_book = sid
        for line in open(os.path.join(dump_dir, f"{sid}.tsv"), encoding="utf-8"):
            p = (line.rstrip("\n").split("\t") + ["", ""])[:3]
            RAW[(sid, int(p[0]))] = p[1]
            if p[2].strip(" \\n"):
                FEET[(sid, int(p[0]))] = I.parse_foot(p[2])
    return [u for u in UNITS[sid] if u.page_id == pid]

def ed_words(units, numbered_first, keep_titles=True):
    """words + specials (P page breaks, F footnotes qualified by page, N numbers) + footnote texts"""
    words, specials, foot_texts, numbers = [], defaultdict(list), {}, []
    for k, u in enumerate(units):
        w, sp = I.edition_words(u.raw, u.part, keep_titles=keep_titles)
        base = len(words)
        if u.number is not None and (k > 0 or numbered_first):
            specials[base].append(("N", str(u.number)))
        for j, lst in sp.items():
            for kind, val in lst:
                specials[base + j].append((kind, f"{u.sh_book}:{u.page_id}:{val}" if kind == "F" else val))
        words.extend(w)
        if u.number is not None:
            numbers.append(u.number)
        for num, text in FEET.get((u.sh_book, u.page_id), {}).items():
            foot_texts[f"{u.sh_book}:{u.page_id}:{num}"] = text
    return words, specials, foot_texts, numbers

def ed_only(units):
    """The edition's text alone (no tags of ours): returns (xml, notes)."""
    w, sp, ft, _ = ed_words(units, numbered_first=True)
    xml, used = I.transfer([], w, sp, [], units[0].part, {}, ft, Counter())
    return xml, dict(used)

def rebuild(old_xml, head_units, body_units):
    """The import's own way: the edition's words, our tags carried where they line up."""
    st, foot_ids, used = Counter(), {}, []
    h, bd = I.split_heading(old_xml)
    if head_units:
        hw, hs, ft_h, _ = ed_words(head_units, numbered_first=False)
    else:
        hw, hs, ft_h = [], {}, {}
    w, sp, ft, numbers = ed_words(body_units, numbered_first=False, keep_titles=False)
    ft.update(ft_h)
    if hw or A.db_plain(h).strip():
        hx, u1 = I.transfer(I.xml_items(h), hw, hs, [], (head_units or body_units)[0].part, foot_ids, ft, st)
        used += u1
    else:
        hx = h
    bx, u2 = I.transfer(I.xml_items(bd), w, sp, numbers, body_units[0].part, foot_ids, ft, st)
    used += u2
    return strip_margin(hx + bx), dict(used)

# ── markup helpers ────────────────────────────────────────────────────────────────────────────────
TOK = re.compile(r"<(/?)([^\s>/]+)([^>]*?)(/?)>")
MARGIN = re.compile(r"<Margin>.*?</Margin>", re.S)

def strip_margin(x):
    return MARGIN.sub("", x)

def notes_of(x):
    return {m.group(1): html.unescape(m.group(2)).strip()
            for m in re.finditer(r'<FootNote ID="([^"]+)">(.*?)</FootNote>', x, re.S)}

def open_stack(x, pos):
    st = []
    for m in TOK.finditer(x[:pos]):
        if m.group(4) or m.group(2).startswith(("!", "?")):
            continue
        if m.group(1):
            if st and st[-1][0] == m.group(2):
                st.pop()
            else:
                raise ValueError(f"unbalanced </{m.group(2)}> before cut")
        else:
            st.append((m.group(2), m.group(0)))
    return st

def cut(x, pos):
    """split well-formed markup at pos: close what is open in part 1, reopen it in part 2"""
    st = open_stack(x, pos)
    return x[:pos] + "".join(f"</{n}>" for n, _ in reversed(st)), "".join(t for _, t in st) + x[pos:]

def back_over(x, pos):
    """move a cut back over the markup that opens the next unit: <نه/>, a حرف number, spaces"""
    while True:
        m = re.search(r'(?:\s+|<نه/>|<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>)$', x[:pos])
        if not m or m.start() == pos:
            return pos
        pos = m.start()

def text_pos(x, phrase):
    """content offset where the visible text `phrase` (compared bare) starts"""
    want = A_bare(phrase)
    chars, offs = [], []
    for m in re.finditer(r"<[^>]+>|[^<]+", x):
        if m.group(0).startswith("<"):
            continue
        for k, ch in enumerate(m.group(0)):
            b = A_bare(ch)
            if b:
                chars.append(b); offs.append(m.start() + k)
    s = "".join(chars)
    i = s.find(want)
    if i < 0:
        raise ValueError(f"text not found: {phrase[:40]}")
    return offs[i]

def A_bare(s):
    s = re.sub(r"[ً-ٰٟـ]", "", s).replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^ء-ي]", "", s)

def lead_of(x):
    m = re.match(r"<مسألة>(<رقم_الفقرة[^>]*/>)?", x)
    return m.group(0) if m else ""

def wrap(inner):
    inner = inner.strip()
    return inner if inner.startswith("<مسألة>") else f"<مسألة>{inner}</مسألة>"

def finalize(x, notes):
    """one Margin at the end, footnotes renumbered 1..n in the order they are referenced"""
    x = strip_margin(x)
    order = []
    for k in re.findall(r'<هامش ID="([^"]+)"', x):
        if k not in order:
            order.append(k)
    ren = {k: str(i + 1) for i, k in enumerate(order)}
    x = re.sub(r'<هامش ID="([^"]+)"', lambda m: f'<هامش ID="{ren[m.group(1)]}"', x)
    if order:
        missing = [k for k in order if k not in notes]
        if missing:
            raise ValueError(f"footnote text missing for {missing}")
        margin = "<Margin>" + "".join(f'<FootNote ID="{ren[k]}">{html.escape(notes[k], quote=False)} </FootNote>' for k in order) + "</Margin>"
        p = x.rfind("</مسألة>")
        x = x[:p] + margin + x[p:] if p >= 0 else x + margin
    ET.fromstring("<r>" + x + "</r>")          # must be well-formed
    return x

def ns(x, notes, tag):
    """namespace footnote ids before pieces from different sources are put in one row"""
    x = re.sub(r'<هامش ID="([^"]+)"', lambda m: f'<هامش ID="{tag}{m.group(1)}"', x)
    return x, {f"{tag}{k}": v for k, v in notes.items()}

def first_num(x, kind="مطبوع"):
    m = re.search(rf'<رقم_حديث نوع="{kind}">([^<]*)</رقم_حديث>', x)
    return m.group(1).strip() if m else None

def page_at(x, pos, default):
    ms = list(re.finditer(r'<الصفحات جزء="([^"]*)" صفحة="([^"]*)"/>', x[:pos]))
    if not ms:
        return default
    part, page = ms[-1].groups()
    return (int(part) if part.isdigit() else default[0], int(page) if page.isdigit() else default[1])

# ── database (read-only) ──────────────────────────────────────────────────────────────────────────
conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
conn.set_session(readonly=True)
cur = conn.cursor()
COLS = "main_id, book_id, id, parent_id, content, tarf, tarqeem_matboa1, tarqeem_harf, part_num, page_num, section_text, chapter_text, is_paragraph"
cur.execute(f"SELECT {COLS} FROM hadith_toc WHERE book_id BETWEEN 1 AND 5")
ROW = {r[0]: dict(zip([c.strip() for c in COLS.split(",")], r)) for r in cur.fetchall()}
conn.close()
OLD = {}
EXPORT = sys.argv[3] if len(sys.argv) > 3 else None
if EXPORT:
    for b in range(1, 6):
        for line in open(os.path.join(EXPORT, f"db_book{b}.jsonl"), encoding="utf-8"):
            r = json.loads(line)
            OLD[r["main_id"]] = r["content"]

content = {m: r["content"] or "" for m, r in ROW.items()}      # working copy
notes = {m: notes_of(content[m]) for m in ROW}
updates, inserts, log = {}, [], []

def set_row(mid, x, nt, **extra):
    content[mid] = finalize(x, nt)
    notes[mid] = notes_of(content[mid])
    updates.setdefault(mid, {}).update(extra)

def new_row(anchor, where, x, nt, number, chapter_text=None, page=None, label=""):
    x = finalize(x, nt)
    r = ROW[anchor]
    inserts.append(dict(anchor=anchor, where=where, content=x, tarf=I.tarf_of(x), tarqeem_matboa1=number,
                        tarqeem_harf=first_num(x, "حرف"), part_num=(page or (r["part_num"], r["page_num"]))[0],
                        page_num=(page or (r["part_num"], r["page_num"]))[1],
                        chapter_text=chapter_text if chapter_text is not None else r["chapter_text"],
                        section_text=r["section_text"], label=label))

# ── 3. splits (Shamela links the second hadith separately) ───────────────────────────────────────
SPLITS = [(12758, "450"), (93547, "3278"), (12347, "288"), (7227, "4769"), (3020, "1854"), (3624, "2243"),
          (90197, "860"), (9003, "5803"), (11080, "7196"), (11527, "7542"), (14890, "1183"), (101195, "2830"),
          (20206, "2865"), (16932, "1731"), (12124, "200"), (91990, "2216"), (97197, "567"),
          (89277, "164")]                       # Abu Dawud 164 (item 2): stands after 163 in row 89277
for mid, n in SPLITS:
    x = content[mid]
    pos = back_over(x, [m.start() for m in re.finditer(re.escape(NUMTAG(n)), x)][-1])
    nt0 = dict(notes[mid])                     # the row's footnotes, before either part is saved
    p1, p2 = cut(x, pos)
    page = page_at(x, pos, (ROW[mid]["part_num"], ROW[mid]["page_num"]))
    set_row(mid, p1, nt0)
    new_row(mid, "after", p2, nt0, n, page=page, label=f"split {mid} → {n}")

# ── 2. narrations written in front of a row: their own row before it ─────────────────────────────
for mid, own_at, n in [(12861, lambda x: x.find(NUMTAG("492")), "491"),
                       (13993, lambda x: [m.start() for m in re.finditer(re.escape(NUMTAG("896")), x)][1], "896")]:
    x = content[mid]
    lead = lead_of(x)
    pos = own_at(x)
    front = x[len(lead):pos]
    assert open_stack(x, pos) == [("مسألة", "<مسألة>")]
    nt0 = dict(notes[mid])
    set_row(mid, lead + x[pos:], nt0)
    new_row(mid, "before", wrap(front), nt0, n, label=f"front of {mid} → {n}")
# Abu Dawud 4535: printed under its own chapter «باب القود بغير حديد», which our tree lacks
x = content[95248]
pos = x.find("<مسألة>")
front = x[:pos]
nt0 = dict(notes[95248])
set_row(95248, x[pos:], nt0)
new_row(95248, "before-chapter", wrap(front), nt0, "4535", chapter_text="باب القود بغير حديد",
        label="4535 under a new chapter row")
inserts[-1]["chapter_title"] = "باب القود بغير حديد"
inserts[-1]["chapter_anchor"] = ROW[95248]["parent_id"]

# ── 1أ. Tirmidhi 3793: its own row 102700 gets the edition text written in front of 102702 ─────────
x = content[102702]
lead = lead_of(x)
pos = x.find('<رقم_حديث نوع="حرف">4172 </رقم_حديث>')
assert open_stack(x, pos) == [("مسألة", "<مسألة>")]
front = x[len(lead):pos]
nt0 = dict(notes[102702])
set_row(102702, lead + x[pos:], nt0)
old = content[102700]
harf = re.search(r'<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>', old).group(0)
set_row(102700, lead_of(old) + harf + front.strip() + "</مسألة>", nt0, tarqeem_matboa1="3793")

# ── 1أ. Bukhari 4905: heading (page 4794) and page 4795 (3024-3026); the piece of it in 4907 comes out
x = content[4907]
pos = text_pos(x, "بَابٌ: الْحَرْبُ خَدْعَةٌ")
lead = lead_of(x)
assert [n for n, _ in open_stack(x, pos)] == ["مسألة"]
set_row(4907, lead + x[pos:], notes[4907])
bx, bn = rebuild(content[4905], units_of(1681, 4794), units_of(1681, 4795))
set_row(4905, bx, bn, tarqeem_matboa1="3024")
# Tirmidhi 99467: page 3219 (1842)
u1842 = units_of(7895, 3219)
# the edition prints «١٨٤٢ (١) -»: Bashar's note marker between the number and the dash, which the unit
# loader does not read as a number mark — the number becomes the row's tag, «(١)» stays as printed
m1842 = re.match(r"\s*١٨٤٢\s*\(١\)\s*-\s*", u1842[0].raw)
assert m1842 and u1842[0].number is None and len(u1842) == 1
u1842[0].number, u1842[0].raw = 1842, "(١) " + u1842[0].raw[m1842.end():]
bx, bn = rebuild(content[99467], [], u1842)
set_row(99467, bx, bn, tarqeem_matboa1="1842")

# ── 1أ. Muslim's introduction ─────────────────────────────────────────────────────────────────────
# 11610 holds page 55-57 whole; bullets 4-6 of page 57 are rows 11611-11613
x = content[11610]
bullets = [m.start() for m in re.finditer("•", x)]
starts = {}
for mid, phrase in [(11611, "وَحَدَّثَنَا حَسَنٌ الْحُلْوَانِيُّ، حَدَّثَنَا أَبُو يَحْيَى الْحِمَّانِيُّ"),
                    (11612, "وَحَدَّثَنِي حَجَّاجُ بْنُ الشَّاعِرِ، حَدَّثَنَا أَحْمَدُ بْنُ يُونُسَ قَالَ: سَمِعْتُ زُهَيْرًا"),
                    (11613, "وَحَدَّثَنِي إِبْرَاهِيمُ بْنُ خَالِدٍ الْيَشْكُرِيُّ")]:
    tp = text_pos(x, phrase)
    starts[mid] = max(b for b in bullets if b < tp)
order = [11611, 11612, 11613]
cuts = [starts[m] for m in order]
p_all, parts = x, []
for c_ in reversed(cuts):
    p_all, tail = cut(p_all, c_)
    parts.append(tail)
parts.reverse()
nt0 = dict(notes[11610])
set_row(11610, p_all, nt0)
for mid, p in zip(order, parts):
    l = lead_of(content[mid])
    p = re.sub(r"^<مسألة>", "<مسألة>" + l[len("<مسألة>"):], p, count=1) if l else p
    set_row(mid, p, nt0)
# 11626 = pages 73-74 (73 had dropped out); 11627 = page 75 (had dropped out; its old text goes)
bx, bn = rebuild(content[11626], [], units_of(711, 73) + units_of(711, 74))
set_row(11626, bx, bn)
bx, bn = rebuild(content[11627], [], units_of(711, 75))
set_row(11627, bx, bn)

# ── 1ب. Tirmidhi: Bashar moved the hadith to his footnote — the number and the footnote, as printed
for mid, n, pid in [(99901, "2086", 3650), (99904, "2088", 3653), (99905, "2089", 3654), (100038, "2153", 3783),
                    (100039, "2154", 3784), (100053, "2161", 3797), (100298, "2300", 4040), (100535, "2439", 4275)]:
    units_of(7895, pid)
    body = re.sub(r"<[^>]+>", "", RAW[(7895, pid)]).strip()
    assert re.fullmatch(r"[٠-٩]+ \(¬١\)\.", body), body
    old = content[mid]
    harf = re.search(r'<رقم_حديث نوع="حرف">[^<]*</رقم_حديث>', old)
    x = lead_of(old) + (harf.group(0) if harf else "") + NUMTAG(n) + '<هامش ID="1" نوع="تعليق"></هامش>.</مسألة>'
    set_row(mid, x, {"1": FEET[(7895, pid)]["1"]}, tarqeem_matboa1=n)

# ── text no row carried: written in front of the row it belongs to ────────────────────────────────
for mid, sid, pids in [(9473, 1681, [9153]), (102919, 642, [1, 2])]:
    ex, en = ed_only([u for p in pids for u in units_of(sid, p)])
    ex, en = ns(ex, en, "e")
    x, xn = ns(content[mid], notes[mid], "t")
    lead = lead_of(x)
    set_row(mid, lead + ex + x[len(lead):], {**xn, **en})

# chapter headings whose continuation no row carried (the contents tree keeps only the title): the
# heading page, whole, in front of the hadith row that follows it — as the neighbouring rows carry theirs
for sid, pid in [(1681, 9934), (711, 1605)]:
    head_units = units_of(sid, pid)
    nxt = A_bare(re.sub(r"<[^>]+>|\(¬[٠-٩]+\)|⦗[^⦘]*⦘|^\s*[٠-٩]+\s*(?:\([^)]*\))?\s*-", " ", RAW[(sid, pid + 1)]))[:90]
    book = {1681: 1, 711: 2}[sid]
    target = [m for m, r in ROW.items() if r["book_id"] == book and r["is_paragraph"] and nxt in A_bare(re.sub(r"<[^>]+>", " ", content[m]))]
    assert len(target) == 1, (sid, pid, target)
    mid = target[0]
    ex, en = ed_only(head_units)
    ex, en = ns(ex, en, "e")
    x, xn = ns(content[mid], notes[mid], "t")
    lead = lead_of(x)
    set_row(mid, lead + ex + x[len(lead):], {**xn, **en})
    log.append(f"heading page {sid}/{pid} → front of {mid}")

# ── columns that follow the content ───────────────────────────────────────────────────────────────
plan_updates = []
for mid, extra in updates.items():
    r = ROW[mid]
    x = content[mid]
    rec = {"main_id": mid, "old_content": r["content"], "content": x}
    t = I.tarf_of(x)
    if r["is_paragraph"] and t != r["tarf"]:
        rec["old_tarf"], rec["tarf"] = r["tarf"], t
    if "tarqeem_matboa1" in extra and extra["tarqeem_matboa1"] != r["tarqeem_matboa1"]:
        rec["old_tarqeem"], rec["tarqeem_matboa1"] = r["tarqeem_matboa1"], extra["tarqeem_matboa1"]
    plan_updates.append(rec)

# ── checks, in memory ─────────────────────────────────────────────────────────────────────────────
problems = []
plain = lambda x: A_bare(re.sub(r"<Margin>.*?</Margin>|<رقم_حديث[^>]*>[^<]*</رقم_حديث>|<[^>]+>", " ", x or "", flags=re.S))
# (a) a split / move keeps every word: old row == its parts
for mid, n in SPLITS:
    new = next(i for i in inserts if i["anchor"] == mid and i["where"] == "after")
    if plain(ROW[mid]["content"]) != plain(content[mid]) + plain(new["content"]):
        problems.append(f"split {mid}: text changed")
for mid in (12861, 13993, 95248):
    new = next(i for i in inserts if i["anchor"] == mid)
    if plain(ROW[mid]["content"]) != plain(new["content"]) + plain(content[mid]):
        problems.append(f"front {mid}: text changed")
if plain(ROW[11610]["content"]) != "".join(plain(content[m]) for m in (11610, 11611, 11612, 11613)):
    problems.append("11610 bullets: text changed")
# (b) coverage and duplicates over all rows of books 1-5 after the plan
after = dict(content)
for k, i in enumerate(inserts):
    after[f"new{k}"] = i["content"]
by_book = defaultdict(list)
for m, x in after.items():
    b = ROW[m]["book_id"] if m in ROW else ROW[inserts[int(m[3:])]["anchor"]]["book_id"]
    by_book[b].append(plain(x))
BACK_MATTER = {("711", p) for p in range(9032, 9038)}
absent, twice = [], []
ed_bare = {}
for b, sids in {1: ["1681"], 2: ["711"], 3: ["654"], 4: ["7895", "642"], 5: ["829"]}.items():
    rows_b = by_book[b]
    big = "|".join(rows_b)
    for sid in sids:
        units_of(int(sid), -1)
        if int(sid) not in ed_bare:
            ed_bare[int(sid)] = [A_bare(re.sub(r"<[^>]+>|\(¬[٠-٩]+\)|⦗[^⦘]*⦘|\(م[^)]*\)", " ", r_)) for (s_, _), r_ in RAW.items() if s_ == int(sid)]
        for (s, pid), raw in RAW.items():
            if s != int(sid) or (sid, pid) in BACK_MATTER:
                continue
            # the edition's «(م)» label sits in our number tag, which plain() leaves out
            t = A_bare(re.sub(r"<[^>]+>|\(¬[٠-٩]+\)|⦗[^⦘]*⦘|\(م[^)]*\)", " ", raw))
            if len(t) < 25:
                continue
            probes = [t[i:i + 24] for i in range(0, len(t) - 24, max(24, (len(t) - 24) // 6))][:7]
            found = sum(q in big for q in probes)
            if found == 0:
                absent.append((sid, pid))
            if len(t) > 200:
                need = max(3, len(probes) - 1)
                holders = sum(1 for r in rows_b if sum(q in r for q in probes) >= need)
                printed = sum(1 for e in ed_bare[int(sid)] if sum(q in e for q in probes) >= need)
                if holders > printed:                  # more copies on the site than the edition prints
                    twice.append((sid, pid, holders, printed))
print("\n".join(log))
report = {"updates": len(plan_updates), "new rows": len(inserts) + 1, "absent pages": absent, "pages held more often than printed": twice,
          "problems": problems}
print(json.dumps(report, ensure_ascii=False, indent=1))
json.dump({"updates": plan_updates, "inserts": inserts}, open(os.path.join(out_dir, "second-pass-plan.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("written", os.path.join(out_dir, "second-pass-plan.json"))
