# Android sign-in — Google, verified server-side

The app never holds a Google client secret, and the backend never trusts the
client's claim of identity. Three steps:

1. **Device** — Credential Manager (`GetGoogleIdOption`) shows the Google
   account picker and returns a **Google ID token** (a JWT signed by Google).
2. **Backend** — `POST /api/v1/auth/mobile/google` verifies that token:
   RS256 signature against Google's JWKS, `aud`, `iss`, `exp`, and a verified
   email (`services/google_id.py`). It then applies the email allowlist and
   mints a FitTrack JWT (30 days, same as the web).
3. **App** — stores the JWT in Keystore-backed storage (`TokenStore`) and sends
   it as `Authorization: Bearer` on subsequent calls.

A forged token gets a 401. A valid token for an email outside `ALLOWED_EMAILS`
gets a 403. Sign-out revokes the JWT server-side (`/auth/logout`) as well as
clearing it locally.

## What you must create (Google Cloud Console)

Project → **APIs & Services → Credentials**.

### 1. Web application client (the audience)

If the project already has the web OAuth client used by NextAuth, reuse it: its
client ID is `GOOGLE_CLIENT_ID` on the backend. This ID is the *audience* the
backend verifies, and the `serverClientId` the app passes to Credential Manager.

Create one if missing: **Create credentials → OAuth client ID → Web application**.

### 2. Android client (attributes the app)

**Create credentials → OAuth client ID → Android**

| Field | Value |
|---|---|
| Package name | `uk.oli.fittrack` |
| SHA-1 | `AF:7C:80:CB:E1:F7:5D:AC:91:41:E5:8E:1A:71:B7:66:2D:A7:F2:AD` (this machine's debug keystore) |

The debug SHA-1 is specific to this machine's `~/.android/debug.keystore`. A
release build needs its own SHA-1 from the release keystore:

```
keytool -list -v -keystore <release.jks> -alias <alias>
```

Add **both** fingerprints to the same Android client if you ship both.

## Configuration

**App** — `android/local.properties` (gitignored):

```
googleWebClientId=<the WEB client id>.apps.googleusercontent.com
# apiBaseUrl=https://oliradlett.co.uk/api/v1
```

`API_BASE_URL` defaults to production; override with `apiBaseUrl` or
`-PapiBaseUrl=...` to point at a local backend.

**Backend** — `.env`:

```
GOOGLE_CLIENT_ID=<the WEB client id>          # already set for NextAuth
# GOOGLE_MOBILE_CLIENT_ID=...                 # only if the app should use a different audience
```

`GOOGLE_MOBILE_CLIENT_ID` is optional and falls back to `GOOGLE_CLIENT_ID`.
Until one of them is set the endpoint returns **503**, which is deliberate: an
unconfigured server must not accept any identity.

## Testing

Backend, without a device:

```
cd backend
python -m pytest tests/test_google_id_token.py -q
```

Eight cases: valid token, wrong audience, expired, wrong issuer, unknown key id,
unverified email, `alg: HS256`, and a token signed by a different key. They sign
real tokens with a generated RSA key and install a matching JWKS, so the jose
signature path is genuinely exercised.

On a device: build, open **You → Continue with Google**. Requires Google Play
Services. Common failures and what they mean:

| Symptom | Cause |
|---|---|
| `Sign-in is not configured in this build` | `googleWebClientId` empty in `local.properties`, or the build predates it |
| `No credentials available` / `28444` | No Google account on the device, or the Play Services version is too old |
| `10:` / `12500:` from Google | The Android client's package + SHA-1 do not match the build you installed |
| `401 Invalid Google sign-in token` | Backend audience ≠ the client ID the app used |
| `403 not allowed` | The Google account's email is not in `ALLOWED_EMAILS` |

## Not done yet

- No refresh token is stored: when the 30-day JWT expires the app will ask you
  to sign in again. Silent renewal is a follow-up.
- Sign-in currently grants nothing but the token — there is no sync yet. The
  gym flow is deliberately usable without signing in.
- The endpoint is rate-limited to 10 attempts/minute per client IP (fail-open on
  a Redis outage).
