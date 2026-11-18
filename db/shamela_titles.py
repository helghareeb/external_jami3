"""db/shamela_titles.py — book and chapter titles from the editions' table of contents (dry run).

Our chapter rows (hadith_toc rows that are not paragraphs: كتاب / باب …) are paired, by position, with
the titles of the edition Shamela references — Shamela's own table of contents for that edition, as its
contents panel shows it — and take the edition's title text exactly. The tree (parent_id, left/right
values) is ours and is not touched, so links and breadcrumbs keep working. Each hadith row's chapter_text
(the title of its chapter, repeated on the row) follows its chapter row. Nothing is guessed: rows with no
partner on either side are listed for a person.

    python -I db/shamela_titles.py <titles dump dir> <export dir> <out dir>

<titles dump dir>/<shamela id>.tsv comes from tools/DumpTitles.java (Shamela's «title» store);
the tree and pages come from C:/shamela4/database/book/*/<id>.db (table title).
Writes <out>/title-updates.jsonl, <out>/titles-report.csv and prints a summary. Touches no database.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shamela_align as A  # noqa: E402


def edition_titles(dump_dir, sh_ids):
    """The edition's titles in book order: (title_id, page, depth, text, book). Appended books (Tirmidhi's
    كتاب العلل) get their pages offset so pages keep increasing."""
    out, offset = [], 0
    for sh in sh_ids:
        f = glob.glob(f"C:/shamela4/database/book/*/{sh}.db")[0]
        con = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
        rows = con.execute("select id, page, parent from title order by id").fetchall()
        maxpage = con.execute("select max(id) from page").fetchone()[0] or 0
        par = {i: p for i, _, p in rows}

        def depth(i):
            n = 0
            while par.get(i):
                i = par[i]
                n += 1
            return n
        texts = {}
        for line in open(os.path.join(dump_dir, f"{sh}.tsv"), encoding="utf-8"):
            n, _, rest = line.rstrip("\n").partition("\t")
            texts[int(n)] = rest[5:] if rest.startswith("body=") else rest
        for i, page, _ in rows:
            out.append({"title_id": i, "page": (page or 0) + offset, "depth": depth(i), "text": texts.get(i, "").strip(), "book": sh})
        offset += maxpage + 1
    return out


def run(dump_dir, export_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    upd = open(os.path.join(out_dir, "title-updates.jsonl"), "w", encoding="utf-8")
    report_rows = []
    summary = []
    for book, sh_ids, folder, _scheme in A.BOOKS:
        rows = [json.loads(l) for l in open(os.path.join(export_dir, f"db_book{book}.jsonl"), encoding="utf-8")]
        byid = {r["main_id"]: r for r in rows}
        # our chapter rows, without the book's own root row («صحيح البخاري»), in book order
        chapters = [r for r in rows if not r["is_paragraph"] and r.get("parent_id") in byid]
        chapters.sort(key=lambda r: (r.get("id") or 0, r["main_id"]))
        D = []
        for k, r in enumerate(chapters):
            u = A.DbUnit(k, r["main_id"], None, None, 0, 0, "")
            u.text = A.db_plain(r["content"] or "")
            u.cmp = A.to_compare(u.text) or "·"
            u.src_id = r.get("id") or 0
            D.append(u)
        T = edition_titles(dump_dir, sh_ids)
        S = []
        for k, t in enumerate(T):
            s = A.ShUnit(k, t["page"], "", 0, None, None, [], "")
            s.text = t["text"]
            s.cmp = A.to_compare(t["text"]) or "·"
            S.append(s)
        pairs = A.align(D, S, use_numbers=False, back_pages=420, ahead_pages=60, floor=0.25)
        n_same = n_changed = n_only_ours = n_only_ed = 0
        new_title = {}
        for di, si, score in pairs:
            d = D[di] if di is not None else None
            t = T[si] if si is not None else None
            status = ""
            if d and t:
                status = "same" if d.text == t["text"] else "changed"
                if status == "changed":
                    new_title[d.main_id] = t["text"]
                    upd.write(json.dumps({"main_id": d.main_id, "content": t["text"], "old": d.text}, ensure_ascii=False) + "\n")
                n_same += status == "same"
                n_changed += status == "changed"
            elif d:
                status = "only_ours"
                n_only_ours += 1
            else:
                status = "only_edition"
                n_only_ed += 1
            report_rows.append({
                "book": folder, "status": status, "similarity": f"{score:.2f}" if d and t else "",
                "main_id": d.main_id if d else "", "our_title": d.text if d else "",
                "edition_title": t["text"] if t else "", "edition_title_id": t["title_id"] if t else "",
                "edition_depth": t["depth"] if t else "",
            })
        # each hadith row's chapter_text follows its chapter row (only where it repeated that title)
        n_ct = 0
        for r in rows:
            if not r["is_paragraph"]:
                continue
            p = r.get("parent_id")
            if p in new_title and (r.get("chapter_text") or "").strip() == A.db_plain(byid[p]["content"] or "").strip():
                upd.write(json.dumps({"main_id": r["main_id"], "chapter_text": new_title[p], "old": r.get("chapter_text")}, ensure_ascii=False) + "\n")
                n_ct += 1
        summary.append((folder, len(D), len(T), n_same, n_changed, n_only_ours, n_only_ed, n_ct))
        print(folder, f"ours {len(D)} edition {len(T)} | same {n_same} changed {n_changed} only-ours {n_only_ours} "
                      f"only-edition {n_only_ed} | hadith rows' chapter_text updated {n_ct}", flush=True)
    upd.close()
    with open(os.path.join(out_dir, "titles-report.csv"), "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(report_rows[0].keys()))
        w.writeheader()
        w.writerows(report_rows)
    json.dump(summary, open(os.path.join(out_dir, "titles-summary.json"), "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    run(*sys.argv[1:4])
