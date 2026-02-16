// supabase/functions/_shared/auth.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

function getEnv(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    return null;
  }
}

function envOrThrow(primary: string, fallback?: string): string {
  const v =
    getEnv(primary) ||
    (fallback ? getEnv(fallback) : null);

  if (!v) throw new Error(`Missing env var: ${primary}${fallback ? ` (or ${fallback})` : ""}`);
  return v;
}

function logEnvPresence(context: string) {
  const debug =
    getEnv("SUPABASE_DEBUG") === "1" ||
    getEnv("SUPABASE_DEBUG_AUTH") === "1";

  if (!debug) return;

  const names = [
    "SUPABASE_URL",
    "URL",
    "SUPABASE_ANON_KEY",
    "ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  ];

  const present = names.filter(n => getEnv(n));
  console.log(`[auth-debug:${context}] present envs: ${present.join(", ")}`);
}

export function getSupabaseUrl(): string {
  // Supabase provides SUPABASE_URL by default in Functions
  // But we also accept URL because you set it as a secret.
  logEnvPresence("getSupabaseUrl");
  return envOrThrow("SUPABASE_URL", "URL");
}

export function getAnonKey(): string {
  // Supabase provides SUPABASE_ANON_KEY by default in Functions
  // But we also accept ANON_KEY because you set it as a secret.
  logEnvPresence("getAnonKey");
  return envOrThrow("SUPABASE_ANON_KEY", "ANON_KEY");
}

export function getServiceRoleKey(): string {
  // Supabase provides SUPABASE_SERVICE_ROLE_KEY by default in Functions
  // But we also accept SERVICE_ROLE_KEY because you set it as a secret.
  logEnvPresence("getServiceRoleKey");
  return envOrThrow("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");
}

export function extractBearerToken(req: Request): string | null {
  const userJwt = req.headers.get("x-user-jwt");
  if (userJwt && userJwt.trim()) return userJwt.trim();
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;

  // Support:
  // - "Bearer <token>"
  // - "<token>"
  const trimmed = h.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("bearer ")) {
    const t = trimmed.slice(7).trim();
    return t || null;
  }
  return trimmed;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getSupabaseUrlFromJwt(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  const iss = payload && typeof payload.iss === "string" ? String(payload.iss) : "";
  if (!iss) return null;
  return iss.replace(/\/auth\/v1\/?$/, "");
}

export function userClientFromRequest(req: Request) {
  const jwt = extractBearerToken(req);
  const url = (jwt && getSupabaseUrlFromJwt(jwt)) || getSupabaseUrl();
  const anon = getAnonKey();

  if (getEnv("SUPABASE_DEBUG") === "1") {
    console.log("[auth] using supabase url:", url);
  }

  // IMPORTANT:
  // - supabase.auth.getUser(jwt) expects ONLY the raw JWT
  // - NOT "Bearer <jwt>"
  if (!jwt) return { supabase: null, jwt: null };

  const supabase = createClient(url, anon, {
    auth: { persistSession: false },
    global: {
      headers: {
        // This header is used for PostgREST calls if you do them with the user client
        Authorization: `Bearer ${jwt}`,
      },
    },
  });

  return { supabase, jwt };
}

export async function requireUser(req: Request) {
  logEnvPresence("requireUser");
  const { supabase, jwt } = userClientFromRequest(req);
  if (!supabase || !jwt) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header",
      user: null,
      jwt: null,
    };
  }

  const { data, error } = await supabase.auth.getUser(jwt);

  if (error || !data?.user) {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid JWT",
      user: null,
      jwt: null,
    };
  }

  return {
    ok: true as const,
    status: 200,
    error: null,
    user: data.user,
    jwt,
  };
}

export function serviceClient() {
  const url = getSupabaseUrl();
  const service = getServiceRoleKey();

  return createClient(url, service, {
    auth: { persistSession: false },
  });
}
