/**
 * @file purge-deleted-users.js
 * @description purge-deleted-users Edge Function for Supabase to permanently delete user accounts marked for deletion. Used in Supabase Edge Functions.
 * @updated 01/30/2026
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_KEY = Deno.env.get('CRON_KEY') || '';

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { 'x-client-info': 'truck-packer-3d' } },
});

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const cronKeyHeader = req.headers.get('x-cron-key') || '';
  if (!cronKeyHeader || cronKeyHeader !== CRON_KEY)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // select profiles to purge
  const { data: profiles, error: selectErr } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('deletion_status', 'requested')
    .lte('purge_after', new Date().toISOString());
  if (selectErr)
    return new Response(JSON.stringify({ error: 'Failed to select profiles', details: selectErr.message }), {
      status: 500,
    });

  const results = [];

  for (const p of profiles || []) {
    try {
      // delete organization memberships
      const delMem = await serviceClient.from('organization_memberships').delete().eq('user_id', p.id);
      if (delMem.error) results.push({ user_id: p.id, error: 'failed_delete_members', details: delMem.error.message });

      // delete profile
      const delProf = await serviceClient.from('profiles').delete().eq('id', p.id);
      if (delProf.error)
        results.push({ user_id: p.id, error: 'failed_delete_profile', details: delProf.error.message });

      // delete auth user
      const delAuth = await serviceClient.auth.admin.deleteUser(p.id);
      if (delAuth.error) results.push({ user_id: p.id, error: 'failed_delete_auth', details: delAuth.error.message });

      results.push({ user_id: p.id, success: true });
    } catch (e) {
      results.push({ user_id: p.id, error: 'exception', details: e.message });
    }
  }

  return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
