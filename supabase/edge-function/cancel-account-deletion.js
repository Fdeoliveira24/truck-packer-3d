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

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const token = authHeader.slice(7).trim();

  const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
  const user = userRes?.user;
  if (userErr || !user) return json(401, { error: "Invalid token" });

  const userId = user.id;

  // Unban
  const { error: unbanErr } = await serviceClient.auth.admin.updateUserById(userId, {
    ban_duration: "0s",
  });
  if (unbanErr) return json(500, { error: "Failed to unban user", details: unbanErr.message });

  // Clear deletion flags
  const { error: profErr } = await serviceClient
    .from("profiles")
    .update({ deletion_status: "canceled", deleted_at: null, purge_after: null })
    .eq("id", userId);

  if (profErr) return json(500, { error: "Failed to update profile", details: profErr.message });

  return json(200, { success: true });
});