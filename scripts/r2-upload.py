"""Upload a file to the R2 bucket behind files.hadith.dev, in parts (any size — wrangler stops at 300 MiB).

Credentials come from .env.r2 at the repo root (git-ignored): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY —
an R2 account token with Object Read & Write on hadith-files only. They are never printed.

  python scripts/r2-upload.py <local file> <key in the bucket> [content-type] [cache-control]
  e.g.  python scripts/r2-upload.py db-backup/hadith-public-2026-11-19.dump db/hadith-public-2026-11-19.dump

Needs boto3 (pip install boto3). Verifies the uploaded size afterwards.
"""
import os, re, sys
import boto3
from boto3.s3.transfer import TransferConfig

ACCOUNT = "39dab0dc448bb89849cc790b61513134"
BUCKET = "hadith-files"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
for line in open(os.path.join(root, ".env.r2"), encoding="utf-8"):
    m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
    if m:
        env[m.group(1)] = m.group(2).strip("\"'")
src, key = sys.argv[1], sys.argv[2]
ctype = sys.argv[3] if len(sys.argv) > 3 else "application/octet-stream"
cache = sys.argv[4] if len(sys.argv) > 4 else "public, max-age=86400"

s3 = boto3.client("s3", endpoint_url=f"https://{ACCOUNT}.r2.cloudflarestorage.com",
                  aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
                  region_name="auto")
size = os.path.getsize(src)
done = [0]
def progress(n):
    done[0] += n
    pct = done[0] * 100 // size
    if pct % 10 == 0 and pct != progress.last:
        progress.last = pct
        print(f"  {pct}%", flush=True)
progress.last = -1
s3.upload_file(src, BUCKET, key, ExtraArgs={"ContentType": ctype, "CacheControl": cache},
               Config=TransferConfig(multipart_threshold=64 * 1024**2, multipart_chunksize=64 * 1024**2, max_concurrency=4),
               Callback=progress)
remote = s3.head_object(Bucket=BUCKET, Key=key)["ContentLength"]
print(f"uploaded {key}: {remote:,} bytes (local {size:,}) {'OK' if remote == size else 'SIZE MISMATCH'}")
