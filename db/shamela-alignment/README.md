# Alignment with the editions Shamela references

Shamela 4 (build 108) cross-links hadiths between eight editions only: the ones listed in its own
`service/hadeeth.db → inservice`. For our first five books, those editions are:

| Our book | Shamela edition (id) |
|---|---|
| 1 صحيح البخاري | صحيح البخاري - ط السلطانية (1681) |
| 2 صحيح مسلم | صحيح مسلم - ط التركية (711) |
| 3 سنن أبي داود | سنن أبي داود - ط دهلي مع عون المعبود (654) |
| 4 جامع الترمذي | سنن الترمذي - ت بشار (7895) + كتاب العلل بآخره (642) |
| 5 سنن النسائي | سنن النسائي - ط المصرية (829). This is **not** al-Risala's edition. |

This folder compares every hadith row of ours (`hadith_toc`, paragraph rows) with the edition's
text. **Nothing in the database was changed.** The figures are in [SUMMARY.md](SUMMARY.md).

**Decided (2026-11-18): the edition wins in every respect.** At import, sanad, matn, harakat, wording,
numbering, part/page and the division into hadiths are all taken from the edition, and honorifics stay as
glyphs (ﷺ ﵁ …). A tashkeel difference is a real difference (زُبْد / زَبَد / زَبْد). The status columns below
describe how far we are from the edition today. They do not decide what is kept. A person is needed only
where the alignment itself is uncertain (`only_ours`, `only_shamela`, low similarity).

## Data used
- **Ours:** the local PGlite database `offline-build/pgdata` (snapshot of 2026-10-16), read from a copy.
- **Shamela:** the page store of the local install `C:\shamela4` (v108), read-only.

## Files in each book folder

| File | What it holds | Who acts |
|---|---|---|
| `needs-review.md` / `.csv` | **Wording** differences. Also rows with no partner on the other side. Each entry shows the differing words as «ours» ← «Shamela», then both full texts. | A person |
| `numbers-to-fix.csv` | Rows whose text agrees with the edition but whose printed number does not, or is missing. | Mechanical: take the edition's number |
| `structure.csv` | One of our rows that holds several of the edition's numbered hadiths, or one hadith that is split over several of our rows. | At import: split or join |
| `minor-differences.csv` | Differences only in tashkeel, spelling convention (hamza seat, السموات/السماوات), an honorific, or where one hadith ends and the next begins. | Taken from the edition at import, no review needed |
| `mapping.csv` | Every row ↔ edition unit: number, part/page, Shamela page id, Shamela hadith keys, status. | Input for the import |

## Status meanings
- `exact`: identical letters and harakat. Punctuation, markup, and ligature vs written-out honorifics are ignored.
- `tashkeel`: the same letters with different harakat. The Sultaniyya and Turkish editions mark variant
  readings of the riwayat with two harakat on one letter (يَحْبِسُْهَا، الشَّعَْرِ). These count here.
- `spelling`: the same words once hamza seats, alif and ta-marbuta forms, and word spacing are folded.
- `honorific`: the only difference is an honorific present on one side (e.g. رضي الله عنهما).
- `boundary`: two neighbouring hadiths agree once joined; only the point where one ends and the next begins differs.
- `wording`: different words. A person needs to look at it.
- `only_ours` / `only_shamela`: nothing on the other side was similar enough to pair with.

## Points to know before importing
- **Our content is annotated XML** (`<راوي ربط=…>`, `<متن>`, `<غريب>`, …). The edition's text has to be
  written into that markup, not over it. Shamela's raw pages carry narrator links (`inr://man-<id>`) that use
  the same ids as our `<راوي ربط>`, and a `<hadeeth-KEY>` tag where the matn begins.
- **Chapter headings inside hadith rows:** many rows begin with the chapter heading (ترجمة الباب) before
  «- حدثنا». The edition keeps headings on their own pages. The "heading inside our row" column of SUMMARY.md counts these rows.
- **Nasa'i:** the text largely agrees, but our numbering comes from a different, one-volume printing.
  Nearly every number changes (`numbers-to-fix.csv`).

## The import (dry run)
`import-dry-run/REVIEW.html` is the review of the rebuild (Arabic, right-to-left). It is produced by:

- `db/shamela_import.py`: rebuilds every paired row from the edition. All of our old text is replaced
  by the edition's: the heading in front of the hadith, sanad, matn, the author's remarks, numbers,
  volume/page, page breaks and footnotes. Our tags are carried onto the edition's words wherever they
  line up. Anything the edition prints between two of our rows (headings, hadiths we have no row for)
  is written whole in front of the next row. It writes `updates.jsonl` and touches no database.
- `db/shamela_verify.py`: checks every rebuilt row: the whole visible row equals the edition text it was
  built from (letter for letter, harakat included), no tag was lost, footnotes are consistent, and the
  XML is well-formed.
- `tools/apply_pglite.mjs`: applies `updates.jsonl` to a COPY of the PGlite database, with the edition
  names and bibliographic cards from `tools/editions.mjs`.
- `tools/review_report.py`: writes `import-dry-run/REVIEW.html` and `REVIEW.md`.

## Re-running
```
# 1. the edition pages (JDK 21; Lucene jars from the Shamela install)
javac -cp "C:\shamela4\app\lucene\2\*" -d classes tools\DumpBooks.java
java  -cp "classes;C:\shamela4\app\lucene\2\*" DumpBooks C:\shamela4\database\store\page <dump> 1681 711 654 7895 642 829
# 2. our rows, from a COPY of offline-build/pgdata (opening a PGlite directory writes to it)
node tools\export_pglite.mjs <copy of pgdata> <export>
# 3. the comparison
python -I db\shamela_align.py <dump> <export> db\shamela-alignment
# 4. the rebuild, its verification, a trial apply on a copy, and the review
python -I db\shamela_import.py <dump> <export> <out>
python -I db\shamela_verify.py <dump> <export> <out>
node tools\apply_pglite.mjs <copy of pgdata> <out>\updates.jsonl
python -I tools\review_report.py <out> <export> db\shamela-alignment\import-dry-run
```
