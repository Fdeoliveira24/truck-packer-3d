# Billing Status Curl Test

Use real keys for the yduzbvijzwczjapanxbd project. Do not paste service keys in browser code.

```sh
# 1) Paste your anon public key and a valid access_token
export ANON="<anon_public_key>"
export TOKEN="<access_token_from_supabase_auth>"

# 2) Verify the token directly with Auth (expects HTTP/2 200)
curl -sS -D - \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${TOKEN}" \
  "https://yduzbvijzwczjapanxbd.supabase.co/auth/v1/user" \
  | head -n 20

# 3) Call the billing-status function (expects HTTP/2 200 and ok: true)
curl -sS -D - \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Origin: http://127.0.0.1:5500" \
  "https://yduzbvijzwczjapanxbd.functions.supabase.co/billing-status" \
  -o /tmp/billing.json

cat /tmp/billing.json
```

Expected success body:
```
{"ok":true,"userId":"<uuid>","data":{"subscription":null,"isActive":false}}
```

If Auth returns 401, mint a fresh access_token using supabase-js signInWithPassword for this project.
If billing-status returns 403 with "Origin not allowed", add the origin to ALLOWED_ORIGINS or use the dev origins above.
