"""Upload to the R2 bucket behind files.hadith.dev (Cloudflare), in parts — any file size (wrangler stops at
300 MiB per file). See docs/publishing.md.

Credentials come from the environment (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY — GitHub Actions secrets), else from
.env.r2 at the repo root (git-ignored); never printed:
  R2_ACCESS_KEY_ID=…
  R2_SECRET_ACCESS_KEY=…
(an R2 account API token with Object Read & Write on hadith-files only).

  python scripts/r2-upload.py <file> <key>
      one file, e.g.  db-backup/hadith-public-2026-11-19.dump  db/hadith-public-2026-11-19.dump
  python scripts/r2-upload.py <folder> <prefix>/
      every file in the folder under the prefix, e.g.  out/offline-db  offline/
      — an offline edition: chunks first, manifest.json last (the manifest tells apps a new edition exists);
      — desktop installers (out/desktop → desktop/): installers first, latest*.yml and latest.json last.

Content types and caching are set from the name: *.gz → application/gzip, cached for a year (the edition's date
is in the name, so a chunk never changes); manifest.json → no-cache; *.dump → octet-stream, a day.
Every upload's size is checked against the local file afterwards. Needs boto3 (pip install boto3).
"""
import os, re, sys
import boto3
from boto3.s3.transfer import TransferConfig

ACCOUNT = "39dab0dc448bb89849cc790b61513134"
BUCKET = "hadith-files"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {k: os.environ[k] for k in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if os.environ.get(k)}  # CI secrets
if len(env) < 2:
    for line in open(os.path.join(root, ".env.r2"), encoding="utf-8"):
        m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            env[m.group(1)] = m.group(2).strip("\"'")

s3 = boto3.client("s3", endpoint_url=f"https://{ACCOUNT}.r2.cloudflarestorage.com",
                  aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
                  region_name="auto")
CONFIG = TransferConfig(multipart_threshold=64 * 1024**2, multipart_chunksize=64 * 1024**2, max_concurrency=4)


LAST = re.compile(r"^(manifest\.json|latest(-mac|-linux)?\.yml|latest\.json)$")   # what tells clients a new version exists


def headers(name):
    if LAST.match(name):
        return ("application/json; charset=utf-8" if name.endswith(".json") else "text/yaml; charset=utf-8"), "no-cache"
    if name.endswith(".apk"):
        return "application/vnd.android.package-archive", "public, max-age=31536000, immutable"
    if re.search(r"\.(exe|dmg|zip|AppImage|deb|blockmap)$", name):
        return "application/octet-stream", "public, max-age=31536000, immutable"   # the version is in the name
    if name.endswith(".gz"):
        return "application/gzip", "public, max-age=31536000, immutable"
    if name.endswith(".json"):
        return "application/json; charset=utf-8", "public, max-age=3600"
    return "application/octet-stream", "public, max-age=86400"


def upload(src, key, show_progress):
    size = os.path.getsize(src)
    ctype, cache = headers(os.path.basename(src))
    state = {"done": 0, "last": -1}

    def progress(n):
        state["done"] += n
        pct = state["done"] * 100 // max(size, 1)
        if show_progress and pct % 10 == 0 and pct != state["last"]:
            state["last"] = pct
            print(f"  {pct}%", flush=True)

    s3.upload_file(src, BUCKET, key, ExtraArgs={"ContentType": ctype, "CacheControl": cache}, Config=CONFIG,
                   Callback=progress)
    remote = s3.head_object(Bucket=BUCKET, Key=key)["ContentLength"]
    if remote != size:
        sys.exit(f"SIZE MISMATCH {key}: uploaded {remote:,}, local {size:,}")
    print(f"ok {key} ({size:,} bytes)", flush=True)


src, key = sys.argv[1], sys.argv[2]
if os.path.isdir(src):
    prefix = key.rstrip("/") + "/"
    names = sorted(n for n in os.listdir(src) if os.path.isfile(os.path.join(src, n)))
    names.sort(key=lambda n: bool(LAST.match(n)))  # manifest / latest*.yml / latest.json last
    for n in names:
        upload(os.path.join(src, n), prefix + n, False)
    print(f"uploaded {len(names)} files to {prefix}")
else:
    upload(src, key, True)
