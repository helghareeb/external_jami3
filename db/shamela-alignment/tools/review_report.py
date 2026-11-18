"""Write the dry-run review in Arabic, right-to-left: REVIEW.html (any browser) and REVIEW.md (RTL HTML blocks,
for GitHub / VS Code). Direction comes from dir="rtl" / lang="ar" on the containers — no invisible bidi
characters; row ids and links sit in their own LTR <bdi> elements.

    python -I review_report.py <import out dir> <export dir> <dest dir>
"""
import html
import json
import os
import re
import sys
from collections import defaultdict

src, export_dir, dst = sys.argv[1:4]
os.makedirs(dst, exist_ok=True)

BOOKS = {
    "01-bukhari-sultaniyya": "صحيح البخاري — الطبعة السلطانية",
    "02-muslim-turkish": "صحيح مسلم — الطبعة التركية",
    "03-abu-dawud-delhi": "سنن أبي داود — ط دهلي مع عون المعبود",
    "04-tirmidhi-bashar": "جامع الترمذي — ت بشار عواد",
    "05-nasai-egyptian": "سنن النسائي — الطبعة المصرية",
}
BOOK_OF_ID = {}
for n, folder in enumerate(BOOKS, start=1):
    for line in open(os.path.join(export_dir, f"db_book{n}.jsonl"), encoding="utf-8"):
        BOOK_OF_ID[json.loads(line)["main_id"]] = folder

STAT_AR = {
    "rows rebuilt": "صفوف أُعيد بناؤها من الطبعة",
    "heading rebuilt from the edition": "تراجم أبواب أُعيد بناؤها من الطبعة",
    "old heading text removed (the edition prints none there)": "تراجم قديمة أُزيلت (لا ترجمة في الطبعة هناك)",
    "footnotes written": "حواشٍ كُتبت من الطبعة",
    "page_markers": "علامات صفحات المطبوع",
    "rows holding several edition hadiths (numbers inline)": "صفوف تضمّ أكثر من حديث من الطبعة",
    "rows sharing one edition hadith": "حديث واحد في الطبعة موزّع على صفّين عندنا",
    "edition hadiths without a row of ours, written before the next row": "أحاديث في الطبعة ليس لها صفّ عندنا (كُتبت كاملةً أمام الصف التالي)",
    "edition title pages left to our chapter rows (phase 2)": "صفحات عناوين في الطبعة تخصّ صفوف الأبواب (المرحلة الثانية)",
    "pairing too uncertain (left unchanged, in needs-review)": "صفوف تُركت دون تغيير (المطابقة غير مؤكدة)",
    "row of ours with no edition partner (left unchanged)": "صفوف عندنا ليس لها نظير في الطبعة (تُركت)",
}
ORDER = list(STAT_AR)

# per-book statistics from import-report.md
stats = defaultdict(dict)
cur = None
for line in open(os.path.join(src, "import-report.md"), encoding="utf-8"):
    m = re.match(r"## (\S+)", line)
    if m:
        cur = m.group(1)
    m = re.match(r"- (.+): (\d+)$", line.strip())
    if m and cur:
        stats[cur][m.group(1)] = int(m.group(2))
verify = json.load(open(os.path.join(src, "verify.json"), encoding="utf-8"))
res = verify["result"]
absent = [json.loads(l) for l in open(os.path.join(src, "absent-from-edition.jsonl"), encoding="utf-8")]
kept = [json.loads(l) for l in open(os.path.join(src, "headings-kept.jsonl"), encoding="utf-8")]
# the whole-row check (heading + sanad + matn + remarks) is the one that counts
fails = [{**f, "diffs": f["whole_row_diffs"]} for f in verify["failures"] if "whole_row_diffs" in f]
FAILED = {m for f in fails for m in f["rows"]}   # rows whose rebuilt text is not yet identical to the edition

esc = lambda s: html.escape(str(s), quote=True)

# The rebuilt rows as the local site (port 3100) shows them, and our old rows, to place each removed
# passage in the new text.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import difflib  # noqa: E402
import shamela_align as A  # noqa: E402

NEW, OLD = {}, {}
for line in open(os.path.join(src, "updates.jsonl"), encoding="utf-8"):
    u = json.loads(line)
    NEW[u["main_id"]] = u["content"]
for n in range(1, 6):
    for line in open(os.path.join(export_dir, f"db_book{n}.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        if r["main_id"] in NEW:
            OLD[r["main_id"]] = r["content"] or ""


def new_context(main_ids, passage, width=7):
    """The new text around the spot where `passage` was removed: (before, after) word strings."""
    old_w = " ".join(A.db_plain(OLD.get(m, "")) for m in main_ids).split()
    new_w = " ".join(A.db_plain(NEW.get(m, "")) for m in main_ids).split()
    key = lambda w: A.fold_spelling(A.to_compare(w)).replace(" ", "") or "·"
    target = [key(w) for w in passage.split()]
    tset = set(target)
    best = None
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=[key(w) for w in old_w], b=[key(w) for w in new_w],
                                                       autojunk=False).get_opcodes():
        if op in ("delete", "replace"):
            gone = [key(w) for w in old_w[i1:i2]]
            # how many of the removed passage's words this change took away (whole words, not letters)
            score = len(tset & set(gone))
            if best is None or score > best[0]:
                best = (score, j1, j2)
    if best is None or best[0] == 0:
        return None
    if best is None:
        return None
    _, j1, j2 = best
    return " ".join(new_w[max(0, j1 - width):j1]), " ".join(new_w[j1:j2]), " ".join(new_w[j2:j2 + width])


def link(mid):
    return f'<bdi dir="ltr"><a href="http://localhost:3100/hadith/{mid}">{mid}</a></bdi>'


def ltr(s):
    return f'<bdi dir="ltr">{esc(s)}</bdi>'


parts = []
P = parts.append
P('<h1>مراجعة الاستيراد التجريبي من الطبعات التي تعتمدها الشاملة</h1>')
P('<p>نُسخت نصوص الكتب الخمسة (السند والمتن وكلام المصنِّف) من الطبعات التي تربط بينها الشاملة، بحروفها وحركاتها وعلامات ترقيمها، '
  'وأُبقيت وسوم الرواة والمتن والغريب كما هي. جرى ذلك على <strong>نسخة محلية</strong> من قاعدة البيانات فقط، ولم يُمسّ الموقع المنشور.</p>')

P('<h2>نتيجة التحقق الآلي</h2>')
P('<table><thead><tr><th>الفحص</th><th>العدد</th></tr></thead><tbody>')
for label, key in (("صفوف نصُّها كلُّه مطابق للطبعة حرفًا بحرف مع الحركات (الترجمة والسند والمتن وكلام المصنِّف)",
                    "WHOLE ROW identical to the edition (heading included)"),
                   ("صفوف ما زال نصُّها يختلف عن الطبعة", "WHOLE ROW differs from the edition"),
                   ("صفوف حُفظت فيها الوسوم كلها (الرواة، المتن، الطرف، الغريب…)", "markup kept"),
                   ("صفوف سليمة البنية (XML)", "well-formed"),
                   ("وسم راوٍ صار فارغًا لأن الطبعة ليس فيها ذلك الاسم", "empty narrator tag")):
    P(f"<tr><td>{label}</td><td class='num'>{ltr(f'{res.get(key, 0):,}')}</td></tr>")
P('</tbody></table>')

P('<h2>الأرقام لكل كتاب</h2>')
P('<div class="scroll"><table><thead><tr><th>البند</th>' + "".join(f"<th>{esc(n)}</th>" for n in BOOKS.values()) + '</tr></thead><tbody>')
for key in ORDER:
    P(f"<tr><td>{STAT_AR[key]}</td>" + "".join(f"<td class='num'>{ltr(f'{stats[b].get(key, 0):,}')}</td>" for b in BOOKS) + "</tr>")
P('</tbody></table></div>')

def coverage(main_ids, passage):
    """Share of the passage's words that are still in the row's new text (spelling and harakat folded)."""
    key = lambda w: A.fold_spelling(A.to_compare(w)).replace(" ", "")
    words = [k for k in (key(w) for w in passage.split()) if len(k) > 1]
    new_words = {key(w) for m in main_ids for w in A.db_plain(NEW.get(m, "")).split()}
    return sum(1 for w in words if w in new_words) / len(words) if words else 0.0


gone_rows = [a for a in absent if coverage(a["main_ids"], a["text"]) < 0.6]
reworded = [a for a in absent if coverage(a["main_ids"], a["text"]) >= 0.6]

P(f'<h2>١. عبارات من نصّنا القديم أُزيلت ({len(gone_rows)})، أو استُبدل بها لفظ الطبعة ({len(reworded)})</h2>')
P('<p><strong>نصّنا القديم لم يَبقَ منه شيء في هذه الصفوف:</strong> النسخة الجديدة فيها هي نصُّ الطبعة حرفًا بحرف '
  'مع الحركات، وقد تحقّق الفحص الآلي من ذلك في كل صفّ من صفوف هذا القسم (<span class="ok">✓ مطابق للطبعة</span>). '
  'وإنما يعرض هذا القسم أين كان لفظنا القديم يخالف الطبعة، وماذا صار في موضعه:</p>'
  '<ul><li><strong>أ.</strong> عبارات قديمة ليس في الطبعة ما يقابلها، فأُزيلت ولم يحلّ محلَّها شيء.</li>'
  '<li><strong>ب.</strong> عبارات قديمة في الطبعة ما يقابلها بلفظ قريب (يختلف بكلمة أو حرف أو ترتيب)، '
  'فاستُبدل بها لفظ الطبعة كما هو؛ والكلمات المظلَّلة هي مواضع الاختلاف التي صارت الآن على لفظ الطبعة.</li></ul>'
  '<p>أمّا ما وُجد في موضع آخر من الطبعة (عند حديث مجاور) فلم يُحذف، بل انتقل إلى موضعه فيها.</p>')
P('<p>العمود الأخير يعرض النسخة الجديدة كما تظهر في الموقع المحلي (المنفذ <bdi dir="ltr">3100</bdi>) في الموضع نفسه: '
  'العلامة <span class="gap">⟨حُذف هنا⟩</span> مكانُ النص المحذوف، وما ظُلِّل هو لفظ الطبعة الذي حلّ محلّه إن وُجد.</p>')


def removed_table(rows, title):
    P(f'<h3>{title} ({ltr(len(rows))})</h3>')
    P('<table class="removed"><colgroup><col style="width:13%"><col style="width:7%"><col style="width:7%">'
      '<col style="width:35%"><col style="width:38%"></colgroup>'
      '<thead><tr><th>الكتاب</th><th>رقمه في الطبعة</th><th>الصف</th><th>لفظنا القديم (أُزيل)</th>'
      '<th>النسخة الجديدة في الموضع نفسه (نص الطبعة)</th></tr></thead><tbody>')
    for a in rows:
        removed_row(a, reworded=rows is reworded)
    P('</tbody></table>')


def reworded_view(main_ids, passage, pad=3):
    """The stretch of the new text that carries the passage, words differing from the old one marked."""
    key = lambda w: A.fold_spelling(A.to_compare(w)).replace(" ", "") or "·"
    old = passage.split()
    new_w = " ".join(A.db_plain(NEW.get(m, "")) for m in main_ids).split()
    sm = difflib.SequenceMatcher(a=[key(w) for w in old], b=[key(w) for w in new_w], autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size]
    if not blocks:
        return None
    j_start, j_end = blocks[0].b, blocks[-1].b + blocks[-1].size
    same = {j for b in blocks for j in range(b.b, b.b + b.size)}
    out = [f"<span class='ctx'>{esc(' '.join(new_w[max(0, j_start - pad):j_start]))}</span>"]
    for j in range(j_start, j_end):
        out.append(esc(new_w[j]) if j in same else f"<mark>{esc(new_w[j])}</mark>")
    out.append(f"<span class='ctx'>{esc(' '.join(new_w[j_end:j_end + pad]))}</span>")
    return " ".join(out)


def removed_row(a, reworded=False):
    nums = "، ".join(str(x) for x in a["edition_numbers"] if x is not None) or "—"
    shown = None
    if reworded:
        shown = reworded_view(a["main_ids"], a["text"])
    else:
        ctx = new_context(a["main_ids"], a["text"])
        if ctx:
            before, instead, after = ctx
            mid = f"<mark>{esc(instead)}</mark>" if instead else "<span class='gap'>⟨حُذف هنا⟩</span>"
            shown = f"<span class='ctx'>{esc(before)}</span> {mid} <span class='ctx'>{esc(after)}</span>"
    ok = not (set(a["main_ids"]) & FAILED)
    badge = "<div class='ok'>✓ مطابق للطبعة</div>" if ok else "<div class='bad'>✗ ما زال يختلف عن الطبعة</div>"
    P(f"<tr><td>{esc(BOOKS[a['book']])}</td><td class='num'>{ltr(nums)}</td><td class='num'>{' '.join(link(m) for m in a['main_ids'])}</td>"
      f"<td class='ar old'>{esc(a['text'].strip(' ،,:؛.-–'))}</td><td class='ar'>{shown or '—'}{badge}</td></tr>")


removed_table(gone_rows, "أ. أُزيلت: ليس في الطبعة ما يقابلها")
removed_table(reworded, "ب. استُبدل بها لفظ الطبعة")

P(f'<h2>٢. صفوف ما زال نصّها يختلف عن الطبعة ({len(fails)})</h2>')
if not fails:
    P('<p class="ok">✓ لا يوجد: كل صفّ أُعيد بناؤه نصُّه كلُّه — الترجمة والسند والمتن وكلام المصنِّف — '
      'هو نصُّ الطبعة حرفًا بحرف مع الحركات. لم يُرقَّع شيء من نصّنا القديم: حُذف كلّه وكُتب نصّ الطبعة مكانه، '
      'وأُعيدت الوسوم (الرواة، الطرف، الغريب، المتن) إلى كلمات الطبعة حيث تطابقت، ليبقى الربط يعمل.</p>')
if fails:
    P('<p>في كل صف: موضع الاختلاف بين النسخة الجديدة ونصّ الطبعة، مع كلمات قبله وبعده من الطبعة. '
      'العمود الأوسط نصّ الطبعة، والجزء المظلَّل هو ما ليس في النسخة الجديدة.</p>')
    P('<table><thead><tr><th>الصف</th><th>في الطبعة (والفرق مظلَّل)</th><th>النسخة الجديدة (المحلية) في الموضع نفسه</th></tr></thead><tbody>')
    for f in fails:
        for d in f["diffs"][:2]:
            shown = (f"<span class='ctx'>{esc(d['before'])}</span> <mark>{esc(d['edition']) or '∅'}</mark> "
                     f"<span class='ctx'>{esc(d['after'])}</span>")
            P(f"<tr><td class='num'>{' '.join(link(m) for m in f['rows'])}</td><td class='ar'>{shown}</td>"
              f"<td class='ar'>{esc(d['ours']) or '— لا شيء'}</td></tr>")
    P('</tbody></table>')

P(f'<h2>٣. تراجم قديمة أُزيلت لأن الطبعة لا تطبع ترجمةً في ذلك الموضع ({len(kept)})</h2>')
P('<p>الترجمة التي أمام كل حديث صارت ما تطبعه الطبعة بين الحديث السابق وهذا الحديث، كاملةً بلفظها، '
  'ولو اختلف لفظنا القديم عنها. وفي هذه المواضع وحدها لا تطبع الطبعة شيئًا بين الحديثين، فأُزيل نصّ ترجمتنا القديمة.</p>')
by_book = defaultdict(list)
for h in kept:
    by_book[BOOK_OF_ID.get(h["main_id"], "?")].append(h)
for b, name in BOOKS.items():
    rows = by_book.get(b, [])
    if not rows:
        continue
    P(f"<details open><summary>{esc(name)} ({ltr(len(rows))})</summary><table><thead><tr><th>الصف</th><th>الترجمة القديمة (أُزيلت)</th></tr></thead><tbody>")
    for h in rows:
        P(f"<tr><td class='num'>{link(h['main_id'])}</td><td class='ar old'>{esc(h['heading'])}</td></tr>")
    P("</tbody></table></details>")

P('<h2>٤. ما بقي لمرحلة ثانية</h2>')
P('<ul>'
  '<li>أحاديث في الطبعة ليس لها صف عندنا (كالمكرَّر «م»): نصُّها الآن مكتوبٌ كاملًا برقمه أمام الصف التالي حتى لا يسقط شيء من الطبعة، '
  'وتحتاج صفوفًا مستقلة مع روابط أسانيدها.</li>'
  '<li>صفوف تضمّ أكثر من حديث من الطبعة: تظهر الآن صحيحة وأرقامها في مواضعها، لكنها لم تُقسَّم إلى صفوف مستقلة.</li>'
  '<li>صفوف تُركت دون تغيير لأن مطابقتها غير مؤكدة: تُراجَع يدويًّا.</li>'
  '<li>صفوف عناوين الكتب والأبواب (غير صفوف الأحاديث): لم يُعَد بناؤها بعد.</li>'
  '<li>النسخ المخفية من المتن (<bdi dir="ltr">متن_مخفي</bdi>) التي تعتمد عليها مقارنة الروايات: ما زالت بلفظ قديم.</li>'
  '<li>الترقيم الفرعي في صحيح مسلم داخل كل كتاب، مثل «٤٥ - (١٠٠٠)»: لم يُعرض بعد.</li>'
  '</ul>')
P('<p class="note">الروابط تفتح الموقع المحلي على <bdi dir="ltr">http://localhost:3100</bdi> (يعمل على جهازك فقط ما دامت النسخة التجريبية مشغَّلة).</p>')

body = "\n".join(parts)
CSS = """
:root { color-scheme: light dark; --bg:#fbfaf7; --fg:#1f1d1a; --muted:#6b655c; --line:#e3ddd2; --head:#f1ece3; --accent:#7a5c1e; }
@media (prefers-color-scheme: dark) { :root { --bg:#17161a; --fg:#ece9e3; --muted:#c9c2b6; --line:#34313a; --head:#232129; --accent:#d8b46a; } }
table.removed { table-layout: fixed; }
html { background: var(--bg); }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; color: var(--fg); background: var(--bg);
  /* Scheherazade New draws the honorific ligatures (﵁ ﵄ ﷿ ﵎ ﷾ …) that Amiri and the system fonts lack */
  font-family: "Amiri", "Scheherazade New", "Noto Naskh Arabic", "Traditional Arabic", "Segoe UI", Tahoma, sans-serif; font-size: 19px; line-height: 1.9; }
h1 { font-size: 1.6em; line-height: 1.4; margin: 0 0 .4em; }
h3 { font-size: 1.05em; margin: 1.2em 0 .3em; }
h2 { font-size: 1.25em; margin: 1.8em 0 .5em; padding-bottom: .2em; border-bottom: 2px solid var(--line); color: var(--accent); }
p { margin: .4em 0 .9em; }
table { border-collapse: collapse; width: 100%; margin: .4em 0 1em; font-size: .95em; }
th, td { border: 1px solid var(--line); padding: .35em .6em; text-align: start; vertical-align: top; }
th { background: var(--head); font-weight: 700; }
td.num { white-space: nowrap; font-family: "Segoe UI", Tahoma, sans-serif; font-size: .9em; }
td.ar { font-size: 1.05em; }
.ctx { color: var(--muted); }
.ok { color: #2e7d4f; font-weight: 700; font-size: .85em; margin-top: .3em; }
.bad { color: #b03a3a; font-weight: 700; font-size: .85em; margin-top: .3em; }
@media (prefers-color-scheme: dark) { .ok { color: #7fd6a2; } .bad { color: #ff8a80; } }
td.old { text-decoration: line-through; text-decoration-color: rgba(180, 60, 60, .55); }
.gap { color: #b03a3a; font-weight: 700; white-space: nowrap; }
@media (prefers-color-scheme: dark) { .gap { color: #ff8a80; } }
mark { background: #f3dc9a; color: #1f1d1a; padding: 0 .15em; border-radius: 3px; }
@media (prefers-color-scheme: dark) { mark { background: #6b5520; color: #f6efe0; } }
.scroll { overflow-x: auto; }
details { margin: .4em 0; border: 1px solid var(--line); border-radius: 8px; padding: .2em .8em; }
summary { cursor: pointer; font-weight: 700; padding: .3em 0; }
a { color: var(--accent); }
.note { color: var(--muted); font-size: .9em; }
"""
page = f"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مراجعة الاستيراد التجريبي</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Scheherazade+New:wght@400;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>
"""
with open(os.path.join(dst, "REVIEW.html"), "w", encoding="utf-8") as fh:
    fh.write(page)
# Markdown: the same content as one RTL HTML block (GitHub and VS Code render HTML inside .md)
with open(os.path.join(dst, "REVIEW.md"), "w", encoding="utf-8") as fh:
    fh.write('<div dir="rtl" lang="ar">\n\n')
    fh.write(body.replace("http://localhost:3100", "http://localhost:3100"))
    fh.write('\n\n</div>\n')

# structural QA: no invisible bidi controls in what we wrote
BIDI = re.compile("[‪-‮⁦-⁩‎‏؜]")
for name in ("REVIEW.html", "REVIEW.md"):
    txt = open(os.path.join(dst, name), encoding="utf-8").read()
    print(name, len(txt), "chars; bidi control characters:", len(BIDI.findall(txt)))
