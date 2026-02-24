import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin) return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401, origin });
    }

    const sb = serviceClient();
    const userId = String(auth.user.id || "");
    if (!userId) return json({ error: "Missing user id" }, { status: 401, origin });

    const nowIso = new Date().toISOString();
    const purgeAfterIso = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

    const { error: profileErr } = await sb
      .from("profiles")
      .upsert({
        id: userId,
        deletion_status: "requested",
        deleted_at: nowIso,
        purge_after: purgeAfterIso,
        updated_at: nowIso,
      }, { onConflict: "id" });

    if (profileErr) {
      console.error("request-account-deletion: profile upsert failed", profileErr);
      return json({ error: "Failed to set deletion status" }, { status: 500, origin });
    }

    // Best effort cleanup: table may not exist in every environment.
    try {
      const { error: memErr } = await sb
        .from("organization_members")
        .delete()
        .eq("user_id", userId);
      if (memErr && memErr.code !== "42P01") {
        console.warn("request-account-deletion: membership cleanup warning", memErr);
      }
    } catch (err) {
      console.warn("request-account-deletion: membership cleanup exception", err);
    }

    // Best effort login block while deletion is pending.
    try {
      const { error: banErr } = await sb.auth.admin.updateUserById(userId, {
        ban_duration: "720h",
      });
      if (banErr) console.warn("request-account-deletion: ban warning", banErr);
    } catch (err) {
      console.warn("request-account-deletion: ban exception", err);
    }

    return json({
      ok: true,
      deletion_status: "requested",
      requested_at: nowIso,
      purge_after: purgeAfterIso,
    }, { status: 200, origin });
  } catch (e) {
    const message = (e as Error)?.message || String(e);
    console.error("request-account-deletion fatal:", e);
    return json({ error: message }, { status: 500, origin });
  }
});
