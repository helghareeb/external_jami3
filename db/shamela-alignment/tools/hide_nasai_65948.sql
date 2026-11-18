-- Hide Nasa'i main_id 65948 «1367 م» (DECISIONS item 1ج, decided 2026-11-19): one hadith that the
-- Egyptian edition of al-Mujtaba — the one Shamela references — does not have, in its text or its notes.
--
-- The row leaves the book (hadith_toc) whole, into hadith_toc_hidden with the reason; the reading chain
-- is closed around it. Its takhrij / chain / judgment rows stay in their tables for the record — every
-- view joins hadith_toc, so it drops out of lists, search and parallels. /hadith/65948 shows a notice.
--
--   psql -v ON_ERROR_STOP=1 -f hide_nasai_65948.sql      (ends with ROLLBACK unless -v commit=1)
\set ON_ERROR_STOP 1
BEGIN;
LOCK TABLE hadith_toc IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS hadith_toc_hidden (LIKE hadith_toc INCLUDING DEFAULTS);
ALTER TABLE hadith_toc_hidden ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE hadith_toc_hidden ADD COLUMN IF NOT EXISTS hidden_at timestamptz DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hadith_toc_hidden_pkey') THEN
    ALTER TABLE hadith_toc_hidden ADD CONSTRAINT hadith_toc_hidden_pkey PRIMARY KEY (main_id);
  END IF;
END $$;

-- guard: the row is the one decided on
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM hadith_toc WHERE main_id = 65948;
  IF NOT FOUND THEN RAISE EXCEPTION 'row 65948 is not in hadith_toc'; END IF;
  IF r.book_id <> 5 OR NOT r.is_paragraph OR btrim(r.tarqeem_matboa1) <> '1367 م' OR r.content NOT LIKE '%بِجُوَاثَا%' THEN
    RAISE EXCEPTION 'row 65948 is not Nasa''i «1367 م» (book %, number %)', r.book_id, r.tarqeem_matboa1;
  END IF;
END $$;

INSERT INTO hadith_toc_hidden
SELECT h.*, 'ليس في طبعة سنن النسائي التي تعتمدها المكتبة الشاملة (الطبعة المصرية)، لا في متنها ولا في حواشيها، فأُخفي ليبقى الكتاب مطابقًا لها.', now()
FROM hadith_toc h WHERE h.main_id = 65948;

-- the reading chain closes around it; its chapter's first-row pointer moves to the next row
UPDATE hadith_toc SET next_paragraph_id = (SELECT next_paragraph_id FROM hadith_toc WHERE main_id = 65948)
 WHERE main_id = (SELECT prev_paragraph_id FROM hadith_toc WHERE main_id = 65948);
UPDATE hadith_toc SET prev_paragraph_id = (SELECT prev_paragraph_id FROM hadith_toc WHERE main_id = 65948)
 WHERE main_id = (SELECT next_paragraph_id FROM hadith_toc WHERE main_id = 65948);
UPDATE hadith_toc c SET paragraph_id = (SELECT next_paragraph_id FROM hadith_toc WHERE main_id = 65948)
 WHERE c.paragraph_id = 65948 AND c.main_id <> 65948;
DELETE FROM hadith_toc WHERE main_id = 65948;

-- check: chain closed at the gap, nothing points at the hidden row
DO $$ DECLARE p int; n int; BEGIN
  SELECT prev_paragraph_id, next_paragraph_id INTO p, n FROM hadith_toc_hidden WHERE main_id = 65948;
  IF (SELECT next_paragraph_id FROM hadith_toc WHERE main_id = p) <> n OR (SELECT prev_paragraph_id FROM hadith_toc WHERE main_id = n) <> p THEN
    RAISE EXCEPTION 'reading chain not closed around 65948';
  END IF;
  IF EXISTS (SELECT 1 FROM hadith_toc WHERE 65948 IN (parent_id, paragraph_id, prev_paragraph_id, next_paragraph_id)) THEN
    RAISE EXCEPTION 'a row still points at 65948';
  END IF;
  RAISE NOTICE 'hidden 65948; chain % ↔ % closed', p, n;
END $$;

\if :{?commit}
COMMIT;
\else
ROLLBACK;
\endif
