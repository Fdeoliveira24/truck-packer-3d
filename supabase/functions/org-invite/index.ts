import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const VALID_ROLES = new Set(["admin", "member"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);

function normalizeRole(value: unknown): "admin" | "member" | null {
  const role = String(value || "member").trim().toLowerCase();
  if (!VALID_ROLES.has(role)) return null;
  return role as "admin" | "member";
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function createInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  bytes.forEach((b) => {
    raw += String.fromCharCode(b);
  });
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildInviteLink(origin: string | null, token: string): string | null {
  const base =
    (origin && origin !== "*" && origin !== "null" ? origin : null) ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("SUPABASE_SITE_URL") ||
    null;

  if (!base) return null;

  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/index.html";
    }
    url.searchParams.set("invite_token", token);
    return url.toString();
  } catch {
    return null;
  }
}

async function getActorRole(sb: ReturnType<typeof serviceClient>, orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ? String(data.role).toLowerCase() : null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const origin = getAllowedOrigin(req);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin || origin === "*") return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401, origin });
    }

    const body = await req.json().catch(() => ({}));
    const orgId = String(body.organization_id || body.org_id || "").trim();
    const email = normalizeEmail(body.email);
    const requestedRole = String(body.role || "member").trim().toLowerCase();
    const role = normalizeRole(requestedRole);

    if (Deno.env.get("SUPABASE_DEBUG") === "1") {
      console.log("org-invite request", {
        orgId,
        role: requestedRole,
        hasEmail: Boolean(email),
      });
    }

    if (!orgId) return json({ error: "Missing organization_id" }, { status: 400, origin });
    if (!email) return json({ error: "Missing email" }, { status: 400, origin });
    if (requestedRole === "owner") {
      return json(
        { error: "Owner invites are not allowed. Invite as Admin or Member, then promote in Members." },
        { status: 400, origin },
      );
    }
    if (!role) return json({ error: "Invalid role. Allowed roles: member, admin." }, { status: 400, origin });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid email address." }, { status: 400, origin });
    }

    const sb = serviceClient();
    const actorRole = await getActorRole(sb, orgId, auth.user.id);
    if (!actorRole || !MANAGER_ROLES.has(actorRole)) {
      return json({ error: "Only owners/admins can invite members." }, { status: 403, origin });
    }

    const token = createInviteToken();
    const nowIso = new Date().toISOString();

    const { data: pendingRows, error: pendingErr } = await sb
      .from("organization_invites")
      .select("id, email")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .limit(200);

    if (pendingErr) throw pendingErr;

    const existingPending = (Array.isArray(pendingRows) ? pendingRows : []).find(
      (row) => String(row?.email || "").trim().toLowerCase() === email,
    );

    const payload = {
      email,
      role,
      status: "pending",
      token,
      invited_by: auth.user.id,
      invited_at: nowIso,
      accepted_at: null,
      revoked_at: null,
    };

    let inviteRecord: Record<string, unknown> | null = null;

    if (existingPending?.id) {
      const { data, error } = await sb
        .from("organization_invites")
        .update(payload)
        .eq("id", String(existingPending.id))
        .select("id, organization_id, email, role, status, invited_by, invited_at, accepted_at, revoked_at")
        .single();
      if (error) throw error;
      inviteRecord = data as Record<string, unknown>;
    } else {
      const { data, error } = await sb
        .from("organization_invites")
        .insert({
          organization_id: orgId,
          ...payload,
        })
        .select("id, organization_id, email, role, status, invited_by, invited_at, accepted_at, revoked_at")
        .single();
      if (error) throw error;
      inviteRecord = data as Record<string, unknown>;
    }

    return json(
      {
        ok: true,
        invite: inviteRecord,
        token,
        invite_link: buildInviteLink(origin, token),
      },
      { status: 200, origin },
    );
  } catch (e) {
    const code = (e as any)?.code;
    if (code === "42P01") {
      return json(
        { error: "organization_invites table is missing. Run migrations first." },
        { status: 500, origin },
      );
    }

    const status = (e as any)?.status ?? 500;
    const message = (e as Error).message ?? "Server error";
    console.error("org-invite error", e);
    return json({ error: message }, { status, origin });
  }
});
