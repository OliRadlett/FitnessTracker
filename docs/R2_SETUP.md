# R2 Video Storage Setup (§1.1 strength videos)

Keeping lifting videos in **Cloudflare R2** (S3-compatible object storage).
Uploads go browser → R2 via a presigned PUT; playback streams via a presigned
GET. Everything is implemented server-side (`app/integrations/r2.py`) and
frontend-side (`LiftVideoForm` / `VideoEmbed`), so this page is
only about **creating your Cloudflare resources and turning the feature on.**

> Without these steps the upload endpoints return **501** and video uploads
> are unavailable. Nothing here costs money for a
> personal library — see [cost](#cost) below.

---

## 1. Create a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and register.
2. **Add a payment method.** R2's free tier is permanently free, but Cloudflare
   requires a payment method on file before you can create a bucket (you will
   **not** be charged while you stay inside the free tier — see
   [cost](#cost)).

## 2. Create an R2 bucket

1. In the dashboard, click **R2** in the left sidebar.
2. **Create bucket** → name it (suggest `fittrack-videos`) → **Create bucket**.
   - Any location hint is fine (data placement is global; the S3 endpoint is
     region-less).
3. Note the bucket name — it becomes `R2_BUCKET`.

## 3. Create an R2 API token

1. Inside **R2**, open **Manage R2 API Tokens** (via the R2 overview).
2. **Create API Token** → permissions **Object Read & Write**.
3. Scope it to **your bucket only** (`fittrack-videos`) — least privilege.
4. Save the generated **Access Key ID** and **Secret Access Key** now; the
   secret is shown only once. These become `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY`.

Find your **Account ID** (becomes `R2_ACCOUNT_ID`) on the R2 overview page —
short alphanumeric id, in the top-right account area.

## 4. Set the env vars

Add these to **both** `.env` (local dev) and the Droplet's `.env`
(`~/docker/fittrack/.env`), then restart:

```dotenv
R2_ACCOUNT_ID=your_account_id_16_chars
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=fittrack-videos
```

Local:

```bash
python fittrack.py up          # restart backend with new env
```

Production (after updating the Droplet `.env`):

```bash
python fittrack.py --prod up   # via SSH — full redeploy with the new env
```

## 5. Apply the bucket CORS rule

R2 has **no CORS UI** — the browser presigned PUT/GET won't work until the
bucket has a CORS rule. Apply it with the included one-off (idempotent):

```bash
python fittrack.py up
python fittrack.py exec backend python -m app.scripts.r2_bootstrap
# → "R2 bucket CORS rule applied."
```

The rule allows `PUT`/`GET`/`HEAD` from the app origins
(`https://oliradlett.co.uk`, dev + localhost). Re-run it if you change domains.

## 6. Verify

1. Backend log should be clean; uploads no longer 501:
   ```bash
   python fittrack.py logs backend --tail 20
   ```
2. In the app: **Lifting → Video Bank → Add Video → Upload video.** Pick a
   file (<250 MB, mp4/quicktime/webm). You should see the progress bar fill,
   then the video appear and play back.
3. If the PUT fails with a CORS error, re-check step 5. If it fails with
   `SignatureDoesNotMatch`, re-check the token was created with Object
   **Read & Write** and the `R2_` values have no trailing spaces.

## Cost

| Item | Free tier (monthly, recurring) | Paid |
|------|-------------------------------|------|
| Storage | 10 GB-month | $0.015 / GB-month |
| Writes (Class A) | 1M | $4.50 / M |
| Reads (Class B) | 10M | $0.36 / M |
| Egress | **$0** (always) | — |

At 250 MB max per file the free tier holds ~40 videos. Below that you pay
nothing; billing is rounded up to the next GB-month.

## Retention & deletion

- Objects are stored **indefinitely** — no TTL/lifecycle is configured. The
  1-hour expiry applies only to the presigned URLs, not the files.
- Deleting a video in the Video Bank removes the DB row **and** deletes its
  R2 object (best-effort; a failed object delete is logged, the row is still
  removed). If you ever want automatic expiry, add a bucket lifecycle rule
  deleting objects older than N days via the S3 API (`put_bucket_lifecycle`).
- To check current bucket usage: Cloudflare dashboard → **R2** → bucket →
  Usage (storage/class A/class B for the month).

## How it works (code map)

| Piece | File |
|-------|------|
| Presigned PUT/GET + delete + CORS helpers | `backend/app/integrations/r2.py` |
| Upload URL, create row, stream URL, delete endpoints | `backend/app/api/videos.py` |
| CORS bootstrap command | `backend/app/scripts/r2_bootstrap.py` |
| Browser PUT with progress bar | `frontend/src/components/lifting/LiftVideoForm.tsx` |
| Playback (R2 `<video>`) | `frontend/src/components/lifting/VideoEmbed.tsx` |
| Config fields | `backend/app/config.py` (`r2_*`) |