import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuthedUser = { id: string; email: string | null };

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function requireUser(req: Request): Promise<{ user: AuthedUser; token: string }> {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error("Missing Authorization Bearer token");
    (err as any).status = 401;
    throw err;
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    const err = new Error("Server missing SUPABASE_URL or SUPABASE_ANON_KEY");
    (err as any).status = 500;
    throw err;
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error("Invalid or expired session");
    (err as any).status = 401;
    throw err;
  }

  return { token, user: { id: data.user.id, email: data.user.email ?? null } };
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new Error("Missing service env vars");

  return createClient(url, service, { auth: { persistSession: false } });
}
