import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { "x-client-info": "truck-packer-3d" } },
});

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { "x-client-info": "truck-packer-3d" } },
});

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const token = authHeader.slice(7).trim();

  // Validate token -> user
  const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
  const user = userRes?.user;
  if (userErr || !user) return json(401, { error: "Invalid token" });

  const userId = user.id;
  const nowIso = new Date().toISOString();
  const purgeAfterIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1) Ban user for 30 days (blocks new login / refresh)
  const { error: banErr } = await serviceClient.auth.admin.updateUserById(userId, {
    ban_duration: "720h",
  });
  if (banErr) return json(500, { error: "Failed to ban user", details: banErr.message });

  // 2) Remove memberships (keep org intact)
  const { error: memErr } = await serviceClient
    .from("organization_memberships")
    .delete()
    .eq("user_id", userId);
  if (memErr) return json(500, { error: "Failed to remove memberships", details: memErr.message });

  // 3) Mark profile for deletion + purge date
  const { error: profErr } = await serviceClient
    .from("profiles")
    .upsert(
      {
        id: userId,
        deletion_status: "requested",
        deleted_at: nowIso,
        purge_after: purgeAfterIso,
      },
      { onConflict: "id" },
    );
  if (profErr) return json(500, { error: "Failed to update profile", details: profErr.message });

  // 4) Revoke sessions (so other browsers fall out on next auth refresh)
  // Note: admin signOut uses the user's JWT + scope.
  // If this throws (older SDK), keep the try/catch.
  try {
    // @ts-ignore
    await serviceClient.auth.admin.signOut(token, "global");
  } catch (_) {
    // safe fallback: ban still blocks sign-in
  }

  return json(200, { success: true, purge_after: purgeAfterIso });
});