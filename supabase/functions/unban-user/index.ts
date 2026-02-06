import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = Deno.env.get('URL') ?? '';
    const anonKey = Deno.env.get('ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';

    if (!url || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing required secrets (URL, ANON_KEY, SERVICE_ROLE_KEY)' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Admin client (can unban users)
    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // User client (verifies JWT)
    const supabaseUser = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Unban user by setting ban_duration to null
    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      ban_duration: null,
    });

    if (unbanError) throw unbanError;

    return new Response(JSON.stringify({ success: true, message: 'User unbanned successfully' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
