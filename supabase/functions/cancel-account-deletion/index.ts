import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseOriginFor(req: Request): { allowed: boolean; origin: string | null } {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return { allowed: false, origin: null };
  return { allowed: true, origin: allowedOrigin === "*" ? null : allowedOrigin };
}

function getExpectedSecret(): string {
  try {
    return String(Deno.env.get("ACCOUNT_DELETION_SUPPORT_SECRET") || "").trim();
  } catch {
    return "";
  }
}

function getRequestSecret(req: Request): string {
  const direct = String(req.headers.get("x-cancel-secret") || "").trim();
  if (direct) return direct;

  const authorization = String(req.headers.get("authorization") || req.headers.get("Authorization") || "").trim();
  if (!authorization) return "";

  const lower = authorization.toLowerCase();
  return lower.startsWith("bearer ") ? authorization.slice(7).trim() : authorization;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function liftAccountBan(sb: ReturnType<typeof serviceClient>, userId: string): Promise<unknown | null> {
  const { error: banErr } = await sb.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  return banErr || null;
}

Deno.serve(async (req) => {
  const { allowed, origin } = responseOriginFor(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (!allowed) return json({ error: "Origin not allowed" }, { status: 403, origin: null });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });

    const expectedSecret = getExpectedSecret();
    if (!expectedSecret) {
      console.error("cancel-account-deletion: support secret is not configured");
      return json({ error: "Support cancellation is not configured" }, { status: 500, origin });
    }

    if (getRequestSecret(req) !== expectedSecret) {
      return json({ error: "Unauthorized" }, { status: 401, origin });
    }

    const body = await readBody(req);
    const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
    if (!UUID_RE.test(userId)) {
      return json({ error: "Invalid user_id" }, { status: 400, origin });
    }

    const sb = serviceClient();

    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("id, deletion_status, deleted_at, purge_after")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) {
      console.error("cancel-account-deletion: profile lookup failed", profileErr);
      return json({ error: "Failed to load account deletion status" }, { status: 500, origin });
    }

    if (!profile?.id) {
      return json({ error: "Profile not found" }, { status: 404, origin });
    }

    if (profile.deletion_status !== "requested") {
      const banLiftErr = await liftAccountBan(sb, userId);
      if (banLiftErr) {
        console.error("cancel-account-deletion: idempotent ban lift failed", banLiftErr);
        return json({ error: "Account deletion was already canceled, but the account ban could not be lifted" }, {
          status: 500,
          origin,
        });
      }

      return json({ ok: true, already_canceled: true, user_id: userId }, { status: 200, origin });
    }

    const { error: updateErr } = await sb
      .from("profiles")
      .update({
        deletion_status: "canceled",
        deleted_at: null,
        purge_after: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateErr) {
      console.error("cancel-account-deletion: profile update failed", updateErr);
      return json({ error: "Failed to cancel account deletion" }, { status: 500, origin });
    }

    const banLiftErr = await liftAccountBan(sb, userId);
    if (banLiftErr) {
      console.error("cancel-account-deletion: ban lift failed", banLiftErr);
      return json({ error: "Account deletion was canceled, but the account ban could not be lifted" }, {
        status: 500,
        origin,
      });
    }

    return json({
      ok: true,
      user_id: userId,
      deletion_status: "canceled",
    }, { status: 200, origin });
  } catch (err) {
    console.error("cancel-account-deletion fatal:", err);
    return json({ error: "Failed to cancel account deletion" }, { status: 500, origin });
  }
});
