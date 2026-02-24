// supabase/functions/_shared/cors.ts

function getEnv(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

const DEV_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, stripe-signature, x-user-jwt";
const ALLOW_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";

function parseAllowedOrigins() {
  const raw = getEnv("ALLOWED_ORIGINS");
  const list = raw
    ? raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  const allowWildcard = list.includes("*");

  const allowed = new Set<string>([...list, ...DEV_ORIGINS]);
  return { allowWildcard, allowed };
}

function getRequestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const trimmed = origin.trim();
  return trimmed || null;
}

export function getAllowedOrigin(req: Request): string | null {
  const origin = getRequestOrigin(req);
  const { allowWildcard, allowed } = parseAllowedOrigins();

  if (!origin) return "*"; // non-browser callers
  // Explicit wildcard can be used, but missing ALLOWED_ORIGINS should not mean allow-all.
  if (allowWildcard) return origin;
  return allowed.has(origin) ? origin : null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req);
  const allowOrigin = origin ?? "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/**
 * Convenience JSON response builder used by checkout/portal/webhook functions.
 * Usage: json({ ok: true }, { status: 200, origin })
 */
export function json(
  data: unknown,
  opts: { status?: number; origin?: string | null } = {},
): Response {
  const status = opts.status ?? 200;
  const allowOrigin = opts.origin ?? "*";
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowOrigin ?? "null",
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      "Vary": "Origin",
    },
  });
}

export function handleCors(req: Request): Response | null {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(req),
    });
  }

  if (origin === null) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { ...corsHeaders(req), "content-type": "application/json" },
    });
  }

  return null;
}
