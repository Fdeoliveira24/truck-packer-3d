# Truck Packer 3D — Supabase `billing-status` setup log (end-to-end)

Date: 2026-02-10  
Project ref: `yduzbvijzwczjapanxbd`

This file documents what we changed and how to test it from start to finish.

---

## 1) What the goal is

- A Supabase Edge Function named `billing-status`
- It must:
  - accept a user access token (`Authorization: Bearer <JWT>`)
  - validate the user with Supabase Auth
  - return a stable JSON payload like:

```json
{ "ok": true, "userId": "<uuid>", "data": { ... } }
```

- It must not crash on:
  - missing/invalid token
  - bad/missing user id
  - missing subscription data

---

## 2) Secrets and env var names

### 2.1) Supabase CLI restriction
`supabase secrets set` will skip env names starting with `SUPABASE_`.

So we set custom secret names and our code supports both:

- `URL` (fallback for `SUPABASE_URL`)
- `ANON_KEY` (fallback for `SUPABASE_ANON_KEY`)
- `SERVICE_ROLE_KEY` (fallback for `SUPABASE_SERVICE_ROLE_KEY`)

### 2.2) Set secrets
Run:

```bash
supabase secrets set \
  URL="https://yduzbvijzwczjapanxbd.supabase.co" \
  ANON_KEY="<anon_public_key>" \
  SERVICE_ROLE_KEY="<service_role_key>" \
  --project-ref yduzbvijzwczjapanxbd
```

Confirm:

```bash
supabase secrets list --project-ref yduzbvijzwczjapanxbd
```

---

## 3) Code changes summary

### 3.1) `_shared/auth.ts`
- Reads env safely in Edge Functions
- Uses `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` when present
- Falls back to `URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`
- Extracts a raw JWT from the `Authorization` header (supports `Bearer <token>`)

### 3.2) `_shared/cors.ts`
- Returns real origin strings (no `[object Request]`)
- Uses allow list from `ALLOWED_ORIGINS`
- Always allows dev origins:
  - `http://localhost:*`
  - `http://127.0.0.1:*`
- Correct preflight handling:
  - `OPTIONS` returns `204`
  - sets allowed headers + methods

### 3.3) `functions/billing-status/index.ts`
- Uses the new CORS helper
- Validates JWT and returns clean 401 errors when missing/invalid
- Validates `user.id` exists and looks like a UUID before using it
- Subscription lookup is guarded:
  - if the table/row is missing, still returns `ok: true` with minimal data
  - if a real DB error happens, returns a safe 500 response

---

## 4) Deploy

Deploy the function:

```bash
supabase functions deploy billing-status --project-ref yduzbvijzwczjapanxbd
```

Note: you may see `WARNING: Docker is not running`. Deploy can still work.

---

## 5) Get a valid access token for testing

### 5.1) In the browser console (app)
Find the stored session in `localStorage` and print the access token:

```js
const key = Object.keys(localStorage).find(k => k.includes("-auth-token"));
const parsed = JSON.parse(localStorage.getItem(key) || "{}");
console.log("access_token len:", parsed.access_token?.length);
console.log("segments:", (parsed.access_token || "").split(".").length);
console.log(parsed.access_token);
```

Expected:
- length around `900+`
- JWT segments = `3` (three parts separated by dots)

Copy the token.

---

## 6) Terminal test script (safe)

### 6.1) Put ANON in a tiny helper file
This avoids re-pasting the anon key every time.

```bash
cat > /tmp/supa-env.sh <<'SH'
export ANON='<anon_public_key_here>'
echo "ANON len: ${#ANON}"
echo "Now set TOKEN in this terminal: export TOKEN='...'"
SH

source /tmp/supa-env.sh
```

### 6.2) Paste the access token in the terminal
(Do not store the user JWT in a file.)

```bash
export TOKEN='<paste_access_token_here>'
echo "TOKEN len: ${#TOKEN}"
printf "%s" "$TOKEN" | awk -F. '{print "TOKEN segments:", NF}'
```

Expected:
- token segments: `3`

---

## 7) Validate Auth works (must be 200)

```bash
curl -sS -D - \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${TOKEN}" \
  "https://yduzbvijzwczjapanxbd.supabase.co/auth/v1/user" \
  | head -n 25
```

Expected:
- `HTTP/2 200`
- JSON with the user id + email

If you get `401`:
- your token is expired or not the full token (bad copy)

---

## 8) Validate the Edge Function (must be 200)

```bash
curl -sS -D - \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Origin: http://127.0.0.1:5500" \
  "https://yduzbvijzwczjapanxbd.functions.supabase.co/billing-status" \
  -o /tmp/billing.json && echo && cat /tmp/billing.json && echo
```

Expected:
- `HTTP/2 200`
- JSON like:

```json
{ "ok": true, "userId": "<uuid>", "data": { ... } }
```

---

## 9) Frontend test (fetch from the app)

Run in the browser console (after the app has `supabase` ready):

```js
const { data: { session } } = await supabase.auth.getSession();

const res = await fetch(
  "https://yduzbvijzwczjapanxbd.functions.supabase.co/billing-status",
  {
    headers: {
      apikey: "<anon_public_key_here>",
      Authorization: `Bearer ${session.access_token}`,
    },
  }
);

console.log(res.status, await res.json());
```

Expected:
- status `200`
- JSON payload with `ok: true`

---

## 10) Common issues and fixes

### A) `Invalid API key`
- Your `apikey` header is wrong or empty.
- Make sure `ANON` is set in the same terminal session.

### B) `Invalid JWT`
- Your token is expired or not copied fully.
- Re-copy from the browser console. Confirm 3 segments and length ~915.

### C) `No API key found in request`
- You forgot `-H "apikey: ${ANON}"` or `${ANON}` is empty.

### D) CORS problems in the browser
- Add your dev origin to `ALLOWED_ORIGINS` secret, or use `http://127.0.0.1:5500`.
- Make sure the CORS helper returns origin strings, not a Request object.

---

## 11) Current status

- Auth endpoint test is working (HTTP 200).
- `billing-status` function test is working (HTTP 200).
- Ready to proceed to UI wiring.
