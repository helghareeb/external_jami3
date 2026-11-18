# Publishing data: the database dump and the offline edition

Two things are published for people to download, both from Cloudflare R2 at **https://files.hadith.dev**:

| What | Where | Who uses it |
|---|---|---|
| Public database dump (`pg_dump`, private tables empty) | `https://files.hadith.dev/db/hadith-public-YYYY-MM-DD.dump` | developers, linked from the README |
| Offline edition (PGlite chunks + `manifest.json`) | `https://files.hadith.dev/offline/` | the installed app («الجامع دون إنترنت») |

Publish both whenever the production data changes in a way readers should get (a re-based book, a numbering
fix, new tables). Each takes one upload command once built. Work through the steps in order: dump → check
→ offline build → upload → verify → update the README → tidy up.

## How it is wired (set up 2026-11-19)

- **Domain.** hadith.dev is registered at Railway; its DNS is served by Cloudflare (zone `hadith.dev`,
  nameservers `addyson` and `lee.ns.cloudflare.com`). Every record is **DNS only** (grey cloud), copied
  from Railway's list: the apex is a CNAME to `logg0b2h.up.railway.app`, plus `_railway-verify`, the Resend
  mail records (`send`, `rsend`, `resend._domainkey`) and `_dmarc`. If Railway ever gives a new target or
  verification value, change it in **Cloudflare**, not Railway. To hand DNS back to Railway: Railway →
  Domains → hadith.dev → Nameservers → *Reset to Railway*.
- **Bucket.** R2 bucket `hadith-files` (Cloudflare account `39dab0dc448bb89849cc790b61513134`), custom
  domain `files.hadith.dev`, CORS allowing GET/HEAD from `https://hadith.dev`, `https://www.hadith.dev`
  and `http://localhost:3000`/`3100`. R2 has no download (egress) charges.
- **The app.** `NEXT_PUBLIC_OFFLINE_DATA_URL=https://files.hadith.dev/offline` on the Railway service
  `hadith-web`. It is fixed into the browser code **at build time** (the `Dockerfile` declares it as an
  `ARG`; without that line Railway would not pass it in), so changing it needs a redeploy. Unset, the app
  falls back to `/api/offline/files/…`, which proxies the GitHub release `offline-pg` (`OFFLINE_DATA_URL`
  overrides that source).
- **Upload credentials.** `.env.r2` in the repo root, git-ignored (`.env*`):

  ```
  R2_ACCESS_KEY_ID=…
  R2_SECRET_ACCESS_KEY=…
  ```

  An R2 **Account** API token (Cloudflare → R2 → API Tokens), permission *Object Read & Write*, bucket
  `hadith-files` only, no IP filter. Its secret is shown once, when it is created: if `.env.r2` is lost,
  create a new token and revoke the old one. Never paste the keys into a chat, an issue or a commit.
- **Tools.** `python -m pip install boto3` (for `scripts/r2-upload.py`), PostgreSQL 18 client tools
  (`pg_dump`, `pg_restore`), the Railway CLI (logged in), and `gh` for the GitHub fallback.

## 1. Make the public dump

Take the connection string from Railway without printing it, and dump everything except the rows of the
private tables (accounts, sessions, readers' libraries, analytics). Their tables stay in the dump, empty.

```powershell
$kv = railway variables --service Postgres --kv 2>$null
$env:PGURL = ($kv | Where-Object { $_ -like 'DATABASE_PUBLIC_URL=*' }) -replace '^DATABASE_PUBLIC_URL=',''
$d = Get-Date -Format yyyy-MM-dd
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" --dbname=$env:PGURL -Fc --no-owner --no-privileges `
  --exclude-table-data='users' --exclude-table-data='sessions' --exclude-table-data='login_links' `
  --exclude-table-data='login_codes' --exclude-table-data='api_tokens' --exclude-table-data='oauth_*' `
  --exclude-table-data='page_views' --exclude-table-data='mcp_events' --exclude-table-data='collections' `
  --exclude-table-data='highlights' --exclude-table-data='library_*' --exclude-table-data='user_*' `
  --exclude-table-data='admin_*' `
  -f "db-backup\hadith-public-$d.dump"
Remove-Item Env:PGURL
```

When a new table holding readers' or admin data is added to the site, add it to this list **before** the
next dump.

## 2. Check that nothing private is in it

Neither command should print anything except the counts on the last line:

```bash
f=db-backup/hadith-public-YYYY-MM-DD.dump
pg_restore --list "$f" | grep "TABLE DATA" | grep -E " public (users|sessions|login_links|login_codes|api_tokens|oauth_[a-z_]*|page_views|mcp_events|collections|highlights|library_[a-z_]*|user_[a-z_]*|admin_[a-z_]*) "
echo "tables: $(pg_restore --list "$f" | grep -c ' TABLE public ')  with data: $(pg_restore --list "$f" | grep -c 'TABLE DATA')"
sha256sum "$f"
```

Keep the SHA-256 for the README.

## 3. Build the offline edition

From the dump (about an hour and 25 GB free), as in [scripts/offline/README.md](../scripts/offline/README.md):

```
python3 scripts/offline/pgdump_to_sql.py db-backup/hadith-public-YYYY-MM-DD.dump out/sql
node scripts/offline/build-pglite-db.mjs out/sql out/pgdata
node scripts/offline/build-query-cache.mjs out/pgdata
node scripts/offline/pack-pglite.mjs out/pgdata out/offline-db YYYY-MM-DD
```

`out/offline-db` then holds `aljami-pg-YYYY-MM-DD.partNNN.gz` (about 25 MB each) and `manifest.json`. The
date is the edition's version: installed apps compare it with theirs and offer the update.

If the edition needs a site change (a new index, a new table the pages query), deploy that change first
and publish the edition with it — the site and the edition must match.

## 4. Upload to Cloudflare

```bash
python scripts/r2-upload.py out/offline-db offline/
python scripts/r2-upload.py db-backup/hadith-public-YYYY-MM-DD.dump db/hadith-public-YYYY-MM-DD.dump
```

The folder upload sends the chunks first and `manifest.json` **last**, because the manifest is what tells
apps a new edition exists — a manifest uploaded before its chunks would send apps after files that are
not there yet. Each file's size is checked after upload; the script stops on a mismatch. Chunks are cached
for a year (a chunk's name carries its edition, so it never changes) and the manifest is never cached, so
apps see a new edition at once.

`npx wrangler r2 object put hadith-files/<key> --file <file> --remote` works too for single files, but
stops at 300 MiB, so it cannot upload the dump.

## 5. GitHub fallback (keep it current)

The site's proxy serves the GitHub release `offline-pg` if `NEXT_PUBLIC_OFFLINE_DATA_URL` is ever unset.
Keep exactly one edition there — the same one as on R2:

```bash
gh release upload offline-pg out/offline-db/*.gz --repo Manny8777/Hadith
gh release upload offline-pg out/offline-db/manifest.json --clobber --repo Manny8777/Hadith
# then delete the previous edition's chunks:
gh release view offline-pg --repo Manny8777/Hadith --json assets --jq '.assets[].name' \
  | grep -- '-pg-OLD-DATE\.part' | xargs -I{} gh release delete-asset offline-pg {} --yes --repo Manny8777/Hadith
```

GitHub release files are limited to 2 GB each, so the dump does not go there.

## 6. Verify

```bash
curl -s https://files.hadith.dev/offline/manifest.json | head -c 60        # the new version
curl -sI -H "Origin: https://hadith.dev" https://files.hadith.dev/offline/manifest.json \
  | grep -i -E "^(HTTP|access-control-allow-origin|cache-control)"          # 200, https://hadith.dev, no-cache
curl -s https://hadith.dev/api/offline/files/manifest.json | head -c 60    # fallback: same version
curl -sL https://files.hadith.dev/db/hadith-public-YYYY-MM-DD.dump | sha256sum   # equals step 2
```

Then open https://hadith.dev/offline in an installed app: it should offer the new edition and, in the
browser's network panel, download the chunks from `files.hadith.dev`.

## 7. Update the README and tidy up

- In `README.md` (Arabic and English sections, «تحميل قاعدة البيانات» / *Download the database*), change
  the dump's file name, link, size and SHA-256. Commit on a branch and merge it.
- Delete the previous dump and edition from R2 once the new one is verified (Cloudflare → R2 →
  hadith-files, or `npx wrangler r2 object delete hadith-files/<key> --remote`). Keep only the current
  ones, so nobody downloads an outdated copy by mistake.
- Delete the local `out/` folders when you no longer need them (about 20 GB per edition).

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| Apps still download through `/api/offline/files/` | The build did not get `NEXT_PUBLIC_OFFLINE_DATA_URL`: check the `ARG` in `Dockerfile` and `railway variables --service hadith-web --kv`, then redeploy. |
| Browser console: CORS error from files.hadith.dev | The page's origin is missing from the bucket's CORS policy (`npx wrangler r2 bucket cors list hadith-files`). |
| `files.hadith.dev` does not answer | `npx wrangler r2 bucket domain list hadith-files` should show it enabled and active; it needs the Cloudflare zone to be active. |
| The site or email stops working after a DNS change | Compare Cloudflare's records with Railway's list; every record must stay DNS only. Railway → *Reset to Railway* restores Railway's DNS. |
| `r2-upload.py` fails with an access error | The token expired or was revoked: create a new one (see *Upload credentials*) and update `.env.r2`. |
