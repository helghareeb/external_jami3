"""DECISIONS item 4 (decided 2026-11-19): the hidden matn copies in books 1-5.

A narration that gives only its chain and says «بمثله / نحوه / بهذا الإسناد» carried, in al-Jami's data, a hidden
full matn (<متن_مخفي … نص="…"/>) for the matn-comparison feature — text from another source, not the edition.
Decision ب: each copy takes the edition's matn of the hadith it refers to; where that hadith cannot be told
with confidence, the copy is removed.

The hadith referred to: among the row's own matn, the nearest three earlier hadiths of the same chapter, and
— after a tahwil «(ح)», where the matn follows — the next two, the one whose edition matn best matches the old
copy (share of the old copy's three-word phrases found in it, or 0.85 × its words found, whichever is
higher). Taken when that score is at least 0.4 (samples down to 0.4 all named the right hadith); when two
score within 0.1 of each other, the nearer. Otherwise the copy is removed.

Read-only against the database; writes hidden-matn-updates.jsonl for tools/apply_numbers_postgres.mjs (a
guarded content update) and a report. Checks: only <متن_مخفي> elements change; every row well-formed.

  DATABASE_URL=… python db/shamela_hidden_matn.py <out dir>
"""
import html, json, os, re, sys, collections
import xml.etree.ElementTree as ET
import psycopg2

sys.stdout.reconfigure(encoding="utf-8")
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
THRESHOLD, CLOSE = 0.4, 0.1
HIDDEN = re.compile(r'<متن_مخفي([^>]*?)\sنص="([^"]*)"([^>]*?)(/?)>')
MATN = re.compile(r"<متن(?=[\s>])[^>]*>(.*?)</متن>", re.S)

def bare(s):
    s = re.sub(r"[ً-ٰٟـ]", "", s or "").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^ء-ي ]", " ", s)
def words(s):
    return [w for w in bare(s).split() if len(w) > 1 and w not in ("صلي", "الله", "عليه", "وسلم")]
def grams(ws, n=3):
    return {" ".join(ws[i:i + n]) for i in range(len(ws) - n + 1)} or set(ws)
def matn_text(x):
    x = re.sub(r"<Margin>.*?</Margin>", "", x or "", flags=re.S)
    return re.sub(r"\s+", " ", " ".join(re.sub(r"<[^>]+>", " ", m) for m in MATN.findall(x))).strip()

conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
conn.set_session(readonly=True)
cur = conn.cursor()
cur.execute("SELECT main_id, book_id, parent_id, content FROM hadith_toc WHERE book_id BETWEEN 1 AND 5 AND is_paragraph ORDER BY book_id, left_value")
rows = cur.fetchall()
conn.close()

stats, report, updates = collections.Counter(), [], []
for i, (m, b, par, x) in enumerate(rows):
    if "<متن_مخفي" not in (x or ""):
        continue
    # candidates: the row itself, up to three earlier hadiths and two later ones of the same chapter
    cands = []
    if matn_text(x):
        cands.append((0, m, matn_text(x)))
    k = i - 1
    while k >= 0 and len([c for c in cands if c[0] < 0]) < 3 and rows[k][1] == b and rows[k][2] == par:
        t = matn_text(rows[k][3])
        if len(words(t)) >= 4:
            cands.append((k - i, rows[k][0], t))
        k -= 1
    k = i + 1
    while k < len(rows) and k <= i + 2 and rows[k][1] == b and rows[k][2] == par:
        t = matn_text(rows[k][3])
        if len(words(t)) >= 4:
            cands.append((k - i, rows[k][0], t))
        k += 1

    def replace(h):
        old = html.unescape(h.group(2))
        og, ow = grams(words(old)), set(words(old))
        scored = []
        for dist, mid, t in cands:
            tw = words(t)
            s = max(len(og & grams(tw)) / max(1, len(og)), 0.85 * len(ow & set(tw)) / max(1, len(ow)))
            scored.append((s, abs(dist), dist > 0, mid, t))
        if not scored or max(s for s, *_ in scored) < THRESHOLD:
            stats["removed (no hadith it can be told to refer to)"] += 1
            report.append({"main_id": m, "action": "removed", "best": round(max((s for s, *_ in scored), default=0), 3), "old": old[:120]})
            return ""
        best = max(s for s, *_ in scored)
        s, _, _, mid, t = min((c for c in scored if c[0] >= best - CLOSE), key=lambda c: (c[1], c[2]))   # nearest; earlier first
        stats["replaced with the edition's matn" + (" (its own row)" if mid == m else "")] += 1
        report.append({"main_id": m, "action": "replaced", "from": mid, "score": round(s, 3), "old": old[:120], "new": t[:120]})
        return f'<متن_مخفي{h.group(1)} نص="{html.escape(t, quote=True)}"{h.group(3)}{h.group(4)}>'

    new = HIDDEN.sub(replace, x)
    if new == x:
        continue
    # only the hidden copies changed
    strip = lambda s: re.sub(r"<متن_مخفي[^>]*>", "", s)
    assert strip(new) == strip(x), f"row {m}: something besides a hidden copy changed"
    ET.fromstring("<r>" + new + "</r>")
    updates.append({"main_id": m, "book_id": b, "old_content": x, "content": new})
    stats["rows"] += 1

with open(os.path.join(out_dir, "hidden-matn-updates.jsonl"), "w", encoding="utf-8") as f:
    for u in updates:
        f.write(json.dumps(u, ensure_ascii=False) + "\n")
with open(os.path.join(out_dir, "hidden-matn-report.jsonl"), "w", encoding="utf-8") as f:
    for r in report:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(json.dumps(stats, ensure_ascii=False, indent=1))
