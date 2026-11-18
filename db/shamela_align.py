"""db/shamela_align.py — align our hadith rows with the editions Shamela links (المطبوعات المخدومة).

Read-only. Compares each paragraph of hadith_toc for books 1-5 with the hadith units of the edition
that Shamela 4 cross-links (service/hadeeth.db → inservice), and writes, per book, a mapping of
every row to its Shamela unit plus the rows a person needs to settle.

Inputs (made by the export steps, see db/shamela-alignment/README.md):
  <dump>/<shamela_book_id>.tsv     page_id \t body   (raw page HTML from Shamela's Lucene store)
  <export>/db_book<N>.jsonl        hadith_toc rows of book N, in left_value order
  C:/shamela4/database/book/*/<id>.db   per-page part/page/number/services

    python -I db/shamela_align.py <dump dir> <export dir> <out dir>

Comparison levels, strictest first, for a matched pair:
  exact          identical letters and tashkeel (punctuation, markup and honorific ligatures aside)
  tashkeel       same letters, different harakat
  spelling       same words once hamza/alif/ya/ta-marbuta forms are folded
  wording        different words — needs a person
"""
from __future__ import annotations

import csv
import difflib
import glob
import json
import os
import re
import sqlite3
import sys
import unicodedata
from dataclasses import dataclass, field

BOOKS = [
    # our book_id, Shamela book ids (in book order), folder name, how the edition numbers its hadiths
    (1, [1681], "01-bukhari-sultaniyya", "plain"),
    (2, [711], "02-muslim-turkish", "muslim"),
    (3, [654], "03-abu-dawud-delhi", "plain"),
    (4, [7895, 642], "04-tirmidhi-bashar", "plain"),   # 642 = كتاب العلل الواقع بآخر جامع الترمذي
    (5, [829], "05-nasai-egyptian", "plain"),
]
# Books whose printed numbers we trust enough to use as an alignment hint (Nasa'i's are not).
NUMBER_HINT = {1, 2, 3, 4}

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
TATWEEL = "\u0640"

# Honorific phrases, folded to one symbol on both sides: the edition writes ﷺ where we write it out.
LIGATURES = {
    "\uFDFA": "صلى الله عليه وسلم",
    "\uFD41": "رضي الله عنه",
    "\uFD42": "رضي الله عنها",
    "\uFD43": "رضي الله عنهم",
    "\uFD44": "رضي الله عنهما",
    "﷾": "سبحانه وتعالى",
    "﷽": "بسم الله الرحمن الرحيم",
    "﵅": "رضي الله عنهن",
    "﵈": "عليهم السلام",
    "﵉": "عليهما السلام",
    "﵊": "عليه الصلاة والسلام",
    "﵍": "عليها السلام",
    "﵎": "تبارك وتعالى",
    "﵏": "رحمهم الله",
    "\uFDFF": "عز وجل",
    "\uFD47": "عليه السلام",
    "\uFDFB": "جل جلاله",
    "\uFD40": "رحمه الله",
}


def _phrase_re(phrase: str) -> re.Pattern:
    # letters of the phrase, any harakat between them, words separated by spaces; «الله» may be «اللّه»
    parts = []
    for word in phrase.split():
        parts.append("".join(re.escape(ch) + r"[\u064B-\u065F\u0670]*" for ch in word))
    return re.compile(r"(?<![\u0621-\u064A])" + r"\s+".join(parts) + r"(?![\u0621-\u064A\u064B-\u065F\u0670])")


HONORIFIC_RES = [(lig, _phrase_re(text)) for lig, text in sorted(LIGATURES.items(), key=lambda kv: -len(kv[1]))]


def fold_honorifics(s: str) -> str:
    for lig, rx in HONORIFIC_RES:
        s = rx.sub(f" {lig} ", s)
    return s


def to_compare(text: str) -> str:
    """Letters + harakat + honorific symbols only, single-spaced, canonical mark order."""
    s = unicodedata.normalize("NFC", text).replace(TATWEEL, "")
    s = s.replace("\u0671", "ا")  # alif wasla
    s = fold_honorifics(s)
    keep = re.compile(r"[^\u0621-\u064A\u064B-\u065F\u0670" + "".join(LIGATURES) + r"\s]")
    s = keep.sub(" ", s)
    # the tahwil mark (\u062D) sits at the end of one unit in the edition and at the start of the next in ours
    s = re.sub(r"(?:(?<=\s)|^)\u062D(?=\s|$)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_tashkeel(s: str) -> str:
    return re.sub(r"\s+", " ", DIACRITICS.sub("", s)).strip()


def fold_spelling(s: str) -> str:
    s = strip_tashkeel(s)
    # hamza seats differ by convention (جاؤوا / جاءوا, رؤوس / رءوس): drop the hamza, keep the letters
    s = re.sub("[أإآ]", "ا", s).replace("ى", "ي").replace("ة", "ه")
    s = re.sub("ؤو", "و", s).replace("ءو", "و").replace("ؤ", "و").replace("ئ", "ي").replace("ء", "")
    # rasm conventions: السموات / السماوات, إسحق / إسحاق, إسمعيل / إسماعيل
    s = s.replace("سماوات", "سموات").replace("اسحاق", "اسحق").replace("اسماعيل", "اسمعيل")
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------- Shamela side

# «١٠٠ -», Muslim «٤٥ - (١٠٠٠)», Tirmidhi's repeats «٢٠٧٢ (م) -»; a page may open with a tag such as <s1>.
# Usually at a line start; on some pages two hadiths run on in one line, so a number followed by « - »
# after a space counts too (the edition writes no other «digits -» in running text).
NUM_MARK = re.compile(r"(?:^|\\n|(?<=\s))(?:\s|<[^>]+>)*([٠-٩]{1,4})\s*(?:\(م(?:\s*[٠-٩]+)?\)\s*)?-\s+(?:\(([٠-٩]+)\)\s*)?")


@dataclass
class ShUnit:
    idx: int
    page_id: int
    part: str
    page: int
    number: int | None          # the edition's printed hadith number (Muslim: Abd al-Baqi's)
    sub: int | None              # Muslim only: the number within its كتاب
    keys: list[int]
    raw: str
    text: str = ""               # plain, for display
    cmp: str = ""                # comparison form
    sanad: str = ""
    matn: str = ""
    narrators: list[int] = field(default_factory=list)
    sh_book: int = 0
    real_page_id: int = 0
    is_title: bool = False


def shamela_plain(html: str) -> str:
    s = html.replace("\\n", "\n")
    s = re.sub(r'<span data-type="title"[^>]*>.*?</span>', " ", s, flags=re.S)  # chapter titles live in their own rows
    s = re.sub(r"⦗[^⦘]*⦘", " ", s)            # printed-page markers
    s = re.sub(r"\(¬[٠-٩0-9]+\)", " ", s)      # footnote references
    s = re.sub(r"<[^>]+>", "", s)
    for lig, text in LIGATURES.items():
        s = s.replace(lig, f" {lig} ")
    return re.sub(r"[ \t]+", " ", s).strip()


def load_shamela(dump_dir: str, sh_id: int, scheme: str) -> list[ShUnit]:
    dbf = glob.glob(f"C:/shamela4/database/book/*/{sh_id}.db")[0]
    meta = {}
    con = sqlite3.connect(f"file:{dbf}?mode=ro", uri=True)
    for pid, part, page, number, services in con.execute("select id, part, page, number, services from page"):
        keys = json.loads(services).get("hadeeth", []) if services else []
        meta[pid] = (part, page, number, keys)
    bodies = []
    with open(os.path.join(dump_dir, f"{sh_id}.tsv"), encoding="utf-8") as fh:
        for line in fh:
            # page_id \t body [\t foot] — the footnotes column, when present, is not part of the body
            pid, body = line.rstrip("\n").split("\t")[:2]
            bodies.append((int(pid), body))
    bodies.sort()
    units: list[ShUnit] = []
    for pid, body in bodies:
        part, page, number, keys = meta.get(pid, ("", 0, None, []))
        marks = list(NUM_MARK.finditer(body))
        pieces = []
        if not marks:
            pieces.append((None, None, body))
        else:
            if body[: marks[0].start()].strip(" \\n"):
                pieces.append((None, None, body[: marks[0].start()]))
            for k, m in enumerate(marks):
                end = marks[k + 1].start() if k + 1 < len(marks) else len(body)
                a = int(m.group(1).translate(AR_DIGITS))
                b = int(m.group(2).translate(AR_DIGITS)) if m.group(2) else None
                if scheme == "muslim" and b is not None:
                    num, sub = b, a
                else:
                    num, sub = a, None
                pieces.append((num, sub, body[m.end():end]))
        # A chapter title printed after a hadith on the same page heads the NEXT hadith: split it off.
        split_pieces = []
        for num, sub, raw in pieces:
            t = raw.find('<span data-type="title"')
            if num is not None and t > 0 and strip_tashkeel(shamela_plain(raw[:t])):
                split_pieces.append((num, sub, raw[:t]))
                split_pieces.append((None, None, raw[t:]))
            else:
                split_pieces.append((num, sub, raw))
        pieces = split_pieces
        for num, sub, raw in pieces:
            u = ShUnit(len(units), pid, str(part), int(page or 0), num, sub, keys, raw)
            u.text = shamela_plain(raw)
            u.cmp = to_compare(u.text)
            if num is None and 'data-type="title"' in raw:
                # a page piece holding only chapter titles (Abu Dawud, Tirmidhi, Nasa'i print them on
                # the hadith page): keep it as a heading unit, text = the titles
                u.text = shamela_plain(re.sub(r'<span data-type="title"[^>]*>(.*?)</span>', r" \1 ", raw, flags=re.S))
                u.cmp = to_compare(u.text)
                u.is_title = True
            m = re.search(r"<hadeeth(?:-\d+)?>", raw)
            if m:
                u.sanad = shamela_plain(raw[: m.start()])
                u.matn = shamela_plain(raw[m.start():])
            u.narrators = [int(x) for x in re.findall(r'href="inr://man-(\d+)"', raw)]
            if u.cmp:
                units.append(u)
    for i, u in enumerate(units):
        u.idx = i
    return units


# ---------------------------------------------------------------- our side

HIDDEN = re.compile(
    r"<(سند_مخفي|متن_مخفي|تعليق_مخفي|إضافي|ترقيم_حرف|رقم_حديث_للعرض|رقم_حديث|FootNote|Margin)\b[^>]*?/>"
    r"|<(سند_مخفي|متن_مخفي|تعليق_مخفي|إضافي|ترقيم_حرف|رقم_حديث_للعرض|FootNote|Margin)\b[^>]*>.*?</\2>"
    r"|<رقم_حديث\b[^>]*>.*?</رقم_حديث>",
    re.S,
)
HEADING_HEAD = re.compile(r"^(?:\s*\(\s*[0-9٠-٩]+\s*\)\s*)*\s*(?:[0-9٠-٩]+\s*/\s*[0-9٠-٩]+\s*-\s*)?\s*(?:بَ?ا?بُ?|كِ?تَ?ا?بُ?|أَ?بْ?وَ?ا?بُ?)")


@dataclass
class DbUnit:
    idx: int
    main_id: int
    matboa: str | None
    harf: str | None
    part: int
    page: int
    raw: str
    number: int | None = None
    text: str = ""
    cmp: str = ""
    heading_in_content: str = ""
    printed_numbers: int = 0
    src_id: int = 0


def db_plain(xml: str) -> str:
    s = HIDDEN.sub(" ", xml)
    s = s.replace("<نه/>", "\n").replace("<نه />", "\n")
    s = re.sub(r"<[^>]+>", "", s)
    s = (s.replace("&quot;", '"').replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))
    return re.sub(r"[ \t]+", " ", s).strip()


def load_db(export_dir: str, book: int) -> list[DbUnit]:
    out: list[DbUnit] = []
    with open(os.path.join(export_dir, f"db_book{book}.jsonl"), encoding="utf-8") as fh:
        records = [json.loads(line) for line in fh if line.strip()]
    # Book order is the source paragraph id (left_value follows the chapter tree, not the page order).
    records.sort(key=lambda r: (r.get("id") is None, r.get("id") or 0, r["main_id"]))
    if True:
        for r in records:
            content = r.get("content") or ""
            if not r.get("is_paragraph") or not content.strip():
                continue
            u = DbUnit(len(out), r["main_id"], r.get("tarqeem_matboa1"), r.get("tarqeem_harf"),
                       r.get("part_num") or 0, r.get("page_num") or 0, content)
            if u.matboa:
                m = re.match(r"\s*(\d+)", u.matboa)
                u.number = int(m.group(1)) if m else None
            u.printed_numbers = len(re.findall(r'<رقم_حديث\b[^>]*نوع="مطبوع"', content))
            u.src_id = r.get("id") or 0
            # Text written into the record before the hadith itself — a chapter heading (ترجمة الباب),
            # which the edition keeps on its own page. Compared from the hadith's number onwards.
            starts = [p for p in (content.find("<رقم_حديث"), content.find("<حديث")) if p >= 0]
            if starts:
                cut = min(starts)
                head = db_plain(content[:cut]).strip(" -–\n")
                if head:
                    u.heading_in_content = head
                    content = content[cut:]
            u.text = db_plain(content)
            # A heading line with no tag boundary: «بَابُ …» on its own line, then «- حَدَّثَنَا …».
            m = re.match(r"\s*([^\n]{1,400}?)\s*\n\s*-\s", u.text)
            if m and HEADING_HEAD.match(strip_tashkeel(m.group(1))):
                u.heading_in_content = (u.heading_in_content + " | " if u.heading_in_content else "") + m.group(1)
                u.text = u.text[m.end() - 2:]
            u.cmp = to_compare(u.text)
            if u.cmp:
                out.append(u)
    for i, u in enumerate(out):
        u.idx = i
    return out


# ---------------------------------------------------------------- alignment

def shingles(s: str, n: int = 3) -> frozenset:
    s = fold_spelling(s).replace(" ", "")
    if len(s) <= n:
        return frozenset([s])
    return frozenset(hash(s[i:i + n]) for i in range(len(s) - n + 1))


def sim(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


def align(D: list[DbUnit], S: list[ShUnit], use_numbers: bool, back_pages: int = 420, ahead_pages: int = 40,
          floor: float = 0.30):
    """Weighted LCS inside a band: maximise the summed similarity of matched pairs; rows on either
    side may stay unmatched. Our rows' source paragraph id runs a little ahead of Shamela's page id
    (by 0-350 pages, growing through the book), so row i may only pair with Shamela units whose
    page id lies in [id - back_pages, id + ahead_pages]. Returns [(d_idx|None, s_idx|None, score)]."""
    import bisect
    n, m = len(D), len(S)
    dsh = [shingles(u.cmp) for u in D]
    ssh = [shingles(u.cmp) for u in S]
    pages = [u.page_id for u in S]
    NEG = -1.0
    rows = [(0, 0)] * (n + 1)
    lo_run = hi_run = 0
    for i in range(1, n + 1):
        pid = D[i - 1].src_id
        lo = bisect.bisect_left(pages, pid - back_pages)
        hi = bisect.bisect_right(pages, pid + ahead_pages)
        lo_run = max(lo_run, min(lo, m))
        hi_run = max(hi_run, min(hi, m), lo_run)
        rows[i] = (lo_run, hi_run)
    rows[0] = (0, rows[1][1] if n else m)
    rows[n] = (rows[n][0], m)
    # keep each row's band reachable from the previous one
    for i in range(1, n + 1):
        lo, hi = rows[i]
        rows[i] = (min(lo, rows[i - 1][1]), max(hi, rows[i - 1][1]))
    import array
    best = [None] * (n + 1)
    move = [None] * (n + 1)
    lo0, hi0 = rows[0]
    best[0] = array.array("d", [0.0] * (hi0 - lo0 + 1))
    move[0] = bytearray(hi0 - lo0 + 1)  # 0 none, 1 diag, 2 up (skip D), 3 left (skip S)
    for j in range(1, hi0 - lo0 + 1):
        move[0][j] = 3
    def get(i, j):
        lo, hi = rows[i]
        if j < lo or j > hi:
            return NEG * 1e9
        return best[i][j - lo]
    for i in range(1, n + 1):
        lo, hi = rows[i]
        cur = array.array("d", [0.0] * (hi - lo + 1))
        mv = bytearray(hi - lo + 1)
        du = D[i - 1]
        for j in range(lo, hi + 1):
            up = get(i - 1, j)
            bestv, bm = up, 2
            if j > lo:
                left = cur[j - 1 - lo]
                if left > bestv:
                    bestv, bm = left, 3
            if j >= 1:
                diag_prev = get(i - 1, j - 1)
                if diag_prev > NEG * 1e8:
                    s = sim(dsh[i - 1], ssh[j - 1])
                    su = S[j - 1]
                    if use_numbers and du.number is not None and su.number is not None and du.number == su.number:
                        s += 0.25
                    if s >= floor and diag_prev + s > bestv:
                        bestv, bm = diag_prev + s, 1
            cur[j - lo] = bestv
            mv[j - lo] = bm
        best[i] = cur
        move[i] = mv
    # trace back from the best cell of the last row
    i = n
    lo, hi = rows[n]
    j = hi
    pairs = []
    while i > 0 or j > 0:
        lo, hi = rows[i]
        if j < lo or j > hi:
            # outside the band: walk D up
            pairs.append((i - 1, None, 0.0)); i -= 1; continue
        mvv = move[i][j - lo]
        if i > 0 and j > 0 and mvv == 1:
            s = sim(dsh[i - 1], ssh[j - 1])
            pairs.append((i - 1, j - 1, s)); i -= 1; j -= 1
        elif i > 0 and (mvv == 2 or j == 0):
            pairs.append((i - 1, None, 0.0)); i -= 1
        else:
            pairs.append((None, j - 1, 0.0)); j -= 1
    pairs.reverse()
    return pairs


def merge_pass(pairs, D, S):
    """One of our rows sometimes holds two or more of the edition's numbered hadiths (and the other
    way round). Fold an unpaired neighbour into a pair when that brings the texts closer."""
    def joined(units):
        return " ".join(u.cmp for u in units)

    def is_heading(u):
        # a chapter heading belongs in front of the next hadith, never inside a neighbouring one
        return (u.number is None and (u.is_title or 'data-type="title"' in u.raw
                or re.match(r"\s*(?:﷽\s*)?(?:بَ?ا?بٌ?ُ?|كِ?تَ?ا?بُ?|أَ?بْ?وَ?ا?بُ?)", strip_tashkeel(u.text) or "")))
    out = []
    groups = []   # [d_idx|None, [s_idx...], [d_idx extra...]]
    for di, si, sc in pairs:
        groups.append([di, [si] if si is not None else [], []])
    changed = True
    while changed:
        changed = False
        for k, g in enumerate(groups):
            if g[0] is None or not g[1]:
                continue
            d = D[g[0]]
            base = sim(shingles(d.cmp), shingles(joined(S[i] for i in g[1])))
            for nb in (k + 1, k - 1):
                if not (0 <= nb < len(groups)):
                    continue
                h = groups[nb]
                if h[0] is None and len(h[1]) == 1 and not is_heading(S[h[1][0]]):   # an unpaired unit next to us
                    cand = sorted(g[1] + h[1])
                    if sim(shingles(d.cmp), shingles(joined(S[i] for i in cand))) > base + 0.02:
                        g[1] = cand; h[1] = []; changed = True; break
                if h[0] is not None and not h[1] and not h[2]:   # an unpaired row of ours next to us
                    rows = sorted([g[0], h[0]])
                    text = " ".join(D[i].cmp for i in rows)
                    if sim(shingles(text), shingles(joined(S[i] for i in g[1]))) > base + 0.02:
                        g[2].append(h[0]); h[0] = None; changed = True; break
    for di, sis, extra in groups:
        if di is None and not sis:
            continue
        out.append((di, sis, extra))
    return out


def combine_s(units: list[ShUnit]) -> ShUnit:
    if len(units) == 1:
        units[0].covers = [units[0].number]
        return units[0]
    first = units[0]
    u = ShUnit(first.idx, first.page_id, first.part, first.page, first.number, first.sub,
               [k for x in units for k in x.keys], " ".join(x.raw for x in units))
    u.text = " ".join(x.text for x in units)
    u.cmp = " ".join(x.cmp for x in units)
    u.sh_book, u.real_page_id = first.sh_book, first.real_page_id
    u.covers = [x.number for x in units]
    return u


def combine_d(units: list[DbUnit]) -> DbUnit:
    if len(units) == 1:
        units[0].rows = [units[0].main_id]
        return units[0]
    first = units[0]
    u = DbUnit(first.idx, first.main_id, first.matboa, first.harf, first.part, first.page,
               " ".join(x.raw for x in units), first.number)
    u.text = "\n".join(x.text for x in units)
    u.cmp = " ".join(x.cmp for x in units)
    u.heading_in_content = " | ".join(x.heading_in_content for x in units if x.heading_in_content)
    u.printed_numbers = sum(x.printed_numbers for x in units)
    u.src_id = first.src_id
    u.rows = [x.main_id for x in units]
    return u


# ---------------------------------------------------------------- reporting

def level(d: DbUnit, s: ShUnit) -> str:
    if d.cmp == s.cmp:
        return "exact"
    if strip_tashkeel(d.cmp) == strip_tashkeel(s.cmp):
        return "tashkeel"
    if fold_spelling(d.cmp).replace(" ", "") == fold_spelling(s.cmp).replace(" ", ""):
        return "spelling"   # includes word-spacing only (بِ قُلْ / بِقُلْ)
    no_hon = lambda t: re.sub("[" + "".join(LIGATURES) + "]", "", fold_spelling(t)).replace(" ", "")
    if no_hon(d.cmp) == no_hon(s.cmp):
        return "honorific"  # only a ﷺ / رضي الله عنه … present on one side and not the other
    return "wording"


def word_diff(a: str, b: str, folded: bool) -> list[tuple[str, str]]:
    """Word-level differences between our text a and the edition's b: [(ours, theirs)]."""
    ta, tb = a.split(), b.split()
    ka = [fold_spelling(w) if folded else w for w in ta]
    kb = [fold_spelling(w) if folded else w for w in tb]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=ka, b=kb, autojunk=False).get_opcodes():
        if op != "equal":
            out.append((" ".join(ta[i1:i2]), " ".join(tb[j1:j2])))
    return out


def fmt_diff(pairs, limit=12) -> str:
    bits = []
    for ours, theirs in pairs[:limit]:
        bits.append(f"«{ours or '∅'}» ← «{theirs or '∅'}»")
    more = f" … (+{len(pairs) - limit})" if len(pairs) > limit else ""
    return " ؛ ".join(bits) + more


def run(dump_dir: str, export_dir: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    overall = []
    for book, sh_ids, folder, scheme in BOOKS:
        S: list[ShUnit] = []
        offset = 0
        for sh_id in sh_ids:
            part = load_shamela(dump_dir, sh_id, scheme)
            for u in part:
                u.sh_book = sh_id
                u.real_page_id = u.page_id
                u.page_id += offset          # keep page ids increasing across the appended books
            S.extend(part)
            offset = (S[-1].page_id if S else 0) + 1
        for i, u in enumerate(S):
            u.idx = i
        sh_id = "+".join(map(str, sh_ids))
        D = load_db(export_dir, book)
        groups = merge_pass(align(D, S, use_numbers=book in NUMBER_HINT), D, S)
        pairs = []
        for di, sis, extra in groups:
            d = combine_d([D[i] for i in sorted([di] + extra)]) if di is not None else None
            s = combine_s([S[i] for i in sis]) if sis else None
            score = sim(shingles(d.cmp), shingles(s.cmp)) if d and s else 0.0
            pairs.append((d, s, score))
        bdir = os.path.join(out_dir, folder)
        os.makedirs(bdir, exist_ok=True)
        counts = {"exact": 0, "tashkeel": 0, "spelling": 0, "wording": 0, "only_ours": 0, "only_shamela": 0,
                  "only_shamela_unnumbered": 0}
        counts["boundary"] = 0
        counts["honorific"] = 0
        num_same = num_diff = 0
        heading = 0
        rows_map, rows_review, rows_minor, rows_numbers, rows_structure = [], [], [], [], []
        statuses = []
        for d, s, score in pairs:
            if d and s:
                statuses.append(level(d, s))
            elif d:
                statuses.append("only_ours")
            elif s.number is None:
                # a page with no hadith number: chapter heading / ترجمة, kept in our chapter rows
                statuses.append("only_shamela_unnumbered")
            else:
                statuses.append("only_shamela")
        # Text that ends one of our rows but starts the edition's next unit (or the reverse): the two
        # neighbours agree once joined, so only the split point differs.
        for k in range(len(pairs) - 1):
            (d1, s1, _), (d2, s2, _) = pairs[k], pairs[k + 1]
            if not (d1 and s1 and d2 and s2):
                continue
            if statuses[k] in ("exact", "tashkeel") and statuses[k + 1] in ("exact", "tashkeel"):
                continue
            a, b = d1.cmp + " " + d2.cmp, s1.cmp + " " + s2.cmp
            if strip_tashkeel(a) == strip_tashkeel(b) or fold_spelling(a).replace(" ", "") == fold_spelling(b).replace(" ", ""):
                for kk in (k, k + 1):
                    if statuses[kk] not in ("exact", "tashkeel"):
                        statuses[kk] = "boundary"
        for (d, s, score), status in zip(pairs, statuses):
            counts[status] += 1
            if d and s and d.number is not None and s.number is not None:
                if d.number == s.number:
                    num_same += 1
                else:
                    num_diff += 1
            if d and d.heading_in_content:
                heading += 1
            rec = {
                "status": status,
                "similarity": f"{score:.3f}" if d and s else "",
                "main_id": d.main_id if d else "",
                "our_printed": d.matboa if d else "",
                "our_harf": d.harf if d else "",
                "our_part_page": f"{d.part}/{d.page}" if d else "",
                "shamela_book": s.sh_book if s else "",
                "shamela_page_id": s.real_page_id if s else "",
                "shamela_number": s.number if s and s.number is not None else "",
                "shamela_sub_number": s.sub if s and s.sub is not None else "",
                "shamela_part_page": f"{s.part}/{s.page}" if s else "",
                "shamela_hadith_keys": " ".join(map(str, s.keys)) if s else "",
                "number_agrees": ("yes" if d.number == s.number else "no") if d and s and d.number is not None and s.number is not None else "",
                "shamela_numbers_in_unit": " ".join(str(x) for x in getattr(s, "covers", []) if x is not None) if s else "",
                "our_rows_in_unit": " ".join(map(str, getattr(d, "rows", []))) if d else "",
                "heading_in_our_content": d.heading_in_content if d else "",
                "our_printed_numbers_in_row": d.printed_numbers if d else "",
            }
            rows_map.append(rec)
            if status in ("wording", "only_ours", "only_shamela") or (d and s and score < 0.6):
                diff = fmt_diff(word_diff(d.cmp, s.cmp, True)) if d and s else ""
                rows_review.append({**rec, "differences (ours ← shamela)": diff,
                                    "our_text": d.text if d else "", "shamela_text": s.text if s else "",
                                    "link": f"https://hadith.dev/hadith/{d.main_id}" if d else ""})
            elif status in ("tashkeel", "spelling", "boundary", "honorific"):
                rows_minor.append({"status": status, "main_id": d.main_id, "our_printed": d.matboa,
                                   "shamela_number": s.number if s.number is not None else "",
                                   "differences (ours ← shamela)": fmt_diff(word_diff(d.cmp, s.cmp, False), 20)})
            # numbering to correct: the texts agree but the printed number does not (or we have none)
            if d and s and status not in ("wording",) and s.number is not None and d.number != s.number:
                rows_numbers.append({"main_id": d.main_id, "our_printed": d.matboa or "", "our_harf": d.harf or "",
                                     "shamela_number": s.number, "shamela_sub_number": rec["shamela_sub_number"],
                                     "shamela_part_page": rec["shamela_part_page"], "text_status": status,
                                     "link": f"https://hadith.dev/hadith/{d.main_id}"})
            # one of our rows ↔ several of the edition's numbered hadiths, or several rows ↔ one
            covers = [x for x in getattr(s, "covers", []) if x is not None] if s else []
            our_rows = getattr(d, "rows", []) if d else []
            if len(covers) > 1 or len(our_rows) > 1:
                rows_structure.append({"main_ids": " ".join(map(str, our_rows)), "our_printed": d.matboa if d else "",
                                       "shamela_numbers": " ".join(map(str, covers)), "status": status,
                                       "what": ("our row holds %d of the edition's hadiths" % len(covers)) if len(covers) > 1
                                       else ("the edition's hadith is split over %d of our rows" % len(our_rows))})
        write_csv(os.path.join(bdir, "mapping.csv"), rows_map)
        write_csv(os.path.join(bdir, "needs-review.csv"), rows_review)
        write_csv(os.path.join(bdir, "minor-differences.csv"), rows_minor)
        write_csv(os.path.join(bdir, "numbers-to-fix.csv"), rows_numbers)
        write_csv(os.path.join(bdir, "structure.csv"), rows_structure)
        old = os.path.join(bdir, "tashkeel-only.csv")
        if os.path.exists(old):
            os.remove(old)
        write_review_md(os.path.join(bdir, "needs-review.md"), folder, rows_review)
        counts["numbers_to_fix"] = len(rows_numbers)
        counts["structure"] = len(rows_structure)
        overall.append((folder, sh_id, len(D), len(S), counts, num_same, num_diff, heading))
        print(folder, "ours", len(D), "shamela", len(S), counts, "numbers same/diff", num_same, num_diff, "headings", heading, flush=True)
    write_summary(os.path.join(out_dir, "SUMMARY.md"), overall)


def write_csv(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        if not rows:
            fh.write("")
            return
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def write_review_md(path, folder, rows):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"# {folder} — rows that need a person\n\n")
        fh.write("Each entry: our row, the Shamela unit it was aligned to, and the word differences "
                 "written «ours» ← «Shamela». `only_ours` / `only_shamela` = nothing on the other side was "
                 "similar enough to pair with.\n\n")
        for r in rows:
            fh.write(f"## {r['status']} — ours #{r['our_printed'] or '—'} (id {r['main_id'] or '—'}) ↔ "
                     f"Shamela #{r['shamela_number'] or '—'} (page {r['shamela_page_id'] or '—'}, {r['shamela_part_page'] or '—'})"
                     f" · similarity {r['similarity'] or '—'}\n\n")
            if r["link"]:
                fh.write(f"{r['link']}\n\n")
            if r["differences (ours ← shamela)"]:
                fh.write(f"**Differences:** {r['differences (ours ← shamela)']}\n\n")
            if r["our_text"]:
                fh.write(f"**Ours:** {r['our_text'][:1500]}\n\n")
            if r["shamela_text"]:
                fh.write(f"**Shamela:** {r['shamela_text'][:1500]}\n\n")
            fh.write("---\n\n")


def write_summary(path, overall):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Alignment with Shamela's linked editions — summary\n\n")
        fh.write("| Book | Shamela id | our rows | exact | tashkeel only | spelling only | honorific only | split point only | **wording** | only ours | only Shamela | **numbers to fix** | rows to split/join | heading inside our row |\n")
        fh.write("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
        for folder, sh_id, nd, ns, c, same, diff, heading in overall:
            fh.write(f"| {folder} | {sh_id} | {nd} | {c['exact']} | {c['tashkeel']} | {c['spelling']} | {c['honorific']} | {c['boundary']} | **{c['wording']}** | "
                     f"{c['only_ours']} | {c['only_shamela']} | **{c['numbers_to_fix']}** | {c['structure']} | {heading} |\n")
        fh.write("\nShamela pages with no hadith number (chapter headings / تراجم) are not counted; our rows keep "
                 "those headings in their chapter rows or, in the 'heading inside our row' column, inside the hadith row itself.\n")


if __name__ == "__main__":
    run(*sys.argv[1:4])
