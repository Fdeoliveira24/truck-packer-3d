/**
 * @file request-account-deletion.js
 * @description request-account-deletion Edge Function for Supabase to mark user accounts for deletion after 30 days.Used in Supabase Edge Functions.
 * @updated 01/30/2026
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('URL') || '';
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, {
      error: 'Missing env vars',
      details: {
        hasURL: !!SUPABASE_URL,
        hasAnon: !!SUPABASE_ANON_KEY,
        hasService: !!SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Unauthorized' });
  }

  const token = authHeader.slice(7).trim();

  const { data: userRes, error: userErr } = await anonClient.auth.getUser(token);
  const user = userRes?.user;

  if (userErr || !user) {
    return json(401, { error: 'Invalid token', details: userErr?.message || null });
  }

  const userId = user.id;
  const nowIso = new Date().toISOString();
  const purgeAfterIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1) Ban user for 30 days
  const { error: banErr } = await serviceClient.auth.admin.updateUserById(userId, {
    ban_duration: '720h',
  });
  if (banErr) return json(500, { error: 'Failed to ban user', details: banErr.message });

  // 2) Remove org membership rows (skip if table not present yet)
  try {
    const memDel = await serviceClient.from('organization_members').delete().eq('user_id', userId);

    // If your table is named differently, you can change it later.
    // If the table doesn't exist, PostgREST returns an error; we ignore it here.
    if (memDel?.error) {
      const msg = String(memDel.error.message || '');
      const code = String(memDel.error.code || '');
      const isMissingTable = code === '42P01' || msg.toLowerCase().includes('does not exist');
      if (!isMissingTable) {
        return json(500, { error: 'Failed to remove memberships', details: memDel.error.message });
      }
    }
  } catch (_) {
    // ignore
  }

  // 3) Mark profile for deletion
  const { error: profErr } = await serviceClient.from('profiles').upsert(
    {
      id: userId,
      deletion_status: 'requested',
      deleted_at: nowIso,
      purge_after: purgeAfterIso,
    },
    { onConflict: 'id' }
  );

  if (profErr) return json(500, { error: 'Failed to update profile', details: profErr.message });

  // 4) Try to revoke sessions (best effort)
  try {
    // Some SDK versions differ; keep it best-effort
    // @ts-ignore
    await serviceClient.auth.admin.signOut(token, 'global');
  } catch (_) {}

  return json(200, { success: true, purge_after: purgeAfterIso });
});
