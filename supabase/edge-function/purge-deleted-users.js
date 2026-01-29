import { createClient } from 'npm:@supabase/supabase-js@2'

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // Simple shared secret check for cron calls
  const cronKey = Deno.env.get('CRON_KEY') ?? ''
  const gotKey = req.headers.get('x-cron-key') ?? ''
  if (!cronKey || gotKey !== cronKey) return json(401, { error: 'Unauthorized' })

  const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('URL') ?? ''
  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

  if (!url || !serviceRoleKey) return json(500, { error: 'Missing required secrets' })

  const supabaseAdmin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

  // Find users ready to purge
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('profiles')
    .select('id, avatar_url, purge_after, deletion_status')
    .eq('deletion_status', 'requested')
    .not('purge_after', 'is', null)
    .lte('purge_after', new Date().toISOString())
    .limit(200)

  if (qErr) return json(500, { error: 'Query failed', details: qErr.message })

  const results: any[] = []
  for (const r of rows ?? []) {
    const userId = r.id

    // 1) Remove memberships (adjust table name if needed)
    await supabaseAdmin.from('organization_memberships').delete().eq('user_id', userId)

    // 2) Delete profile row
    await supabaseAdmin.from('profiles').delete().eq('id', userId)

    // 3) Delete auth user (this is the true “hard delete”)
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    results.push({ userId, deleted: !delErr, error: delErr?.message ?? null })
  }

  return json(200, { ok: true, purged: results.length, results })
})