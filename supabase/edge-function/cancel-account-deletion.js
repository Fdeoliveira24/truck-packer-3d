 /**
 * @file cancel-account-deletion.js
 * @description cancel-account-deletion Edge Function for Supabase to cancel user account deletion requests. Used in Supabase Edge Functions. 
 * @updated 01/30/2026
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("URL") || "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
  const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, {
      error: "Missing env vars",
      details: {
        hasURL: !!SUPABASE_URL,
        hasAnon: !!SUPABASE_ANON_KEY,
        hasService: !!SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";

  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

  const token = authHeader.slice(7).trim();

  const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
  const user = userRes?.user;
  if (userErr || !user) return json(401, { error: "Invalid token", details: userErr?.message || null });

  const userId = user.id;

  const { error: unbanErr } = await serviceClient.auth.admin.updateUserById(userId, {
    ban_duration: "0s",
  });
  if (unbanErr) return json(500, { error: "Failed to unban user", details: unbanErr.message });

  const { error: profErr } = await serviceClient
    .from("profiles")
    .update({ deletion_status: "canceled", deleted_at: null, purge_after: null })
    .eq("id", userId);

  if (profErr) return json(500, { error: "Failed to update profile", details: profErr.message });

  return json(200, { success: true });
});