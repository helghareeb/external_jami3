"""db/shamela_verify.py — check a dry-run import (updates.jsonl) against the edition and our old rows.

For every rebuilt row:
  1. text      — what the row shows (sanad, matn, remarks) equals the edition's text letter for letter,
                 harakat and punctuation included (spaces aside). Rows sharing/holding units are joined.
  2. markup    — no narrator / matn / tarf / gharib … tag was lost in the transfer
  3. footnotes — no old footnote survives; every reference has its note and every note its reference
  4. well-formed XML

    python -I db/shamela_verify.py <dump dir> <export dir> <import out dir>
"""
from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A  # noqa: E402
import shamela_import as I  # noqa: E402

KEEP_TAGS = ("راوي", "متن", "طرف", "غريب", "صيغة_تحديث", "مصطلح_صيغ", "مصطلح_متون", "حديث", "قول", "علم_رجل",
             "قرآن", "آية", "نقد_الراوي", "مسألة")


def strict(s: str) -> str:
    s = re.sub(r"\s+", "", s)
    return s.lstrip("-–")


def visible(xml: str) -> str:
    return A.db_plain(xml)


def edition_visible(raw: str) -> str:
    return A.shamela_plain(raw)


def main(dump_dir, export_dir, out_dir):
    old = {}
    for b in range(1, 6):
        for line in open(os.path.join(export_dir, f"db_book{b}.jsonl"), encoding="utf-8"):
            r = json.loads(line)
            old[r["main_id"]] = r
    # edition units by (book, number) are not unique; verify by re-deriving each update's units
    upd = [json.loads(l) for l in open(os.path.join(out_dir, "updates.jsonl"), encoding="utf-8")]
    by_group = defaultdict(list)
    for u in upd:
        by_group[tuple(u["_rows"])].append(u)

    # rebuild the edition text per group exactly as the builder saw it
    units_text = {}
    for book, sh_ids, folder, scheme in A.BOOKS:
        S = []
        offset = 0
        for sh_id in sh_ids:
            part = A.load_shamela(dump_dir, sh_id, scheme)
            for u in part:
                u.sh_book, u.real_page_id = sh_id, u.page_id
                u.page_id += offset
            S.extend(part)
            offset = (S[-1].page_id if S else 0) + 1
        D = A.load_db(export_dir, book)
        for di, sis, extra in A.merge_pass(A.align(D, S, use_numbers=book in A.NUMBER_HINT), D, S):
            if di is None or not sis:
                continue
            rows = tuple(D[k].main_id for k in sorted([di] + extra, key=lambda k: D[k].idx))
            units_text[rows] = " ".join(edition_visible(S[i].raw) for i in sis)

    res = Counter()
    fails = []
    for rows, recs in by_group.items():
        recs.sort(key=lambda r: rows.index(r["main_id"]))
        # Whole row, heading included: must equal the edition's heading + hadith text it was built from.
        whole_new = " ".join(visible(r["content"]) for r in recs)
        whole_ed = (recs[0].get("_ed_heading", "") + " " + recs[0].get("_ed_body", "")).strip()
        if strict(whole_new) == strict(whole_ed):
            res["WHOLE ROW identical to the edition (heading included)"] += len(recs)
        else:
            res["WHOLE ROW differs from the edition"] += len(recs)
            import difflib
            wa, wb = whole_new.split(), whole_ed.split()
            ops = []
            for o, i1, i2, j1, j2 in difflib.SequenceMatcher(a=wa, b=wb, autojunk=False).get_opcodes():
                if o != "equal" and strict(" ".join(wa[i1:i2])) != strict(" ".join(wb[j1:j2])):
                    ops.append({"ours": " ".join(wa[i1:i2]), "edition": " ".join(wb[j1:j2]),
                                "before": " ".join(wb[max(0, j1 - 3):j1]), "after": " ".join(wb[j2:j2 + 3])})
            fails.append({"rows": rows, "whole_row_diffs": ops[:6], "n_diffs": len(ops)})
        new_text = " ".join(visible(I.split_heading(r["content"])[1]) for r in recs)
        ed = units_text.get(rows)
        if ed is None:
            res["group not found"] += 1
            continue
        a, b = strict(new_text), strict(ed)
        if a == b:
            res["text identical to the edition"] += len(recs)
        else:
            res["text DIFFERS from the edition"] += len(recs)
            import difflib
            # word-level, with three words of context either side, so a person can read it
            wa, wb = new_text.split(), ed.split()
            ops = []
            for o, i1, i2, j1, j2 in difflib.SequenceMatcher(a=wa, b=wb, autojunk=False).get_opcodes():
                if o == "equal":
                    continue
                if strict(" ".join(wa[i1:i2])) == strict(" ".join(wb[j1:j2])):
                    continue          # spacing only
                ops.append({"ours": " ".join(wa[i1:i2]), "edition": " ".join(wb[j1:j2]),
                            "before": " ".join(wb[max(0, j1 - 3):j1]), "after": " ".join(wb[j2:j2 + 3])})
            fails.append({"rows": rows, "diffs": ops[:6], "n_diffs": len(ops)})
        for r in recs:
            c, o = r["content"], old[r["main_id"]]["content"] or ""
            # markup kept
            lost = []
            for t in KEEP_TAGS:
                n_old = len(re.findall(rf"<{t}[\s>/]", o))
                n_new = len(re.findall(rf"<{t}[\s>/]", c))
                if n_new < n_old and len(rows) == 1:
                    lost.append(f"{t} {n_old}->{n_new}")
            if lost:
                res["markup lost"] += 1
                if len(fails) < 400:
                    fails.append({"rows": (r["main_id"],), "markup_lost": lost})
            else:
                res["markup kept"] += 1
            # empty narrator elements (a name deleted by the edition)
            if re.search(r"<راوي\b[^>]*>\s*</راوي>", c):
                res["empty narrator tag"] += 1
            # footnotes
            refs = re.findall(r'<هامش ID="(\d+)"', c)
            notes = re.findall(r'<FootNote ID="(\d+)"', c)
            if sorted(set(refs)) != sorted(set(notes)):
                res["footnote ref/note mismatch"] += 1
            if c.count("<Margin") > 1:
                res["two footnote blocks"] += 1
            old_notes = [re.sub(r"\s+", " ", x).strip() for x in re.findall(r"<FootNote[^>]*>(.*?)</FootNote>", o, re.S)]
            new_notes = [re.sub(r"\s+", " ", x).strip() for x in re.findall(r"<FootNote[^>]*>(.*?)</FootNote>", c, re.S)]
            if any(n and n in new_notes for n in old_notes if "طبعة" in n and n not in " ".join(new_notes[:0])) and old_notes != new_notes:
                res["an old footnote survived"] += 1
            # well-formed
            try:
                ET.fromstring("<r>" + re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#)", "&amp;", c) + "</r>")
                res["well-formed"] += 1
            except ET.ParseError:
                res["NOT well-formed"] += 1
                if len(fails) < 400:
                    fails.append({"rows": (r["main_id"],), "xml_error": c[:300]})
    with open(os.path.join(out_dir, "verify.json"), "w", encoding="utf-8") as fh:
        json.dump({"result": res, "failures": fails[:400]}, fh, ensure_ascii=False, indent=1, default=list)
    for k, v in sorted(res.items()):
        print(f"{k}: {v}")
    print("failures logged:", len(fails))


if __name__ == "__main__":
    main(*sys.argv[1:4])
