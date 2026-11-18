"""Item 6 of the second pass: the contents tree of books 1-5 = the edition's index, as Shamela shows it.

Input: toc-plan.json (per book: renames, chapter rows to remove, new chapter rows incl. the edition's front
matter, rows whose text runs into the next chapter's heading, and the final order of every parent's
children — made from the edition index and checked by an independent walk).

Builds the whole final state of the five books (read-only against the database) and checks it:
  - the tree walked in order gives the edition index's titles, in its order, under its parents;
  - hadith rows come out in book order (the order of `id`, which the reading chain follows);
  - the nested set is rebuilt inside each book's own range (other books keep every value);
  - the reading chain (prev/next_paragraph_id) is the walk order, and stays linked to the neighbouring books;
  - a chapter row's paragraph_id, a hadith row's chapter_text follow the new tree.
Writes toc-mirror-plan.json for tools/apply_toc_mirror_postgres.mjs: changed columns of existing rows (with
their current values, for the guard), chapter rows to remove, new rows.

  DATABASE_URL=… python db/shamela_toc_mirror.py <toc-plan.json> <shamela dump dir> <out dir>
"""
import html, json, os, re, sys, glob, sqlite3
from collections import Counter, defaultdict
import xml.etree.ElementTree as ET
import psycopg2

sys.stdout.reconfigure(encoding="utf-8")
plan_file, dump_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
PLAN = json.load(open(plan_file, encoding="utf-8"))
SIDS = {1: [1681], 2: [711], 3: [654], 4: [7895], 5: [829]}
COLS = ["main_id", "book_id", "book_name", "id", "content", "parent_id", "is_leaf", "is_paragraph", "paragraph_id",
        "next_paragraph_id", "prev_paragraph_id", "left_value", "right_value", "section_text", "chapter_text", "part_num",
        "page_num", "tarf", "tarqeem_harf", "tarqeem_matboa1", "mosanef_id", "books_takhrij", "tarqeem_matboa2", "dorar_key"]

conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
conn.set_session(readonly=True)
cur = conn.cursor()
cur.execute(f"SELECT {', '.join(COLS)} FROM hadith_toc WHERE book_id BETWEEN 1 AND 5")
ROW = {r[0]: dict(zip(COLS, r)) for r in cur.fetchall()}
cur.execute("SELECT max(main_id) FROM hadith_toc")
MAX_MAIN = cur.fetchone()[0]

def bare(s):
    s = re.sub(r"[\u064B-\u065F\u0670ـ]", "", s or "").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^ء-ي]", "", s)

def visible(x):
    return re.sub(r"<Margin>.*?</Margin>|<[^>]+>", " ", x or "", flags=re.S)

# ── markup helpers (as in shamela_second_pass.py) ───────────────────────────────────────────────────
TOK = re.compile(r"<(/?)([^\s>/]+)([^>]*?)(/?)>")
def open_stack(x, pos):
    st = []
    for m in TOK.finditer(x[:pos]):
        if m.group(4):
            continue
        if m.group(1):
            assert st and st[-1][0] == m.group(2), "unbalanced markup before cut"
            st.pop()
        else:
            st.append((m.group(2), m.group(0)))
    return st

def text_pos(x, phrase):
    want = bare(phrase)
    chars, offs = [], []
    for m in re.finditer(r"<[^>]+>|[^<]+", x):
        if m.group(0).startswith("<"):
            continue
        for k, ch in enumerate(m.group(0)):
            if bare(ch):
                chars.append(bare(ch)); offs.append(m.start() + k)
    i = "".join(chars).rfind(want)
    assert i >= 0, f"heading not found: {phrase}"
    return offs[i]

def well_formed(x):
    ET.fromstring("<r>" + x + "</r>")
    return x

def lead_of(x):
    m = re.match(r"<مسألة>(<رقم_الفقرة[^>]*/>)?", x)
    return m.group(0) if m else ""

MARGIN = re.compile(r"<Margin>.*?</Margin>", re.S)
def notes_of(x):
    return {m.group(1): html.unescape(m.group(2)).strip()
            for m in re.finditer(r'<FootNote ID="([^"]+)">(.*?)</FootNote>', x, re.S)}

def finalize(x, notes):
    """one Margin at the end, footnotes renumbered 1..n in the order they are referenced"""
    x = MARGIN.sub("", x)
    order = []
    for k in re.findall(r'<هامش ID="([^"]+)"', x):
        if k not in order:
            order.append(k)
    ren = {k: str(i + 1) for i, k in enumerate(order)}
    x = re.sub(r'<هامش ID="([^"]+)"', lambda m: f'<هامش ID="{ren[m.group(1)]}"', x)
    if order:
        missing = [k for k in order if k not in notes]
        assert not missing, f"footnote text missing for {missing}"
        margin = "<Margin>" + "".join(f'<FootNote ID="{ren[k]}">{html.escape(notes[k], quote=False)} </FootNote>' for k in order) + "</Margin>"
        k = x.rfind("</مسألة>")
        x = x[:k] + margin + x[k:]
    return well_formed(x)

def ns(x, notes, tag):
    x = re.sub(r'<هامش ID="([^"]+)"', lambda m: f'<هامش ID="{tag}{m.group(1)}"', x)
    return x, {f"{tag}{k}": v for k, v in notes.items()}

def detach(x, cut):
    """split the row at cut: part 1 closes what is open there (inside the root <مسألة>); the rest drops
    those elements' closing tags, so no wrapper of part 1 (e.g. a narrator link) spreads over the moved text"""
    st = [t for t, _ in open_stack(x, cut)][1:]                 # below the root <مسألة>
    part1 = x[:cut].rstrip() + "".join(f"</{t}>" for t in reversed(st)) + "</مسألة>"
    tail = MARGIN.sub("", x[cut:])
    tail = tail[: tail.rfind("</مسألة>")]
    pending = list(reversed(st))                                 # innermost first
    out, depth = [], []
    for m in re.finditer(r"<[^>]+>|[^<]+", tail):
        t = m.group(0)
        tm = TOK.fullmatch(t)
        if tm and not tm.group(4) and not tm.group(1):
            depth.append(tm.group(2))
        elif tm and tm.group(1):
            if depth and depth[-1] == tm.group(2):
                depth.pop()
            elif pending and pending[0] == tm.group(2):
                pending.pop(0)
                continue                                         # a closer of part 1's wrapper: dropped
            else:
                raise AssertionError(f"unexpected </{tm.group(2)}> after the cut")
        out.append(t)
    return part1, "".join(out)

# ── edition index (titles, in order, with their parents) ────────────────────────────────────────────
def edition_index(b):
    out = []
    for sid in SIDS[b]:
        db = glob.glob(f"C:/shamela4/database/book/*/{sid}.db")[0]
        par = dict(sqlite3.connect(f"file:{db}?mode=ro", uri=True).execute("SELECT id, parent FROM title").fetchall())
        for line in open(os.path.join(os.path.dirname(plan_file), "..", "titles_dump", f"{sid}.tsv"), encoding="utf-8"):
            tid, body = line.rstrip("\n").split("\t", 1)
            out.append((int(tid), body.replace("body=", "", 1).strip(), par.get(int(tid)) or 0))
    return out

def dump_page(sid, pid):
    for line in open(os.path.join(dump_dir, f"{sid}.tsv"), encoding="utf-8"):
        p = (line.rstrip("\n").split("\t") + ["", ""])[:3]
        if p[0] == str(pid):
            return p[1], p[2]
    raise KeyError((sid, pid))

def page_meta(sid, pid):
    db = glob.glob(f"C:/shamela4/database/book/*/{sid}.db")[0]
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True).execute("SELECT part, page FROM page WHERE id=?", (pid,)).fetchone()

# ── build ───────────────────────────────────────────────────────────────────────────────────────────
next_main = MAX_MAIN + 1
BOOK_LR = {}
updates = defaultdict(dict)             # main_id -> {col: new}
inserts, deletes, report = [], [], []
problems = []

def setcol(mid, col, val):
    if ROW[mid][col] != val:
        updates[mid][col] = val

for b in range(1, 6):
    P = PLAN[str(b)]
    rows = {m: r for m, r in ROW.items() if r["book_id"] == b}
    root = P["root_main_id"]
    content = {m: r["content"] or "" for m, r in rows.items()}
    removed = {r["main_id"] for r in P["remove_chapter_rows"]}
    assert all(not rows[m]["is_paragraph"] for m in removed), "only chapter rows are removed"
    keymap = {}                                                      # new chapter key -> main_id
    for nc in P["new_chapter_rows"]:
        keymap[nc["key"]] = next_main; next_main += 1
    node = lambda k: keymap[k] if isinstance(k, str) and k.startswith("new:") else int(k)
    order = {node(k): [node(x) for x in v] for k, v in P["final_order"].items()}

    # front matter: a page row under each front-matter chapter, with the edition's text
    front_rows = {}
    new_title = {keymap[nc["key"]]: nc["title"] for nc in P["new_chapter_rows"]}
    for fm in P.get("front_matter_pages", []):
        cid = keymap[fm["key"]]
        sid = fm["shamela_book"]
        parts, first_meta = [], None
        for seg in fm["segments"]:
            body, foot = dump_page(sid, seg["page_id"])
            col = foot if seg["column"] == "foot" else body
            txt = col[seg["from_char"]:seg["to_char"]]
            txt = html.unescape(re.sub(r"<[^>]+>", " ", txt.replace("\\n", "\n")))
            if seg["column"] == "body":
                # the book's own opening, which Shamela files under its last front-matter title: it is
                # already the first row of the book — not copied
                first_para = min((r for r in rows.values() if r["is_paragraph"]), key=lambda r: (r["id"], r["main_id"]))
                if bare(txt)[:40] in bare(visible(first_para["content"])):
                    report.append(f"book {b}: page {seg['page_id']} body is already in row {first_para['main_id']} — not copied")
                    continue
                problems.append(f"book {b}: front-matter body segment {seg} not found in the first row")
            meta = page_meta(sid, seg["page_id"])
            first_meta = first_meta or meta
            if parts:
                parts.append(f'<الصفحات جزء="{meta[0]}" صفحة="{meta[1]}"/>')
            lines = [html.escape(l.strip(), quote=False) for l in txt.split("\n") if l.strip()]
            parts.append("<نه/>".join(lines))
        if not parts:
            continue
        pid = next_main; next_main += 1
        x = well_formed("<مسألة>" + " ".join(parts) + "</مسألة>")
        front_rows[pid] = dict(content=x, chapter=cid, part=int(first_meta[0]) if str(first_meta[0]).isdigit() else 0,
                               page=int(first_meta[1] or 0))
        order.setdefault(cid, []).append(pid)

    # chapter titles: the edition's text (renames, and two stored with an HTML entity)
    title = {m: (r["content"] or "").strip() for m, r in rows.items() if not r["is_paragraph"]}
    title.update(new_title)

    # walk
    parents, seq = {}, []
    def walk(n):
        for ch in order.get(n, []):
            parents[ch] = n
            seq.append(ch)
            walk(ch)
    walk(root)
    is_para = lambda n: n in front_rows or (n in rows and rows[n]["is_paragraph"])
    chapters = [n for n in seq if not is_para(n)]
    ed = edition_index(b)
    if len(chapters) != len(ed):
        problems.append(f"book {b}: {len(chapters)} chapters vs {len(ed)} edition titles")
    pos = {n: i for i, n in enumerate(chapters)}
    for i, (tid, etitle, epar) in enumerate(ed[:len(chapters)]):
        n = chapters[i]
        if title.get(n) != etitle:
            if n in rows:
                setcol(n, "content", etitle); setcol(n, "tarf", etitle)
                report.append(f"book {b}: chapter {n} «{title.get(n)}» → «{etitle}»")
            title[n] = etitle
        ep = next((k for k, (t, _, _) in enumerate(ed) if t == epar), None)
        our = pos.get(parents[n]) if parents[n] != root else None
        if our != ep:
            problems.append(f"book {b}: chapter {n} parent differs from the edition")

    # rows whose text runs into the next chapter's heading: the heading moves to the front of the next row
    paras = [n for n in seq if is_para(n)]
    for s in P.get("rows_spanning_two_titles", []):
        m = s["main_id"]
        x = content[m]
        heading = s["second_title_text"]
        cut = text_pos(x, re.sub(r"^\([٠-٩]+\)\s*", "", heading))
        lab = re.search(r"\([٠-٩]+\)\s*$", re.sub(r"<[^>]+>", "", x[:cut]))      # «(٥٧) بَابُ …»: the number goes too
        if lab:
            k = x.rfind("(", 0, cut)
            cut = k if k >= 0 else cut
        notes_m = notes_of(x)
        part1, moved = detach(x, cut)
        nxt = paras[paras.index(m) + 1]
        y, ny = ns(content[nxt], notes_of(content[nxt]), "n")
        moved, nm = ns(moved, notes_m, "m")
        l = lead_of(y)
        content[m] = finalize(part1, notes_m)
        content[nxt] = finalize(l + moved.strip() + " " + y[len(l):], {**ny, **nm})
        setcol(m, "content", content[m]); setcol(nxt, "content", content[nxt])
        report.append(f"book {b}: heading «{heading}» moved from the end of {m} to the front of {nxt}")

    # nested set inside the book's own range; reading chain; derived columns
    r0 = rows[root]
    val = r0["left_value"]
    left, right = {}, {}
    def number(n):
        nonlocal_val[0] += 1
        left[n] = nonlocal_val[0]
        for ch in order.get(n, []):
            number(ch)
        nonlocal_val[0] += 1
        right[n] = nonlocal_val[0]
    nonlocal_val = [val - 1]
    sys.setrecursionlimit(10000)
    number(root)
    # a book that gains rows needs room: recorded here, made after all books are built (see below)
    BOOK_LR[b] = dict(left=left, right=right, root=root, old_left=r0["left_value"], old_right=r0["right_value"],
                      grow=max(0, right[root] - r0["right_value"]))
    # first paragraph under each chapter, for paragraph_id
    def first_para(n):
        for ch in order.get(n, []):
            if is_para(ch):
                return ch
            f = first_para(ch)
            if f:
                return f
        return None
    first_in_book = paras[0]
    prev_out = rows[min((r for r in rows.values() if r["is_paragraph"]), key=lambda r: (r["id"], r["main_id"]))["main_id"]]["prev_paragraph_id"]
    last_old = max((r for r in rows.values() if r["is_paragraph"]), key=lambda r: (r["id"], r["main_id"]))
    next_out = last_old["next_paragraph_id"]
    chain = {}
    for i, n in enumerate(paras):
        chain[n] = (paras[i - 1] if i else prev_out, paras[i + 1] if i + 1 < len(paras) else next_out)
    # the neighbouring books' rows that point into this book
    if prev_out and chain[first_in_book][0] == prev_out and ROW.get(prev_out, {}).get("next_paragraph_id") != first_in_book:
        if prev_out in ROW:
            setcol(prev_out, "next_paragraph_id", first_in_book)
        else:
            updates[prev_out]["next_paragraph_id"] = first_in_book      # a row of another book
    if next_out:
        if next_out in ROW:
            setcol(next_out, "prev_paragraph_id", paras[-1])
        else:
            updates[next_out]["prev_paragraph_id"] = paras[-1]

    section_of = {}
    def top(n):
        while parents.get(n) not in (root, None):
            n = parents[n]
        return n
    for n in seq:
        if n in rows:
            setcol(n, "parent_id", parents[n])
            if is_para(n):
                setcol(n, "prev_paragraph_id", chain[n][0]); setcol(n, "next_paragraph_id", chain[n][1])
                if parents[n] != root:
                    setcol(n, "chapter_text", title[parents[n]])
            else:
                fp = first_para(n)
                if fp and rows[n]["paragraph_id"] != fp and (n in {p for p in order} ):
                    setcol(n, "paragraph_id", fp)
    for m in removed:
        deletes.append(m)
    # new chapter rows and front-matter page rows
    for nc in P["new_chapter_rows"]:
        n = keymap[nc["key"]]
        t = title[n]
        fp = first_para(n)
        inserts.append(dict(main_id=n, book_id=b, book_name=r0["book_name"], id=(rows[fp]["id"] if fp in rows else 1) if fp else 1,
                            content=t, parent_id=parents[n], is_leaf=False, is_paragraph=False, paragraph_id=fp or 0,
                            next_paragraph_id=0, prev_paragraph_id=0, left_value=left[n], right_value=right[n], section_text=None,
                            chapter_text=None, part_num=0, page_num=0, tarf=t, tarqeem_harf=None, tarqeem_matboa1=None,
                            mosanef_id=0, books_takhrij=None, tarqeem_matboa2=None, dorar_key=None))
    for pid, f in front_rows.items():
        inserts.append(dict(main_id=pid, book_id=b, book_name=r0["book_name"], id=1, content=f["content"], parent_id=parents[pid],
                            is_leaf=True, is_paragraph=True, paragraph_id=pid, next_paragraph_id=chain[pid][1],
                            prev_paragraph_id=chain[pid][0], left_value=left[pid], right_value=right[pid],
                            section_text=title[top(pid)], chapter_text=title[parents[pid]], part_num=f["part"], page_num=f["page"],
                            tarf=None, tarqeem_harf=None, tarqeem_matboa1=None, mosanef_id=0, books_takhrij=None,
                            tarqeem_matboa2=None, dorar_key=None))
    # every kept row placed, nothing twice
    placed = Counter(seq)
    expect = (set(rows) - removed - {root}) | set(keymap.values()) | set(front_rows)
    if set(placed) != expect or any(v > 1 for v in placed.values()):
        problems.append(f"book {b}: placement — missing {len(expect - set(placed))}, extra {len(set(placed) - expect)}")
    # hadith rows in book order
    ids = [(rows[n]["id"], n) for n in paras if n in rows]
    if ids != sorted(ids):
        problems.append(f"book {b}: hadith rows out of book order")
    report.append(f"book {b}: {len(chapters)} chapters = edition index; {len(paras)} reading rows; removed {len(removed)}, "
                  f"new chapters {len(keymap)}, front-matter rows {len(front_rows)}")

# the rows of neighbouring books whose reading chain is re-pointed: their current values, for the guard
outside = [m for m in updates if m not in ROW]
if outside:
    cur.execute(f"SELECT {', '.join(COLS)} FROM hadith_toc WHERE main_id = ANY(%s)", (outside,))
    for r in cur.fetchall():
        ROW_OUT = dict(zip(COLS, r))
        ROW[ROW_OUT["main_id"]] = {**ROW_OUT, "_outside": True}
conn.close()

# ── the nested set: each book renumbered in its own place; a book that grows pushes everything after it ──
# Values are global across all books. Offset of a book = room taken by grown books that lie before it;
# rows of other books after a grown book's old end move up by the same amount (done by the apply script).
grown = sorted((v["old_right"], v["grow"]) for v in BOOK_LR.values() if v["grow"])
offset_at = lambda val: sum(g for end, g in grown if end < val)
for b, v in BOOK_LR.items():
    off = offset_at(v["old_left"])
    for n in v["left"]:
        L, R = v["left"][n] + off, v["right"][n] + off
        if n in ROW:
            setcol(n, "left_value", L); setcol(n, "right_value", R)
        else:
            ins = next(i for i in inserts if i["main_id"] == n)
            ins["left_value"], ins["right_value"] = L, R
    report.append(f"book {b}: nested set {v['left'][v['root']] + off}-{v['right'][v['root']] + off} (was {v['old_left']}-{v['old_right']})")
# old values for the guard
out_updates = []
for m, cols in updates.items():
    old = {c: ROW[m][c] for c in cols}
    out_updates.append({"main_id": m, "set": cols, "old": old, "outside_books": bool(ROW[m].get("_outside"))})
json.dump({"max_main_id": MAX_MAIN, "grown": grown, "books": sorted(BOOK_LR), "updates": out_updates, "deletes": deletes, "inserts": inserts},
          open(os.path.join(out_dir, "toc-mirror-plan.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("\n".join(report))
print(json.dumps({"rows changed": len(out_updates), "of which outside books 1-5": sum(u["outside_books"] for u in out_updates),
                  "chapter rows removed": len(deletes), "rows added": len(inserts), "problems": problems}, ensure_ascii=False, indent=1))
