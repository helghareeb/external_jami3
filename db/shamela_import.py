"""db/shamela_import.py — rebuild our hadith rows from the editions Shamela references (dry run).

The edition wins in every respect: every letter, haraka and punctuation mark of the sanad, matn and
the author's remarks, the honorifics as glyphs (ﷺ ﵁ …), the printed hadith number, the volume/page
and the page breaks, and the footnotes. Our XML annotation is kept: the narrator, narration-formula,
matn, tarf, gharib and other tags are carried across onto the edition's words by aligning the two
texts word for word. Old footnotes and page markers are removed before the edition's are written,
so a hadith never shows both.

Writes, without touching any database:
  <out>/updates.jsonl     {main_id, content, tarf, tarqeem_matboa1, part_num, page_num}
  <out>/import-report.md  what was rebuilt, what was left alone and why, and the verification result

    python -I db/shamela_import.py <dump dir with body+foot> <export dir> <out dir>
"""
from __future__ import annotations

import difflib
import html
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A  # noqa: E402

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Elements whose content is never shown (the old XSL left them empty) — carried across unchanged.
OPAQUE = ("سند_مخفي", "متن_مخفي", "تعليق_مخفي", "نص_مخفي", "إضافي", "ترقيم_حرف")
OPAQUE_RE = re.compile(
    r"<(?P<t>" + "|".join(OPAQUE) + r")\b[^>]*?/>|<(?P<u>" + "|".join(OPAQUE) + r")\b[^>]*>.*?</(?P=u)>", re.S)
NUMBER_RE = re.compile(r"<رقم_حديث_للعرض\b[^>]*>.*?</رقم_حديث_للعرض>|<رقم_حديث\b[^>]*>.*?</رقم_حديث>", re.S)
OLD_FOOT_RE = re.compile(r"<Margin\b[^>]*>.*?</Margin>|<FootNote\b[^>]*>.*?</FootNote>", re.S)
OLD_REF_RE = re.compile(r"<هامش\b[^>]*?/>|<هامش\b[^>]*>\s*</هامش>|<هامش\b[^>]*>")
OLD_PAGE_RE = re.compile(r"<الصفحات\b[^>]*?/>|<الصفحات\b[^>]*>\s*</الصفحات>")

SPECIAL = "\x02"


# ------------------------------------------------------------------ our side: XML → items

class Item:
    __slots__ = ("kind", "value")      # kind: 'tag' | 'word' | 'num' | 'rowbreak'

    def __init__(self, kind, value):
        self.kind, self.value = kind, value


def xml_items(xml: str) -> list[Item]:
    """Split one row's XML into tags (kept verbatim) and words (to be replaced). Hidden elements and
    hadith-number elements become single opaque items; old footnotes and page markers are dropped."""
    s = OLD_FOOT_RE.sub("", xml)
    s = OLD_REF_RE.sub("", s).replace("</هامش>", "")
    s = OLD_PAGE_RE.sub("", s)
    opaque: list[str] = []

    def stash(m):
        opaque.append(m.group(0))
        return f"{SPECIAL}O{len(opaque) - 1}{SPECIAL}"
    s = OPAQUE_RE.sub(stash, s)
    numbers: list[str] = []

    def stash_num(m):
        numbers.append(m.group(0))
        return f"{SPECIAL}N{len(numbers) - 1}{SPECIAL}"
    s = NUMBER_RE.sub(stash_num, s)
    items: list[Item] = []
    for m in re.finditer(r"<[^>]+>|" + SPECIAL + r"[ON]\d+" + SPECIAL + r"|[^<" + SPECIAL + r"]+", s):
        tok = m.group(0)
        if tok.startswith("<"):
            items.append(Item("tag", tok))
        elif tok.startswith(SPECIAL + "O"):
            items.append(Item("tag", opaque[int(tok[2:-1])]))
        elif tok.startswith(SPECIAL + "N"):
            raw = numbers[int(tok[2:-1])]
            items.append(Item("num", raw))
        else:
            for w in html.unescape(tok).split():
                items.append(Item("word", w))
    return items


# ------------------------------------------------------------------ edition side: HTML → words + specials

def edition_words(raw_html: str, part: str, keep_titles: bool = False):
    """The edition's text as (words, specials). specials[j] = markup to place before word j:
    page breaks (⦗n⦘) and footnote references ((¬n)). Chapter titles are dropped unless keep_titles
    (they belong to the heading, which is rebuilt separately)."""
    s = raw_html.replace("\\n", " ")
    if keep_titles:
        s = re.sub(r'<span data-type="title"[^>]*>(.*?)</span>', r" \1 ", s, flags=re.S)
    s = re.sub(r'<span data-type="title"[^>]*>.*?</span>', " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"⦗([^⦘]*)⦘", lambda m: f" {SPECIAL}P{m.group(1).strip().translate(AR_DIGITS)}{SPECIAL} ", s)
    s = re.sub(r"\(¬([٠-٩0-9]+)\)", lambda m: f" {SPECIAL}F{m.group(1).translate(AR_DIGITS)}{SPECIAL} ", s)
    words: list[str] = []
    specials: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for tok in s.split():
        if tok.startswith(SPECIAL) and tok.endswith(SPECIAL):
            specials[len(words)].append((tok[1], tok[2:-1]))
        elif not re.search(r"[ء-ي0-9٠-٩﴾-﷿]", tok) and words:
            words[-1] = words[-1] + " " + tok          # standalone punctuation: keep it with its word
        else:
            words.append(tok)
    return words, specials


def word_key(w: str) -> str:
    k = A.fold_spelling(A.to_compare(w))
    return k.replace(" ", "") or "·"


# ------------------------------------------------------------------ the transfer

def transfer(items: list[Item], ed_words: list[str], ed_specials, ed_numbers: list[int], part: str,
             foot_ids: dict, foot_texts: dict, stats: Counter):
    """Emit the edition's words with our tags carried to the aligned positions. Returns the XML string
    (rowbreak items come out as SPECIAL+'R' markers) and the footnotes referenced."""
    ours = [i for i in items if i.kind == "word"]
    a = [word_key(w.value) for w in ours]
    b = [word_key(w) for w in ed_words]
    # f[i] = edition index our word i maps to (for markup sitting before our word i); f[n] = m
    n, m = len(a), len(b)
    f = [0] * (n + 1)
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        for i in range(i1, i2):
            if op == "equal":
                f[i] = j1 + (i - i1)
            elif op == "replace":
                f[i] = j1 + ((i - i1) * (j2 - j1)) // (i2 - i1)
            else:  # delete
                f[i] = j1
    f[n] = m if n else 0               # no words of ours (tags only): keep the tags in front
    for i in range(1, n + 1):          # monotone, so nesting of the carried tags is preserved
        f[i] = max(f[i], f[i - 1])
    # place every non-word item at the mapped position of the next word of ours
    before: dict[int, list[Item]] = defaultdict(list)
    wi = 0
    for it in items:
        if it.kind == "word":
            wi += 1
            continue
        before[f[wi]].append(it)
    out: list[str] = []
    numbers = list(ed_numbers)
    first_num_done = False
    used_feet: list[tuple[str, str]] = []

    def emit_special(kind, val):
        if kind == "P":
            out.append(f'<الصفحات جزء="{part}" صفحة="{val}"/>')
            stats["page_markers"] += 1
        elif kind == "F":
            key = foot_ids.get(val)
            if key is None:
                key = str(len(foot_ids) + 1)
                foot_ids[val] = key
                used_feet.append((key, foot_texts.get(val, "")))
            out.append(f'<هامش ID="{key}" نوع="تعليق"></هامش>')
        elif kind == "N":                                  # the next of the edition's hadiths in this unit
            out.append(f'<رقم_حديث نوع="مطبوع">{val} </رقم_حديث>')   # shown as «(n)» by the reader

    def is_second_printed(it):
        return it.kind == "num" and ('نوع="مطبوع"' in it.value or "رقم_حديث_للعرض" in it.value)

    for j in range(m + 1):
        here = before.get(j, [])
        specials = ed_specials.get(j, [])
        # page breaks and footnote references belong to the word before: emit them first
        for kind, val in specials:
            if kind in ("P", "F"):
                emit_special(kind, val)
        # the next edition hadith's number: where our own number for it stood, else after the
        # closing tags (so it opens the next hadith instead of sitting inside the last matn)
        pending_n = [val for kind, val in specials if kind == "N"]
        slot = None
        if pending_n:
            seen_first = first_num_done
            for k, it in enumerate(here):
                if is_second_printed(it):
                    if seen_first:
                        slot = k
                        break
                    seen_first = True
            if slot is None and j == 0:
                slot = len(here)       # at the very start: inside the row's opening tags
            if slot is None:
                slot = next((k for k, it in enumerate(here) if not (it.kind == "tag" and it.value.startswith("</"))), len(here))
        for k, it in enumerate(here + [None]):
            if pending_n and k == slot:
                for val in pending_n:
                    emit_special("N", val)
                pending_n = []
            if it is None:
                break
            if it.kind == "tag":
                out.append(it.value)
            elif it.kind == "rowbreak":
                out.append(SPECIAL + "R")
            elif it.kind == "num":
                if 'نوع="مطبوع"' in it.value or "رقم_حديث_للعرض" in it.value:
                    if not first_num_done and numbers:
                        out.append(f'<رقم_حديث نوع="مطبوع">{numbers[0]} </رقم_حديث>')
                        first_num_done = True
                    # a second printed number of ours in the same unit is dropped: the edition's govern
                else:
                    out.append(it.value)       # Harf's number: a different numbering, kept as it is
        if j < m:
            out.append(html.escape(ed_words[j], quote=False) + " ")
    return "".join(out), used_feet


# ------------------------------------------------------------------ per row

def parse_foot(foot: str) -> dict[str, str]:
    """A page's footnotes «(¬١) text (¬٢) text» → {'1': text, ...}."""
    s = foot.replace("\\n", " ")
    # a heading inside the footnotes, e.g. «(تعليق الشاملة)», says whose notes follow: keep it on each
    s = re.sub(r'<span data-type="title"[^>]*>(.*?)</span>', lambda m: f" \x03{m.group(1).strip()}\x03 ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    parts = re.split(r"\(¬([٠-٩0-9]+)\)", s)
    out = {}
    label = ""
    for k in range(1, len(parts) - 1, 2):
        lab = re.findall("\x03(.*?)\x03", parts[k - 1])
        if lab:
            label = lab[-1]
        text = re.sub(r"\s+", " ", re.sub("\x03.*?\x03", " ", parts[k + 1])).strip()
        if label and not text.startswith(label):
            text = f"{label} {text}"
        out[parts[k].translate(AR_DIGITS)] = text
    return out


def split_heading(xml: str):
    starts = [p for p in (xml.find("<رقم_حديث"), xml.find("<حديث")) if p >= 0]
    if not starts:
        return "", xml
    return xml[: min(starts)], xml[min(starts):]


def tarf_of(xml: str) -> str | None:
    # the opening of THIS hadith: the tarf inside its own matn, not one in heading material in front of it
    # (edition text placed in front of the row carries none of our tags, so our own hadith is the
    # first <حديث> element)
    start = xml.find("<حديث")
    own = xml[start:] if start >= 0 else xml
    m = re.search(r"<متن\b[^>]*>(.*?)</متن>", own, re.S)
    parts = re.findall(r"<طرف\b[^>]*>(.*?)</طرف>", m.group(1) if m else own, re.S) or \
        re.findall(r"<طرف\b[^>]*>(.*?)</طرف>", xml, re.S)
    if not parts:
        return None
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", " ".join(parts)))).strip()
    # the edition's quotation marks stay in the text; the tarf column is shown inside the site's own «…»
    return text.replace("«", "").replace("»", "").strip() or None


def build(dump_dir: str, export_dir: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    upd = open(os.path.join(out_dir, "updates.jsonl"), "w", encoding="utf-8")
    report = []
    totals = Counter()
    removed: list[dict] = []
    kept_headings: list[dict] = []
    for book, sh_ids, folder, scheme in A.BOOKS:
        stats = Counter()
        # edition units, with each page's footnotes
        S: list[A.ShUnit] = []
        feet: dict[tuple[int, int], dict] = {}
        offset = 0
        for sh_id in sh_ids:
            for line in open(os.path.join(dump_dir, f"{sh_id}.tsv"), encoding="utf-8"):
                pid, body, foot = (line.rstrip("\n").split("\t") + ["", ""])[:3]
                if foot.strip(" \\n"):
                    feet[(sh_id, int(pid))] = parse_foot(foot)
            part = A.load_shamela(dump_dir, sh_id, scheme)
            for u in part:
                u.sh_book, u.real_page_id = sh_id, u.page_id
                u.page_id += offset
            S.extend(part)
            offset = (S[-1].page_id if S else 0) + 1
        for i, u in enumerate(S):
            u.idx = i
        D = A.load_db(export_dir, book)
        raw_rows = {}
        for line in open(os.path.join(export_dir, f"db_book{book}.jsonl"), encoding="utf-8"):
            r = json.loads(line)
            raw_rows[r["main_id"]] = r
        groups = A.merge_pass(A.align(D, S, use_numbers=book in A.NUMBER_HINT), D, S)

        # Everything the edition prints between two of our rows that has no row of its own — chapter
        # headings, and hadiths we do not have (e.g. a repeated «(م)» narration) — waits here and is
        # written, whole and in order, in front of the next rebuilt row. Nothing of the edition is dropped.
        prev_unnumbered: list[int] = []
        for di, sis, extra in groups:
            if di is None:
                prev_unnumbered.extend(sis)
                continue
            if not sis:
                stats["row of ours with no edition partner (left unchanged)"] += 1
                continue
            row_ids = sorted([di] + extra, key=lambda k: D[k].idx)
            units = [S[i] for i in sis]
            sc = A.sim(A.shingles(" ".join(D[k].cmp for k in row_ids)), A.shingles(" ".join(u.cmp for u in units)))
            if sc < 0.5:
                stats["pairing too uncertain (left unchanged, in needs-review)"] += 1
                continue

            # edition text of the unit(s): words, page/footnote specials, and the numbers inside it
            ed_words: list[str] = []
            ed_specials: dict[int, list] = defaultdict(list)
            numbers: list[int] = []
            for k, u in enumerate(units):
                w, sp = edition_words(u.raw, u.part)
                base = len(ed_words)
                if k > 0 and u.number is not None:
                    ed_specials[base].append(("N", str(u.number)))
                for j, lst in sp.items():
                    for kind, val in lst:
                        # footnote refs are numbered per page: qualify them with the page
                        ed_specials[base + j].append((kind, f"{u.sh_book}:{u.real_page_id}:{val}" if kind == "F" else val))
                ed_words.extend(w)
                if u.number is not None:
                    numbers.append(u.number)
            foot_texts = {}
            for u in units:
                for num, text in feet.get((u.sh_book, u.real_page_id), {}).items():
                    foot_texts[f"{u.sh_book}:{u.real_page_id}:{num}"] = text

            # our rows: heading part and hadith part
            heads, bodies = [], []
            for k in row_ids:
                h, bd = split_heading(raw_rows[D[k].main_id]["content"] or "")
                heads.append(h)
                bodies.append(bd)
            foot_ids: dict = {}
            used: list = []
            # The heading in front of the first row is whatever the edition prints between the previous
            # hadith and this one (its heading / title units), taken whole — position decides, not how
            # close our old wording was. Where the edition prints nothing there, our old heading text
            # is removed. Our tags are carried onto the edition's words where they line up.
            new_heads = []
            ed_heading_plain = ""
            pending = [S[i] for i in prev_unnumbered]
            pending_has_hadith = any(x.number is not None for x in pending)
            if pending and not A.to_compare(A.db_plain(heads[0])) and not pending_has_hadith:
                # only chapter titles, and our row carries no heading: they live in our chapter rows
                stats["edition title pages left to our chapter rows (phase 2)"] += len(pending)
                pending = []
            for k, h in enumerate(heads):
                hu = pending if k == 0 else []
                # any visible character of ours (punctuation too) counts: nothing of the old text may stay
                if not A.db_plain(h).strip() and not hu:
                    new_heads.append(h)
                    continue
                hw, hs = [], defaultdict(list)
                for x in hu:
                    if x.number is not None:
                        # a hadith of the edition that has no row of ours: written here with its number
                        hs[len(hw)].append(("N", str(x.number)))
                        stats["edition hadiths without a row of ours, written before the next row"] += 1
                    w, sp = edition_words(x.raw, x.part, keep_titles=True)
                    for j, lst in sp.items():
                        for kind, val in lst:
                            hs[len(hw) + j].append((kind, f"{x.sh_book}:{x.real_page_id}:{val}" if kind == "F" else val))
                    hw.extend(w)
                    for num, text in feet.get((x.sh_book, x.real_page_id), {}).items():
                        foot_texts[f"{x.sh_book}:{x.real_page_id}:{num}"] = text
                had_text = bool(A.to_compare(A.db_plain(h)))
                hx, hused = transfer(xml_items(h), hw, hs, [], hu[0].part if hu else units[0].part, foot_ids, foot_texts, stats)
                used = used + hused
                new_heads.append(hx)
                if hu:
                    ed_heading_plain = " ".join(
                        A.shamela_plain(re.sub(r'<span data-type="title"[^>]*>(.*?)</span>', r" \1 ", x.raw, flags=re.S)) for x in hu)
                    stats["heading rebuilt from the edition"] += 1
                elif had_text:
                    stats["old heading text removed (the edition prints none there)"] += 1
                    kept_headings.append({"main_id": D[row_ids[k]].main_id, "heading": A.db_plain(h)[:300]})
            prev_unnumbered = []

            items: list[Item] = []
            for k, bd in enumerate(bodies):
                if k:
                    items.append(Item("rowbreak", ""))
                items.extend(xml_items(bd))
            xml_out, bused = transfer(items, ed_words, ed_specials, numbers, units[0].part, foot_ids, foot_texts, stats)
            used = used + bused
            # words of ours the edition does not have at all: removed — listed for the record
            ours_w = [i.value for i in items if i.kind == "word"]
            gone = []
            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(
                    a=[word_key(w) for w in ours_w], b=[word_key(w) for w in ed_words], autojunk=False).get_opcodes():
                if op == "delete" and (i2 - i1) >= 3:
                    gone.append(" ".join(ours_w[i1:i2]))
            if gone:
                removed.append({"book": folder, "main_ids": [D[x].main_id for x in row_ids],
                                "edition_numbers": [u.number for u in units], "removed": gone})
            pieces = xml_out.split(SPECIAL + "R")
            if len(pieces) != len(row_ids):
                stats["row split failed (left unchanged)"] += 1
                continue

            # assemble each row, footnotes at the end of the row that references them
            for k, rid in enumerate(row_ids):
                d = D[rid]
                xml = new_heads[k] + pieces[k]
                refs = re.findall(r'<هامش ID="(\d+)"', xml)
                notes = [(key, text) for key, text in used if key in refs]
                if notes:
                    margin = "<Margin>" + "".join(
                        f'<FootNote ID="{key}">{html.escape(text, quote=False)} </FootNote>' for key, text in notes) + "</Margin>"
                    pos = xml.rfind("</مسألة>")
                    xml = xml[:pos] + margin + xml[pos:] if pos >= 0 else xml + margin
                    stats["footnotes written"] += len(notes)
                if xml.count("<") != xml.count(">"):
                    stats["malformed (left unchanged)"] += 1
                    continue
                u0 = units[0]
                rec = {
                    "main_id": d.main_id,
                    "content": xml,
                    "tarf": tarf_of(xml),
                    "tarqeem_matboa1": str(numbers[0]) if numbers else raw_rows[d.main_id].get("tarqeem_matboa1"),
                    "part_num": int(u0.part) if str(u0.part).isdigit() else raw_rows[d.main_id]["part_num"],
                    "page_num": u0.page or raw_rows[d.main_id]["page_num"],
                    "_units": [u.number for u in units], "_rows": [D[x].main_id for x in row_ids],
                    # the edition text this row (group) was built from: heading units + hadith units
                    "_ed_heading": ed_heading_plain if k == 0 else "",
                    "_ed_body": " ".join(A.shamela_plain(u.raw) for u in units) if k == 0 else "",
                }
                upd.write(json.dumps(rec, ensure_ascii=False) + "\n")
                stats["rows rebuilt"] += 1
                if len(units) > 1:
                    stats["rows holding several edition hadiths (numbers inline)"] += 1
                if len(row_ids) > 1:
                    stats["rows sharing one edition hadith"] += 1
        report.append((folder, stats))
        totals.update(stats)
        print(folder, dict(stats), flush=True)
    upd.close()
    with open(os.path.join(out_dir, "removed-not-in-edition.jsonl"), "w", encoding="utf-8") as fh:
        for r in removed:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(os.path.join(out_dir, "headings-kept.jsonl"), "w", encoding="utf-8") as fh:
        for r in kept_headings:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("passages removed (3+ words not in the edition):", len(removed), " headings kept as ours:", len(kept_headings))
    with open(os.path.join(out_dir, "import-report.md"), "w", encoding="utf-8") as fh:
        fh.write("# Dry-run import from the referenced editions\n\n")
        for folder, st in report:
            fh.write(f"## {folder}\n\n")
            for k, v in sorted(st.items()):
                fh.write(f"- {k}: {v}\n")
            fh.write("\n")


if __name__ == "__main__":
    build(*sys.argv[1:4])
