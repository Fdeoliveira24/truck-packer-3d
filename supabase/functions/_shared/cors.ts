export const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
});

export function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!origin) return null;
  if (allowed.length === 0) return origin; // dev fallback
  return allowed.includes(origin) ? origin : null;
}

export function json(
  data: unknown,
  init: ResponseInit & { origin?: string | null } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  const origin = init.origin ?? null;
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}
