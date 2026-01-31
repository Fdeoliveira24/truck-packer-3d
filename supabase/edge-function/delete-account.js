 /**
 * @file delete-account.js
 * @description delete-account Edge Function for Supabase to delete user accounts immediately. Used in Supabase Edge Functions. 
 * @updated 01/30/2026
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader =
      req.headers.get('authorization') ?? req.headers.get('Authorization')

    if (!authHeader) {
      return json(401, { error: 'Missing Authorization header' })
    }

    const jwt = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader.trim()

    // Prefer Supabase-provided defaults (recommended)
    const url =
      Deno.env.get('SUPABASE_URL') ??
      Deno.env.get('URL') ??
      ''

    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ??
      Deno.env.get('ANON_KEY') ??
      ''

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''

    if (!url || !anonKey || !serviceRoleKey) {
      return json(500, {
        error: 'Missing required secrets',
        details: {
          hasUrl: !!url,
          hasAnonKey: !!anonKey,
          hasServiceRoleKey: !!serviceRoleKey,
        },
      })
    }

    // User client (validate JWT)
    const supabaseUser = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    })

    const { data, error: userError } = await supabaseUser.auth.getUser()

    if (userError || !data?.user) {
      return json(401, {
        error: 'JWT validation failed',
        details: userError?.message ?? 'No user returned',
      })
    }

    // Admin client (delete auth user)
    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    })

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(
      data.user.id
    )

    if (deleteError) {
      return json(500, {
        error: 'Delete failed',
        details: deleteError.message,
      })
    }

    return json(200, { success: true, message: 'Account deleted' })
  } catch (err) {
    return json(500, { error: err?.message || String(err) })
  }
})